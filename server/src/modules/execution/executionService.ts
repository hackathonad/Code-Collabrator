import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { env } from "../../config/env";
import { logSafeEvent } from "../../utils/safeLogger";
import { clearExecutionEvents, clearExecutionRoom, getExecution, publishExecution } from "./executionEvents";
import type { ExecutionAction, ExecutionCapabilities, ExecutionRecord, ExecutionStatus } from "./executionTypes";

const MAX_HISTORY = 40;
const SAFE_TARGET = /^(?:server\/)?test\/[A-Za-z0-9._-]+\.test\.cjs$/;

export const EXECUTION_PLANS: Record<Exclude<ExecutionAction, "run" | "targeted-tests">, { command: string; args: string[]; label: string }> = {
  tests: { command: "npm", args: ["test"], label: "Run project tests" },
  build: { command: "npm", args: ["run", "build"], label: "Build project" },
  typecheck: { command: "npm", args: ["run", "build", "--workspace", "server"], label: "TypeScript check" },
  lint: { command: "npm", args: ["run", "lint"], label: "Run ESLint" },
  diagnostics: { command: "npm", args: ["run", "build", "--workspace", "server"], label: "Project diagnostics" }
};

const actionLabels: Record<ExecutionAction, string> = {
  run: "Run project", tests: "Run tests", "targeted-tests": "Run targeted test", build: "Build", typecheck: "TypeScript check", lint: "ESLint", diagnostics: "Diagnostics"
};
const actionDescriptions: Record<ExecutionAction, string> = {
  run: "Room code is virtual and is not executed by the server.",
  tests: "Runs the repository's existing test script with a fixed command.",
  "targeted-tests": "Runs one existing server test file; no arbitrary command is accepted.",
  build: "Runs the repository's existing build script with a fixed command.",
  typecheck: "Runs the server TypeScript build with a fixed command.",
  lint: "Runs the repository ESLint script with a fixed command.",
  diagnostics: "Runs the server TypeScript diagnostics check with a fixed command."
};
const clip = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 30))}\n[…output truncated…]`;
const safeEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API_KEY|SECRET|TOKEN|PASSWORD|SUPABASE|AUTHORIZATION|COOKIE|SESSION)/i.test(key))) as NodeJS.ProcessEnv;
const commandFor = (action: ExecutionAction, target?: string, cwd = process.cwd()) => {
  if (action === "run") return { command: "not executed", args: [] };
  if (action === "targeted-tests") return { command: "node", args: ["--test", target ?? ""] };
  const serverPackage = existsSync(path.join(cwd, "src")) && existsSync(path.join(cwd, "package.json")) && !existsSync(path.join(cwd, "client"));
  const prefix = serverPackage ? ["--prefix", ".."] : [];
  if (action === "tests") return { command: "npm", args: ["test", ...prefix], label: EXECUTION_PLANS.tests.label };
  if (action === "build") return { command: "npm", args: ["run", "build", ...prefix], label: EXECUTION_PLANS.build.label };
  if (action === "lint") return { command: "npm", args: ["run", "lint", ...prefix], label: EXECUTION_PLANS.lint.label };
  if (action === "typecheck" || action === "diagnostics") return { command: "npm", args: ["run", "build", ...(serverPackage ? [] : ["--workspace", "server"])], label: EXECUTION_PLANS[action].label };
  return EXECUTION_PLANS[action];
};

export class ExecutionServiceError extends Error {
  constructor(public readonly code: "EXECUTION_CONFLICT" | "EXECUTION_NOT_FOUND" | "EXECUTION_NOT_ALLOWED" | "EXECUTION_LIMIT", message: string) { super(message); }
}

interface StartInput { roomId: string; workspaceId: string; ownerId: string; action: ExecutionAction; target?: string; requestId?: string; }
interface ExecutionServiceOptions { cwd?: string; timeoutMs?: number; outputLimit?: number; maxConcurrent?: number; spawnProcess?: typeof spawn; }

export class ExecutionService {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly outputLimit: number;
  private readonly maxConcurrent: number;
  private readonly spawnProcess: typeof spawn;
  private readonly history = new Map<string, ExecutionRecord[]>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly cancelRequested = new Set<string>();

  constructor(options: ExecutionServiceOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? env.executionTimeoutMs;
    this.outputLimit = options.outputLimit ?? env.executionOutputLimit;
    this.maxConcurrent = options.maxConcurrent ?? env.executionMaxConcurrent;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  capabilities(): ExecutionCapabilities {
    return { available: true, scope: "server-project", message: "Safe checks run only against the configured Code Collaborator project. Virtual room source is never passed to an arbitrary shell.", actions: (Object.keys(actionLabels) as ExecutionAction[]).map((action) => ({ action, label: actionLabels[action], available: action !== "run", description: actionDescriptions[action] })) };
  }

  list(roomId: string, workspaceId: string) { return (this.history.get(`${roomId}:${workspaceId}`) ?? []).map((record) => ({ ...record })); }

  get(executionId: string, roomId: string, workspaceId: string) { const record = getExecution(executionId); return record && record.roomId === roomId && record.workspaceId === workspaceId ? { ...record } : null; }

  start(input: StartInput) {
    const requestId = input.requestId?.trim().slice(0, 100) || undefined;
    const key = `${input.roomId}:${input.workspaceId}`;
    const prior = this.history.get(key)?.find((record) => requestId && record.requestId === requestId);
    if (prior) return { ...prior };
    const active = this.history.get(key)?.find((record) => record.status === "queued" || record.status === "running");
    if (active) throw new ExecutionServiceError("EXECUTION_CONFLICT", "Another validation is already running for this workspace.");
    if ([...this.children.keys()].length >= this.maxConcurrent) throw new ExecutionServiceError("EXECUTION_LIMIT", "The safe execution capacity is busy. Try again shortly.");
    const target = input.action === "targeted-tests" ? this.validateTarget(input.target) : undefined;
    const plan = commandFor(input.action, target, this.cwd);
    const now = Date.now();
    const record: ExecutionRecord = {
      executionId: randomUUID(), ...(requestId ? { requestId } : {}), roomId: input.roomId, workspaceId: input.workspaceId, ownerId: input.ownerId, action: input.action, ...(target ? { target } : {}), command: [plan.command, ...plan.args].join(" "), status: input.action === "run" ? "unavailable" : "queued", exitCode: null, durationMs: input.action === "run" ? 0 : null, output: input.action === "run" ? "Room source is virtual. Download it or use the external runner to execute it locally." : "", errorSummary: input.action === "run" ? "Server execution of room code is unavailable." : null, createdAt: now, ...(input.action === "run" ? { startedAt: now, completedAt: now } : {})
    };
    this.add(record);
    publishExecution(input.action === "run" ? "execution:updated" : "execution:started", record);
    if (input.action !== "run") void this.run(record, plan.command, plan.args);
    return { ...record };
  }

  cancel(executionId: string, roomId: string, workspaceId: string) {
    const record = this.get(executionId, roomId, workspaceId);
    if (!record) throw new ExecutionServiceError("EXECUTION_NOT_FOUND", "Execution was not found in this workspace.");
    if (record.status !== "queued" && record.status !== "running") return record;
    this.cancelRequested.add(executionId);
    this.children.get(executionId)?.kill("SIGTERM");
    if (record.status === "queued") this.finish(record, "cancelled", null, "Execution cancelled before it started.");
    return this.get(executionId, roomId, workspaceId)!;
  }

  clearRoom(roomId: string) {
    for (const record of [...this.history.values()].flat()) if (record.roomId === roomId && (record.status === "queued" || record.status === "running")) this.cancel(record.executionId, roomId, record.workspaceId);
    for (const key of this.history.keys()) if (key.startsWith(`${roomId}:`)) this.history.delete(key);
    clearExecutionRoom(roomId);
  }

  shutdown() { for (const child of this.children.values()) child.kill("SIGTERM"); this.children.clear(); this.history.clear(); this.cancelRequested.clear(); clearExecutionEvents(); }

  private validateTarget(target: string | undefined) {
    const normalized = typeof target === "string" ? target.replaceAll("\\", "/").trim() : "";
    const relative = normalized.startsWith("server/") ? normalized.slice("server/".length) : normalized;
    const serverCwd = existsSync(path.join(this.cwd, "src")) && existsSync(path.join(this.cwd, "package.json")) && !existsSync(path.join(this.cwd, "client")) ? this.cwd : path.join(this.cwd, "server");
    const testRoot = `${path.resolve(serverCwd, "test")}${path.sep}`;
    const resolved = path.resolve(serverCwd, relative);
    if ((!SAFE_TARGET.test(normalized) && !SAFE_TARGET.test(`server/${relative}`)) || normalized.includes("..") || !resolved.startsWith(testRoot) || !existsSync(resolved)) throw new ExecutionServiceError("EXECUTION_NOT_ALLOWED", "Targeted execution only accepts an existing server test path.");
    return serverCwd === this.cwd ? relative : `server/${relative}`;
  }

  private add(record: ExecutionRecord) { const key = `${record.roomId}:${record.workspaceId}`; this.history.set(key, [...(this.history.get(key) ?? []), record].slice(-MAX_HISTORY)); }

  private update(record: ExecutionRecord, status: ExecutionStatus, values: Partial<ExecutionRecord> = {}) {
    const next = { ...record, ...values, status }; const key = `${record.roomId}:${record.workspaceId}`; const entries = this.history.get(key) ?? []; const index = entries.findIndex((entry) => entry.executionId === record.executionId); if (index >= 0) entries[index] = next; publishExecution("execution:updated", next); return next;
  }

  private finish(record: ExecutionRecord, status: ExecutionStatus, exitCode: number | null, errorSummary: string | null, output = record.output) {
    const completedAt = Date.now(); const next = this.update(record, status, { exitCode, durationMs: completedAt - record.createdAt, completedAt, errorSummary, output: clip(output, this.outputLimit) }); this.children.delete(record.executionId); this.cancelRequested.delete(record.executionId); logSafeEvent("execution", status, { roomId: record.roomId, workspaceId: record.workspaceId, executionId: record.executionId, action: record.action, durationMs: next.durationMs }); return next;
  }

  private async run(record: ExecutionRecord, command: string, args: string[]) {
    const startedAt = Date.now(); const running = this.update(record, "running", { startedAt }); const executable = process.platform === "win32" && command === "npm" ? process.execPath : command; const executableArgs = process.platform === "win32" && command === "npm" ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args] : args;
    let child: ChildProcess;
    try { child = this.spawnProcess(executable, executableArgs, { cwd: this.cwd, shell: false, windowsHide: true, env: safeEnvironment() }); } catch { this.finish(running, "unavailable", null, "The approved validation command could not be started."); return; }
    this.children.set(record.executionId, child); let output = ""; let timedOut = false; let spawnError = false; const append = (chunk: Buffer) => { output = clip(output + chunk.toString(), this.outputLimit); }; child.stdout?.on("data", append); child.stderr?.on("data", append); const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, this.timeoutMs);
    const result = await new Promise<number | null>((resolve) => { child.once("error", () => { spawnError = true; resolve(null); }); child.once("close", (code) => resolve(code)); }); clearTimeout(timer);
    if (this.cancelRequested.has(record.executionId)) { this.finish(running, "cancelled", result, "Execution cancelled.", output); return; }
    if (timedOut) { this.finish(running, "timed_out", result, `Execution timed out after ${this.timeoutMs} ms.`, output); return; }
    if (spawnError) { this.finish(running, "unavailable", result, "The approved validation command was unavailable.", output); return; }
    this.finish(running, result === 0 ? "completed" : "failed", result, result === 0 ? null : `Command exited with code ${result ?? "unknown"}.`, output);
  }
}

export const executionService = new ExecutionService();
