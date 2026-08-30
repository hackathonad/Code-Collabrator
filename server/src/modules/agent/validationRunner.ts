import { spawn } from "node:child_process";
import path from "node:path";
import type { ValidationCategory, ValidationRunResult, ValidationRunner } from "./agentTypes";

export const VALIDATION_COMMANDS: Record<ValidationCategory, { command: string; args: string[] }> = {
  typecheck: { command: "npm", args: ["run", "build"] },
  lint: { command: "npm", args: ["run", "lint"] },
  tests: { command: "npm", args: ["test"] },
  build: { command: "npm", args: ["run", "build"] }
};

const MAX_OUTPUT = 12_000;
export const VALIDATION_TIMEOUT_MS = 30_000;

const clip = (value: string) => value.length <= MAX_OUTPUT ? value : `${value.slice(0, MAX_OUTPUT)}\n[…output truncated…]`;

export const createValidationRunner = (options: { cwd?: string; timeoutMs?: number } = {}): ValidationRunner => async (category, signal) => {
  const command = VALIDATION_COMMANDS[category];
  if (!command) throw new Error("Validation category is not allowed");
  if (signal?.aborted) return { category, ok: false, exitCode: null, timedOut: false, cancelled: true, stdout: "", stderr: "", durationMs: 0, summary: `${category} cancelled` };
  const executable = process.platform === "win32" ? process.execPath : command.command;
  const args = process.platform === "win32"
    ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...command.args]
    : command.args;
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? VALIDATION_TIMEOUT_MS;
  const child = spawn(executable, args, {
    cwd: options.cwd ?? process.cwd(),
    shell: false,
    windowsHide: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API_KEY|SECRET|TOKEN|PASSWORD|SUPABASE|GUEST_SESSION)/i.test(key))) as NodeJS.ProcessEnv
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let cancelled = false;
  const append = (target: "stdout" | "stderr", chunk: Buffer) => {
    const value = chunk.toString();
    if (target === "stdout") stdout = clip(stdout + value);
    else stderr = clip(stderr + value);
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  const abort = () => { cancelled = true; child.kill("SIGTERM"); };
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  let spawnError = false;
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once("error", () => { spawnError = true; resolve(null); });
    child.once("close", (code) => resolve(code));
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  });
  const ok = !timedOut && !cancelled && !spawnError && exitCode === 0;
  return {
    category,
    ok,
    exitCode,
    timedOut,
    cancelled,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    summary: timedOut ? `${category} timed out` : cancelled ? `${category} cancelled` : spawnError ? `${category} unavailable: validation could not start` : ok ? `${category} passed` : `${category} failed (exit ${exitCode ?? "unknown"})`
  } satisfies ValidationRunResult;
};
