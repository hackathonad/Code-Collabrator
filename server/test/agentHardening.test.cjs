const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { createGuestSessionToken } = require("../dist/middleware/guestSession");
const { roomStore } = require("../dist/modules/rooms/roomStore");
const { createAgentToolRegistry } = require("../dist/modules/agent/agentToolRegistry");
const { createValidationRunner } = require("../dist/modules/agent/validationRunner");
const {
  getPublicAgentProposalState,
  registerAgentProposal,
  subscribeAgentProposal,
  updateAgentProposal
} = require("../dist/modules/agent/agentEvents");
const {
  cancelAgentTask,
  getAgentTask,
  registerAgentTaskController,
  startAgentTask
} = require("../dist/modules/agent/agentTaskHistory");
const { workspacePathForFile } = require("../dist/modules/agent/agentSecurity");

const settings = {
  provider: "custom",
  model: "test-model",
  temperature: 0,
  maxTokens: 128,
  streaming: false,
  workspaceContextSize: "minimal"
};

const fixture = () => {
  const created = roomStore.createRoom("Hardening owner", "javascript");
  return {
    room: created.room,
    request: {
      roomId: created.room.roomId,
      userId: created.participant.userId,
      workspaceId: created.room.workspace.id,
      currentFileId: created.room.workspace.activeFileId,
      userInstruction: "Inspect the workspace",
      conversation: [],
      mode: "EDIT",
      language: "javascript",
      settings,
      contextBudget: 8_000
    }
  };
};

test("proposal transitions are one-way and reconnect state excludes raw patch content", async () => {
  const value = fixture();
  const file = value.room.workspace.files[value.room.workspace.activeFileId];
  const path = workspacePathForFile(value.room.workspace, file);
  const proposal = await createAgentToolRegistry({ room: value.room, request: value.request, allowPatchApplication: false }).run("APPLY_PATCH", {
    path,
    expectedContent: file.content,
    replacement: `${file.content}\n// safe proposal`
  });
  const events = [];
  const unsubscribe = subscribeAgentProposal((event) => events.push(event));
  registerAgentProposal(proposal.patch, value.request.userId);
  assert.equal(updateAgentProposal(proposal.patch.patchId, "proposal_approved").type, "proposal_approved");
  assert.equal(events.at(-1).type, "proposal_approved");
  assert.equal(updateAgentProposal(proposal.patch.patchId, "proposal_rejected"), null, "a rejected transition after approval is invalid");
  assert.deepEqual(updateAgentProposal(proposal.patch.patchId, "proposal_applied").type, "proposal_applied");
  unsubscribe();
  const state = getPublicAgentProposalState(value.room.roomId);
  assert.equal(state[0].status, "applied");
  assert.equal(Object.hasOwn(state[0], "expectedContent"), false);
  assert.equal(Object.hasOwn(state[0], "replacement"), false);
  assert.ok(state[0].preview.includes("safe proposal"));
  registerAgentProposal({ ...proposal.patch, patchId: `${proposal.patch.patchId}-secret`, preview: "token=do-not-broadcast" }, value.request.userId);
  const redacted = getPublicAgentProposalState(value.room.roomId).find((entry) => entry.patchId.endsWith("-secret"));
  assert.equal(redacted.preview, "[redacted sensitive preview]");
  roomStore.deleteRoom(value.room.roomId, value.request.userId);
});

test("task cancellation aborts the server controller and preserves terminal lifecycle", () => {
  const value = fixture();
  const task = startAgentTask(value.request);
  const controller = new AbortController();
  assert.equal(registerAgentTaskController(task.taskId, controller), true);
  const cancelled = cancelAgentTask(task.taskId, value.room.roomId, value.request.userId);
  assert.equal(controller.signal.aborted, true);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelAgentTask(task.taskId, value.room.roomId, value.request.userId).status, "cancelled");
  assert.equal(getAgentTask(task.taskId, value.room.roomId, value.request.userId).status, "cancelled");
  roomStore.deleteRoom(value.room.roomId, value.request.userId);
});

test("room deletion aborts and removes every related agent task", () => {
  const value = fixture();
  const task = startAgentTask(value.request);
  const controller = new AbortController();
  registerAgentTaskController(task.taskId, controller);
  roomStore.deleteRoom(value.room.roomId, value.request.userId);
  assert.equal(controller.signal.aborted, true);
  assert.equal(getAgentTask(task.taskId), null);
});

test("validation cancellation is a distinct non-success result", async () => {
  const value = fixture();
  const controller = new AbortController();
  controller.abort();
  const result = await createAgentToolRegistry({
    room: value.room,
    request: value.request,
    allowPatchApplication: false,
    signal: controller.signal
  }).run("RUN_VALIDATION", { category: "tests" });
  assert.equal(result.ok, false);
  assert.equal(result.validation.status, "cancelled");
  const cancelled = await createValidationRunner() ("tests", controller.signal);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.ok, false);
});

test("the lifecycle allows timeout from queued and rejects terminal restart", () => {
  const value = fixture();
  const task = startAgentTask(value.request);
  const { canTransitionAgentTask, updateAgentTask } = require("../dist/modules/agent/agentTaskHistory");
  assert.equal(canTransitionAgentTask("queued", "timed_out"), true);
  assert.ok(updateAgentTask(task.taskId, { status: "timed_out" }));
  assert.equal(updateAgentTask(task.taskId, { status: "running" }), null);
  roomStore.deleteRoom(value.room.roomId, value.request.userId);
});

test("proposal routes restore safe state, authorize collaborators, and isolate rooms", async () => {
  const value = fixture();
  const collaborator = roomStore.joinRoom(value.room.roomId, "Hardening collaborator");
  const collaboratorToken = createGuestSessionToken(value.room.roomId, collaborator.participant.userId);
  const file = value.room.workspace.files[value.room.workspace.activeFileId];
  const path = workspacePathForFile(value.room.workspace, file);
  const proposal = await createAgentToolRegistry({ room: value.room, request: value.request, allowPatchApplication: false }).run("APPLY_PATCH", {
    path,
    expectedContent: file.content,
    replacement: `${file.content}\n// approved by collaborator`
  });
  assert.equal(proposal.ok, true);
  registerAgentProposal(proposal.patch, value.request.userId);

  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const stateResponse = await fetch(`${baseUrl}/api/ai/rooms/${value.room.roomId}/agent/proposals?guestToken=${encodeURIComponent(collaboratorToken)}`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.proposals.length, 1);
    assert.equal(Object.hasOwn(state.proposals[0], "expectedContent"), false);
    assert.equal(Object.hasOwn(state.proposals[0], "replacement"), false);

    const fullResponse = await fetch(`${baseUrl}/api/ai/rooms/${value.room.roomId}/agent/proposals/${proposal.patch.patchId}?guestToken=${encodeURIComponent(collaboratorToken)}`);
    assert.equal(fullResponse.status, 200);
    assert.equal((await fullResponse.json()).patch.expectedContent, file.content);

    const applyResponse = await fetch(`${baseUrl}/api/ai/rooms/${value.room.roomId}/agent/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestToken: collaboratorToken, patch: proposal.patch })
    });
    assert.equal(applyResponse.status, 200);
    assert.match(roomStore.getRoomSnapshot(value.room.roomId).workspace.files[file.id].content, /approved by collaborator/);

    const duplicateResponse = await fetch(`${baseUrl}/api/ai/rooms/${value.room.roomId}/agent/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestToken: collaboratorToken, patch: proposal.patch })
    });
    assert.equal(duplicateResponse.status, 409);

    const other = fixture();
    const otherToken = createGuestSessionToken(other.room.roomId, other.request.userId);
    const crossRoomResponse = await fetch(`${baseUrl}/api/ai/rooms/${other.room.roomId}/agent/proposals/${proposal.patch.patchId}?guestToken=${encodeURIComponent(otherToken)}`);
    assert.equal(crossRoomResponse.status, 404);
    roomStore.deleteRoom(other.room.roomId, other.request.userId);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    roomStore.deleteRoom(value.room.roomId, value.request.userId);
  }
});
