import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { User } from "@supabase/supabase-js";
import { env } from "../config/env";
import { verifySupabaseAccessToken } from "../lib/supabase";
import { sanitizeUserId } from "../utils/validation";

export interface AuthenticatedIdentity {
  kind: "member";
  userId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  authUser: User;
}

export interface GuestIdentity {
  kind: "guest";
  userId: string;
  displayName: string;
  avatarUrl: null;
}

export type RequestIdentity = AuthenticatedIdentity | GuestIdentity;

export interface AuthenticatedRequest extends Request {
  identity: RequestIdentity;
}

const getBearerToken = (authorization: string | undefined) => {
  if (!authorization?.startsWith("Bearer ")) {
    return "";
  }

  return authorization.slice("Bearer ".length).trim();
};

const displayNameFromUser = (user: User) => {
  const metadata = user.user_metadata as Record<string, unknown> | null;
  const name = metadata && typeof metadata.name === "string" ? metadata.name : "";
  const fullName = metadata && typeof metadata.full_name === "string" ? metadata.full_name : "";
  return (name || fullName || user.email?.split("@")[0] || "Member").slice(0, 80);
};

const avatarFromUser = (user: User) => {
  const metadata = user.user_metadata as Record<string, unknown> | null;
  return metadata && typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;
};

export const resolveIdentityFromToken = async (token: string): Promise<AuthenticatedIdentity | null> => {
  const user = await verifySupabaseAccessToken(token);
  if (!user) {
    return null;
  }

  return {
    kind: "member",
    userId: user.id,
    email: user.email ?? null,
    displayName: displayNameFromUser(user),
    avatarUrl: avatarFromUser(user),
    authUser: user
  };
};

export const anonymousIdentity = (displayName = "Guest"): GuestIdentity => ({
  kind: "guest",
  userId: randomUUID(),
  displayName,
  avatarUrl: null
});

export const optionalAuth = async (request: Request, _response: Response, next: NextFunction) => {
  try {
    const token = getBearerToken(request.headers.authorization);
    const identity = token ? await resolveIdentityFromToken(token) : null;
    (request as AuthenticatedRequest).identity = identity ?? anonymousIdentity();
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const token = getBearerToken(request.headers.authorization);
    const identity = token ? await resolveIdentityFromToken(token) : null;
    if (!identity) {
      response.status(401).json({ ok: false, message: "Sign in to continue." });
      return;
    }
    (request as AuthenticatedRequest).identity = identity;
    next();
  } catch (error) {
    next(error);
  }
};

const signGuestValue = (roomId: string, userId: string) =>
  createHmac("sha256", env.guestSessionSecret).update(`${roomId}:${userId}`).digest("base64url");

export const createGuestSessionToken = (roomId: string, userId: string) => `${userId}.${signGuestValue(roomId, userId)}`;

export const verifyGuestSessionToken = (roomId: string, token: string | undefined) => {
  if (!token) {
    return "";
  }

  const [userId, signature] = token.split(".");
  const safeUserId = sanitizeUserId(userId);
  if (!safeUserId || !signature) {
    return "";
  }

  const expected = signGuestValue(roomId, safeUserId);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right) ? safeUserId : "";
};
