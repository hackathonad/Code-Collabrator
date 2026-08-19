import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { profileService } from "../services/profileService";
import { sanitizeAccountUsername, sanitizeUsername } from "../utils/validation";

const router = Router();

router.get("/session", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  if (identity.kind !== "member") {
    response.status(401).json({ ok: false, message: "Sign in to continue." });
    return;
  }

  const profile = (await profileService.getProfile(identity.userId)) ?? (await profileService.ensureProfile(identity));
  response.json({ ok: true, user: { id: identity.userId, email: identity.email }, profile });
});

router.post("/logout", requireAuth, (_request, response) => {
  response.json({ ok: true });
});

router.get("/profile", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  if (identity.kind !== "member") {
    response.status(401).json({ ok: false, message: "Sign in to continue." });
    return;
  }

  const profile = (await profileService.getProfile(identity.userId)) ?? (await profileService.ensureProfile(identity));
  response.json({ ok: true, profile });
});

router.patch("/profile", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  if (identity.kind !== "member") {
    response.status(401).json({ ok: false, message: "Sign in to continue." });
    return;
  }

  const requestedUsername = request.body?.username;
  const username = requestedUsername === undefined ? "" : sanitizeAccountUsername(requestedUsername);
  const displayName = sanitizeUsername(request.body?.displayName);
  const avatarUrl = typeof request.body?.avatarUrl === "string" && /^https:\/\//i.test(request.body.avatarUrl) ? request.body.avatarUrl.slice(0, 500) : null;
  const bio = typeof request.body?.bio === "string" ? request.body.bio.trim().slice(0, 280) : undefined;
  const theme = typeof request.body?.theme === "string" ? request.body.theme.slice(0, 80) : undefined;

  if (requestedUsername !== undefined && !username) {
    response.status(400).json({ ok: false, message: "Username must be 3–24 characters and use only letters, numbers, hyphens, or underscores." });
    return;
  }

  const profile = await profileService.updateProfile(identity.userId, {
    ...(username ? { username } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    ...(request.body?.avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
    ...(bio !== undefined ? { bio } : {}),
    ...(theme ? { theme } : {}),
    ...(request.body?.preferences && typeof request.body.preferences === "object" ? { preferences: request.body.preferences } : {}),
    ...(request.body?.profileSettings && typeof request.body.profileSettings === "object" ? { profile_settings: request.body.profileSettings } : {})
  });

  response.json({ ok: true, profile });
});

router.get("/settings", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  if (identity.kind !== "member") {
    response.status(401).json({ ok: false, message: "Sign in to continue." });
    return;
  }

  const profile = await profileService.getProfile(identity.userId);
  response.json({ ok: true, settings: { theme: profile?.theme ?? "aurora", preferences: profile?.preferences ?? {} } });
});

router.get("/recent-rooms", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  if (identity.kind !== "member") {
    response.status(401).json({ ok: false, message: "Sign in to continue." });
    return;
  }

  response.json({ ok: true, rooms: await profileService.listRecentRooms(identity.userId) });
});

export default router;
