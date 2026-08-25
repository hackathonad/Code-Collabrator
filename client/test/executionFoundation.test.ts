import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard } from "../src/lib/clipboard";
import { downloadSourceFile, runCodeExternally, sourceFilenameForLanguage } from "../src/lib/editorActions";

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
