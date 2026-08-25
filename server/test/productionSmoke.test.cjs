const assert = require("node:assert/strict");
const test = require("node:test");
const { io: connectSocket } = require("socket.io-client");
const { createRealtimeServer } = require("../dist/index");
const { env } = require("../dist/config/env");

const waitFor = (socket, event, timeoutMs = 5_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off(event, listener);
    reject(new Error(`Timed out waiting for ${event}`));
  }, timeoutMs);
  const listener = (payload) => {
    clearTimeout(timer);
    socket.off(event, listener);
    resolve(payload);
  };
  socket.on(event, listener);
});

test("guest room production smoke path supports CORS, REST, Socket.IO, and deletion", async () => {
  const { httpServer, io } = createRealtimeServer();
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  let socket;

  try {
    const allowedOrigin = env.clientOrigins[0];
    const preflight = await fetch(`${baseUrl}/api/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    assert.ok([200, 204].includes(preflight.status));
    assert.equal(preflight.headers.get("access-control-allow-origin"), allowedOrigin);

    const created = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Smoke Owner", language: "javascript" })
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    const roomId = createdBody.room.roomId;
    const session = createdBody.participant;

    const fetched = await fetch(`${baseUrl}/api/rooms/${roomId}?guestToken=${encodeURIComponent(session.guestToken)}`);
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).roomId, roomId);

    socket = connectSocket(baseUrl, {
      forceNew: true,
      transports: ["websocket", "polling"],
      auth: { guestToken: session.guestToken }
    });
    await waitFor(socket, "connect");
    const snapshot = waitFor(socket, "room:snapshot");
    socket.emit("room:join", { roomId, userId: session.userId });
    assert.equal((await snapshot).roomId, roomId);

    const deleted = await fetch(`${baseUrl}/api/rooms/${roomId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestToken: session.guestToken })
    });
    assert.equal(deleted.status, 204);

    const missing = await fetch(`${baseUrl}/api/rooms/${roomId}`);
    assert.equal(missing.status, 404);
  } finally {
    socket?.disconnect();
    await new Promise((resolve) => io.close(resolve));
    if (httpServer.listening) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
});
