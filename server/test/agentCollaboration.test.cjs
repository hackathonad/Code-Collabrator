const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { Server } = require("socket.io");
const { io: connectSocket } = require("socket.io-client");
const { createGuestSessionToken } = require("../dist/middleware/guestSession");
const { emitAgentWorkspaceChange, registerAgentProposal, subscribeAgentProposal, updateAgentProposal } = require("../dist/modules/agent/agentEvents");
const { getPublicAgentProposalHistory } = require("../dist/modules/agent/agentEvents");
const { getPublicAgentTaskHistory, startAgentTask } = require("../dist/modules/agent/agentTaskHistory");
const { createAgentToolRegistry } = require("../dist/modules/agent/agentToolRegistry");
const { workspacePathForFile } = require("../dist/modules/agent/agentSecurity");
const { roomStore } = require("../dist/modules/rooms/roomStore");
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

const connectParticipant = async (baseUrl, roomId, session) => {
  const socket = connectSocket(baseUrl, { forceNew: true, transports: ["websocket"], auth: { guestToken: session.guestToken } });
  await waitFor(socket, "connect");
  const snapshot = waitFor(socket, "room:snapshot");
  socket.emit("room:join", { roomId, userId: session.userId });
  return { socket, snapshot: await snapshot };
};

test("agent proposals broadcast safely and approved changes converge across collaborators", async () => {
  const created = roomStore.createRoom("Agent owner", "javascript");
  const roomId = created.room.roomId;
  const owner = created.participant;
  const guest = roomStore.joinRoom(roomId, "Collaborator").participant;
  const ownerSession = { userId: owner.userId, guestToken: createGuestSessionToken(roomId, owner.userId) };
  const guestSession = { userId: guest.userId, guestToken: createGuestSessionToken(roomId, guest.userId) };
  const httpServer = http.createServer();
  const io = new Server(httpServer, { cors: { origin: true } });
  registerCollaborationSocket(io);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  const sockets = [];

  try {
    const ownerConnection = await connectParticipant(baseUrl, roomId, { ...owner, ...ownerSession });
    const guestConnection = await connectParticipant(baseUrl, roomId, { ...guest, ...guestSession });
    sockets.push(ownerConnection.socket, guestConnection.socket);
    const initialRoom = roomStore.getRoomSnapshot(roomId);
    const file = initialRoom.workspace.files[initialRoom.workspace.activeFileId];
    const path = workspacePathForFile(initialRoom.workspace, file);
    const request = {
      roomId,
      userId: owner.userId,
      workspaceId: initialRoom.workspace.id,
      currentFileId: file.id,
      userInstruction: "Propose a review comment",
      conversation: [],
      mode: "EDIT",
      language: "javascript",
      settings: { provider: "custom", model: "test-model", temperature: 0, maxTokens: 256, streaming: false, workspaceContextSize: "minimal" },
      contextBudget: 8_000
    };
    const proposal = await createAgentToolRegistry({ room: initialRoom, request, allowPatchApplication: false }).run("APPLY_PATCH", { path, expectedContent: file.content, replacement: `${file.content}\n// agent change` });
    assert.equal(proposal.ok, true);
    const createdEvent = waitFor(guestConnection.socket, "agent:proposal", (event) => event.patchId === proposal.patch.patchId && event.type === "proposal_created");
    registerAgentProposal(proposal.patch, owner.userId);
    await createdEvent;

    const approvedEvent = waitFor(guestConnection.socket, "agent:proposal", (event) => event.patchId === proposal.patch.patchId && event.type === "proposal_approved");
    updateAgentProposal(proposal.patch.patchId, "proposal_approved", initialRoom.version);
    await approvedEvent;
    const sync = waitFor(guestConnection.socket, "editor:sync", (payload) => payload.code.includes("// agent change"));
    const applied = await createAgentToolRegistry({
      room: initialRoom,
      request,
      allowPatchApplication: true,
      onWorkspaceChanged: (snapshot, changedFile, patch) => emitAgentWorkspaceChange({ roomId, userId: owner.userId, fileId: changedFile.id, snapshot, patch })
    }).run("APPLY_PATCH", proposal.patch);
    assert.equal(applied.ok, true);
    updateAgentProposal(proposal.patch.patchId, "proposal_applied", applied.patch.baseVersion + 1);
    assert.equal((await sync).version, initialRoom.version + 1);
    assert.equal(roomStore.getRoomSnapshot(roomId).workspace.files[file.id].content.endsWith("// agent change"), true);

    const afterApply = roomStore.getRoomSnapshot(roomId);
    const secondFile = afterApply.workspace.files[file.id];
    const secondProposal = await createAgentToolRegistry({ room: afterApply, request: { ...request, currentFileId: secondFile.id }, allowPatchApplication: false }).run("APPLY_PATCH", { path, expectedContent: secondFile.content, replacement: `${secondFile.content}\n// rejected change` });
    assert.equal(secondProposal.ok, true);
    registerAgentProposal(secondProposal.patch, owner.userId);
    const rejectedEvent = waitFor(guestConnection.socket, "agent:proposal", (event) => event.patchId === secondProposal.patch.patchId && event.type === "proposal_rejected");
    updateAgentProposal(secondProposal.patch.patchId, "proposal_rejected");
    await rejectedEvent;
    assert.equal(roomStore.getRoomSnapshot(roomId).workspace.files[file.id].content.includes("// rejected change"), false);
    assert.equal(updateAgentProposal(secondProposal.patch.patchId, "proposal_rejected"), null, "duplicate rejection must not broadcast twice");

    guestConnection.socket.disconnect();
    const reconnected = await connectParticipant(baseUrl, roomId, { ...guest, ...guestSession });
    sockets.push(reconnected.socket);
    assert.equal(reconnected.snapshot.workspace.files[file.id].content.includes("// agent change"), true);
    assert.equal(reconnected.snapshot.workspace.files[file.id].content.includes("// agent change\n// agent change"), false);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => io.close(resolve));
    if (httpServer.listening) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("reconnect history is room-scoped and metadata-only", () => {
  const first = roomStore.createRoom("History owner", "javascript");
  const second = roomStore.createRoom("Other owner", "javascript");
  const request = { roomId: first.room.roomId, userId: first.participant.userId, workspaceId: first.room.workspace.id, currentFileId: first.room.workspace.activeFileId, userInstruction: "token=should-redact", conversation: [], mode: "ASK", language: "javascript", settings: { provider: "custom", model: "test", temperature: 0, maxTokens: 64, streaming: false, workspaceContextSize: "minimal" }, contextBudget: 8_000 };
  startAgentTask(request);
  startAgentTask({ ...request, roomId: second.room.roomId, userId: second.participant.userId, workspaceId: second.room.workspace.id, currentFileId: second.room.workspace.activeFileId });
  const file = first.room.workspace.files[first.room.workspace.activeFileId];
  const patch = { patchId: `history-${first.room.roomId}`, roomId: first.room.roomId, workspaceId: first.room.workspace.id, fileId: file.id, path: "main.js", baseVersion: first.room.version, expectedContent: file.content, replacement: "private-token=do-not-share", additions: 1, deletions: 0, preview: "secret preview", applied: false, status: "pending" };
  registerAgentProposal(patch, first.participant.userId);
  const tasks = getPublicAgentTaskHistory(first.room.roomId);
  const proposals = getPublicAgentProposalHistory(first.room.roomId);
  assert.equal(tasks.length, 1);
  assert.equal(proposals.length, 1);
  assert.equal(Object.hasOwn(proposals[0], "preview"), false);
  assert.equal(Object.hasOwn(proposals[0], "replacement"), false);
  assert.equal(getPublicAgentTaskHistory(second.room.roomId).length, 1);
  assert.doesNotMatch(tasks[0].summary, /should-redact/);
});
