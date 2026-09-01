const test = require("node:test");
const assert = require("node:assert/strict");

const { roomStore } = require("../dist/modules/rooms/roomStore");
const { createAgentToolRegistry } = require("../dist/modules/agent/agentToolRegistry");
const { executeAgent, parseAgentActionResult } = require("../dist/modules/agent/agentRuntime");
const { workspacePathForFile } = require("../dist/modules/agent/agentSecurity");

const settings = { provider: "custom", model: "test-model", temperature: 0, maxTokens: 256, streaming: false, workspaceContextSize: "minimal" };

const createFixture = () => {
  const created = roomStore.createRoom("Reliability owner", "javascript");
  return {
    room: created.room,
    request: {
      roomId: created.room.roomId,
      userId: created.participant.userId,
      workspaceId: created.room.workspace.id,
      currentFileId: created.room.workspace.activeFileId,
      userInstruction: "Inspect the current file",
      conversation: [],
      mode: "EDIT",
      language: "javascript",
      settings,
      contextBudget: 8_000
    }
  };
};

test("strict agent parsing distinguishes valid, deterministic repair, and malformed output", () => {
  assert.equal(parseAgentActionResult('{"type":"final","text":"Done"}').status, "valid");
  assert.equal(parseAgentActionResult("```json\n{\"type\":\"final\",\"text\":\"Done\"}\n```").status, "repaired");
  assert.equal(parseAgentActionResult('{"type":"plan","steps":[42]}').status, "invalid");
  assert.equal(parseAgentActionResult('{"type":"tool_call","tool":"RUN_SHELL","arguments":{"command":"whoami"}}').status, "invalid");
  assert.equal(parseAgentActionResult('{"type":"tool_call","tool":"APPLY_PATCH","arguments":{"path":"main.js","expectedContent":"old","replacement":42}}').status, "invalid");
  assert.equal(parseAgentActionResult('{"type":"tool_call","tool":"APPLY_PATCH","arguments":{"changes":[{"path":"main.js","expectedContent":"old"}]}}').status, "invalid");
});

test("malformed model output retries once and never becomes a tool call", async () => {
  const fixture = createFixture();
  let calls = 0;
  const events = [];
  const fakeAI = {
    getProviders: () => [{ id: "custom", supportsStreaming: false }],
    complete: async () => {
      calls += 1;
      return { provider: "custom", model: "test-model", content: calls === 1 ? '{"type":"tool_call","tool":"APPLY_PATCH","arguments":{"path":"main.js","expectedContent":"old"}}' : '{"type":"final","text":"The response was repaired safely."}' };
    },
    stream: () => { throw new Error("stream should not be used"); }
  };
  const result = await executeAgent(fixture.request, fixture.room, (event) => events.push(event), { aiService: fakeAI, repository: null });
  assert.equal(calls, 2);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.patches.length, 0);
  assert.equal(result.finalText, "The response was repaired safely.");
  assert.ok(events.some((event) => event.type === "status" && /retrying safely/i.test(event.message)));
});

test("two malformed model responses produce a safe normalized failure", async () => {
  const fixture = createFixture();
  const fakeAI = {
    getProviders: () => [{ id: "custom", supportsStreaming: false }],
    complete: async () => ({ provider: "custom", model: "test-model", content: '{"type":"tool_call","tool":"APPLY_PATCH","arguments":{"path":"main.js","expectedContent":"old"}}' }),
    stream: () => { throw new Error("stream should not be used"); }
  };
  const result = await executeAgent(fixture.request, fixture.room, undefined, { aiService: fakeAI, repository: null });
  assert.equal(result.toolCalls, 0);
  assert.equal(result.patches.length, 0);
  assert.match(result.finalText, /invalid structured response twice/i);
  assert.ok(result.events.some((event) => event.type === "error" && event.code === "INVALID_MODEL_OUTPUT"));
});

test("malformed patch objects and patch text are rejected without changing the workspace", async () => {
  const fixture = createFixture();
  const file = fixture.room.workspace.files[fixture.room.workspace.activeFileId];
  const path = workspacePathForFile(fixture.room.workspace, file);
  const tools = createAgentToolRegistry({ room: fixture.room, request: fixture.request, allowPatchApplication: false });
  const before = file.content;
  const malformedObject = await tools.run("APPLY_PATCH", { changes: [{ path, expectedContent: before, replacement: 42 }] });
  const malformedText = await tools.run("APPLY_PATCH", { path, expectedContent: before, replacement: "```diff\nnot a supported patch\n```" });
  assert.equal(malformedObject.ok, false);
  assert.equal(malformedText.ok, true, "patch text is content and remains proposal-safe when structurally valid");
  assert.equal(roomStore.getRoomSnapshot(fixture.room.roomId).workspace.files[file.id].content, before);
});
