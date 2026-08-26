const assert = require("node:assert/strict");
const test = require("node:test");

const { roomStore } = require("../dist/modules/rooms/roomStore");
const { buildProjectIndex, createTaskPlan, isComplexTask, recommendProvider, reviewPatch, selectRelevantFiles } = require("../dist/modules/agent/agentIntelligence");
const { createAgentToolRegistry } = require("../dist/modules/agent/agentToolRegistry");
const { parseAgentAction } = require("../dist/modules/agent/agentRuntime");
const { workspacePathForFile } = require("../dist/modules/agent/agentSecurity");
const { canTransitionAgentTask, getAgentTask, getPublicAgentTaskHistory, startAgentTask, taskStatusForResult, updateAgentTask, subscribeAgentTasks } = require("../dist/modules/agent/agentTaskHistory");

const settings = { provider: "custom", model: "test-model", temperature: 0, maxTokens: 256, streaming: false, workspaceContextSize: "minimal" };
const fixture = () => {
  const created = roomStore.createRoom("Index owner", "javascript");
  return { room: created.room, request: { roomId: created.room.roomId, userId: created.participant.userId, workspaceId: created.room.workspace.id, currentFileId: created.room.workspace.activeFileId, userInstruction: "inspect the workspace", conversation: [], mode: "ASK", language: "javascript", settings, contextBudget: 8000 } };
};

test("project index is bounded, discovers tests/config/scripts, and stays virtual-workspace only", () => {
  const value = fixture();
  const root = value.room.workspace.rootFolderId;
  for (const name of ["package.json", "service.ts", "service.test.js", "tsconfig.json"]) {
    const result = roomStore.applyWorkspaceOperation(value.room.roomId, value.request.userId, { id: `create-${name}`, type: "create-file", parentId: root, name });
    value.room = result.room;
  }
  let packageFile = Object.values(value.room.workspace.files).find((file) => file.name === "package.json");
  let sourceFile = Object.values(value.room.workspace.files).find((file) => file.name === "service.ts");
  let testFile = Object.values(value.room.workspace.files).find((file) => file.name === "service.test.js");
  packageFile = roomStore.updateCode(value.room.roomId, value.request.userId, JSON.stringify({ scripts: { test: "node --test", lint: "eslint" }, dependencies: { express: "1" } }), packageFile.id).room.workspace.files[packageFile.id];
  sourceFile = roomStore.updateCode(value.room.roomId, value.request.userId, "export function service() { return true; }", sourceFile.id).room.workspace.files[sourceFile.id];
  testFile = roomStore.updateCode(value.room.roomId, value.request.userId, "import { service } from '../src/service'; test('service', () => service());", testFile.id).room.workspace.files[testFile.id];
  value.room = roomStore.getRoomSnapshot(value.room.roomId);
  const index = buildProjectIndex(value.room);
  assert.ok(index.files.length >= 4);
  assert.ok(index.testFiles.some((path) => path.endsWith("service.test.js")));
  assert.ok(index.configFiles.some((path) => path === "package.json"));
  assert.deepEqual(index.scripts.slice(0, 2), ["test", "lint"]);
  assert.ok(index.dependencies.includes("express"));
  assert.ok(index.files.find((file) => file.path === "service.ts").symbols.includes("service"));
  assert.ok(index.files.find((file) => file.path === "service.test.js").imports.includes("../src/service"));
  assert.equal(index.files.some((file) => file.path.includes("node_modules")), false);
});

test("relevance selection and plans distinguish simple questions from workflow tasks", () => {
  const value = fixture();
  const relevant = selectRelevantFiles(value.room, value.request);
  assert.equal(relevant[0].file.id, value.request.currentFileId);
  assert.equal(isComplexTask({ userInstruction: "what does this function do?", intent: "explain", mode: "ASK" }), false);
  assert.equal(isComplexTask({ userInstruction: "review the entire project", intent: "review", mode: "ASK" }), true);
  const plan = createTaskPlan({ userInstruction: "review the entire project", intent: "review", mode: "ASK" }, relevant);
  assert.ok(plan.length >= 3);
  assert.match(plan[1], /security|correctness/i);
});

test("review protocol is structured and patch review flags dangerous or oversized proposals", () => {
  const parsed = parseAgentAction(JSON.stringify({ type: "review", findings: [{ severity: "high", file: "src/app.ts", line: 12, title: "Unsafe execution", explanation: "Evidence from the inspected file", suggestion: "Use an allowlist" }] }));
  assert.equal(parsed.type, "review");
  assert.equal(parsed.findings[0].line, 12);
  const findings = reviewPatch({ path: "src/app.ts", replacement: "import { execSync } from 'node:child_process';" });
  assert.ok(findings.some((finding) => finding.severity === "high"));
  assert.ok(reviewPatch({ path: "src/app.ts", replacement: "" }).some((finding) => finding.title === "Empty replacement"));
});

test("multi-file proposals apply atomically and stale conflicts leave every file unchanged", async () => {
  const value = fixture();
  const root = value.room.workspace.rootFolderId;
  value.room = roomStore.applyWorkspaceOperation(value.room.roomId, value.request.userId, { id: "create-second", type: "create-file", parentId: root, name: "helper.js" }).room;
  let snapshot = roomStore.getRoomSnapshot(value.room.roomId);
  const files = Object.values(snapshot.workspace.files);
  const first = files.find((file) => file.name === "main.js");
  const second = files.find((file) => file.name === "helper.js");
  value.room = roomStore.updateCode(value.room.roomId, value.request.userId, "export const helper = false;", second.id).room;
  snapshot = roomStore.getRoomSnapshot(value.room.roomId);
  const changes = [
    { path: workspacePathForFile(snapshot.workspace, first), expectedContent: first.content, replacement: `${first.content}\n// first` },
    { path: workspacePathForFile(snapshot.workspace, second), expectedContent: second.content, replacement: "export const helper = true;" }
  ];
  const proposal = await createAgentToolRegistry({ room: snapshot, request: value.request, allowPatchApplication: false }).run("APPLY_PATCH", { changes });
  assert.equal(proposal.ok, true);
  assert.equal(proposal.patch.files.length, 2);
  const applied = await createAgentToolRegistry({ room: snapshot, request: value.request, allowPatchApplication: true }).run("APPLY_PATCH", proposal.patch);
  assert.equal(applied.ok, true);
  snapshot = roomStore.getRoomSnapshot(value.room.roomId);
  assert.ok(snapshot.workspace.files[first.id].content.includes("// first"));
  assert.ok(snapshot.workspace.files[second.id].content.includes("helper = true"));
  assert.equal(snapshot.version, value.room.version + 1);

  const staleSnapshot = snapshot;
  const staleChanges = [
    { path: workspacePathForFile(staleSnapshot.workspace, first), expectedContent: staleSnapshot.workspace.files[first.id].content, replacement: `${staleSnapshot.workspace.files[first.id].content}\n// stale` },
    { path: workspacePathForFile(staleSnapshot.workspace, second), expectedContent: staleSnapshot.workspace.files[second.id].content, replacement: "export const helper = false;" }
  ];
  const staleProposal = await createAgentToolRegistry({ room: staleSnapshot, request: value.request, allowPatchApplication: false }).run("APPLY_PATCH", { changes: staleChanges });
  roomStore.updateCode(value.room.roomId, value.request.userId, "export const helper = 'collaborator';", second.id);
  const staleResult = await createAgentToolRegistry({ room: staleSnapshot, request: value.request, allowPatchApplication: true }).run("APPLY_PATCH", staleProposal.patch);
  assert.equal(staleResult.ok, false);
  const afterStale = roomStore.getRoomSnapshot(value.room.roomId);
  assert.equal(afterStale.workspace.files[first.id].content.includes("// stale"), false);
  assert.ok(afterStale.workspace.files[second.id].content.includes("collaborator"));
});

test("provider recommendation is advisory and task history is bounded and redacted", () => {
  const providers = [
    { id: "ollama", available: true, models: [{ id: "local" }], supportsStreaming: true, supportsToolCalling: false, supportsLocalModels: true, defaultModel: "local" },
    { id: "openai", available: true, models: [{ id: "gpt" }], supportsStreaming: true, supportsToolCalling: true, supportsLocalModels: false, defaultModel: "gpt" }
  ];
  const recommendation = recommendProvider(providers, "review");
  assert.equal(recommendation.providerId, "openai");
  assert.equal(recommendation.model, "gpt");
  const value = fixture();
  for (let index = 0; index < 45; index += 1) startAgentTask({ ...value.request, userInstruction: `token=super-secret-value-${index}` });
  const history = getPublicAgentTaskHistory(value.room.roomId, value.request.userId);
  assert.equal(history.length, 40);
  assert.ok(history.every((task) => !task.summary.includes("super-secret-value")));
  assert.ok(history.every((task) => !Object.hasOwn(task, "provider") && !Object.hasOwn(task, "model") && !Object.hasOwn(task, "userId")));
});

test("task lifecycle is deterministic, recoverable, and rejects duplicate task IDs", () => {
  const value = fixture();
  const taskId = `task-${value.room.roomId}`;
  const events = [];
  const unsubscribe = subscribeAgentTasks((event) => { if (event.task.taskId === taskId) events.push(event); });
  const task = startAgentTask({ ...value.request, taskId, conversationId: "conversation-1" });
  assert.equal(task.status, "queued");
  assert.equal(startAgentTask({ ...value.request, taskId }), null);
  assert.equal(startAgentTask({ ...fixture().request, taskId }), null, "task IDs remain unambiguous across rooms");
  for (const status of ["planning", "running", "waiting_for_approval", "validating", "waiting_for_approval", "applying", "validating", "completed"]) {
    assert.ok(updateAgentTask(taskId, { status }), status);
  }
  assert.equal(updateAgentTask(taskId, { status: "running" }), null, "terminal tasks cannot restart");
  assert.equal(canTransitionAgentTask("running", "timed_out"), true);
  assert.equal(taskStatusForResult("timeout"), "timed_out");
  assert.equal(taskStatusForResult("cancelled"), "cancelled");
  const publicTask = getPublicAgentTaskHistory(value.room.roomId, value.request.userId)[0];
  assert.equal(publicTask.conversationId, "conversation-1");
  assert.equal(publicTask.status, "completed");
  assert.ok(events.some((event) => event.task.status === "waiting_for_approval"));
  assert.equal(getAgentTask(taskId, value.room.roomId, value.request.userId).status, "completed");
  unsubscribe();
});
