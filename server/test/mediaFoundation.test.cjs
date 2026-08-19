const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const test = require("node:test");
const { createGuestSessionToken } = require("../dist/middleware/auth");
const { createMediaRoutes } = require("../dist/routes/mediaRoutes");
const { roomStore } = require("../dist/modules/rooms/roomStore");

const startMediaApi = async (mediaService) => {
  const app = express(); app.use(express.json()); app.use("/api", createMediaRoutes(mediaService));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

test("media token endpoint issues a short-lived room token only for the trusted guest participant", async () => {
  const issued = [];
  const fakeMedia = { getStatus: () => ({ provider: "livekit", configured: true, publicUrl: "ws://127.0.0.1:7880" }), issueToken: async (request) => { issued.push(request); return { provider: "livekit", serverUrl: "ws://127.0.0.1:7880", token: "test-token", expiresAt: Date.now() + 900_000 }; } };
  const { server, url } = await startMediaApi(fakeMedia);
  const created = roomStore.createRoom("Media owner");
  try {
    const response = await fetch(`${url}/api/rooms/${created.room.roomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestToken: createGuestSessionToken(created.room.roomId, created.participant.userId), userId: "spoofed-user", role: "owner" }) });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.session.token, "test-token");
    assert.equal(issued[0].participant.userId, created.participant.userId); assert.equal(issued[0].participant.username, "Media owner"); assert.equal(issued[0].participant.role, "owner");
    assert.equal("apiSecret" in body.session, false);
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("media token endpoint rejects invalid sessions, unknown rooms, and absent media configuration", async () => {
  const unavailable = { getStatus: () => ({ provider: "livekit", configured: false, publicUrl: null }), issueToken: async () => { throw new Error("should not issue"); } };
  const { server, url } = await startMediaApi(unavailable);
  const created = roomStore.createRoom("Media guest");
  try {
    const invalid = await fetch(`${url}/api/rooms/${created.room.roomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(invalid.status, 401);
    const forged = await fetch(`${url}/api/rooms/${created.room.roomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestToken: "not-a-valid-session" }) });
    assert.equal(forged.status, 401);
    const missingRoomId = "deadbeef"; const missing = await fetch(`${url}/api/rooms/${missingRoomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestToken: createGuestSessionToken(missingRoomId, created.participant.userId) }) });
    assert.equal(missing.status, 404);
    const notConfigured = await fetch(`${url}/api/rooms/${created.room.roomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestToken: createGuestSessionToken(created.room.roomId, created.participant.userId) }) });
    assert.equal(notConfigured.status, 503);
    assert.equal((await notConfigured.json()).code, "MEDIA_NOT_CONFIGURED");
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("media token endpoint validates room IDs, rejects deleted rooms, and rate limits trusted sessions", async () => {
  const configured = { getStatus: () => ({ provider: "livekit", configured: true, publicUrl: "ws://127.0.0.1:7880" }), issueToken: async () => ({ provider: "livekit", serverUrl: "ws://127.0.0.1:7880", token: "test-token", expiresAt: Date.now() + 900_000 }) };
  const { server, url } = await startMediaApi(configured);
  const deleted = roomStore.createRoom("Deleted media room");
  const active = roomStore.createRoom("Limited media room");
  try {
    const malformed = await fetch(`${url}/api/rooms/not-a-room/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(malformed.status, 400);

    roomStore.deleteRoom(deleted.room.roomId, deleted.participant.userId);
    const deletedResponse = await fetch(`${url}/api/rooms/${deleted.room.roomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestToken: createGuestSessionToken(deleted.room.roomId, deleted.participant.userId) }) });
    assert.equal(deletedResponse.status, 404);

    const body = JSON.stringify({ guestToken: createGuestSessionToken(active.room.roomId, active.participant.userId) });
    for (let request = 0; request < 8; request += 1) {
      const accepted = await fetch(`${url}/api/rooms/${active.room.roomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      assert.equal(accepted.status, 200);
    }
    const limited = await fetch(`${url}/api/rooms/${active.room.roomId}/media/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "RATE_LIMITED");
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
