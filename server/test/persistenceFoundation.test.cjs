const assert = require("node:assert/strict");
const test = require("node:test");
const { createRoomPersistence } = require("../dist/services/roomPersistence");
const { roomStore } = require("../dist/modules/rooms/roomStore");

const createFakeClient = ({ roomWriteError = null, roomWriteDelayMs = 0, roomWriteReject = null, roomUpdateError = null, readinessError = null } = {}) => {
  const calls = [];
  const result = async (error = null, delayMs = 0) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { data: null, error };
  };

  return {
    calls,
    from(table) {
      return {
        upsert(payload) {
          calls.push({ operation: "upsert", table, payload });
          if (table === "rooms" && roomWriteReject) return Promise.reject(roomWriteReject);
          return result(table === "rooms" ? roomWriteError : null, table === "rooms" ? roomWriteDelayMs : 0);
        },
        insert(payload) {
          calls.push({ operation: "insert", table, payload });
          return result();
        },
        update(payload) {
          calls.push({ operation: "update", table, payload });
          return { eq(column, value) {
            calls.push({ operation: "filter", table, column, value });
            return result(table === "rooms" ? roomUpdateError : null);
          } };
        },
        delete() {
          calls.push({ operation: "delete", table });
          return { eq(column, value) {
            calls.push({ operation: "filter", table, column, value });
            return result();
          } };
        },
        select(columns) {
          calls.push({ operation: "select", table, columns });
          const query = {
            eq() { return query; },
            is() { return query; },
            maybeSingle() { return result(readinessError); },
            limit() { return result(readinessError); }
          };
          return query;
        }
      };
    }
  };
};

const captureWarnings = async (callback) => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await callback();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
};

test("persistence is optional and unavailable writes resolve without rejecting", async () => {
  const created = roomStore.createRoom("Optional persistence owner");
  const persistence = createRoomPersistence(null);

  await assert.doesNotReject(() => persistence.saveRoom(created.room));
  assert.deepEqual(await persistence.checkReadiness(), {
    configured: false,
    healthy: false,
    status: "not-configured"
  });
});

test("room creation persistence is asynchronous and failed queued writes settle safely", async () => {
  const delayedClient = createFakeClient({ roomWriteDelayMs: 50 });
  const delayedPersistence = createRoomPersistence(delayedClient);
  const delayedRoom = roomStore.createRoom("Slow database owner");
  const startedAt = process.hrtime.bigint();
  const pendingWrite = delayedPersistence.saveRoom(delayedRoom.room);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  assert.ok(elapsedMs < 25, `saveRoom unexpectedly blocked for ${elapsedMs.toFixed(1)}ms`);
  await pendingWrite;
  assert.ok(delayedClient.calls.some((call) => call.operation === "upsert" && call.table === "rooms"));

  const writeError = new Error("temporary database outage");
  const failedClient = createFakeClient({ roomWriteReject: writeError });
  const failedPersistence = createRoomPersistence(failedClient);
  const failedRoom = roomStore.createRoom("Failed database owner");
  const warnings = await captureWarnings(async () => {
    const failedWrite = failedPersistence.saveRoom(failedRoom.room);
    await assert.doesNotReject(() => failedWrite);
    await failedPersistence.flush();
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].operation, "saveRoom");
  assert.equal(warnings[0][1].message, writeError.message);
});

test("configured persistence writes room, workspace, membership, and history, then tombstones deletion", async () => {
  const client = createFakeClient();
  const persistence = createRoomPersistence(client);
  const created = roomStore.createRoom("Durable owner");

  await persistence.saveRoom(created.room);
  await persistence.flush();
  assert.ok(client.calls.some((call) => call.operation === "upsert" && call.table === "rooms"));
  assert.ok(client.calls.some((call) => call.operation === "upsert" && call.table === "room_members"));
  assert.ok(client.calls.some((call) => call.operation === "insert" && call.table === "room_history"));
  assert.deepEqual(await persistence.checkReadiness(), { configured: true, healthy: true, status: "healthy" });

  assert.equal(await persistence.deleteRoom(created.room.roomId), true);
  const tombstone = client.calls.find((call) => call.operation === "update" && call.table === "rooms");
  assert.ok(tombstone);
  assert.ok(tombstone.payload.deleted_at);
  assert.equal(await persistence.loadRoom(created.room.roomId), null, "the local tombstone must prevent resurrection");
});

test("failed durable deletion stays fail-closed in memory and logs Supabase diagnostics safely", async () => {
  const databaseError = {
    code: "42703",
    message: "column rooms.deleted_at does not exist",
    details: "The requested column was not found",
    hint: "Apply the workspace persistence migration"
  };
  const client = createFakeClient({ roomUpdateError: databaseError });
  const persistence = createRoomPersistence(client);
  const created = roomStore.createRoom("Deletion owner");
  roomStore.deleteRoom(created.room.roomId, created.participant.userId);
  const warnings = await captureWarnings(async () => {
    assert.equal(await persistence.deleteRoom(created.room.roomId), false);
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[persistence] operation failed");
  assert.deepEqual(warnings[0][1], {
    operation: "deleteRoom",
    roomId: created.room.roomId,
    code: "42703",
    message: databaseError.message,
    details: databaseError.details,
    hint: databaseError.hint
  });

  assert.throws(() => roomStore.getRoomSnapshot(created.room.roomId), /Room not found/);
  assert.equal(await persistence.loadRoom(created.room.roomId), null, "a failed delete must not resurrect the room in this process");
});

test("readiness reports schema/database failure without exposing raw provider details to the browser", async () => {
  const client = createFakeClient({ readinessError: { code: "42P01", message: "relation public.rooms does not exist", details: "internal detail", hint: "apply migration" } });
  const persistence = createRoomPersistence(client);
  const warnings = await captureWarnings(async () => {
    assert.deepEqual(await persistence.checkReadiness(), {
      configured: true,
      healthy: false,
      status: "unavailable",
      errorCode: "42P01"
    });
  });
  assert.equal(warnings[0][1].message, "relation public.rooms does not exist");
  assert.equal(warnings[0][1].details, "internal detail");
  assert.equal(warnings[0][1].hint, "apply migration");
});
