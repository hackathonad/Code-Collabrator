const assert = require("node:assert/strict");
const test = require("node:test");
const { buildProjectIndex } = require("../dist/modules/agent/agentIntelligence");
const { buildProjectExperience } = require("../dist/modules/agent/projectExperience");
const { assignAgentTask, getPublicAgentTaskHistory, setAgentTaskPriority, startAgentTask, toggleAgentTaskWatch } = require("../dist/modules/agent/agentTaskHistory");
const { createGuestSessionToken } = require("../dist/middleware/guestSession");
const { roomStore } = require("../dist/modules/rooms/roomStore");

const taskRequest = (room, userId, instruction = "Review the current project") => ({
  roomId: room.roomId,
  userId,
  workspaceId: room.workspace.id,
  currentFileId: room.workspace.activeFileId,
  userInstruction: instruction,
  conversation: [],
  mode: "ASK",
  language: room.language,
  settings: { provider: "custom", model: "test-model", temperature: 0, maxTokens: 128, streaming: false, workspaceContextSize: "minimal" },
  contextBudget: 8_000
});

test("project experience reports bounded, actual workspace and validation evidence", () => {
  const created = roomStore.createRoom("Project owner", "javascript");
  const room = roomStore.getRoomSnapshot(created.room.roomId);
  const experience = buildProjectExperience({
    room,
    index: buildProjectIndex(room),
    repository: null,
    executions: [
      { roomId: room.roomId, workspaceId: room.workspace.id, action: "build", status: "completed", durationMs: 41, createdAt: 20, errorSummary: null },
      { roomId: room.roomId, workspaceId: room.workspace.id, action: "tests", status: "failed", durationMs: 23, createdAt: 21, errorSummary: "A controlled test failure" }
    ],
    providers: [{ id: "custom", available: true, models: [{ id: "test" }] }],
    tasks: [],
    now: 100
  });
  assert.equal(experience.workspaceId, room.workspace.id);
  assert.equal(experience.snapshot.language, "JavaScript");
  assert.equal(experience.snapshot.backend, "Not detected in indexed files");
  assert.equal(experience.health.find((item) => item.id === "build").state, "passed");
  assert.equal(experience.health.find((item) => item.id === "tests").state, "failed");
  assert.equal(experience.health.find((item) => item.id === "typecheck").state, "not-run");
  assert.ok(experience.onboarding.overview.some((line) => line.includes("Entry points")));
  assert.ok(experience.map.areas.length <= 12);
  assert.ok(experience.readiness.every((item) => !/success|passed/i.test(item.detail) || item.state === "ready" || item.state === "passed"));
});

test("task collaboration metadata is room-scoped, bounded, and publicly safe", () => {
  const created = roomStore.createRoom("Task owner", "javascript");
  const room = roomStore.getRoomSnapshot(created.room.roomId);
  const other = roomStore.joinRoom(room.roomId, "Reviewer").participant;
  const task = startAgentTask(taskRequest(room, created.participant.userId, "Review token=do-not-share"));
  assert.ok(task);
  assert.equal(setAgentTaskPriority(task.taskId, room.roomId, "urgent").priority, "urgent");
  assert.equal(assignAgentTask(task.taskId, room.roomId, { userId: other.userId, displayName: other.displayName }).assignedTo.displayName, "Reviewer");
  const watched = toggleAgentTaskWatch(task.taskId, room.roomId, { userId: other.userId, displayName: other.displayName }, true);
  assert.equal(watched.watchers.length, 1);
  const publicTask = getPublicAgentTaskHistory(room.roomId)[0];
  assert.equal(publicTask.priority, "urgent");
  assert.equal(publicTask.assignedTo.userId, other.userId);
  assert.equal(publicTask.watchers[0].displayName, "Reviewer");
  assert.doesNotMatch(publicTask.summary, /do-not-share/);
  assert.equal(Object.hasOwn(publicTask, "userId"), false);
  assert.equal(typeof createGuestSessionToken(room.roomId, created.participant.userId), "string");
});
