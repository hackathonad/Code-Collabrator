import { Router } from "express";
import { optionalAuth, verifyGuestSessionToken, createGuestSessionToken, type AuthenticatedRequest } from "../middleware/auth";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { profileService } from "../services/profileService";
import { gitService } from "../modules/git/gitService";
import { sanitizeLanguage, sanitizeRoomId, sanitizeUsername } from "../utils/validation";
import { analyticsService } from "../services/analyticsService";

const router = Router();

const sendError = (response: { status: (status: number) => { json: (payload: unknown) => void } }, status: number, message: string) => {
  response.status(status).json({
    ok: false,
    message
  });
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

const participantResponse = (roomId: string, userId: string, identityKind: "guest" | "member") => ({
  identityKind,
  guestToken: identityKind === "guest" ? createGuestSessionToken(roomId, userId) : undefined
});

const guestTokenFrom = (request: AuthenticatedRequest) => {
  const bodyToken = typeof request.body?.guestToken === "string" ? request.body.guestToken : "";
  const queryToken = typeof request.query.guestToken === "string" ? request.query.guestToken : "";
  return bodyToken || queryToken;
};

const roomParticipantId = (request: AuthenticatedRequest, roomId: string) => {
  const identity = request.identity;
  const userId = identity.kind === "member" ? identity.userId : verifyGuestSessionToken(roomId, guestTokenFrom(request));
  if (!userId) return "";
  try {
    roomStore.getParticipant(roomId, userId);
    return userId;
  } catch {
    return "";
  }
};

router.post("/", optionalAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  const requestedUsername = sanitizeUsername(request.body?.username);
  const username = requestedUsername || identity.displayName;
  const language = sanitizeLanguage(request.body?.language);

  if (!username) {
    sendError(response, 400, "Display name is required");
    return;
  }

  const created = roomStore.createRoom(username, language, {
    userId: identity.userId,
    identityKind: identity.kind,
    avatarUrl: identity.avatarUrl
  });

  await Promise.all([
    roomPersistence.saveRoom(created.room),
    profileService.ensureProfile(identity, username, created.room.roomId),
    profileService.touchRecentRoom(identity, created.room.roomId, `Room ${created.room.roomId}`)
  ]);

  response.status(201).json({
    ok: true,
    room: created.room,
    participant: {
      userId: created.participant.userId,
      username: created.participant.username,
      ...participantResponse(created.room.roomId, created.participant.userId, identity.kind)
    }
  });
  void analyticsService.record({
    type: "room_created",
    userId: identity.kind === "member" ? identity.userId : undefined,
    roomId: created.room.roomId,
    workspaceId: created.room.workspace.id,
    metadata: { language }
  });
});

router.post("/:roomId/join", optionalAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
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

    const guestUserId = identity.kind === "guest" ? verifyGuestSessionToken(roomId, request.body?.guestToken) : undefined;
    const joined = roomStore.joinRoom(roomId, username, guestUserId, {
      userId: identity.kind === "member" ? identity.userId : guestUserId || identity.userId,
      identityKind: identity.kind,
      avatarUrl: identity.avatarUrl
    });

    await Promise.all([
      roomPersistence.saveRoom(joined.room),
      profileService.ensureProfile(identity, username, roomId),
      profileService.touchRecentRoom(identity, roomId, `Room ${roomId}`)
    ]);

    response.json({
      ok: true,
      room: joined.room,
      participant: {
        userId: joined.participant.userId,
        username: joined.participant.username,
        ...participantResponse(roomId, joined.participant.userId, identity.kind)
      }
    });
    void analyticsService.record({
      type: "room_joined",
      userId: identity.kind === "member" ? identity.userId : undefined,
      roomId,
      workspaceId: joined.room.workspace.id,
      metadata: { language: joined.room.language }
    });
  } catch (error) {
    sendError(response, 404, error instanceof Error ? error.message : "Unable to join room");
  }
});

router.get("/:roomId", optionalAuth, async (request, response) => {
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
    if (!roomParticipantId(request as AuthenticatedRequest, roomId)) {
      sendError(response, 403, "Join this room before loading its workspace.");
      return;
    }
    response.json(roomStore.getRoomSnapshot(roomId));
  } catch (error) {
    sendError(response, 404, error instanceof Error ? error.message : "Room not found");
  }
});

router.get("/:roomId/repository", optionalAuth, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId || !(await loadRoomIfNeeded(roomId))) {
    sendError(response, 404, "Room not found");
    return;
  }
  try {
    if (!roomParticipantId(request as AuthenticatedRequest, roomId)) {
      sendError(response, 403, "Join this room before viewing repository details.");
      return;
    }
    const room = roomStore.getRoomSnapshot(roomId);
    response.json({ ok: true, repository: await gitService.getSummary(room.workspace) });
  } catch (error) {
    sendError(response, 503, error instanceof Error ? error.message : "Repository state is unavailable");
  }
});

router.post("/:roomId/repository/refresh", optionalAuth, async (request, response) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId || !(await loadRoomIfNeeded(roomId))) {
    sendError(response, 404, "Room not found");
    return;
  }
  try {
    if (!roomParticipantId(request as AuthenticatedRequest, roomId)) {
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

router.get("/:roomId/history", optionalAuth, async (request, response) => {
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
    if (!roomParticipantId(request as AuthenticatedRequest, roomId)) {
      sendError(response, 403, "Join this room before viewing its history.");
      return;
    }
    response.json(roomStore.getRoomSnapshot(roomId).history);
  } catch (error) {
    sendError(response, 404, error instanceof Error ? error.message : "Room not found");
  }
});

router.post("/:roomId/history/:historyId/restore", optionalAuth, async (request, response) => {
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
    const userId = roomParticipantId(request as AuthenticatedRequest, roomId);
    if (!userId) {
      sendError(response, 401, "A valid room session is required");
      return;
    }
    const restored = roomStore.restoreHistoryEntry(roomId, userId, String(request.params.historyId ?? ""));
    await roomPersistence.saveRoom(restored.room);
    response.json({ ok: true, ...restored });
  } catch (error) {
    sendError(response, 403, error instanceof Error ? error.message : "Unable to restore room history");
  }
});

router.delete("/:roomId", optionalAuth, async (request, response) => {
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
    const userId = roomParticipantId(request as AuthenticatedRequest, roomId);
    if (!userId) {
      sendError(response, 401, "A valid room session is required");
      return;
    }
    roomStore.deleteRoom(roomId, userId);
    await Promise.all([roomPersistence.deleteRoom(roomId), profileService.removeRoomReferences(roomId)]);
    response.status(204).send();
  } catch (error) {
    sendError(response, 403, error instanceof Error ? error.message : "Unable to delete room");
  }
});

export default router;
