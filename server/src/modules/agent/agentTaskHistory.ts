import { randomUUID } from "node:crypto";
import type { AgentPatch, AgentRequest, AgentResult, AgentTaskPublic, AgentTaskStatus, AgentValidationStatus } from "./agentTypes";
import { classifyTask } from "./agentIntelligence";

interface AgentTaskRecord extends AgentTaskPublic {
  userId: string;
  provider: AgentRequest["settings"]["provider"];
  model: string;
}

type TaskUpdate = Partial<Pick<AgentTaskRecord, "status" | "patchStatus" | "validationStatus" | "validationSummary" | "patchCount">>;

export interface AgentTaskEvent {
  type: "task_started" | "task_updated";
  task: AgentTaskPublic;
}

const MAX_TASKS_PER_ROOM = 40;
const tasks = new Map<string, AgentTaskRecord[]>();
const listeners = new Set<(event: AgentTaskEvent) => void>();
const transitions: Record<AgentTaskStatus, AgentTaskStatus[]> = {
  queued: ["planning", "cancelled", "failed"],
  planning: ["running", "cancelled", "failed"],
  running: ["waiting_for_approval", "validating", "completed", "cancelled", "failed", "timed_out", "conflict"],
  waiting_for_approval: ["applying", "validating", "completed", "cancelled", "failed", "conflict"],
  applying: ["validating", "completed", "failed", "timed_out", "conflict"],
  validating: ["waiting_for_approval", "completed", "failed", "cancelled", "timed_out", "conflict"],
  completed: ["validating"],
  cancelled: [],
  failed: [],
  timed_out: [],
  conflict: []
};

const safeSummary = (value: string) => value.replace(/(api[_-]?key|secret|password|token)\s*([:=])\s*([^\s,;]+)/gi, "$1$2 [REDACTED]").replace(/\s+/g, " ").trim().slice(0, 240) || "Coding-agent task";

const publicTask = (task: AgentTaskRecord): AgentTaskPublic => ({
  taskId: task.taskId,
  roomId: task.roomId,
  ...(task.conversationId ? { conversationId: task.conversationId } : {}),
  mode: task.mode,
  intent: task.intent,
  ...(task.classification ? { classification: task.classification } : {}),
  summary: task.summary,
  status: task.status,
  patchStatus: task.patchStatus,
  validationStatus: task.validationStatus,
  ...(task.validationSummary ? { validationSummary: task.validationSummary } : {}),
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
  if (request.taskId && getAgentTask(request.taskId)) return null;
  const now = Date.now();
  const task: AgentTaskRecord = {
    taskId: request.taskId ?? randomUUID(),
    roomId: request.roomId,
    ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    userId: request.userId,
    mode: request.mode,
    intent: request.intent ?? (request.mode === "DEBUG" ? "fix" : request.mode === "EDIT" ? "generate" : "explain"),
    classification: classifyTask(request),
    summary: safeSummary(request.userInstruction),
    provider: request.settings.provider,
    model: request.settings.model.slice(0, 160),
    status: "queued",
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

export const getAgentTask = (taskId: string, roomId?: string, userId?: string) => {
  for (const roomTasks of tasks.values()) {
    const task = roomTasks.find((entry) => entry.taskId === taskId && (!roomId || entry.roomId === roomId) && (!userId || entry.userId === userId));
    if (task) return task;
  }
  return null;
};

export const clearAgentTasks = (roomId: string) => { tasks.delete(roomId); };

export const canTransitionAgentTask = (from: AgentTaskStatus, to: AgentTaskStatus) => from === to || transitions[from].includes(to);

export const updateAgentTask = (taskId: string, update: TaskUpdate) => {
  for (const roomTasks of tasks.values()) {
    const task = roomTasks.find((entry) => entry.taskId === taskId);
    if (!task) continue;
    if (update.status && !canTransitionAgentTask(task.status, update.status)) return null;
    const changed = Object.entries(update).some(([key, value]) => task[key as keyof AgentTaskRecord] !== value);
    if (!changed) return task;
    Object.assign(task, update, { updatedAt: Date.now() });
    emit("task_updated", task);
    return task;
  }
  return null;
};

export const recordTaskPatches = (taskId: string, patches: AgentPatch[]) => updateAgentTask(taskId, { patchCount: patches.length, patchStatus: patches.length ? "proposed" : "none" });

export const recordTaskValidation = (taskId: string, status: AgentValidationStatus, summary?: string) => updateAgentTask(taskId, { validationStatus: status, ...(summary ? { validationSummary: safeSummary(summary) } : {}) });

export const taskStatusForResult = (stoppedReason: AgentTaskStatus | AgentResult["stoppedReason"] | undefined, hasError = false): AgentTaskStatus => {
  if (stoppedReason === "cancelled") return "cancelled";
  if (stoppedReason === "timeout") return "timed_out";
  return hasError ? "failed" : "completed";
};
