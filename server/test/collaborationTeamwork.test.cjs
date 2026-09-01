const assert = require("node:assert/strict");
const test = require("node:test");

const { roomStore } = require("../dist/modules/rooms/roomStore");
const { addAgentTaskNote, findSimilarAgentTask, getPublicAgentTaskHistory, startAgentTask, updateAgentTask } = require("../dist/modules/agent/agentTaskHistory");

const requestFor = (room, userId, userInstruction) => ({
  roomId: room.roomId,
  userId,
  workspaceId: room.workspace.id,
  currentFileId: room.workspace.activeFileId,
  userInstruction,
  conversation: [],
  mode: "ASK",
  language: room.language,
  settings: { provider: "custom", model: "test-model", temperature: 0, maxTokens: 128, streaming: false, workspaceContextSize: "minimal" },
  contextBudget: 8_000,
  initiatorLabel: "Guest One"
});

test("room activity is shared, bounded, redacted, and tied to the active file", () => {
  const created = roomStore.createRoom("Activity owner", "javascript");
  const roomId = created.room.roomId;
  const userId = created.participant.userId;
  const file = created.room.workspace.files[created.room.workspace.activeFileId];
  const updates = [];
  const unsubscribe = require("../dist/modules/rooms/roomStore").subscribeRoomActivity((entry) => updates.push(entry));

  try {
    roomStore.updateCode(roomId, userId, `${file.content}\n// collaborator edit`, file.id);
    roomStore.recordActivity(roomId, userId, "agent", "reviewed token=do-not-leak", { taskId: "task-1", fileId: file.id });
    for (let index = 0; index < 75; index += 1) roomStore.recordActivity(roomId, userId, "room", `activity ${index}`);
    const snapshot = roomStore.getRoomSnapshot(roomId);
    const participant = snapshot.participants.find((entry) => entry.userId === userId);
    assert.equal(snapshot.activity.length, 60);
    assert.ok(snapshot.activity.every((entry) => entry.roomId === roomId));
    assert.ok(updates.some((entry) => entry.message.includes("[REDACTED]")));
    assert.equal(participant.activeFileId, file.id);
    assert.equal(participant.activeFileName, file.name);
    assert.equal(participant.activity, `Editing ${file.name}`);
    assert.ok(updates.some((entry) => entry.kind === "file" && entry.fileId === file.id));
  } finally {
    unsubscribe();
  }
});

test("shared AI tasks expose ownership, prevent near-duplicate work, and accept bounded notes", () => {
  const created = roomStore.createRoom("Guest One", "javascript");
  const room = created.room;
  const task = startAgentTask(requestFor(room, created.participant.userId, "fix the authentication error in the current file"));
  assert.ok(task);
  assert.equal(findSimilarAgentTask(room.roomId, "please fix the authentication error in the current file")?.taskId, task.taskId);
  assert.equal(addAgentTaskNote(task.taskId, room.roomId, created.participant.userId, "Guest One", "Check token=private-value before applying" ).notes[0].message, "Check token= [REDACTED] before applying");
  assert.equal(getPublicAgentTaskHistory(room.roomId)[0].requestedBy, "Guest One");
  assert.equal(getPublicAgentTaskHistory(room.roomId)[0].notes.length, 1);

  for (const status of ["planning", "running", "completed"]) assert.ok(updateAgentTask(task.taskId, { status }));
  assert.equal(findSimilarAgentTask(room.roomId, "fix the authentication error in the current file"), null);
});
