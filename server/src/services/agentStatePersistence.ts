import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabase";
import { hydrateAgentProposals, getAgentProposal, subscribeAgentProposal, type StoredProposal } from "../modules/agent/agentEvents";
import { getAgentMemory, hydrateAgentMemory, subscribeAgentMemory } from "../modules/agent/agentMemory";
import { getAgentTask, hydrateAgentTasks, subscribeAgentTasks, type AgentTaskRecord } from "../modules/agent/agentTaskHistory";
import { logSafeEvent } from "../utils/safeLogger";

/** Keep in step with the in-memory bounds. Older rows are pruned. */
export const MAX_PERSISTED_TASKS_PER_ROOM = 40;
export const MAX_PERSISTED_PROPOSALS_PER_ROOM = 100;
const MAX_TOMBSTONES = 10_000;

export interface AgentStateOptions {
  /** Writes for the same record within this window are coalesced into one. */
  flushDelayMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
}

type QueryClient = Pick<SupabaseClient, "from">;

const iso = (timestamp: number) => new Date(timestamp).toISOString();

const taskRow = (task: AgentTaskRecord) => ({
  room_id: task.roomId,
  task_id: task.taskId,
  user_id: task.userId,
  status: task.status,
  mode: task.mode,
  intent: task.intent,
  priority: task.priority,
  summary: task.summary,
  payload: task,
  created_at: iso(task.createdAt),
  updated_at: iso(task.updatedAt)
});

// created_at is left out on purpose so the database keeps the first-write time.
const proposalRow = (stored: StoredProposal) => ({
  room_id: stored.patch.roomId,
  patch_id: stored.patch.patchId,
  task_id: stored.patch.taskId ?? null,
  user_id: stored.userId,
  status: stored.status,
  base_version: stored.patch.baseVersion,
  payload: { patch: stored.patch, userId: stored.userId, status: stored.status },
  updated_at: new Date().toISOString()
});

const must = (result: { error: unknown }) => {
  if (result.error) throw result.error;
};

const safeFailure = (error: unknown) => {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof candidate.message === "string" ? candidate.message : error instanceof Error ? error.message : "unknown error";
  return { code: typeof candidate.code === "string" ? candidate.code.slice(0, 40) : "", message: message.replace(/(api[_-]?key|secret|password|token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 300) };
};

interface Pending { roomId: string; attempts: number; write: () => Promise<void> }

/**
 * Write-through persistence for AI tasks, patch proposals and project memory.
 *
 * Memory stays authoritative: every method is fire-and-forget and never
 * throws, and a database outage only delays durability. Writes for one record
 * are coalesced (latest state wins) and retried a few times.
 */
export const createAgentStatePersistence = (client: QueryClient | null, options: AgentStateOptions = {}) => {
  const flushDelayMs = options.flushDelayMs ?? 300;
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  const maxAttempts = options.maxAttempts ?? 4;
  const pending = new Map<string, Pending>();
  const deletedRooms = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> = Promise.resolve();

  const arm = (delayMs: number) => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      running = running.then(runFlush);
    }, delayMs);
    timer.unref();
  };

  const schedule = (key: string, roomId: string, write: () => Promise<void>) => {
    if (!client || deletedRooms.has(roomId)) return;
    pending.set(key, { roomId, attempts: 0, write });
    arm(flushDelayMs);
  };

  const runFlush = async () => {
    const batch = [...pending.entries()];
    pending.clear();
    let retry = false;
    for (const [key, entry] of batch) {
      if (deletedRooms.has(entry.roomId)) continue;
      try {
        await entry.write();
      } catch (error) {
        const attempts = entry.attempts + 1;
        const failure = safeFailure(error);
        logSafeEvent("agent-persistence", "write_failed", { key: key.split(":")[0], roomId: entry.roomId, attempts, code: failure.code, message: failure.message });
        // A newer write for the same record supersedes this one; otherwise retry a bounded number of times.
        if (attempts < maxAttempts && !pending.has(key)) {
          pending.set(key, { ...entry, attempts });
          retry = true;
        }
      }
    }
    if (retry) arm(retryDelayMs);
  };

  const prune = (table: "ai_tasks" | "patch_proposals", idColumn: "task_id" | "patch_id", orderColumn: "created_at" | "updated_at", keep: number, roomId: string) =>
    schedule(`prune:${table}:${roomId}`, roomId, async () => {
      const extra = await client!.from(table).select(idColumn).eq("room_id", roomId).order(orderColumn, { ascending: false }).range(keep, keep + 500);
      must(extra);
      const ids = ((extra.data ?? []) as unknown as Array<Record<string, string>>).map((row) => row[idColumn]).filter(Boolean);
      if (ids.length) must(await client!.from(table).delete().eq("room_id", roomId).in(idColumn, ids));
    });

  const persistence = {
    saveTask(task: AgentTaskRecord) {
      // The record object is updated in place, so the write always reads the latest state.
      schedule(`task:${task.roomId}:${task.taskId}`, task.roomId, async () => {
        must(await client!.from("ai_tasks").upsert(taskRow(task), { onConflict: "room_id,task_id" }));
      });
    },

    saveProposal(stored: StoredProposal) {
      schedule(`proposal:${stored.patch.roomId}:${stored.patch.patchId}`, stored.patch.roomId, async () => {
        must(await client!.from("patch_proposals").upsert(proposalRow(stored), { onConflict: "room_id,patch_id" }));
      });
    },

    saveMemory(roomId: string) {
      schedule(`memory:${roomId}`, roomId, async () => {
        must(await client!.from("project_memory").upsert({ room_id: roomId, memory: getAgentMemory(roomId), updated_at: new Date().toISOString() }, { onConflict: "room_id" }));
      });
    },

    pruneTasks: (roomId: string) => prune("ai_tasks", "task_id", "created_at", MAX_PERSISTED_TASKS_PER_ROOM, roomId),
    pruneProposals: (roomId: string) => prune("patch_proposals", "patch_id", "updated_at", MAX_PERSISTED_PROPOSALS_PER_ROOM, roomId),

    /**
     * Removes everything stored for a deleted room. The room is tombstoned
     * synchronously, before the first await, so a write that was already queued
     * cannot resurrect it. Returns false only when the database could not be updated.
     */
    async deleteRoom(roomId: string) {
      deletedRooms.add(roomId);
      if (deletedRooms.size > MAX_TOMBSTONES) deletedRooms.delete(deletedRooms.values().next().value as string);
      for (const [key, entry] of pending) if (entry.roomId === roomId) pending.delete(key);
      if (!client) return true;
      try {
        await running;
        const results = await Promise.all([
          client.from("ai_tasks").delete().eq("room_id", roomId),
          client.from("patch_proposals").delete().eq("room_id", roomId),
          client.from("project_memory").delete().eq("room_id", roomId)
        ]);
        results.forEach(must);
        return true;
      } catch (error) {
        const failure = safeFailure(error);
        logSafeEvent("agent-persistence", "delete_failed", { roomId, code: failure.code, message: failure.message });
        return false;
      }
    },

    /** Reads a room's stored state. Failures degrade to "nothing stored" rather than blocking the room. */
    async loadRoomState(roomId: string) {
      if (!client || deletedRooms.has(roomId)) return null;
      const read = async <T>(label: string, query: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => {
        try {
          const result = await query();
          if (result.error) throw result.error;
          return result.data;
        } catch (error) {
          const failure = safeFailure(error);
          logSafeEvent("agent-persistence", "load_failed", { roomId, table: label, code: failure.code, message: failure.message });
          return null;
        }
      };
      const [tasks, proposals, memory] = await Promise.all([
        read("ai_tasks", () => client.from("ai_tasks").select("payload").eq("room_id", roomId).order("created_at", { ascending: false }).limit(MAX_PERSISTED_TASKS_PER_ROOM)),
        read("patch_proposals", () => client.from("patch_proposals").select("payload").eq("room_id", roomId).order("updated_at", { ascending: false }).limit(MAX_PERSISTED_PROPOSALS_PER_ROOM)),
        read("project_memory", () => client.from("project_memory").select("memory").eq("room_id", roomId).maybeSingle())
      ]);
      return {
        tasks: ((tasks ?? []) as unknown as Array<{ payload: unknown }>).map((row) => row.payload),
        proposals: ((proposals ?? []) as unknown as Array<{ payload: unknown }>).map((row) => row.payload).reverse(),
        memory: (memory as unknown as { memory?: unknown } | null)?.memory ?? null
      };
    },

    /** Restores a room's AI state into memory. Never throws; live state is never overwritten. */
    async hydrate(roomId: string) {
      try {
        const state = await persistence.loadRoomState(roomId);
        if (!state) return false;
        const interrupted = hydrateAgentTasks(roomId, state.tasks);
        const proposals = hydrateAgentProposals(roomId, state.proposals);
        const memory = hydrateAgentMemory(roomId, state.memory);
        for (const task of interrupted) persistence.saveTask(task);
        if (state.tasks.length || proposals || memory) logSafeEvent("agent-persistence", "hydrated", { roomId, tasks: state.tasks.length, proposals, memory, interrupted: interrupted.length });
        return true;
      } catch (error) {
        const failure = safeFailure(error);
        logSafeEvent("agent-persistence", "hydrate_failed", { roomId, code: failure.code, message: failure.message });
        return false;
      }
    },

    /** Writes everything queued now (used on shutdown and by tests). Failed writes stay queued for retry. */
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      running = running.then(runFlush);
      await running;
    },

    pendingCount: () => pending.size
  };

  return persistence;
};

export type AgentStatePersistence = ReturnType<typeof createAgentStatePersistence>;

export const agentStatePersistence = createAgentStatePersistence(supabaseAdmin);

const registered = new WeakSet<object>();

/** Subscribes the persistence to task, proposal and memory changes. Idempotent per instance. */
export const registerAgentStatePersistence = (persistence: AgentStatePersistence = agentStatePersistence) => {
  if (registered.has(persistence)) return () => undefined;
  registered.add(persistence);
  const unsubscribers = [
    subscribeAgentTasks((event) => {
      const task = getAgentTask(event.task.taskId, event.task.roomId);
      if (!task) return;
      persistence.saveTask(task);
      if (event.type === "task_started") persistence.pruneTasks(task.roomId);
    }),
    subscribeAgentProposal((event) => {
      const stored = getAgentProposal(event.patchId);
      if (!stored) return;
      persistence.saveProposal(stored);
      if (event.type === "proposal_created") persistence.pruneProposals(stored.patch.roomId);
    }),
    subscribeAgentMemory((roomId) => persistence.saveMemory(roomId))
  ];
  return () => { unsubscribers.forEach((unsubscribe) => unsubscribe()); registered.delete(persistence); };
};
