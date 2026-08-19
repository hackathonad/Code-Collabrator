import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { analyticsService } from "../services/analyticsService";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { sanitizeRoomId } from "../utils/validation";

const router = Router();
const rangeFromRequest = (value: unknown) => value === "7d" || value === "90d" || value === "all" ? value : "30d";
const requireRoomParticipant = async (roomId: string, userId: string) => {
  if (!roomStore.hasRoom(roomId)) {
    const room = await roomPersistence.loadRoom(roomId);
    if (!room) return null;
    roomStore.upsertRoomSnapshot(room);
  }
  try {
    const participant = roomStore.getParticipant(roomId, userId);
    return { room: roomStore.getRoomSnapshot(roomId), participant };
  } catch { return null; }
};

router.get("/analytics/me", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  if (identity.kind !== "member") { response.status(401).json({ ok: false, message: "Sign in to view analytics." }); return; }
  const range = rangeFromRequest(request.query.range);
  response.json({ ok: true, dashboard: await analyticsService.dashboard(identity.userId, range) });
});

router.get("/analytics/rooms/:roomId", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  const roomId = sanitizeRoomId(request.params.roomId);
  if (identity.kind !== "member" || !roomId) { response.status(400).json({ ok: false, message: "A valid signed-in room session is required." }); return; }
  const access = await requireRoomParticipant(roomId, identity.userId);
  if (!access) { response.status(403).json({ ok: false, message: "You do not have access to this room's analytics." }); return; }
  response.json({ ok: true, dashboard: await analyticsService.dashboard(identity.userId, rangeFromRequest(request.query.range), { roomId }) });
});

router.get("/analytics/rooms/:roomId/workspace", requireAuth, async (request, response) => {
  const identity = (request as AuthenticatedRequest).identity;
  const roomId = sanitizeRoomId(request.params.roomId);
  if (identity.kind !== "member" || !roomId) { response.status(400).json({ ok: false, message: "A valid signed-in room session is required." }); return; }
  const access = await requireRoomParticipant(roomId, identity.userId);
  if (!access) { response.status(403).json({ ok: false, message: "You do not have access to this workspace's analytics." }); return; }
  response.json({ ok: true, workspaceId: access.room.workspace.id, dashboard: await analyticsService.dashboard(identity.userId, rangeFromRequest(request.query.range), { workspaceId: access.room.workspace.id }) });
});
export default router;
