import { Router } from "express";
import { createGuestSessionToken, guestSession, verifyGuestSessionToken, type GuestRequest } from "../middleware/guestSession";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { gitService } from "../modules/git/gitService";
import { isSupportedLanguage, sanitizeLanguage, sanitizeRoomId, sanitizeUsername } from "../utils/validation";

const router = Router();

const sendError = (response: { status: (status: number) => { json: (payload: unknown) => void } }, status: number, message: string) => {
  response.status(status).json({
    ok: false,
    message
  });
};

const roomErrorStatus = (error: unknown, fallback = 400) => {
  const message = error instanceof Error ? error.message : "";
  if (/not found/i.test(message)) return 404;
  if (/permission denied|only the owner|valid room session/i.test(message)) return 403;
  if (/paused|already exists|conflict/i.test(message)) return 409;
  return fallback;
};

const loadRoomIfNeeded = async (roomId: string) => {
  if (roomStore.hasRoom(roomId)) {
    return true;
  }

  const persisted = await roomPersistence.loadRoom(roomId);
  if (!persisted) {
    return false;
  }

  roomStore.upsertRoomSnapshot(persisted);
  return true;
};

const participantResponse = (roomId: string, userId: string) => ({
  identityKind: "guest" as const,
  guestToken: createGuestSessionToken(roomId, userId)
});

const guestTokenFrom = (request: GuestRequest) => {
  const bodyToken = typeof request.body?.guestToken === "string" ? request.body.guestToken : "";
  const queryToken = typeof request.query.guestToken === "string" ? request.query.guestToken : "";
  return bodyToken || queryToken;
};

const roomParticipantId = (request: GuestRequest, roomId: string) => {
  const userId = verifyGuestSessionToken(roomId, guestTokenFrom(request));
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

  try {
    const exists = await loadRoomIfNeeded(roomId);
    if (!exists) {
      sendError(response, 404, "Room not found");
      return;
    }

    const suppliedToken = typeof request.body?.guestToken === "string" ? request.body.guestToken : "";
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

    await Promise.all([
      roomPersistence.saveRoom(joined.room)
    ]);

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

router.get("/:roomId", guestSession, async (request, response) => {
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
    await roomPersistence.saveRoom(restored.room);
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
    const persisted = await roomPersistence.deleteRoom(roomId);
    if (!persisted) {
      sendError(response, 503, "Room persistence is unavailable. The room was not deleted.");
      return;
    }
    roomStore.deleteRoom(roomId, userId);
    response.status(204).send();
  } catch (error) {
    sendError(response, roomErrorStatus(error, 403), error instanceof Error ? error.message : "Unable to delete room");
  }
});

export default router;
