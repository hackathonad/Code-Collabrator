const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createAgentStatePersistence, registerAgentStatePersistence, agentStatePersistence, MAX_PERSISTED_TASKS_PER_ROOM } = require("../dist/services/agentStatePersistence");
const { getAgentProposal, getPublicAgentProposalState, registerAgentProposal, updateAgentProposal } = require("../dist/modules/agent/agentEvents");
const { getAgentMemory, recordAgentMemory, removeAgentMemory } = require("../dist/modules/agent/agentMemory");
const { getAgentTask, getPublicAgentTaskHistory, recordTaskPatches, startAgentTask, updateAgentTask } = require("../dist/modules/agent/agentTaskHistory");
const { loadRoomIfNeeded } = require("../dist/modules/rooms/roomLoader");
const { roomPersistence } = require("../dist/services/roomPersistence");
const { roomStore } = require("../dist/modules/rooms/roomStore");

// ---- An in-memory stand-in for the slice of supabase-js the persistence uses. ----
const createFakeSupabase = ({ failUpserts = 0, failAllWrites = false } = {}) => {
  const tables = { ai_tasks: new Map(), patch_proposals: new Map(), project_memory: new Map() };
  const upserts = [];
  let remainingFailures = failUpserts;
  const keyOf = (table, row) => (table === "project_memory" ? row.room_id : `${row.room_id}|${row.task_id ?? row.patch_id}`);
  let sequence = 0;

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.columns = null; }
    upsert(payload) { this.op = "upsert"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    select(columns) { this.op = "select"; this.columns = columns; return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    order(column, { ascending = true } = {}) { this.orderBy = { column, ascending }; return this; }
    limit(count) { this.limitCount = count; return this; }
    range(from, to) { this.rangeArgs = [from, to]; return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
    execute() {
      const map = tables[this.table];
      if (this.op === "upsert") {
        if (failAllWrites || remainingFailures > 0) { remainingFailures -= 1; return { data: null, error: { message: "simulated outage token=hunter2", code: "XX000" } }; }
        const key = keyOf(this.table, this.payload);
        const existing = map.get(key);
        map.set(key, { ...(existing ?? { __seq: (sequence += 1), created_at: new Date(1_700_000_000_000 + sequence * 1000).toISOString() }), ...this.payload });
        upserts.push({ table: this.table, payload: this.payload });
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        for (const [key, row] of [...map]) if (this.filters.every((filter) => filter(row))) map.delete(key);
        return { data: null, error: null };
      }
      let rows = [...map.values()].filter((row) => this.filters.every((filter) => filter(row)));
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        rows.sort((left, right) => (left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0) * (ascending ? 1 : -1));
      }
      if (this.rangeArgs) rows = rows.slice(this.rangeArgs[0], this.rangeArgs[1] + 1);
      if (this.limitCount !== undefined) rows = rows.slice(0, this.limitCount);
      const columns = String(this.columns).split(",").map((column) => column.trim());
      const projected = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
      return { data: this.single ? projected[0] ?? null : projected, error: null };
    }
  }
  return { tables, upserts, from: (table) => new Query(table) };
};

const settings = { provider: "custom", model: "test-model", temperature: 0, maxTokens: 128, streaming: false, workspaceContextSize: "minimal" };
const newRoomId = () => crypto.randomBytes(6).toString("hex");
const taskRequest = (roomId, userId, instruction = "Explain the entry point") => ({ roomId, userId, workspaceId: "ws-1", currentFileId: "f1", userInstruction: instruction, conversation: [], mode: "ASK", language: "javascript", settings, contextBudget: 8_000 });
const storedTask = (roomId, overrides = {}) => ({
  taskId: crypto.randomUUID(), roomId, userId: crypto.randomUUID(), mode: "EDIT", intent: "fix", priority: "normal", watchers: [], notes: [], files: [], reviewCount: 0,
  summary: "Fix the bug", provider: "custom", model: "m", status: "completed", patchStatus: "none", validationStatus: "not-run", patchCount: 0, createdAt: 1_000, updatedAt: 1_000, ...overrides
});
const storedProposal = (roomId, overrides = {}, status = "proposal_created") => ({
  userId: crypto.randomUUID(), status,
  patch: { patchId: crypto.randomBytes(8).toString("hex"), roomId, workspaceId: "ws-1", fileId: "f1", path: "main.js", baseVersion: 3, expectedContent: "a", replacement: "b", additions: 1, deletions: 1, preview: "-a\n+b", applied: false, status: "pending", ...overrides }
});
const seed = (db, table, rows, keyFields) => rows.forEach((row, index) => db.tables[table].set(`${row.room_id}|${row[keyFields]}`, { __seq: index, created_at: new Date(1_700_000_000_000 + index * 1000).toISOString(), ...row }));
const seedTaskRows = (db, roomId, payloads) => seed(db, "ai_tasks", payloads.map((payload) => ({ room_id: roomId, task_id: payload.taskId, user_id: payload.userId, status: payload.status, mode: payload.mode, intent: payload.intent, priority: payload.priority, summary: payload.summary, payload, created_at: new Date(payload.createdAt ?? 0).toISOString(), updated_at: new Date(payload.updatedAt ?? 0).toISOString() })), "task_id");
const seedProposalRows = (db, roomId, stored) => seed(db, "patch_proposals", stored.map((entry) => ({ room_id: roomId, patch_id: entry.patch.patchId, task_id: null, user_id: entry.userId, status: entry.status, base_version: entry.patch.baseVersion, payload: entry, updated_at: new Date().toISOString() })), "patch_id");

test("AI tasks, proposals and memory are written through and survive a restart", async () => {
  const db = createFakeSupabase();
  const persistence = createAgentStatePersistence(db, { flushDelayMs: 5 });
  const unregister = registerAgentStatePersistence(persistence);
  try {
    const created = roomStore.createRoom("Owner", "javascript");
    const roomId = created.room.roomId;
    const requester = created.room.ownerId;

    const task = startAgentTask(taskRequest(roomId, requester, "Explain the entry point"));
    assert.ok(task);
    updateAgentTask(task.taskId, { status: "planning" });
    updateAgentTask(task.taskId, { status: "running" });
    const patch = storedProposal(roomId, { taskId: task.taskId }).patch;
    registerAgentProposal(patch, requester);
    recordTaskPatches(task.taskId, [patch]);
    updateAgentTask(task.taskId, { status: "waiting_for_approval" });
    updateAgentTask(task.taskId, { status: "completed" });
    const fact = recordAgentMemory(roomId, "projectFacts", "Uses npm workspaces");
    await persistence.flush();

    assert.equal(db.tables.ai_tasks.size, 1);
    const row = [...db.tables.ai_tasks.values()][0];
    assert.equal(row.status, "completed");
    assert.equal(row.user_id, requester, "the requester is stored so approval rights survive a restart");
    assert.equal(db.tables.patch_proposals.size, 1);
    assert.equal(db.tables.project_memory.get(roomId).memory.projectFacts[0].summary, "Uses npm workspaces");

    // "Restart": the server forgets the room's AI state, then the room is loaded again.
    roomStore.evictRoom(roomId);
    assert.equal(getPublicAgentTaskHistory(roomId).length, 0);
    assert.equal(getAgentProposal(patch.patchId), null);
    assert.equal(getAgentMemory(roomId).projectFacts.length, 0);

    assert.equal(await persistence.hydrate(roomId), true);
    const restored = getAgentTask(task.taskId, roomId);
    assert.ok(restored, "the task is back");
    assert.equal(restored.userId, requester);
    assert.equal(restored.status, "completed");
    assert.equal(restored.patchStatus, "proposed");
    const proposal = getAgentProposal(patch.patchId);
    assert.equal(proposal.patch.expectedContent, patch.expectedContent, "the exact patch content survives, not just its status");
    assert.equal(proposal.userId, requester);
    assert.equal(getPublicAgentProposalState(roomId)[0].status, "pending");
    assert.equal(getAgentMemory(roomId).projectFacts[0].summary, "Uses npm workspaces");

    // Editing memory is persisted too.
    removeAgentMemory(roomId, "projectFacts", fact.id);
    await persistence.flush();
    assert.equal(db.tables.project_memory.get(roomId).memory.projectFacts.length, 0);
  } finally {
    unregister();
  }
});

test("work that was running when the server stopped is closed honestly; work waiting on a person keeps waiting", async () => {
  const db = createFakeSupabase();
  const persistence = createAgentStatePersistence(db, { flushDelayMs: 5 });
  const roomId = newRoomId();
  const running = storedTask(roomId, { status: "running", createdAt: 5_000, updatedAt: 5_000 });
  const queued = storedTask(roomId, { status: "queued", createdAt: 4_000, updatedAt: 4_000 });
  const waiting = storedTask(roomId, { status: "waiting_for_approval", patchStatus: "proposed", createdAt: 3_000, updatedAt: 3_000 });
  const done = storedTask(roomId, { status: "completed", createdAt: 2_000, updatedAt: 2_000, resultSummary: "All good" });
  seedTaskRows(db, roomId, [done, waiting, queued, running]);

  const approved = storedProposal(roomId, {}, "proposal_approved");
  const pending = storedProposal(roomId, {}, "proposal_created");
  const applied = storedProposal(roomId, {}, "proposal_applied");
  seedProposalRows(db, roomId, [approved, pending, applied]);

  await persistence.hydrate(roomId);
  const history = getPublicAgentTaskHistory(roomId);
  assert.deepEqual(history.map((entry) => entry.taskId), [running.taskId, queued.taskId, waiting.taskId, done.taskId], "newest first, as in memory");
  const byId = Object.fromEntries(history.map((entry) => [entry.taskId, entry]));
  assert.equal(byId[running.taskId].status, "failed");
  assert.match(byId[running.taskId].resultSummary, /server restarted/);
  assert.equal(byId[queued.taskId].status, "failed");
  assert.equal(byId[waiting.taskId].status, "waiting_for_approval", "a task waiting for a human is not process-bound");
  assert.equal(byId[done.taskId].resultSummary, "All good");

  assert.equal(getAgentProposal(approved.patch.patchId).status, "proposal_stale", "an approval whose apply is unknown cannot be trusted");
  assert.equal(getAgentProposal(pending.patch.patchId).status, "proposal_created");
  assert.equal(getAgentProposal(applied.patch.patchId).status, "proposal_applied");

  await persistence.flush();
  assert.equal(db.tables.ai_tasks.get(`${roomId}|${running.taskId}`).status, "failed", "the corrected status is written back");
  assert.equal(db.tables.ai_tasks.get(`${roomId}|${done.taskId}`).status, "completed", "untouched tasks are not rewritten");
});

test("stored rows are validated: other rooms' data, malformed rows and oversize memory are dropped", async () => {
  const db = createFakeSupabase();
  const persistence = createAgentStatePersistence(db, { flushDelayMs: 5 });
  const roomId = newRoomId();
  const otherRoom = newRoomId();
  const good = storedTask(roomId);
  // Rows stored under this room whose payloads are wrong in various ways.
  seedTaskRows(db, roomId, [
    good,
    storedTask(otherRoom, { taskId: "from-another-room" }),
    storedTask(roomId, { taskId: "bad-status", status: "teleporting" }),
    storedTask(roomId, { taskId: "bad-mode", mode: "ROOT" }),
    storedTask(roomId, { taskId: "too-long", summary: "x".repeat(1_000) }),
    { taskId: "junk", roomId, userId: "u", status: "x" }
  ]);
  seedProposalRows(db, roomId, [
    storedProposal(roomId),
    storedProposal(otherRoom),
    storedProposal(roomId, { baseVersion: 0 }),
    storedProposal(roomId, { path: "x".repeat(400) })
  ]);
  const hugeMemory = { currentTask: { id: "c", category: "currentTask", summary: "working", createdAt: 1 }, projectFacts: Array.from({ length: 30 }, (_, index) => ({ id: `f${index}`, category: "projectFacts", summary: `fact ${index}`, createdAt: index })), recentDecisions: [{ id: "x", category: "projectFacts", summary: "wrong bucket", createdAt: 1 }, "nonsense"], patchDecisions: "not-an-array" };
  db.tables.project_memory.set(roomId, { room_id: roomId, memory: hugeMemory });

  await persistence.hydrate(roomId);
  assert.deepEqual(getPublicAgentTaskHistory(roomId).map((entry) => entry.taskId), [good.taskId]);
  assert.equal(getPublicAgentProposalState(roomId).length, 1, "only the valid proposal for this room survives");
  const memory = getAgentMemory(roomId);
  assert.equal(memory.projectFacts.length, 10, "memory is re-bounded");
  assert.equal(memory.projectFacts.at(-1).summary, "fact 29", "the newest entries are the ones kept");
  assert.equal(memory.recentDecisions.length, 0, "an entry in the wrong category is rejected");
  assert.equal(memory.currentTask.summary, "working");
});

test("live in-memory state is never overwritten by stored state", async () => {
  const db = createFakeSupabase();
  const persistence = createAgentStatePersistence(db, { flushDelayMs: 5 });
  const roomId = newRoomId();
  const live = startAgentTask(taskRequest(roomId, crypto.randomUUID(), "Live task"));
  recordAgentMemory(roomId, "projectFacts", "live fact");
  seedTaskRows(db, roomId, [storedTask(roomId, { summary: "Stored task" })]);
  db.tables.project_memory.set(roomId, { room_id: roomId, memory: { projectFacts: [{ id: "s", category: "projectFacts", summary: "stored fact", createdAt: 1 }] } });
  await persistence.hydrate(roomId);
  assert.deepEqual(getPublicAgentTaskHistory(roomId).map((entry) => entry.taskId), [live.taskId]);
  assert.deepEqual(getAgentMemory(roomId).projectFacts.map((entry) => entry.summary), ["live fact"]);
  roomStore.evictRoom(roomId);
});

test("rapid updates to one task are coalesced into a single write", async () => {
  const db = createFakeSupabase();
  const persistence = createAgentStatePersistence(db, { flushDelayMs: 20 });
  const unregister = registerAgentStatePersistence(persistence);
  try {
    const roomId = newRoomId();
    const task = startAgentTask(taskRequest(roomId, crypto.randomUUID(), "Coalesce me"));
    for (const status of ["planning", "running", "validating", "waiting_for_approval", "completed"]) updateAgentTask(task.taskId, { status });
    for (let index = 0; index < 10; index += 1) recordAgentMemory(roomId, "projectFacts", `fact ${index}`);
    await persistence.flush();
    assert.equal(db.upserts.filter((entry) => entry.table === "ai_tasks").length, 1, "one write, carrying the final state");
    assert.equal(db.upserts.filter((entry) => entry.table === "project_memory").length, 1);
    assert.equal(db.tables.ai_tasks.get(`${roomId}|${task.taskId}`).status, "completed");
    roomStore.evictRoom(roomId);
  } finally {
    unregister();
  }
});

test("a database outage never throws, retries a bounded number of times, and then recovers", async () => {
  const flaky = createFakeSupabase({ failUpserts: 2 });
  const persistence = createAgentStatePersistence(flaky, { flushDelayMs: 5, retryDelayMs: 5, maxAttempts: 4 });
  const unregister = registerAgentStatePersistence(persistence);
  try {
    const roomId = newRoomId();
    const task = startAgentTask(taskRequest(roomId, crypto.randomUUID(), "Survive an outage"));
    await assert.doesNotReject(() => persistence.flush());
    for (let attempt = 0; attempt < 10 && !flaky.tables.ai_tasks.size; attempt += 1) await persistence.flush();
    assert.equal(flaky.tables.ai_tasks.size, 1, "the write eventually lands");
    assert.ok(getAgentTask(task.taskId, roomId), "memory stayed authoritative throughout");
    roomStore.evictRoom(roomId);
  } finally {
    unregister();
  }

  const down = createFakeSupabase({ failAllWrites: true });
  const doomed = createAgentStatePersistence(down, { flushDelayMs: 5, retryDelayMs: 5, maxAttempts: 2 });
  const unregisterDoomed = registerAgentStatePersistence(doomed);
  const lines = [];
  const original = console.info;
  console.info = (line) => lines.push(String(line));
  try {
    const roomId = newRoomId();
    startAgentTask(taskRequest(roomId, crypto.randomUUID(), "Never persisted"));
    for (let attempt = 0; attempt < 6; attempt += 1) await doomed.flush();
    assert.equal(doomed.pendingCount(), 0, "retries are bounded; nothing is queued forever");
    assert.equal(down.tables.ai_tasks.size, 0);
    assert.ok(lines.some((line) => line.includes("write_failed")), "failures are logged");
    assert.equal(lines.some((line) => line.includes("hunter2")), false, "credentials in database errors are redacted from logs");
    roomStore.evictRoom(roomId);
  } finally {
    console.info = original;
    unregisterDoomed();
  }
});

test("deleting a room removes its stored AI state and blocks writes that were already queued", async () => {
  const db = createFakeSupabase();
  const persistence = createAgentStatePersistence(db, { flushDelayMs: 50 });
  const unregister = registerAgentStatePersistence(persistence);
  try {
    const roomId = newRoomId();
    const other = newRoomId();
    seedTaskRows(db, roomId, [storedTask(roomId)]);
    seedTaskRows(db, other, [storedTask(other)]);
    db.tables.project_memory.set(roomId, { room_id: roomId, memory: {} });

    startAgentTask(taskRequest(roomId, crypto.randomUUID(), "Queued before the delete"));
    assert.ok(persistence.pendingCount() > 0, "a write is waiting for its flush");
    assert.equal(await persistence.deleteRoom(roomId), true);
    assert.equal(persistence.pendingCount(), 0, "the queued write was discarded");
    await persistence.flush();
    assert.equal([...db.tables.ai_tasks.values()].filter((row) => row.room_id === roomId).length, 0, "nothing for the deleted room remains or comes back");
    assert.equal(db.tables.project_memory.has(roomId), false);
    assert.equal([...db.tables.ai_tasks.values()].filter((row) => row.room_id === other).length, 1, "other rooms are untouched");

    startAgentTask(taskRequest(roomId, crypto.randomUUID(), "After the delete"));
    await persistence.flush();
    assert.equal([...db.tables.ai_tasks.values()].filter((row) => row.room_id === roomId).length, 0, "a deleted room is never resurrected");
    roomStore.evictRoom(roomId);
  } finally {
    unregister();
  }
});

test("only the most recent tasks per room are retained", async () => {
  const db = createFakeSupabase();
  const persistence = createAgentStatePersistence(db, { flushDelayMs: 5 });
  const roomId = newRoomId();
  seedTaskRows(db, roomId, Array.from({ length: MAX_PERSISTED_TASKS_PER_ROOM + 7 }, (_, index) => storedTask(roomId, { taskId: `task-${String(index).padStart(3, "0")}`, createdAt: 1_000 + index, updatedAt: 1_000 + index })));
  persistence.pruneTasks(roomId);
  await persistence.flush();
  const kept = [...db.tables.ai_tasks.values()].map((row) => row.task_id).sort();
  assert.equal(kept.length, MAX_PERSISTED_TASKS_PER_ROOM);
  assert.equal(kept.includes("task-000"), false, "the oldest were pruned");
  assert.equal(kept.includes(`task-${String(MAX_PERSISTED_TASKS_PER_ROOM + 6).padStart(3, "0")}`), true, "the newest were kept");
});

test("loading a room restores its AI history, and proposals older than the room are marked stale", async () => {
  const roomId = newRoomId();
  const created = roomStore.createRoom("Reload owner", "javascript");
  const snapshot = { ...roomStore.getRoomSnapshot(created.room.roomId), roomId, version: 5 };
  roomStore.evictRoom(created.room.roomId);

  const outdated = storedProposal(roomId, { baseVersion: 3 });
  const current = storedProposal(roomId, { baseVersion: 5 });
  const task = storedTask(roomId, { status: "waiting_for_approval", patchStatus: "proposed", taskId: "linked-task" });
  outdated.patch.taskId = "linked-task";
  const state = { tasks: [task], proposals: [outdated, current], memory: { projectFacts: [{ id: "m1", category: "projectFacts", summary: "remembered", createdAt: 1 }] } };

  const originalLoad = roomPersistence.loadRoom;
  const originalState = agentStatePersistence.loadRoomState;
  roomPersistence.loadRoom = async (id) => (id === roomId ? snapshot : null);
  agentStatePersistence.loadRoomState = async (id) => (id === roomId ? state : null);
  try {
    assert.equal(await loadRoomIfNeeded(roomId), true);
    assert.equal(roomStore.hasRoom(roomId), true);
    assert.equal(getPublicAgentTaskHistory(roomId).length, 1);
    assert.equal(getAgentMemory(roomId).projectFacts[0].summary, "remembered");
    assert.equal(getAgentProposal(outdated.patch.patchId).status, "proposal_stale", "a proposal based on an older room version can no longer apply");
    assert.equal(getAgentProposal(current.patch.patchId).status, "proposal_created", "one at the room's version stays actionable");
    assert.equal(getAgentTask("linked-task", roomId).status, "conflict", "the task behind a stale proposal records the conflict");
  } finally {
    roomPersistence.loadRoom = originalLoad;
    agentStatePersistence.loadRoomState = originalState;
    roomStore.evictRoom(roomId);
  }
});

test("without a database the layer is a safe no-op", async () => {
  const none = createAgentStatePersistence(null);
  const unregister = registerAgentStatePersistence(none);
  try {
    const roomId = newRoomId();
    startAgentTask(taskRequest(roomId, crypto.randomUUID(), "No database"));
    recordAgentMemory(roomId, "projectFacts", "still works");
    await assert.doesNotReject(() => none.flush());
    assert.equal(none.pendingCount(), 0);
    assert.equal(await none.hydrate(roomId), false);
    assert.equal(await none.deleteRoom(roomId), true);
    assert.equal(getPublicAgentTaskHistory(roomId).length, 1, "in-memory behavior is unchanged");
    roomStore.evictRoom(roomId);
  } finally {
    unregister();
  }
});

test("the migration is guest-first, locked down, and uses the expected tables", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/202611100002_durable_agent_state.sql"), "utf8");
  for (const table of ["ai_tasks", "patch_proposals", "project_memory"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`), `${table} is created idempotently`);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table} has RLS enabled`);
    assert.match(sql, new RegExp(`revoke all on table[^;]*public\\.${table}[^;]*from anon, authenticated`), `${table} is closed to browser roles`);
  }
  assert.doesNotMatch(sql, /auth\.(uid|users)|references\s+auth\./i, "no Supabase Auth dependency (the product is guest-first)");
  assert.match(sql, /references public\.rooms\(id\) on delete cascade/);
  assert.match(sql, /primary key \(room_id, task_id\)/);
  assert.match(sql, /primary key \(room_id, patch_id\)/);
});
