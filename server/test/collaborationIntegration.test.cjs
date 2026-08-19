const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { Server } = require("socket.io");
const { io: connectSocket } = require("socket.io-client");
const { createApp } = require("../dist/app");
const { registerCollaborationSocket } = require("../dist/sockets/collaborationSocket");

const waitFor = (socket, event, predicate = () => true, timeoutMs = 5_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off(event, listener);
    reject(new Error(`Timed out waiting for ${event}`));
  }, timeoutMs);
  const listener = (payload) => {
    if (!predicate(payload)) return;
    clearTimeout(timer);
    socket.off(event, listener);
    resolve(payload);
  };
  socket.on(event, listener);
});

const postJson = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};

const connectParticipant = async (baseUrl, roomId, session) => {
  const socket = connectSocket(baseUrl, {
    forceNew: true,
    transports: ["websocket"],
    auth: { guestToken: session.guestToken }
  });
  await waitFor(socket, "connect");
  const snapshot = waitFor(socket, "room:snapshot");
  socket.emit("room:join", { roomId, userId: session.userId });
  return { socket, snapshot: await snapshot };
};

test("room REST and Socket.IO collaboration preserve workspace, history, presence, typing, chat, reconnect, and deletion", async () => {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: true } });
  registerCollaborationSocket(io);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  const sockets = [];

  try {
    const created = await postJson(`${baseUrl}/api/rooms`, { username: "Owner", language: "javascript" });
    assert.equal(created.status, 201);
    assert.ok(created.body.participant.guestToken);
    const roomId = created.body.room.roomId;
    const owner = created.body.participant;

    const joined = await postJson(`${baseUrl}/api/rooms/${roomId}/join`, { username: "Guest" });
    assert.equal(joined.status, 200);
    assert.ok(joined.body.participant.guestToken);
    const guest = joined.body.participant;

    const { socket: ownerSocket } = await connectParticipant(baseUrl, roomId, owner);
    const { socket: guestSocket } = await connectParticipant(baseUrl, roomId, guest);
    sockets.push(ownerSocket, guestSocket);

    const codeSync = waitFor(guestSocket, "editor:sync", (payload) => payload.code === "console.log('shared');");
    ownerSocket.emit("editor:update", { roomId, userId: owner.userId, code: "console.log('shared');", fileId: created.body.room.workspace.activeFileId });
    assert.equal((await codeSync).fileId, created.body.room.workspace.activeFileId);

    const folderId = crypto.randomUUID();
    const folderSync = waitFor(guestSocket, "workspace:sync", (payload) => Object.values(payload.workspace.folders).some((folder) => folder.name === "src"));
    ownerSocket.emit("workspace:operation", { roomId, userId: owner.userId, operation: { id: folderId, type: "create-folder", name: "src", parentId: created.body.room.workspace.rootFolderId } });
    const workspaceAfterFolder = (await folderSync).workspace;
    const src = Object.values(workspaceAfterFolder.folders).find((folder) => folder.name === "src");
    assert.ok(src);

    const fileSync = waitFor(guestSocket, "workspace:sync", (payload) => Object.values(payload.workspace.files).some((file) => file.name === "helper.js"));
    ownerSocket.emit("workspace:operation", { roomId, userId: owner.userId, operation: { id: crypto.randomUUID(), type: "create-file", name: "helper.js", parentId: src.id } });
    assert.ok(Object.values((await fileSync).workspace.files).some((file) => file.name === "helper.js"));

    const typingStart = waitFor(guestSocket, "chat:typing", (payload) => payload.userId === owner.userId && payload.isTyping === true);
    ownerSocket.emit("chat:typing", { roomId, userId: owner.userId, isTyping: true });
    await typingStart;
    const typingStop = waitFor(guestSocket, "chat:typing", (payload) => payload.userId === owner.userId && payload.isTyping === false, 4_000);
    await typingStop;

    const chatMessage = waitFor(guestSocket, "chat:new", (payload) => payload.message === "hello collaborator");
    ownerSocket.emit("chat:send", { roomId, userId: owner.userId, message: "hello collaborator" });
    assert.equal((await chatMessage).userId, owner.userId);

    const cursorUpdate = waitFor(guestSocket, "cursor-update", (payload) => payload.userId === owner.userId && payload.lineNumber === 2);
    ownerSocket.emit("editor:cursor", { roomId, userId: owner.userId, cursor: { lineNumber: 2, column: 3 } });
    assert.equal((await cursorUpdate).column, 3);

    const restart = await new Promise((resolve) => ownerSocket.emit("room:restart", { roomId, actingUserId: owner.userId }, resolve));
    assert.equal(restart.ok, true);
    assert.match(restart.room.code, /function main/);

    ownerSocket.disconnect();
    const { socket: reconnectedOwner, snapshot: reconnectSnapshot } = await connectParticipant(baseUrl, roomId, owner);
    sockets.push(reconnectedOwner);
    assert.match(reconnectSnapshot.code, /function main/);
    const unauthenticatedRoom = await fetch(`${baseUrl}/api/rooms/${roomId}`);
    assert.equal(unauthenticatedRoom.status, 403);
    const persistedRoom = await fetch(`${baseUrl}/api/rooms/${roomId}?guestToken=${encodeURIComponent(owner.guestToken)}`).then((response) => response.json());
    assert.match(persistedRoom.code, /function main/);

    const deleted = waitFor(guestSocket, "room:deleted");
    reconnectedOwner.emit("room:delete", { roomId, actingUserId: owner.userId });
    await deleted;
    const missing = await fetch(`${baseUrl}/api/rooms/${roomId}`);
    assert.equal(missing.status, 404);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => io.close(resolve));
    if (httpServer.listening) {
      await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    }
  }
});
