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

const signGuestValue = (roomId: string, userId: string) =>
  createHmac("sha256", env.guestSessionSecret).update(`${roomId}:${userId}`).digest("base64url");

export const createGuestSessionToken = (roomId: string, userId: string) => `${userId}.${signGuestValue(roomId, userId)}`;

export const verifyGuestSessionToken = (roomId: string, token: string | undefined) => {
  if (!token) return "";

  const [userId, signature] = token.split(".");
  const safeUserId = sanitizeUserId(userId);
  if (!safeUserId || !signature) return "";

  const expected = signGuestValue(roomId, safeUserId);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right) ? safeUserId : "";
};
