import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentTaskEvent, parseRoomActivity, parseRoomActivityList } from "../src/lib/collaborationProtocol";

test("room activity protocol keeps bounded, known, room-safe entries", () => {
  const entry = parseRoomActivity({ id: "activity-1", roomId: "room-1", actorName: "Guest", kind: "agent", message: "started a task", createdAt: 10 });
  assert.equal(entry?.kind, "agent");
  assert.equal(parseRoomActivity({ id: "bad", roomId: "room-1", actorName: "Guest", kind: "unknown", message: "x", createdAt: 10 }), null);
  assert.equal(parseRoomActivityList([{ ...entry, roomId: "room-2" }, entry]).length, 2);
});

test("agent task protocol rejects invalid lifecycle metadata and accepts notes", () => {
  const task = { taskId: "task-1", roomId: "room-1", mode: "EDIT", intent: "generate", summary: "Implement a safe change", status: "waiting_for_approval", patchStatus: "proposed", validationStatus: "not-run", patchCount: 1, createdAt: 10, updatedAt: 12, requestedBy: "Guest", priority: "urgent", assignedTo: { userId: "guest-2", displayName: "Reviewer" }, watchers: [{ userId: "guest-2", displayName: "Reviewer" }], files: ["src/app.ts"], reviewCount: 1, resultSummary: "Proposal is ready", notes: [{ id: "note-1", authorName: "Guest", message: "Review this", createdAt: 11 }] };
  const parsed = parseAgentTaskEvent({ type: "task_updated", task }, "room-1");
  assert.equal(parsed?.task.notes?.[0].message, "Review this");
  assert.equal(parseAgentTaskEvent({ type: "task_updated", task: { ...task, intent: "grant-access" } }, "room-1"), null);
  assert.equal(parseAgentTaskEvent({ type: "task_updated", task: { ...task, roomId: "room-2" } }, "room-1"), null);
  assert.ok(parsed);
  assert.equal(parsed.task.priority, "urgent");
  assert.equal(parsed.task.assignedTo.displayName, "Reviewer");
  assert.equal(parsed.task.watchers.length, 1);
  assert.deepEqual(parsed.task.files, ["src/app.ts"]);
});
