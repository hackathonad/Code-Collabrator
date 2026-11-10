import { Router } from "express";
import { env } from "../config/env";
import { createRateLimiter } from "../lib/rateLimiter";
import { GUEST_TOKEN_TTL_MS, createGuestSessionToken, guestSession, guestTokenFromRequest, guestUserIdFromRequest, inspectGuestSessionToken, verifyGuestSessionToken, type GuestRequest } from "../middleware/guestSession";
import { roomStore } from "../modules/rooms/roomStore";
import { loadRoomIfNeeded } from "../modules/rooms/roomLoader";
import { roomPersistence } from "../services/roomPersistence";
import { deleteRoomDurably } from "../services/roomDeletion";
import { EMERGENCY_IDLE_TTL_MS, sweepIdleRooms } from "../services/roomLifecycle";
import { gitService } from "../modules/git/gitService";
import { isSupportedLanguage, sanitizeLanguage, sanitizeRoomId, sanitizeUsername } from "../utils/validation";

export { loadRoomIfNeeded };

const router = Router();

// Creating rooms is unauthenticated, so it is limited per network address.
const createLimiter = createRateLimiter({ limit: env.roomCreateRateLimit, windowMs: 60 * 60_000, maxKeys: 10_000 });
// Room IDs are the join capability. Repeated misses from one address look like
// enumeration, so only misses count and they are throttled.
const missLimiter = createRateLimiter({ limit: env.roomMissRateLimit, windowMs: 60_000, maxKeys: 10_000 });
const clientAddress = (request: { ip?: string; socket: { remoteAddress?: string } }) => request.ip || request.socket.remoteAddress || "unknown";
const throttledForMisses = (request: GuestRequest, response: Parameters<typeof sendError>[0]) => {
  if (!missLimiter.isLimited(clientAddress(request))) return false;
  sendError(response, 429, "Too many unknown room lookups. Please wait a moment and try again.");
  return true;
};
const recordMiss = (request: GuestRequest) => { missLimiter.hit(clientAddress(request)); };

/** Test hook: clears per-process limiter state. */
export const resetRoomRouteLimiters = () => { createLimiter.reset(); missLimiter.reset(); };

export const sendError = (response: { status: (status: number) => { json: (payload: unknown) => void } }, status: number, message: string) => {
  response.status(status).json({
    ok: false,
    message
  });
};

export const roomErrorStatus = (error: unknown, fallback = 400) => {
  const message = error instanceof Error ? error.message : "";
  if (/not found/i.test(message)) return 404;
  if (/permission denied|only the owner|valid room session/i.test(message)) return 403;
  if (/paused|already exists|conflict|room is full/i.test(message)) return 409;
  return fallback;
};

const participantResponse = (roomId: string, userId: string) => ({
  identityKind: "guest" as const,
  guestToken: createGuestSessionToken(roomId, userId)
});

export const roomParticipantId = (request: GuestRequest, roomId: string) => {
  const userId = guestUserIdFromRequest(request, roomId);
  if (!userId) return "";
  try {
    roomStore.getParticipant(roomId, userId);
    return userId;
  } catch {
    return "";
  }
};

router.post("/", guestSession, async (request, response) => {
  const identity = (request as GuestRequest).identity;
  const requestedUsername = sanitizeUsername(request.body?.username);
  const username = requestedUsername || identity.displayName;
  const language = sanitizeLanguage(request.body?.language);

  if (!username) {
    sendError(response, 400, "Display name is required");
    return;
  }
  if (request.body?.language !== undefined && !isSupportedLanguage(request.body.language)) {
    sendError(response, 400, "Unsupported room language");
    return;
  }

  if (!createLimiter.hit(clientAddress(request))) {
    sendError(response, 429, "Too many rooms were created from this network. Please try again later.");
    return;
  }
  if (roomStore.roomCount() >= env.maxActiveRooms) {
    // Try to reclaim rooms nobody has touched for an hour before refusing.
    await sweepIdleRooms({ ttlMs: EMERGENCY_IDLE_TTL_MS });
    if (roomStore.roomCount() >= env.maxActiveRooms) {
      sendError(response, 503, "The server is at room capacity right now. Please try again shortly.");
      return;
    }
  }

  const created = roomStore.createRoom(username, language, {
    userId: identity.userId,
    identityKind: "guest",
    avatarUrl: identity.avatarUrl
  });

  // Room creation is an in-memory operation first. Persistence is optional
  // and must not delay the REST response or make a cold/unavailable database
  // look like a failed room-creation request to the browser.
  void roomPersistence.saveRoom(created.room);

  response.status(201).json({
    ok: true,
    room: created.room,
    participant: {
      userId: created.participant.userId,
      username: created.participant.username,
      ...participantResponse(created.room.roomId, created.participant.userId)
    }
  });
});

router.post("/:roomId/join", guestSession, async (request, response) => {
  const identity = (request as GuestRequest).identity;
  const roomId = sanitizeRoomId(request.params.roomId);
  const username = sanitizeUsername(request.body?.username) || identity.displayName;

  if (!roomId) {
    sendError(response, 400, "Valid room ID is required");
    return;
  }
  if (!username) {
    sendError(response, 400, "Display name is required");
    return;
  }
  if (throttledForMisses(request as GuestRequest, response)) return;

  try {
    const exists = await loadRoomIfNeeded(roomId);
    if (!exists) {
      recordMiss(request as GuestRequest);
      sendError(response, 404, "Room not found");
      return;
    }

    const suppliedToken = guestTokenFromRequest(request);
    const guestUserId = suppliedToken ? verifyGuestSessionToken(roomId, suppliedToken) : identity.userId;
    if (suppliedToken && !guestUserId) {
      sendError(response, 401, "A valid room session is required");
      return;
    }
    const joined = roomStore.joinRoom(roomId, username, guestUserId, {
      userId: guestUserId || identity.userId,
      identityKind: "guest",
      avatarUrl: identity.avatarUrl
    });

    // Joining is served from authoritative in-memory state. Persistence is a
    // best-effort durability update and must not make an active room depend on
    // Supabase availability.
    void roomPersistence.saveRoom(joined.room);

    response.json({
      ok: true,
      room: joined.room,
      participant: {
        userId: joined.participant.userId,
        username: joined.participant.username,
        ...participantResponse(roomId, joined.participant.userId)
      }
    });
  } catch (error) {
    sendError(response, roomErrorStatus(error, 404), error instanceof Error ? error.message : "Unable to join room");
  }
});

/**
 * Issues a fresh session for an existing participant. Sessions expire, so
 * clients call this when a token is old or still in the pre-expiry format.
 */
router.post("/:roomId/session/refresh", guestSession, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId) {
    sendError(response, 400, "Valid room ID is required");
    return;
  }
  if (throttledForMisses(request as GuestRequest, response)) return;
  try {
    if (!(await loadRoomIfNeeded(roomId))) {
      recordMiss(request as GuestRequest);
      sendError(response, 404, "Room not found");
      return;
    }
    const inspected = inspectGuestSessionToken(roomId, guestTokenFromRequest(request));
    if (!inspected) {
      sendError(response, 401, "A valid room session is required");
      return;
    }
    if (!roomStore.hasRoom(roomId) || !roomStore.getRoomSnapshot(roomId).participants.some((participant) => participant.userId === inspected.userId)) {
      sendError(response, 403, "Join this room before refreshing its session.");
      return;
    }
    const guestToken = createGuestSessionToken(roomId, inspected.userId);
    response.json({ ok: true, guestToken, expiresAt: inspectGuestSessionToken(roomId, guestToken)?.expiresAt ?? Date.now() + GUEST_TOKEN_TTL_MS });
  } catch (error) {
    sendError(response, roomErrorStatus(error, 404), error instanceof Error ? error.message : "Unable to refresh the session");
  }
});

router.get("/:roomId", guestSession, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId) {
    sendError(response, 400, "Valid room ID is required");
    return;
  }
  if (throttledForMisses(request as GuestRequest, response)) return;

  try {
    const exists = await loadRoomIfNeeded(roomId);
    if (!exists) {
      recordMiss(request as GuestRequest);
      sendError(response, 404, "Room not found");
      return;
    }
    if (!roomParticipantId(request as GuestRequest, roomId)) {
      sendError(response, 403, "Join this room before loading its workspace.");
      return;
    }
    response.json(roomStore.getRoomSnapshot(roomId));
  } catch (error) {
    sendError(response, roomErrorStatus(error, 404), error instanceof Error ? error.message : "Room not found");
  }
});

router.get("/:roomId/repository", guestSession, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId || !(await loadRoomIfNeeded(roomId))) {
    sendError(response, 404, "Room not found");
    return;
  }
  try {
    if (!roomParticipantId(request as GuestRequest, roomId)) {
      sendError(response, 403, "Join this room before viewing repository details.");
      return;
    }
    const room = roomStore.getRoomSnapshot(roomId);
    response.json({ ok: true, repository: await gitService.getSummary(room.workspace) });
  } catch (error) {
    sendError(response, 503, error instanceof Error ? error.message : "Repository state is unavailable");
  }
});

router.post("/:roomId/repository/refresh", guestSession, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId || !(await loadRoomIfNeeded(roomId))) {
    sendError(response, 404, "Room not found");
    return;
  }
  try {
    if (!roomParticipantId(request as GuestRequest, roomId)) {
      sendError(response, 403, "Join this room before refreshing repository details.");
      return;
    }
    const room = roomStore.getRoomSnapshot(roomId);
    gitService.invalidate(room.workspace.id);
    response.json({ ok: true, repository: await gitService.getSummary(room.workspace) });
  } catch (error) {
    sendError(response, 503, error instanceof Error ? error.message : "Repository state is unavailable");
  }
});

router.get("/:roomId/history", guestSession, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId) {
    sendError(response, 400, "Valid room ID is required");
    return;
  }

  try {
    const exists = await loadRoomIfNeeded(roomId);
    if (!exists) {
      sendError(response, 404, "Room not found");
      return;
    }
    if (!roomParticipantId(request as GuestRequest, roomId)) {
      sendError(response, 403, "Join this room before viewing its history.");
      return;
    }
    response.json(roomStore.getRoomSnapshot(roomId).history);
  } catch (error) {
    sendError(response, roomErrorStatus(error, 404), error instanceof Error ? error.message : "Room not found");
  }
});

router.post("/:roomId/history/:historyId/restore", guestSession, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);

  if (!roomId) {
    sendError(response, 400, "Valid room ID is required");
    return;
  }
  try {
    if (!(await loadRoomIfNeeded(roomId))) {
      sendError(response, 404, "Room not found");
      return;
    }
    const userId = roomParticipantId(request as GuestRequest, roomId);
    if (!userId) {
      sendError(response, 401, "A valid room session is required");
      return;
    }
    const restored = roomStore.restoreHistoryEntry(roomId, userId, String(request.params.historyId ?? ""));
    void roomPersistence.saveRoom(restored.room);
    response.json({ ok: true, ...restored });
  } catch (error) {
    sendError(response, roomErrorStatus(error, 403), error instanceof Error ? error.message : "Unable to restore room history");
  }
});

router.delete("/:roomId", guestSession, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);

  if (!roomId) {
    sendError(response, 400, "Valid room ID is required");
    return;
  }
  try {
    if (!(await loadRoomIfNeeded(roomId))) {
      sendError(response, 404, "Room not found");
      return;
    }
    const userId = roomParticipantId(request as GuestRequest, roomId);
    if (!userId) {
      sendError(response, 401, "A valid room session is required");
      return;
    }
    if (roomStore.getRoomSnapshot(roomId).ownerId !== userId) {
      sendError(response, 403, "Only the owner can delete the room");
      return;
    }
    // Invalidate the live room before touching the optional database. A
    // persistence outage must never leave a deleted room usable in memory.
    roomStore.deleteRoom(roomId, userId);
    const persisted = await deleteRoomDurably(roomId);
    if (!persisted) {
      sendError(response, 503, "The room was deleted from active memory, but durable persistence could not be updated.");
      return;
    }
    response.status(204).send();
  } catch (error) {
    sendError(response, roomErrorStatus(error, 403), error instanceof Error ? error.message : "Unable to delete room");
  }
});

export default router;
