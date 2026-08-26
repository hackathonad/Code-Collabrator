import { spawn } from "node:child_process";
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
  const executable = process.platform === "win32" ? "npm.cmd" : command.command;
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? VALIDATION_TIMEOUT_MS;
  const child = spawn(executable, command.args, {
    cwd: options.cwd ?? process.cwd(),
    shell: false,
    windowsHide: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API_KEY|SECRET|TOKEN|PASSWORD|SUPABASE|GUEST_SESSION)/i.test(key))) as NodeJS.ProcessEnv
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const append = (target: "stdout" | "stderr", chunk: Buffer) => {
    const value = chunk.toString();
    if (target === "stdout") stdout = clip(stdout + value);
    else stderr = clip(stderr + value);
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  const abort = () => child.kill("SIGTERM");
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  });
  const ok = !timedOut && exitCode === 0;
  return {
    category,
    ok,
    exitCode,
    timedOut,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    summary: timedOut ? `${category} timed out` : ok ? `${category} passed` : `${category} failed (exit ${exitCode ?? "unknown"})`
  } satisfies ValidationRunResult;
};
