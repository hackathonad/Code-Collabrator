import { randomUUID } from "node:crypto";
import type { AgentPatch, AgentRequest, AgentResult, AgentTaskNote, AgentTaskPriority, AgentTaskPublic, AgentTaskStatus, AgentValidationStatus } from "./agentTypes";
import { classifyTask } from "./agentIntelligence";
import { logSafeEvent } from "../../utils/safeLogger";
import { recordAgentMemory } from "./agentMemory";
import { env } from "../../config/env";

export interface AgentTaskRecord extends AgentTaskPublic {
  userId: string;
  provider: AgentRequest["settings"]["provider"];
  model: string;
}

type TaskPerson = { userId: string; displayName: string };

type TaskUpdate = Partial<Pick<AgentTaskRecord, "status" | "patchStatus" | "validationStatus" | "validationSummary" | "patchCount" | "priority" | "assignedTo" | "watchers" | "files" | "reviewCount" | "resultSummary">>;

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
const safeNote = (value: string) => value.replace(/(api[_-]?key|secret|password|token|authorization|cookie)\s*([:=])\s*([^\s,;]+)/gi, "$1$2 [REDACTED]").replace(/\s+/g, " ").trim().slice(0, 280);
const activeStatuses = new Set<AgentTaskStatus>(["queued", "planning", "running", "waiting_for_approval", "applying", "validating"]);
const normalizedTaskWords = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !["the", "and", "for", "with", "this", "that", "from", "into"].includes(word)));
const similarTask = (left: string, right: string) => {
  const leftWords = normalizedTaskWords(left);
  const rightWords = normalizedTaskWords(right);
  if (!leftWords.size || !rightWords.size) return false;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return leftWords.size === rightWords.size && overlap >= Math.max(2, Math.ceil(leftWords.size * 0.7))
    || (overlap >= 3 && overlap / Math.min(leftWords.size, rightWords.size) >= 0.75);
};

const publicTask = (task: AgentTaskRecord): AgentTaskPublic => ({
  taskId: task.taskId,
  roomId: task.roomId,
  ...(task.conversationId ? { conversationId: task.conversationId } : {}),
  mode: task.mode,
  intent: task.intent,
  ...(task.classification ? { classification: task.classification } : {}),
  ...(task.initiatorLabel ? { initiatorLabel: task.initiatorLabel } : {}),
    ...(task.initiatorLabel ? { requestedBy: task.initiatorLabel } : {}),
  ...(task.notes?.length ? { notes: task.notes.map((note) => ({ ...note })) } : {}),
  priority: task.priority,
  ...(task.assignedTo ? { assignedTo: { ...task.assignedTo } } : {}),
  watchers: task.watchers.map((watcher) => ({ ...watcher })),
  ...(task.files?.length ? { files: [...task.files] } : {}),
  ...(task.reviewCount ? { reviewCount: task.reviewCount } : {}),
  ...(task.resultSummary ? { resultSummary: task.resultSummary } : {}),
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
    notes: [],
    priority: "normal",
    watchers: [],
    files: [],
    reviewCount: 0,
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

export const findSimilarAgentTask = (roomId: string, userInstruction: string, excludeTaskId?: string) => (tasks.get(roomId) ?? [])
  .find((task) => task.taskId !== excludeTaskId && activeStatuses.has(task.status) && similarTask(task.summary, userInstruction)) ?? null;

export const addAgentTaskNote = (taskId: string, roomId: string, userId: string, authorName: string, message: string) => {
  const task = getAgentTask(taskId, roomId);
  const note = safeNote(message);
  if (!task || !note) return null;
  const entry: AgentTaskNote = { id: randomUUID(), authorName: safeSummary(authorName).slice(0, 80), message: note, createdAt: Date.now() };
  task.notes = [...(task.notes ?? []), entry].slice(-8);
  task.updatedAt = entry.createdAt;
  logSafeEvent("agent", "task_note", { taskId, roomId });
  emit("task_updated", task);
  return publicTask(task);
};

const updateTaskDetails = (taskId: string, roomId: string, update: TaskUpdate) => {
  const task = getAgentTask(taskId, roomId);
  if (!task) return null;
  const changed = Object.entries(update).some(([key, value]) => JSON.stringify(task[key as keyof AgentTaskRecord]) !== JSON.stringify(value));
  if (!changed) return publicTask(task);
  Object.assign(task, update, { updatedAt: Date.now() });
  emit("task_updated", task);
  return publicTask(task);
};

export const setAgentTaskPriority = (taskId: string, roomId: string, priority: AgentTaskPriority) => updateTaskDetails(taskId, roomId, { priority });

export const assignAgentTask = (taskId: string, roomId: string, assignedTo: TaskPerson | undefined) => updateTaskDetails(taskId, roomId, { assignedTo });

export const toggleAgentTaskWatch = (taskId: string, roomId: string, watcher: TaskPerson, watching: boolean) => {
  const task = getAgentTask(taskId, roomId);
  if (!task) return null;
  const watchers = watching
    ? [...task.watchers.filter((entry) => entry.userId !== watcher.userId), watcher].slice(-20)
    : task.watchers.filter((entry) => entry.userId !== watcher.userId);
  return updateTaskDetails(taskId, roomId, { watchers });
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

const TASK_STATUSES = new Set<AgentTaskStatus>(Object.keys(transitions) as AgentTaskStatus[]);
const TASK_MODES = new Set(["ASK", "EDIT", "DEBUG", "EXPLAIN"]);
const PRIORITIES = new Set<AgentTaskPriority>(["normal", "high", "urgent"]);
const PATCH_STATUSES = new Set(["none", "proposed", "applied", "stale", "rejected"]);
const VALIDATION_STATUSES = new Set(["not-run", "running", "passed", "failed", "skipped", "unavailable", "cancelled"]);
/** Statuses that depend on a live server process. After a restart nothing is running them. */
const PROCESS_BOUND_STATUSES = new Set<AgentTaskStatus>(["queued", "planning", "running", "applying", "validating"]);

const str = (value: unknown, limit: number) => (typeof value === "string" && value.length <= limit ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const person = (value: unknown): TaskPerson | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const userId = str(raw.userId, 128); const displayName = str(raw.displayName, 80);
  return userId && displayName ? { userId, displayName } : null;
};

const parseStoredTask = (value: unknown, roomId: string): AgentTaskRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const taskId = str(raw.taskId, 128); const userId = str(raw.userId, 128); const summary = str(raw.summary, 400);
  const createdAt = num(raw.createdAt); const updatedAt = num(raw.updatedAt);
  if (!taskId || !userId || summary === null || createdAt === null || updatedAt === null || raw.roomId !== roomId) return null;
  if (!TASK_MODES.has(raw.mode as string) || !TASK_STATUSES.has(raw.status as AgentTaskStatus) || !PRIORITIES.has(raw.priority as AgentTaskPriority)) return null;
  if (!PATCH_STATUSES.has(raw.patchStatus as string) || !VALIDATION_STATUSES.has(raw.validationStatus as string)) return null;
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).slice(-8).flatMap((entry): AgentTaskNote[] => {
    if (!entry || typeof entry !== "object") return [];
    const note = entry as Record<string, unknown>;
    const id = str(note.id, 128); const authorName = str(note.authorName, 80); const message = str(note.message, 280); const at = num(note.createdAt);
    return id && authorName !== null && message && at !== null ? [{ id, authorName, message, createdAt: at }] : [];
  });
  const watchers = (Array.isArray(raw.watchers) ? raw.watchers : []).slice(-20).flatMap((entry) => { const parsed = person(entry); return parsed ? [parsed] : []; });
  const assignedTo = person(raw.assignedTo);
  const files = (Array.isArray(raw.files) ? raw.files : []).slice(0, 10).flatMap((entry) => { const parsed = str(entry, 260); return parsed ? [parsed] : []; });
  return {
    taskId, roomId, userId,
    ...(str(raw.conversationId, 128) ? { conversationId: raw.conversationId as string } : {}),
    mode: raw.mode as AgentRequest["mode"],
    intent: (str(raw.intent, 40) ?? "custom") as AgentTaskRecord["intent"],
    ...(raw.classification && typeof raw.classification === "object" && !Array.isArray(raw.classification) ? { classification: raw.classification as AgentTaskRecord["classification"] } : {}),
    ...(str(raw.initiatorLabel, 80) ? { initiatorLabel: raw.initiatorLabel as string } : {}),
    ...(str(raw.initiatorLabel, 80) ? { requestedBy: raw.initiatorLabel as string } : {}),
    notes, priority: raw.priority as AgentTaskPriority, ...(assignedTo ? { assignedTo } : {}), watchers, files,
    reviewCount: num(raw.reviewCount) ?? 0,
    ...(str(raw.resultSummary, 400) ? { resultSummary: raw.resultSummary as string } : {}),
    summary, provider: (str(raw.provider, 40) ?? "custom") as AgentTaskRecord["provider"], model: str(raw.model, 160) ?? "",
    status: raw.status as AgentTaskStatus, patchStatus: raw.patchStatus as AgentTaskRecord["patchStatus"], validationStatus: raw.validationStatus as AgentTaskRecord["validationStatus"],
    ...(str(raw.validationSummary, 400) ? { validationSummary: raw.validationSummary as string } : {}),
    patchCount: num(raw.patchCount) ?? 0, createdAt, updatedAt
  };
};

/**
 * Restores a room's tasks from durable storage without emitting events.
 * Work that was running when the server stopped cannot still be running, so it
 * is closed as failed with an explanatory summary; tasks waiting on a human
 * keep waiting. Returns the tasks that were changed so the caller can persist
 * them. Live in-memory tasks for the room are never overwritten.
 */
export const hydrateAgentTasks = (roomId: string, raw: unknown[]): AgentTaskRecord[] => {
  if (tasks.has(roomId)) return [];
  const restored: AgentTaskRecord[] = [];
  const changed: AgentTaskRecord[] = [];
  for (const entry of raw) {
    const task = parseStoredTask(entry, roomId);
    if (!task || restored.some((existing) => existing.taskId === task.taskId)) continue;
    if (PROCESS_BOUND_STATUSES.has(task.status)) {
      task.status = "failed";
      task.resultSummary = task.resultSummary || "Interrupted because the server restarted before this task finished.";
      task.updatedAt = Date.now();
      changed.push(task);
    }
    restored.push(task);
  }
  restored.sort((left, right) => right.createdAt - left.createdAt);
  if (restored.length) tasks.set(roomId, restored.slice(0, MAX_TASKS_PER_ROOM));
  return changed;
};
