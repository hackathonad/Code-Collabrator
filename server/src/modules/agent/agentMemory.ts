import { randomUUID } from "node:crypto";
import type { AgentMemoryCategory, AgentMemoryEntry, AgentMemorySnapshot } from "./agentTypes";
import { logSafeEvent } from "../../utils/safeLogger";

const MAX_ENTRIES_PER_CATEGORY = 10;
const memories = new Map<string, AgentMemorySnapshot>();

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

export const clearAgentMemory = (roomId: string) => { memories.delete(roomId); };
