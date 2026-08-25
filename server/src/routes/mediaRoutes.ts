import { Router } from "express";
import { guestSession, verifyGuestSessionToken } from "../middleware/guestSession";
import { mediaService as defaultMediaService } from "../modules/media/liveKitMediaService";
import { MediaUnavailableError, type MediaService } from "../modules/media/mediaTypes";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { sanitizeRoomId } from "../utils/validation";

const TOKEN_WINDOW_MS = 60_000;
const TOKEN_LIMIT = 8;
const tokenRequests = new Map<string, { startedAt: number; count: number }>();

const loadRoomIfNeeded = async (roomId: string) => {
  if (roomStore.hasRoom(roomId)) return true;
  const persisted = await roomPersistence.loadRoom(roomId);
  if (!persisted) return false;
  roomStore.upsertRoomSnapshot(persisted);
  return true;
};

const allowTokenRequest = (key: string) => {
  const now = Date.now(); const previous = tokenRequests.get(key);
  if (!previous || now - previous.startedAt > TOKEN_WINDOW_MS) { tokenRequests.set(key, { startedAt: now, count: 1 }); return true; }
  previous.count += 1; return previous.count <= TOKEN_LIMIT;
};

const error = (response: import("express").Response, status: number, message: string, code: string) => response.status(status).json({ ok: false, message, code });

export const createMediaRoutes = (mediaService: MediaService = defaultMediaService) => {
  const router = Router();

  router.get("/media/status", (_request, response) => {
    const status = mediaService.getStatus();
    response.json({ ok: true, provider: status.provider, configured: status.configured });
  });

  router.post("/rooms/:roomId/media/token", guestSession, async (request, response) => {
    const roomId = sanitizeRoomId(request.params.roomId);
    if (!roomId) { error(response, 400, "A valid room ID is required.", "INVALID_ROOM"); return; }
    const userId = verifyGuestSessionToken(roomId, typeof request.body?.guestToken === "string" ? request.body.guestToken : undefined);
    if (!userId) { error(response, 401, "A valid room session is required.", "ROOM_SESSION_INVALID"); return; }
    if (!allowTokenRequest(`${roomId}:${userId}`)) { error(response, 429, "Too many media token requests. Please wait a moment.", "RATE_LIMITED"); return; }
    if (!(await loadRoomIfNeeded(roomId))) { error(response, 404, "Room not found.", "ROOM_NOT_FOUND"); return; }
    try {
      const participant = roomStore.getParticipant(roomId, userId);
      if (!mediaService.getStatus().configured) { error(response, 503, "Voice and video are not configured on this server.", "MEDIA_NOT_CONFIGURED"); return; }
      const session = await mediaService.issueToken({ roomId, participant: { userId: participant.userId, username: participant.username, role: participant.role, identityKind: participant.identityKind ?? "guest" } });
      response.json({ ok: true, session });
    } catch (issue) {
      if (issue instanceof MediaUnavailableError) { error(response, 503, issue.message, "MEDIA_NOT_CONFIGURED"); return; }
      error(response, 403, issue instanceof Error ? issue.message : "Unable to start media.", "MEDIA_FORBIDDEN");
    }
  });

  return router;
};

export default createMediaRoutes();
