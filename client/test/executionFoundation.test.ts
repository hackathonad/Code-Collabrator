import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard } from "../src/lib/clipboard";
import { downloadSourceFile, runCodeExternally, sourceFilenameForLanguage } from "../src/lib/editorActions";
import { useExecutionStore } from "../src/store/useExecutionStore";
import type { ExecutionRecord } from "../src/types/execution";

test("source filenames preserve compatible extensions and correct mismatches", () => {
  assert.equal(sourceFilenameForLanguage("main.py", "python"), "main.py");
  assert.equal(sourceFilenameForLanguage("main.ts", "javascript"), "main.ts");
  assert.equal(sourceFilenameForLanguage("main.py", "javascript"), "main.js");
  assert.equal(sourceFilenameForLanguage("", "cpp"), "main.cpp");
});

test("clipboard failures remain visible to the caller", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("permission denied"); } } } });
  try { await assert.rejects(() => copyTextToClipboard("exact source"), /permission denied/); }
  finally { if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete (globalThis as { navigator?: Navigator }).navigator; }
});

test("download workflow uses the exact source and language extension", () => {
  let downloadedName = "";
  let downloadedCode = "";
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousUrl = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (() => "blob:test") as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  const link = { href: "", download: "", rel: "", click: () => { downloadedName = link.download; downloadedCode = "source"; }, remove: () => undefined };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => link, body: { appendChild: () => undefined } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout } });
  try { downloadSourceFile("source", "main.py", "javascript"); }
  finally {
    URL.createObjectURL = previousUrl;
    URL.revokeObjectURL = previousRevoke;
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else delete (globalThis as { document?: Document }).document;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete (globalThis as { window?: Window }).window;
  }
  assert.equal(downloadedName, "main.js");
  assert.equal(downloadedCode, "source");
});

test("external runner reports popup blocking instead of claiming execution", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => undefined } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { open: () => null } });
  try { await assert.rejects(() => runCodeExternally({ code: "print(1)", language: "python" }), /pop-ups/); }
  finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete (globalThis as { navigator?: Navigator }).navigator;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete (globalThis as { window?: Window }).window;
  }
});

const execution = (id: string, roomId = "room", createdAt = Number(id), status: ExecutionRecord["status"] = "completed"): ExecutionRecord => ({
  executionId: id, roomId, workspaceId: "workspace", ownerId: "user", action: "tests", command: "npm test", status, exitCode: status === "completed" ? 0 : null, durationMs: 1, output: "bounded", errorSummary: null, createdAt
});

test("execution state is room-scoped, deduplicated, and bounded", () => {
  useExecutionStore.setState({ roomId: "room", workspaceId: "workspace", records: [], activeExecutionId: null, error: null });
  useExecutionStore.getState().receive(execution("1", "other", 1));
  assert.equal(useExecutionStore.getState().records.length, 0);
  for (let index = 1; index <= 45; index += 1) useExecutionStore.getState().receive(execution(String(index), "room", index));
  assert.equal(useExecutionStore.getState().records.length, 40);
  useExecutionStore.getState().receive({ ...execution("45", "room", 45), output: "older replacement" });
  assert.equal(useExecutionStore.getState().records[0].output, "older replacement");
});

test("execution state marks active work and clears it at terminal status", () => {
  useExecutionStore.setState({ roomId: "room", workspaceId: "workspace", records: [], activeExecutionId: null, error: null });
  useExecutionStore.getState().receive(execution("running", "room", 2, "running"));
  assert.equal(useExecutionStore.getState().activeExecutionId, "running");
  useExecutionStore.getState().receive(execution("running", "room", 2, "completed"));
  assert.equal(useExecutionStore.getState().activeExecutionId, null);
});

test("execution history hydrates only the announced room and workspace", () => {
  useExecutionStore.setState({ roomId: null, workspaceId: null, records: [], activeExecutionId: null, error: null });
  useExecutionStore.getState().hydrate("room", "workspace", [execution("history", "room", 3, "completed"), { ...execution("other-workspace", "room", 4), workspaceId: "other" }]);
  assert.equal(useExecutionStore.getState().roomId, "room");
  assert.equal(useExecutionStore.getState().workspaceId, "workspace");
  assert.deepEqual(useExecutionStore.getState().records.map((record) => record.executionId), ["history"]);
  useExecutionStore.getState().hydrate("other-room", "workspace", [execution("leak", "other-room", 5)]);
  assert.deepEqual(useExecutionStore.getState().records.map((record) => record.executionId), ["history"]);
});
