import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import { sanitizeUserId } from "../utils/validation";

export interface GuestIdentity {
  kind: "guest";
  userId: string;
  displayName: string;
  avatarUrl: null;
}

export interface GuestRequest extends Request {
  identity: GuestIdentity;
}

export const anonymousIdentity = (displayName = "Guest"): GuestIdentity => ({
  kind: "guest",
  userId: randomUUID(),
  displayName,
  avatarUrl: null
});

/**
 * Room APIs are guest-only. A bearer header is rejected rather than treated
 * as a guest so an old client cannot accidentally bypass the guest-session
 * contract.
 */
export const guestSession = async (request: Request, response: Response, next: NextFunction) => {
  if (request.headers.authorization) {
    response.status(401).json({ ok: false, message: "Bearer authentication is not supported. Use the room guest session instead." });
    return;
  }

  (request as GuestRequest).identity = anonymousIdentity();
  next();
};

/** A guest session lasts this long; every join or refresh issues a fresh one. */
export const GUEST_TOKEN_TTL_MS = 14 * 24 * 60 * 60_000;
/** Refresh once fewer than this many days remain. Used by clients and tests. */
export const GUEST_TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60_000;
/**
 * Tokens issued before expiry existed (`userId.signature`) and tokens sent in
 * the URL query string are accepted until this instant so open sessions can
 * upgrade through a join or refresh. After it they are rejected.
 */
export const LEGACY_AUTH_SUNSET_MS = Date.UTC(2026, 11, 10);

const TOKEN_VERSION = "v2";

const signLegacyValue = (roomId: string, userId: string) =>
  createHmac("sha256", env.guestSessionSecret).update(`${roomId}:${userId}`).digest("base64url");

const signValue = (roomId: string, userId: string, expiresAtSeconds: number) =>
  createHmac("sha256", env.guestSessionSecret).update(`${TOKEN_VERSION}:${roomId}:${userId}:${expiresAtSeconds}`).digest("base64url");

const signaturesMatch = (supplied: string, expected: string) => {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** `v2.<userId>.<expiresAtSeconds>.<signature>`, bound to the room and the expiry. */
export const createGuestSessionToken = (roomId: string, userId: string, now = Date.now()) => {
  const expiresAtSeconds = Math.floor((now + GUEST_TOKEN_TTL_MS) / 1000);
  return `${TOKEN_VERSION}.${userId}.${expiresAtSeconds}.${signValue(roomId, userId, expiresAtSeconds)}`;
};

export interface InspectedGuestToken {
  userId: string;
  /** True for a pre-expiry token that should be replaced by a v2 token. */
  legacy: boolean;
  expiresAt: number | null;
}

export const inspectGuestSessionToken = (roomId: string, token: string | undefined, now = Date.now()): InspectedGuestToken | null => {
  if (!token) return null;
  const parts = token.split(".");

  if (parts.length === 4 && parts[0] === TOKEN_VERSION) {
    const userId = sanitizeUserId(parts[1]);
    const expiresAtSeconds = Number(parts[2]);
    if (!userId || !Number.isInteger(expiresAtSeconds) || !parts[3]) return null;
    if (!signaturesMatch(parts[3], signValue(roomId, userId, expiresAtSeconds))) return null;
    if (expiresAtSeconds * 1000 <= now) return null;
    return { userId, legacy: false, expiresAt: expiresAtSeconds * 1000 };
  }

  if (parts.length === 2 && now < LEGACY_AUTH_SUNSET_MS) {
    const userId = sanitizeUserId(parts[0]);
    if (!userId || !parts[1]) return null;
    return signaturesMatch(parts[1], signLegacyValue(roomId, userId)) ? { userId, legacy: true, expiresAt: null } : null;
  }

  return null;
};

export const verifyGuestSessionToken = (roomId: string, token: string | undefined, now = Date.now()) =>
  inspectGuestSessionToken(roomId, token, now)?.userId ?? "";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Where a request carries its guest token, in order of preference: the
 * `X-Guest-Token` header, then the JSON body, then (legacy only) the query
 * string. Query strings are written to proxy and access logs, so they are only
 * honoured for older clients until the sunset.
 */
export const guestTokenFromRequest = (request: Request, now = Date.now()): string => {
  const header = request.headers["x-guest-token"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();
  const body: unknown = request.body;
  if (isRecord(body) && typeof body.guestToken === "string" && body.guestToken) return body.guestToken;
  if (now < LEGACY_AUTH_SUNSET_MS && typeof request.query?.guestToken === "string") return request.query.guestToken;
  return "";
};

export const guestUserIdFromRequest = (request: Request, roomId: string) => verifyGuestSessionToken(roomId, guestTokenFromRequest(request));
