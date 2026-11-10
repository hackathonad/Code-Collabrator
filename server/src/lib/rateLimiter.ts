/**
 * Small bounded fixed-window rate limiter shared by every route that needs one.
 *
 * Each limiter owns a Map capped at `maxKeys`, so an attacker rotating keys
 * (IPs, identities) cannot grow server memory without bound.
 */
export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimiter {
  /** Records one event for `key`; returns true while the key is within its limit. */
  hit(key: string): boolean;
  /** True when `key` has no capacity left in the current window. Records nothing. */
  isLimited(key: string): boolean;
  /** Milliseconds until `key` gets a fresh window (0 when it is not limited). */
  retryAfterMs(key: string): number;
  reset(key?: string): void;
  size(): number;
}

interface Entry { startedAt: number; count: number }

export const createRateLimiter = (options: RateLimiterOptions): RateLimiter => {
  const { limit, windowMs } = options;
  const maxKeys = Math.max(1, options.maxKeys ?? 10_000);
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  const live = (entry: Entry | undefined, at: number): entry is Entry => Boolean(entry) && at - entry!.startedAt < windowMs;

  const prune = (at: number) => {
    if (entries.size <= maxKeys) return;
    for (const [key, entry] of entries) if (!live(entry, at)) entries.delete(key);
    // Map iteration is insertion ordered and fresh windows are re-inserted, so
    // the first keys are the oldest. Drop them if expiry alone was not enough.
    while (entries.size > maxKeys) {
      const oldest = entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    hit(key) {
      const at = now();
      const current = entries.get(key);
      if (!live(current, at)) {
        entries.delete(key);
        entries.set(key, { startedAt: at, count: 1 });
        prune(at);
        return limit >= 1;
      }
      current.count += 1;
      return current.count <= limit;
    },
    isLimited(key) {
      const at = now();
      const current = entries.get(key);
      return live(current, at) && current.count >= limit;
    },
    retryAfterMs(key) {
      const at = now();
      const current = entries.get(key);
      return live(current, at) && current.count >= limit ? Math.max(0, current.startedAt + windowMs - at) : 0;
    },
    reset(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
    size: () => entries.size
  };
};
