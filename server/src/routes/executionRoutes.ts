import { Router } from "express";
import { env } from "../config/env";
import { guestSession, type GuestRequest } from "../middleware/guestSession";
import { executionService, ExecutionServiceError } from "../modules/execution/executionService";
import type { ExecutionAction } from "../modules/execution/executionTypes";
import { roomStore } from "../modules/rooms/roomStore";
import { loadRoomIfNeeded, roomParticipantId } from "./roomRoutes";
import { logSafeEvent } from "../utils/safeLogger";
import { sanitizeRoomId } from "../utils/validation";

const router = Router();
const actions = new Set<ExecutionAction>(["run", "tests", "targeted-tests", "build", "typecheck", "lint", "diagnostics"]);
const windows = new Map<string, { startedAt: number; count: number }>();
const WINDOW_MS = 60_000;

class ExecutionRouteError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rateLimit = (key: string) => {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) { windows.set(key, { startedAt: now, count: 1 }); return true; }
  current.count += 1;
  if (windows.size > 5_000) for (const [entryKey, entry] of windows) if (now - entry.startedAt >= WINDOW_MS) windows.delete(entryKey);
  return current.count <= env.executionRateLimit;
};

const requireRoom = async (request: GuestRequest) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId || !(await loadRoomIfNeeded(roomId))) throw new ExecutionRouteError(404, "ROOM_NOT_FOUND", "Room not found.");
  const userId = roomParticipantId(request, roomId);
  if (!userId) throw new ExecutionRouteError(403, "ROOM_FORBIDDEN", "Join this room before running project checks.");
  const room = roomStore.getRoomSnapshot(roomId);
  return { roomId, userId, room };
};

const sendError = (response: { status: (status: number) => { json: (payload: unknown) => void } }, error: unknown) => {
  if (error instanceof ExecutionRouteError) { response.status(error.status).json({ ok: false, message: error.message, code: error.code }); return; }
  if (error instanceof ExecutionServiceError) {
    const status = error.code === "EXECUTION_NOT_FOUND" ? 404 : error.code === "EXECUTION_NOT_ALLOWED" ? 400 : error.code === "EXECUTION_CONFLICT" ? 409 : 429;
    response.status(status).json({ ok: false, message: error.message, code: error.code });
    return;
  }
  response.status(500).json({ ok: false, message: "The safe execution request failed.", code: "EXECUTION_ERROR" });
};

const withError = async (request: GuestRequest, response: Parameters<typeof sendError>[0], work: () => Promise<void>) => {
  try { await work(); } catch (error) { sendError(response, error); }
};

router.get("/:roomId/execution/capabilities", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  await requireRoom(request as GuestRequest);
  response.json({ ok: true, capabilities: executionService.capabilities() });
}));

router.get("/:roomId/execution/history", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, room } = await requireRoom(request as GuestRequest);
  response.json({ ok: true, executions: executionService.list(roomId, room.workspace.id) });
}));

router.post("/:roomId/execution", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest);
  if (!rateLimit(`${roomId}:${userId}`)) throw new ExecutionRouteError(429, "RATE_LIMITED", "Execution limit reached. Please wait a moment.");
  const body = isRecord(request.body) ? request.body : {};
  const action = typeof body.action === "string" && actions.has(body.action as ExecutionAction) ? body.action as ExecutionAction : null;
  if (!action) throw new ExecutionRouteError(400, "EXECUTION_NOT_ALLOWED", "Choose an allowlisted project action.");
  const target = typeof body.target === "string" ? body.target.slice(0, 200) : undefined;
  const requestId = typeof body.requestId === "string" ? body.requestId.slice(0, 100) : undefined;
  const record = executionService.start({ roomId, workspaceId: room.workspace.id, ownerId: userId, action, target, requestId });
  logSafeEvent("execution", "started", { roomId, workspaceId: room.workspace.id, executionId: record.executionId, action });
  response.status(202).json({ ok: true, execution: record });
}));

router.get("/:roomId/execution/:executionId", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, room } = await requireRoom(request as GuestRequest);
  const executionId = typeof request.params.executionId === "string" ? request.params.executionId.slice(0, 64) : "";
  const record = executionService.get(executionId, roomId, room.workspace.id);
  if (!record) throw new ExecutionServiceError("EXECUTION_NOT_FOUND", "Execution was not found in this workspace.");
  response.json({ ok: true, execution: record });
}));

router.post("/:roomId/execution/:executionId/cancel", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, room } = await requireRoom(request as GuestRequest);
  const executionId = typeof request.params.executionId === "string" ? request.params.executionId.slice(0, 64) : "";
  const execution = executionService.cancel(executionId, roomId, room.workspace.id);
  logSafeEvent("execution", "cancel_requested", { roomId, workspaceId: room.workspace.id, executionId });
  response.json({ ok: true, execution });
}));

export default router;
