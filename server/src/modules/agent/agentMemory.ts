import { randomUUID } from "node:crypto";
import type { AgentMemoryCategory, AgentMemoryEntry, AgentMemorySnapshot } from "./agentTypes";
import { logSafeEvent } from "../../utils/safeLogger";

const MAX_ENTRIES_PER_CATEGORY = 10;
const memories = new Map<string, AgentMemorySnapshot>();
const listeners = new Set<(roomId: string) => void>();

/** Observers (such as durable persistence) are told which room's memory changed. */
export const subscribeAgentMemory = (listener: (roomId: string) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = (roomId: string) => { for (const listener of listeners) { try { listener(roomId); } catch { /* Observers must not break memory. */ } } };

const emptyMemory = (): AgentMemorySnapshot => ({ currentTask: null, recentDecisions: [], patchDecisions: [], projectFacts: [], validationResults: [] });
const safeSummary = (value: string) => value
  .replace(/(api[_-]?key|secret|password|token|authorization|cookie)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
  .replace(/\s+/g, " ").trim().slice(0, 320) || "Agent memory entry";

export const recordAgentMemory = (roomId: string, category: AgentMemoryCategory, summary: string, taskId?: string) => {
  const memory = memories.get(roomId) ?? emptyMemory();
  const entry: AgentMemoryEntry = { id: randomUUID(), category, summary: safeSummary(summary), ...(taskId ? { taskId: taskId.slice(0, 128) } : {}), createdAt: Date.now() };
  if (category === "currentTask") memory.currentTask = entry;
  else {
    const list = memory[category];
    memory[category] = [...list, entry].slice(-MAX_ENTRIES_PER_CATEGORY) as never;
  }
  memories.set(roomId, memory);
  logSafeEvent("agent", "memory_recorded", { roomId, category, taskId });
  notify(roomId);
  return entry;
};

export const getAgentMemory = (roomId: string): AgentMemorySnapshot => {
  const memory = memories.get(roomId) ?? emptyMemory();
  return {
    currentTask: memory.currentTask ? { ...memory.currentTask } : null,
    recentDecisions: memory.recentDecisions.map((entry) => ({ ...entry })),
    patchDecisions: memory.patchDecisions.map((entry) => ({ ...entry })),
    projectFacts: memory.projectFacts.map((entry) => ({ ...entry })),
    validationResults: memory.validationResults.map((entry) => ({ ...entry }))
  };
};

export const removeAgentMemory = (roomId: string, category: "projectFacts", entryId: string) => {
  const memory = memories.get(roomId);
  if (!memory) return false;
  const next = memory.projectFacts.filter((entry) => entry.id !== entryId);
  if (next.length === memory.projectFacts.length) return false;
  memory.projectFacts = next;
  memories.set(roomId, memory);
  notify(roomId);
  return true;
};

export const clearAgentMemory = (roomId: string) => { memories.delete(roomId); };

const MEMORY_CATEGORIES = new Set<AgentMemoryCategory>(["currentTask", "recentDecisions", "patchDecisions", "projectFacts", "validationResults"]);

const parseMemoryEntry = (value: unknown): AgentMemoryEntry | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > 128 || typeof raw.summary !== "string" || !raw.summary.trim()) return null;
  if (!MEMORY_CATEGORIES.has(raw.category as AgentMemoryCategory) || typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) return null;
  return { id: raw.id, category: raw.category as AgentMemoryCategory, summary: safeSummary(raw.summary), ...(typeof raw.taskId === "string" && raw.taskId ? { taskId: raw.taskId.slice(0, 128) } : {}), createdAt: raw.createdAt };
};

/**
 * Restores memory loaded from durable storage. Stored data is validated and
 * re-bounded, and live in-memory state is never overwritten. Returns whether
 * anything was restored.
 */
export const hydrateAgentMemory = (roomId: string, stored: unknown): boolean => {
  if (memories.has(roomId) || !stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const raw = stored as Record<string, unknown>;
  const list = (value: unknown, category: AgentMemoryCategory) => (Array.isArray(value) ? value : []).flatMap((entry) => { const parsed = parseMemoryEntry(entry); return parsed && parsed.category === category ? [parsed] : []; }).slice(-MAX_ENTRIES_PER_CATEGORY);
  const memory: AgentMemorySnapshot = {
    currentTask: parseMemoryEntry(raw.currentTask)?.category === "currentTask" ? parseMemoryEntry(raw.currentTask) : null,
    recentDecisions: list(raw.recentDecisions, "recentDecisions"),
    patchDecisions: list(raw.patchDecisions, "patchDecisions"),
    projectFacts: list(raw.projectFacts, "projectFacts"),
    validationResults: list(raw.validationResults, "validationResults")
  };
  memories.set(roomId, memory);
  return true;
};
