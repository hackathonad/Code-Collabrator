import { randomUUID } from "node:crypto";
import type { AgentPatch, AgentRequest, AgentResult, AgentTaskPublic, AgentTaskStatus, AgentValidationStatus } from "./agentTypes";
import { classifyTask } from "./agentIntelligence";
import { logSafeEvent } from "../../utils/safeLogger";
import { recordAgentMemory } from "./agentMemory";
import { env } from "../../config/env";

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
const taskTimeouts = new Map<string, NodeJS.Timeout>();
const taskControllers = new Map<string, AbortController>();
const transitions: Record<AgentTaskStatus, AgentTaskStatus[]> = {
  queued: ["planning", "cancelled", "failed", "timed_out"],
  planning: ["running", "cancelled", "failed", "timed_out"],
  running: ["waiting_for_approval", "validating", "completed", "cancelled", "failed", "timed_out", "conflict"],
  waiting_for_approval: ["applying", "validating", "completed", "cancelled", "failed", "timed_out", "conflict"],
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
  ...(task.initiatorLabel ? { initiatorLabel: task.initiatorLabel } : {}),
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
  logSafeEvent("agent", type, { taskId: task.taskId, roomId: task.roomId, status: task.status, kind: task.classification?.kind, provider: task.provider });
  for (const listener of listeners) listener(event);
};

const isTerminal = (status: AgentTaskStatus) => ["completed", "cancelled", "failed", "timed_out", "conflict"].includes(status);

const clearTaskTimeout = (taskId: string) => {
  const timer = taskTimeouts.get(taskId);
  if (timer) clearTimeout(timer);
  taskTimeouts.delete(taskId);
};

const scheduleTaskTimeout = (task: AgentTaskRecord) => {
  clearTaskTimeout(task.taskId);
  const timer = setTimeout(() => {
    const current = getAgentTask(task.taskId);
    if (!current || isTerminal(current.status)) return;
    taskControllers.get(task.taskId)?.abort();
    updateAgentTask(task.taskId, { status: "timed_out" });
    logSafeEvent("agent", "task_timeout", { taskId: task.taskId, roomId: task.roomId });
  }, env.agentTimeoutMs + 1_000);
  timer.unref();
  taskTimeouts.set(task.taskId, timer);
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
    ...(request.initiatorLabel ? { initiatorLabel: request.initiatorLabel.slice(0, 80) } : {}),
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
  scheduleTaskTimeout(task);
  recordAgentMemory(request.roomId, "currentTask", task.summary, task.taskId);
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

export const registerAgentTaskController = (taskId: string, controller: AbortController) => {
  if (!getAgentTask(taskId)) return false;
  taskControllers.set(taskId, controller);
  return true;
};

export const unregisterAgentTaskController = (taskId: string, controller?: AbortController) => {
  if (!controller || taskControllers.get(taskId) === controller) taskControllers.delete(taskId);
};

export const cancelAgentTask = (taskId: string, roomId?: string, userId?: string) => {
  const task = getAgentTask(taskId, roomId, userId);
  if (!task || isTerminal(task.status)) return task;
  taskControllers.get(taskId)?.abort();
  return updateAgentTask(taskId, { status: "cancelled" });
};

export const cancelAgentTasksForRoom = (roomId: string) => {
  for (const task of tasks.get(roomId) ?? []) {
    taskControllers.get(task.taskId)?.abort();
    if (!isTerminal(task.status)) updateAgentTask(task.taskId, { status: "cancelled" });
    clearTaskTimeout(task.taskId);
    taskControllers.delete(task.taskId);
  }
};

export const clearAgentTasks = (roomId: string) => {
  cancelAgentTasksForRoom(roomId);
  for (const task of tasks.get(roomId) ?? []) clearTaskTimeout(task.taskId);
  tasks.delete(roomId);
};

export const canTransitionAgentTask = (from: AgentTaskStatus, to: AgentTaskStatus) => from === to || transitions[from].includes(to);

export const updateAgentTask = (taskId: string, update: TaskUpdate) => {
  for (const roomTasks of tasks.values()) {
    const task = roomTasks.find((entry) => entry.taskId === taskId);
    if (!task) continue;
    if (update.status && !canTransitionAgentTask(task.status, update.status)) return null;
    const changed = Object.entries(update).some(([key, value]) => task[key as keyof AgentTaskRecord] !== value);
    if (!changed) return task;
    Object.assign(task, update, { updatedAt: Date.now() });
    if (update.status && isTerminal(update.status)) clearTaskTimeout(task.taskId);
    if (update.status) {
      recordAgentMemory(task.roomId, "currentTask", `${task.summary} · ${update.status}`, task.taskId);
      if (["completed", "cancelled", "failed", "timed_out", "conflict"].includes(update.status)) recordAgentMemory(task.roomId, "recentDecisions", `Task ${update.status}: ${task.summary}`, task.taskId);
    }
    emit("task_updated", task);
    return task;
  }
  return null;
};

export const recordTaskPatches = (taskId: string, patches: AgentPatch[]) => {
  const task = updateAgentTask(taskId, { patchCount: patches.length, patchStatus: patches.length ? "proposed" : "none" });
  if (task && patches.length) recordAgentMemory(task.roomId, "patchDecisions", `Proposed ${patches.length} patch${patches.length === 1 ? "" : "es"}`, taskId);
  return task;
};

export const recordTaskValidation = (taskId: string, status: AgentValidationStatus, summary?: string) => {
  const task = updateAgentTask(taskId, { validationStatus: status, ...(summary ? { validationSummary: safeSummary(summary) } : {}) });
  if (task) recordAgentMemory(task.roomId, "validationResults", `${status}: ${summary ?? "validation"}`, taskId);
  return task;
};

export const taskStatusForResult = (stoppedReason: AgentTaskStatus | AgentResult["stoppedReason"] | undefined, hasError = false): AgentTaskStatus => {
  if (stoppedReason === "cancelled") return "cancelled";
  if (stoppedReason === "timeout") return "timed_out";
  return hasError ? "failed" : "completed";
};
