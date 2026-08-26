import { randomUUID } from "node:crypto";
import type { AgentPatch, AgentRequest, AgentResult, AgentTaskPublic, AgentTaskStatus, AgentValidationStatus } from "./agentTypes";

interface AgentTaskRecord extends AgentTaskPublic {
  userId: string;
  provider: AgentRequest["settings"]["provider"];
  model: string;
}

export interface AgentTaskEvent {
  type: "task_started" | "task_updated";
  task: AgentTaskPublic;
}

const MAX_TASKS_PER_ROOM = 40;
const tasks = new Map<string, AgentTaskRecord[]>();
const listeners = new Set<(event: AgentTaskEvent) => void>();

const safeSummary = (value: string) => value.replace(/(api[_-]?key|secret|password|token)\s*([:=])\s*([^\s,;]+)/gi, "$1$2 [REDACTED]").replace(/\s+/g, " ").trim().slice(0, 240) || "Coding-agent task";

const publicTask = (task: AgentTaskRecord): AgentTaskPublic => ({
  taskId: task.taskId,
  roomId: task.roomId,
  mode: task.mode,
  intent: task.intent,
  summary: task.summary,
  status: task.status,
  patchStatus: task.patchStatus,
  validationStatus: task.validationStatus,
  patchCount: task.patchCount,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt
});

const emit = (type: AgentTaskEvent["type"], task: AgentTaskRecord) => {
  const event = { type, task: publicTask(task) } satisfies AgentTaskEvent;
  for (const listener of listeners) listener(event);
};

export const subscribeAgentTasks = (listener: (event: AgentTaskEvent) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const startAgentTask = (request: AgentRequest) => {
  const now = Date.now();
  const task: AgentTaskRecord = {
    taskId: request.taskId ?? randomUUID(),
    roomId: request.roomId,
    userId: request.userId,
    mode: request.mode,
    intent: request.intent ?? (request.mode === "DEBUG" ? "fix" : request.mode === "EDIT" ? "generate" : "explain"),
    summary: safeSummary(request.userInstruction),
    provider: request.settings.provider,
    model: request.settings.model.slice(0, 160),
    status: "started",
    patchStatus: "none",
    validationStatus: "not-run",
    patchCount: 0,
    createdAt: now,
    updatedAt: now
  };
  const roomTasks = [task, ...(tasks.get(request.roomId) ?? [])].slice(0, MAX_TASKS_PER_ROOM);
  tasks.set(request.roomId, roomTasks);
  emit("task_started", task);
  return task;
};

export const getAgentTaskHistory = (roomId: string, userId?: string, limit = MAX_TASKS_PER_ROOM) => (tasks.get(roomId) ?? [])
  .filter((task) => !userId || task.userId === userId)
  .slice(0, Math.min(MAX_TASKS_PER_ROOM, Math.max(1, limit)));

export const getPublicAgentTaskHistory = (roomId: string, userId?: string, limit = MAX_TASKS_PER_ROOM) => getAgentTaskHistory(roomId, userId, limit).map(publicTask);

export const updateAgentTask = (taskId: string, update: Partial<Pick<AgentTaskRecord, "status" | "patchStatus" | "validationStatus" | "patchCount">>) => {
  for (const roomTasks of tasks.values()) {
    const task = roomTasks.find((entry) => entry.taskId === taskId);
    if (!task) continue;
    Object.assign(task, update, { updatedAt: Date.now() });
    emit("task_updated", task);
    return task;
  }
  return null;
};

export const recordTaskPatches = (taskId: string, patches: AgentPatch[]) => updateAgentTask(taskId, { patchCount: patches.length, patchStatus: patches.length ? "proposed" : "none" });

export const recordTaskValidation = (taskId: string, status: AgentValidationStatus) => updateAgentTask(taskId, { validationStatus: status });

export const taskStatusForResult = (stoppedReason: AgentTaskStatus | AgentResult["stoppedReason"] | undefined, hasError = false): AgentTaskStatus => {
  if (stoppedReason === "cancelled") return "cancelled";
  if (stoppedReason === "timeout") return "timeout";
  return hasError ? "failed" : "completed";
};
