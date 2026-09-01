import type { RoomActivityEntry, RoomActivityKind } from "../types/collaboration";
import type { AIAction } from "../types/ai";
import type { AgentTaskEvent, AgentTaskNote, AgentTaskPublic, AgentTaskStatus } from "../types/agent";

const activityKinds = new Set<RoomActivityKind>(["room", "presence", "file", "agent", "patch", "validation", "git", "chat"]);
const agentModes = new Set(["ASK", "EDIT", "DEBUG", "EXPLAIN"]);
const agentIntents = new Set<AIAction>(["explain", "generate", "fix", "optimize", "refactor", "test", "document", "summarize", "review", "error", "custom"]);
const validationStatuses = new Set(["not-run", "running", "passed", "failed", "skipped", "unavailable", "cancelled"]);
const text = (value: unknown, limit: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : "";

export const parseRoomActivity = (value: unknown): RoomActivityEntry | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 128);
  const roomId = text(raw.roomId, 32);
  const actorName = text(raw.actorName, 80);
  const message = text(raw.message, 220);
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? Math.round(raw.createdAt) : 0;
  if (!id || !roomId || !actorName || !message || !activityKinds.has(raw.kind as RoomActivityKind) || createdAt < 0) return null;
  return {
    id,
    roomId,
    ...(typeof raw.actorId === "string" ? { actorId: raw.actorId.slice(0, 128) } : {}),
    actorName,
    kind: raw.kind as RoomActivityKind,
    message,
    createdAt,
    ...(typeof raw.taskId === "string" ? { taskId: raw.taskId.slice(0, 128) } : {}),
    ...(typeof raw.fileId === "string" ? { fileId: raw.fileId.slice(0, 128) } : {})
  };
};

export const parseRoomActivityList = (value: unknown) => Array.isArray(value)
  ? value.slice(0, 60).flatMap((entry) => { const parsed = parseRoomActivity(entry); return parsed ? [parsed] : []; })
  : [];

const taskStatuses = new Set<AgentTaskStatus>(["queued", "planning", "running", "waiting_for_approval", "applying", "validating", "completed", "cancelled", "failed", "timed_out", "conflict"]);
const parseTask = (value: unknown, roomId: string): AgentTaskPublic | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const taskId = text(raw.taskId, 128);
  const taskRoomId = text(raw.roomId, 32);
  const summary = text(raw.summary, 240);
  const status = raw.status as AgentTaskStatus;
  const patchStatus = raw.patchStatus;
  const validationStatus = raw.validationStatus;
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : -1;
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : -1;
  if (!taskId || taskRoomId !== roomId || !summary || !taskStatuses.has(status) || !["none", "proposed", "applied", "stale", "rejected"].includes(String(patchStatus)) || typeof validationStatus !== "string" || createdAt < 0 || updatedAt < createdAt || !Number.isInteger(raw.patchCount) || Number(raw.patchCount) < 0 || Number(raw.patchCount) > 10) return null;
  const notes: AgentTaskNote[] | undefined = Array.isArray(raw.notes) ? raw.notes.slice(-8).flatMap((note): AgentTaskNote[] => {
    if (!note || typeof note !== "object" || Array.isArray(note)) return [];
    const entry = note as Record<string, unknown>;
    return typeof entry.id === "string" && typeof entry.authorName === "string" && typeof entry.message === "string" && typeof entry.createdAt === "number" ? [{ id: entry.id.slice(0, 128), authorName: entry.authorName.slice(0, 80), message: entry.message.slice(0, 280), createdAt: entry.createdAt }] : [];
  }) : undefined;
  if (!agentModes.has(String(raw.mode)) || !agentIntents.has(raw.intent as AIAction) || !validationStatuses.has(String(validationStatus))) return null;
  return {
    taskId,
    roomId,
    ...(typeof raw.conversationId === "string" ? { conversationId: raw.conversationId.slice(0, 128) } : {}),
    mode: raw.mode as AgentTaskPublic["mode"],
    intent: raw.intent as AgentTaskPublic["intent"],
    ...(typeof raw.initiatorLabel === "string" ? { initiatorLabel: raw.initiatorLabel.slice(0, 80) } : {}),
    ...(typeof raw.requestedBy === "string" ? { requestedBy: raw.requestedBy.slice(0, 80) } : {}),
    ...(notes?.length ? { notes } : {}),
    summary,
    status,
    patchStatus: patchStatus as AgentTaskPublic["patchStatus"],
    validationStatus: validationStatus as AgentTaskPublic["validationStatus"],
    ...(typeof raw.validationSummary === "string" ? { validationSummary: raw.validationSummary.slice(0, 240) } : {}),
    patchCount: Number(raw.patchCount),
    createdAt,
    updatedAt
  };
};

export const parseAgentTaskEvent = (value: unknown, roomId: string): AgentTaskEvent | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== "task_started" && raw.type !== "task_updated") return null;
  const task = parseTask(raw.task, roomId);
  return task ? { type: raw.type, task } : null;
};
