import { env } from "../config/env";
import { createRateLimiter } from "../lib/rateLimiter";

/**
 * Per-identity AI limits are bypassable because a guest can mint a fresh
 * identity per join. These limits are keyed by things an attacker cannot mint
 * for free: network address, room, and a global daily budget that bounds the
 * worst-case spend on server-side provider credentials.
 */
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const ipLimiter = createRateLimiter({ limit: env.aiIpRateLimit, windowMs: MINUTE_MS, maxKeys: 10_000 });
const roomLimiter = createRateLimiter({ limit: env.aiRoomRateLimit, windowMs: MINUTE_MS, maxKeys: 5_000 });
const dailyLimiter = createRateLimiter({ limit: env.aiGlobalDailyLimit, windowMs: DAY_MS, maxKeys: 1 });
const GLOBAL_KEY = "global";

export type AIBudgetDecision =
  | { ok: true }
  | { ok: false; status: 429 | 503; code: "RATE_LIMITED" | "AI_BUDGET_EXHAUSTED"; message: string; retryAfterMs: number };

export const checkAIBudget = (input: { ip: string | undefined; roomId: string }): AIBudgetDecision => {
  const ipKey = input.ip || "unknown";
  if (dailyLimiter.isLimited(GLOBAL_KEY)) {
    return { ok: false, status: 503, code: "AI_BUDGET_EXHAUSTED", message: "The shared AI budget for today has been used. Try again later.", retryAfterMs: dailyLimiter.retryAfterMs(GLOBAL_KEY) };
  }
  if (ipLimiter.isLimited(ipKey)) {
    return { ok: false, status: 429, code: "RATE_LIMITED", message: "Too many AI requests from this network. Please wait a moment.", retryAfterMs: ipLimiter.retryAfterMs(ipKey) };
  }
  if (roomLimiter.isLimited(input.roomId)) {
    return { ok: false, status: 429, code: "RATE_LIMITED", message: "This room is sending AI requests too quickly. Please wait a moment.", retryAfterMs: roomLimiter.retryAfterMs(input.roomId) };
  }
  dailyLimiter.hit(GLOBAL_KEY);
  ipLimiter.hit(ipKey);
  roomLimiter.hit(input.roomId);
  return { ok: true };
};

export const resetAIBudget = () => {
  ipLimiter.reset();
  roomLimiter.reset();
  dailyLimiter.reset();
};
