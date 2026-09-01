import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentEvent } from "../src/lib/agentProtocol";

test("agent event validation accepts bounded events and rejects malformed payloads", () => {
  assert.equal(parseAgentEvent({ type: "status", message: "Preparing workspace context" })?.type, "status");
  assert.equal(parseAgentEvent({ type: "tool_call", tool: "RUN_SHELL", summary: "run shell" }), null);
  assert.equal(parseAgentEvent({ type: "plan", steps: [42] }), null);
  assert.equal(parseAgentEvent({ type: "patch_proposal", patch: { patchId: "p", roomId: "r", workspaceId: "w", fileId: "f", path: "main.js", baseVersion: 1, expectedContent: "old", replacement: "new", additions: 1, deletions: 0, preview: "diff", applied: false, status: "pending" } })?.type, "patch_proposal");
  assert.equal(parseAgentEvent({ type: "final", text: "x".repeat(12_001) }), null);
});
