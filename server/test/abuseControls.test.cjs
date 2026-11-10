// Limits are read once at import time, so configure them before requiring the build.
process.env.ROOM_MAX_PARTICIPANTS = "3";
process.env.ROOM_CREATE_RATE_LIMIT = "4";
process.env.ROOM_MISS_RATE_LIMIT = "3";
process.env.AI_IP_RATE_LIMIT = "2";
process.env.AI_ROOM_RATE_LIMIT = "50";
process.env.AI_GLOBAL_DAILY_LIMIT = "5";
process.env.API_RATE_LIMIT = "2000";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { parseServerEnvironment } = require("../dist/config/env");
const { createRateLimiter } = require("../dist/lib/rateLimiter");
const { roomStore } = require("../dist/modules/rooms/roomStore");
const { loadRoomIfNeeded } = require("../dist/modules/rooms/roomLoader");
const { roomPersistence } = require("../dist/services/roomPersistence");
const { sweepIdleRooms } = require("../dist/services/roomLifecycle");
const { checkAIBudget, resetAIBudget } = require("../dist/services/aiBudget");
const { resetRoomRouteLimiters } = require("../dist/routes/roomRoutes");

const withServer = async (work) => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await fetch(baseUrl + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try { await work({ baseUrl, post }); } finally { await new Promise((resolve) => server.close(resolve)); }
};

test("rate limiter counts per key, expires windows, and stays bounded", () => {
  let clock = 1_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 100, maxKeys: 3, now: () => clock });
  assert.equal(limiter.hit("a"), true);
  assert.equal(limiter.isLimited("a"), false);
  assert.equal(limiter.hit("a"), true);
  assert.equal(limiter.isLimited("a"), true, "a key at its limit is reported limited without recording");
  assert.equal(limiter.hit("a"), false);
  assert.ok(limiter.retryAfterMs("a") > 0 && limiter.retryAfterMs("a") <= 100);
  assert.equal(limiter.hit("b"), true, "other keys are independent");
  clock += 101;
  assert.equal(limiter.isLimited("a"), false, "the window expires");
  assert.equal(limiter.hit("a"), true);
  for (const key of ["k1", "k2", "k3", "k4", "k5"]) limiter.hit(key);
  assert.ok(limiter.size() <= 3, "rotating keys cannot grow the limiter past maxKeys");
  limiter.reset();
  assert.equal(limiter.size(), 0);
});

test("capacity settings are configurable but never exceed hard bounds", () => {
  const configured = parseServerEnvironment({ NODE_ENV: "test", ROOM_MAX_PARTICIPANTS: "40", MAX_ACTIVE_ROOMS: "900", AI_GLOBAL_DAILY_LIMIT: "123" }).config;
  assert.deepEqual([configured.roomMaxParticipants, configured.maxActiveRooms, configured.aiGlobalDailyLimit], [40, 900, 123]);
  const invalid = parseServerEnvironment({ NODE_ENV: "test", ROOM_MAX_PARTICIPANTS: "100000", MAX_ACTIVE_ROOMS: "0", AI_IP_RATE_LIMIT: "-5", ROOM_IDLE_TTL_MS: "abc" }).config;
  assert.equal(invalid.roomMaxParticipants, 25);
  assert.equal(invalid.maxActiveRooms, 500);
  assert.equal(invalid.aiIpRateLimit, 90);
  assert.equal(invalid.roomIdleTtlMs, 86_400_000);
});

test("a room caps its participants, reclaims stale offline guests, and never evicts the owner or online people", () => {
  const created = roomStore.createRoom("Owner", "javascript");
  const roomId = created.room.roomId;
  const first = roomStore.joinRoom(roomId, "One");
  roomStore.joinRoom(roomId, "Two");
  assert.throws(() => roomStore.joinRoom(roomId, "Three"), /Room is full/);

  // A returning identity is not a new participant, so it is never refused.
  assert.doesNotThrow(() => roomStore.joinRoom(roomId, "One again", first.participant.userId));

  // Freshly joined offline guests are kept: reclaim needs ten idle minutes.
  assert.throws(() => roomStore.joinRoom(roomId, "Four"), /Room is full/);

  const stale = roomStore.getParticipant(roomId, first.participant.userId);
  stale.lastActiveAt = Date.now() - 11 * 60_000;
  stale.isOnline = true;
  assert.throws(() => roomStore.joinRoom(roomId, "Five"), /Room is full/, "an online guest is not reclaimed");
  stale.isOnline = false;
  const joined = roomStore.joinRoom(roomId, "Six");
  assert.equal(joined.room.participants.length, 3);
  assert.equal(joined.room.participants.some((participant) => participant.userId === first.participant.userId), false);
  assert.equal(joined.room.participants.some((participant) => participant.userId === created.room.ownerId), true);
});

test("a full room answers HTTP joins with a conflict and a clear message", async () => {
  resetRoomRouteLimiters();
  await withServer(async ({ post }) => {
    const created = await post("/api/rooms", { username: "Owner" });
    assert.equal(created.status, 201);
    const roomId = created.body.room.roomId;
    assert.equal((await post(`/api/rooms/${roomId}/join`, { username: "A" })).status, 200);
    assert.equal((await post(`/api/rooms/${roomId}/join`, { username: "B" })).status, 200);
    const refused = await post(`/api/rooms/${roomId}/join`, { username: "C" });
    assert.equal(refused.status, 409);
    assert.match(refused.body.message, /Room is full/);
  });
});

test("room creation is limited per network address", async () => {
  resetRoomRouteLimiters();
  await withServer(async ({ post }) => {
    for (let index = 0; index < 4; index += 1) assert.equal((await post("/api/rooms", { username: `User${index}` })).status, 201);
    const limited = await post("/api/rooms", { username: "Excess" });
    assert.equal(limited.status, 429);
    assert.match(limited.body.message, /Too many rooms/);
  });
});

test("repeated unknown room lookups from one address are throttled", async () => {
  resetRoomRouteLimiters();
  await withServer(async ({ baseUrl, post }) => {
    for (const roomId of ["aaaaaaa1", "aaaaaaa2", "aaaaaaa3"]) {
      assert.equal((await post(`/api/rooms/${roomId}/join`, { username: "Scanner" })).status, 404);
    }
    assert.equal((await post("/api/rooms/aaaaaaa4/join", { username: "Scanner" })).status, 429);
    assert.equal((await fetch(`${baseUrl}/api/rooms/aaaaaaa5`)).status, 429, "reads share the same enumeration budget");
  });
});

test("AI budget is bounded by network, room and a global daily limit, not by identity", () => {
  resetAIBudget();
  assert.deepEqual(checkAIBudget({ ip: "10.0.0.1", roomId: "r1" }), { ok: true });
  assert.deepEqual(checkAIBudget({ ip: "10.0.0.1", roomId: "r2" }), { ok: true });
  const byIp = checkAIBudget({ ip: "10.0.0.1", roomId: "r3" });
  assert.equal(byIp.ok, false);
  assert.equal(byIp.status, 429);
  assert.equal(byIp.code, "RATE_LIMITED");
  assert.ok(byIp.retryAfterMs > 0);

  assert.equal(checkAIBudget({ ip: "10.0.0.2", roomId: "r4" }).ok, true);
  assert.equal(checkAIBudget({ ip: "10.0.0.2", roomId: "r5" }).ok, true);
  assert.equal(checkAIBudget({ ip: "10.0.0.3", roomId: "r6" }).ok, true);
  const exhausted = checkAIBudget({ ip: "10.0.0.4", roomId: "r7" });
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.status, 503);
  assert.equal(exhausted.code, "AI_BUDGET_EXHAUSTED");
  resetAIBudget();
});

test("minting new guest identities does not buy more AI requests from the same network", async () => {
  resetRoomRouteLimiters();
  resetAIBudget();
  await withServer(async ({ post }) => {
    const created = await post("/api/rooms", { username: "Owner" });
    const roomId = created.body.room.roomId;
    // The owner plus two freshly minted identities fill the room (cap 3). Every
    // identity has its own untouched per-user quota, yet the network limit (2) still applies.
    const identities = [created.body.participant];
    for (const name of ["Fresh1", "Fresh2"]) identities.push((await post(`/api/rooms/${roomId}/join`, { username: name })).body.participant);
    assert.equal(identities.length, 3);
    const outcomes = [];
    for (const identity of identities) {
      const response = await post(`/api/ai/rooms/${roomId}/complete`, { guestToken: identity.guestToken, prompt: "hello", settings: { provider: "custom", model: "none" } });
      outcomes.push({ status: response.status, code: response.body.code });
    }
    assert.deepEqual(outcomes.slice(0, 2).map((outcome) => outcome.status), [503, 503], "within budget the request proceeds and the unconfigured provider answers");
    assert.deepEqual(outcomes[2], { status: 429, code: "RATE_LIMITED" }, "the third identity from the same network is refused before any provider is reached");
  });
  resetAIBudget();
});

test("idle rooms are persisted then evicted; occupied and fresh rooms stay", async () => {
  const saved = [];
  const originalSave = roomPersistence.saveRoom;
  roomPersistence.saveRoom = async (snapshot) => { saved.push(snapshot.roomId); };
  try {
    const idle = roomStore.createRoom("Idle", "javascript");
    const occupied = roomStore.createRoom("Occupied", "javascript");
    const fresh = roomStore.createRoom("Fresh", "javascript");
    roomStore.connectParticipant(occupied.room.roomId, occupied.room.ownerId, "socket-1");

    const hour = 60 * 60_000;
    const later = Date.now() + 25 * hour;
    // Make "fresh" look recently active relative to the sweep time.
    roomStore.getParticipant(fresh.room.roomId, fresh.room.ownerId);
    const freshRoom = roomStore.getRoomSnapshot(fresh.room.roomId);
    assert.ok(freshRoom.updatedAt <= later);

    const ids = roomStore.listIdleRoomIds(24 * hour, later);
    assert.ok(ids.includes(idle.room.roomId));
    assert.equal(ids.includes(occupied.room.roomId), false, "a room with someone connected is never idle");
    assert.equal(roomStore.listIdleRoomIds(24 * hour, Date.now()).includes(fresh.room.roomId), false);

    const evicted = await sweepIdleRooms({ ttlMs: 24 * hour, now: later });
    assert.ok(evicted >= 1);
    assert.ok(saved.includes(idle.room.roomId), "the final snapshot is persisted before eviction");
    assert.equal(roomStore.hasRoom(idle.room.roomId), false);
    assert.equal(roomStore.hasRoom(occupied.room.roomId), true);
  } finally {
    roomPersistence.saveRoom = originalSave;
  }
});

test("an evicted room reloads from persistence, and concurrent loads share one read", async () => {
  const created = roomStore.createRoom("Reloader", "javascript");
  const roomId = created.room.roomId;
  const snapshot = roomStore.getRoomSnapshot(roomId);
  roomStore.evictRoom(roomId);
  assert.equal(roomStore.hasRoom(roomId), false);

  const originalLoad = roomPersistence.loadRoom;
  let reads = 0;
  roomPersistence.loadRoom = async (id) => { reads += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return id === roomId ? snapshot : null; };
  try {
    const results = await Promise.all([loadRoomIfNeeded(roomId), loadRoomIfNeeded(roomId), loadRoomIfNeeded(roomId)]);
    assert.deepEqual(results, [true, true, true]);
    assert.equal(reads, 1, "concurrent callers share a single database read");
    assert.equal(roomStore.hasRoom(roomId), true);
    assert.equal(await loadRoomIfNeeded("00000000"), false);

    // A room that became resident while a read was in flight must not be overwritten by the stored copy.
    roomStore.evictRoom(roomId);
    roomPersistence.loadRoom = async () => { roomStore.upsertRoomSnapshot({ ...snapshot, code: "live edit" }); return snapshot; };
    assert.equal(await loadRoomIfNeeded(roomId), true);
    assert.equal(roomStore.getRoomSnapshot(roomId).code, "live edit");
  } finally {
    roomPersistence.loadRoom = originalLoad;
  }
});
