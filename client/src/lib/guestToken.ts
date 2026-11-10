/**
 * Helpers for the signed guest session token: `v2.<userId>.<expiresAtSeconds>.<signature>`.
 * The browser never verifies the signature (it cannot); it only reads the public
 * expiry so it knows when to ask the server for a fresh token.
 */
const DAY_MS = 24 * 60 * 60_000;
export const GUEST_TOKEN_REFRESH_WINDOW_MS = 7 * DAY_MS;

/** Expiry in epoch milliseconds, or null for tokens without one (pre-expiry format) or malformed input. */
export const guestTokenExpiry = (token: string | undefined): number | null => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return null;
  const seconds = Number(parts[2]);
  return Number.isInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
};

export const isGuestTokenExpired = (token: string | undefined, now = Date.now()) => {
  const expiry = guestTokenExpiry(token);
  return expiry !== null && expiry <= now;
};

/** Old-format tokens and tokens close to expiry should be exchanged for a fresh one. */
export const shouldRefreshGuestToken = (token: string | undefined, now = Date.now()) => {
  if (!token) return false;
  const expiry = guestTokenExpiry(token);
  return expiry === null || expiry - now < GUEST_TOKEN_REFRESH_WINDOW_MS;
};

/** A token that is known to be expired is worse than none: the server would refuse the join outright. */
export const usableGuestToken = (token: string | undefined, now = Date.now()) => (isGuestTokenExpired(token, now) ? undefined : token);

/**
 * Tokens in a URL end up in proxy and access logs. Lift a `guestToken` query
 * parameter out of the URL and into the `X-Guest-Token` header instead.
 */
export const moveGuestTokenToHeader = (input: string, init?: RequestInit): { input: string; init: RequestInit | undefined } => {
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  let url: URL;
  try { url = new URL(input, "http://placeholder.invalid"); } catch { return { input, init }; }
  const token = url.searchParams.get("guestToken");
  if (!token) return { input, init };
  url.searchParams.delete("guestToken");
  const headers = new Headers(init?.headers);
  headers.set("X-Guest-Token", token);
  return { input: absolute ? url.toString() : `${url.pathname}${url.search}`, init: { ...init, headers } };
};
