import { roomStore } from "../rooms/roomStore";
import type { WorkspaceFile, WorkspaceFolder } from "../rooms/roomTypes";
import {
  AgentSecurityError,
  containsSensitiveContent,
  countLineChanges,
  findWorkspaceFile,
  findWorkspaceFolder,
  isSafeWorkspaceFile,
  normalizeWorkspacePath,
  patchIdFor,
  workspacePathForFile
} from "./agentSecurity";
import { createValidationRunner } from "./validationRunner";
import type {
  AgentPatch,
  AgentToolContext,
  AgentToolName,
  AgentToolRegistry,
  AgentToolResult,
  ValidationCategory
} from "./agentTypes";

const MAX_FILE_READ = 20_000;
const MAX_PATCH_PART = 30_000;
const MAX_SEARCH_RESULTS = 50;
const MAX_LIST_RESULTS = 200;
const MAX_TOOL_OUTPUT = 24_000;
const toolNames: AgentToolName[] = [
  "READ_FILE", "LIST_FILES", "SEARCH_CODE", "GET_CURRENT_FILE", "GET_SELECTION",
  "GET_WORKSPACE_SUMMARY", "GET_DIAGNOSTICS", "APPLY_PATCH", "RUN_VALIDATION"
];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clip = (value: string, limit = MAX_TOOL_OUTPUT) => value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 32))}\n[…tool output truncated…]`;
const stringArg = (args: Record<string, unknown>, key: string, limit: number) => typeof args[key] === "string" && args[key].length <= limit ? args[key] : null;
const integerArg = (args: Record<string, unknown>, key: string, fallback: number, min: number, max: number) => typeof args[key] === "number" && Number.isInteger(args[key]) ? Math.min(max, Math.max(min, args[key])) : fallback;
const safeFileOrThrow = (context: AgentToolContext, path: string) => {
  const file = findWorkspaceFile(context.room.workspace, path);
  if (!file || !isSafeWorkspaceFile(context.room.workspace, file)) throw new AgentSecurityError("The requested file is unavailable");
  return file;
};
const fileInfo = (context: AgentToolContext, file: WorkspaceFile) => ({ id: file.id, path: workspacePathForFile(context.room.workspace, file), name: file.name, language: file.language, size: file.content.length });
const folderPath = (workspace: AgentToolContext["room"]["workspace"], folder: WorkspaceFolder) => {
  const parts: string[] = [];
  let current: WorkspaceFolder | undefined = folder;
  while (current && current.id !== workspace.rootFolderId) {
    parts.unshift(current.name);
    current = current.parentId ? workspace.folders[current.parentId] : undefined;
  }
  return parts.join("/");
};
const underScope = (path: string, scope: string) => !scope || path === scope || path.startsWith(`${scope}/`);
const redacted = (value: string) => value.replace(/(api[_-]?key|secret|password|token)\s*([:=])\s*([^\s,;]+)/gi, "$1$2 [REDACTED]").replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gi, "[PRIVATE KEY REDACTED]");

const readFile = (context: AgentToolContext, args: Record<string, unknown>): AgentToolResult => {
  const rawPath = stringArg(args, "path", 260);
  if (rawPath === null) return { ok: false, summary: "READ_FILE requires a path" };
  const path = normalizeWorkspacePath(rawPath);
  const file = safeFileOrThrow(context, path);
  const content = file.content.slice(0, MAX_FILE_READ);
  return { ok: true, summary: `Read ${path} (${file.content.length} characters)`, data: { ...fileInfo(context, file), content, truncated: content.length < file.content.length } };
};

const listFiles = (context: AgentToolContext, args: Record<string, unknown>): AgentToolResult => {
  if ("path" in args && (typeof args.path !== "string" || args.path.length > 260)) return { ok: false, summary: "LIST_FILES requires a valid workspace-relative path" };
  const rawScope = typeof args.path === "string" ? args.path : "";
  const scope = normalizeWorkspacePath(rawScope, true);
  if (!findWorkspaceFolder(context.room.workspace, scope)) return { ok: false, summary: "The requested folder was not found" };
  const maxDepth = integerArg(args, "maxDepth", 4, 1, 8);
  const limit = integerArg(args, "limit", 100, 1, MAX_LIST_RESULTS);
  const files = Object.values(context.room.workspace.files).filter((file) => isSafeWorkspaceFile(context.room.workspace, file)).map((file) => ({ file, path: workspacePathForFile(context.room.workspace, file) })).filter(({ path }) => underScope(path, scope)).filter(({ path }) => path.split("/").length - scope.split("/").filter(Boolean).length <= maxDepth).slice(0, MAX_LIST_RESULTS);
  const folders = Object.values(context.room.workspace.folders).filter((folder) => folder.id !== context.room.workspace.rootFolderId).map((folder) => ({ folder, path: folderPath(context.room.workspace, folder) })).filter(({ path }) => underScope(path, scope)).filter(({ path }) => path.split("/").length - scope.split("/").filter(Boolean).length <= maxDepth).slice(0, MAX_LIST_RESULTS);
  return { ok: true, summary: `Listed ${Math.min(files.length, limit)} visible file(s)`, data: { scope: scope || ".", folders: folders.slice(0, limit).map(({ path }) => `${path}/`), files: files.slice(0, limit).map(({ file, path }) => ({ ...fileInfo(context, file), path })) } };
};

const searchCode = (context: AgentToolContext, args: Record<string, unknown>): AgentToolResult => {
  const query = stringArg(args, "query", 200)?.trim();
  if (!query) return { ok: false, summary: "SEARCH_CODE requires a literal query" };
  if ("path" in args && (typeof args.path !== "string" || args.path.length > 260)) return { ok: false, summary: "SEARCH_CODE requires a valid workspace-relative path" };
  if ("language" in args && (typeof args.language !== "string" || args.language.length > 40)) return { ok: false, summary: "SEARCH_CODE requires a valid language filter" };
  const scope = normalizeWorkspacePath(typeof args.path === "string" ? args.path : "", true);
  const language = typeof args.language === "string" ? args.language : null;
  const limit = integerArg(args, "limit", 20, 1, MAX_SEARCH_RESULTS);
  const lowerQuery = query.toLocaleLowerCase();
  const results: Array<{ path: string; line: number; text: string; context: string[] }> = [];
  for (const file of Object.values(context.room.workspace.files)) {
    const path = workspacePathForFile(context.room.workspace, file);
    if (!isSafeWorkspaceFile(context.room.workspace, file) || !underScope(path, scope) || (language && file.language !== language)) continue;
    const lines = file.content.split("\n");
    for (let index = 0; index < lines.length && results.length < limit; index += 1) {
      if (!lines[index].toLocaleLowerCase().includes(lowerQuery)) continue;
      results.push({ path, line: index + 1, text: lines[index].slice(0, 400), context: lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).map((line) => line.slice(0, 400)) });
    }
    if (results.length >= limit) break;
  }
  return { ok: true, summary: `Found ${results.length} match(es)`, data: { query, scope: scope || ".", results, truncated: results.length >= limit } };
};

const currentFile = (context: AgentToolContext) => {
  const requested = context.room.workspace.files[context.request.currentFileId] ?? context.room.workspace.files[context.room.workspace.activeFileId];
  if (!requested || !isSafeWorkspaceFile(context.room.workspace, requested)) throw new AgentSecurityError("The current file is unavailable");
  return requested;
};

const getCurrentFile = (context: AgentToolContext): AgentToolResult => {
  const file = currentFile(context);
  const content = file.content.slice(0, MAX_FILE_READ);
  return { ok: true, summary: `Current file is ${workspacePathForFile(context.room.workspace, file)}`, data: { ...fileInfo(context, file), content, truncated: content.length < file.content.length } };
};

const getSelection = (context: AgentToolContext): AgentToolResult => {
  const selection = context.request.selection;
  if (!selection) return { ok: true, summary: "No verified editor selection was supplied", data: { selected: false } };
  const file = context.room.workspace.files[selection.fileId];
  if (!file || selection.fileId !== context.request.currentFileId || !isSafeWorkspaceFile(context.room.workspace, file)) return { ok: false, summary: "The selection does not belong to the current visible file" };
  if (!Number.isInteger(selection.startOffset) || !Number.isInteger(selection.endOffset) || selection.startOffset < 0 || selection.endOffset <= selection.startOffset || selection.endOffset > file.content.length || file.content.slice(selection.startOffset, selection.endOffset) !== selection.code) return { ok: false, summary: "The editor selection changed and could not be verified" };
  return { ok: true, summary: `Verified selection in ${workspacePathForFile(context.room.workspace, file)}`, data: { selected: true, path: workspacePathForFile(context.room.workspace, file), startOffset: selection.startOffset, endOffset: selection.endOffset, code: selection.code.slice(0, MAX_FILE_READ), truncated: selection.code.length > MAX_FILE_READ } };
};

const getWorkspaceSummary = (context: AgentToolContext): AgentToolResult => {
  const workspace = context.room.workspace;
  const visibleFiles = Object.values(workspace.files).filter((file) => isSafeWorkspaceFile(workspace, file));
  const languages = [...new Set(visibleFiles.map((file) => file.language))];
  return { ok: true, summary: `Workspace ${workspace.name} has ${visibleFiles.length} visible file(s)`, data: { id: workspace.id, name: workspace.name, language: workspace.language, files: visibleFiles.slice(0, 100).map((file) => ({ path: workspacePathForFile(workspace, file), language: file.language, size: file.content.length })), fileCount: Object.keys(workspace.files).length, folderCount: Object.keys(workspace.folders).length, languages, currentFile: (() => { try { return fileInfo(context, currentFile(context)); } catch { return null; } })(), openFileCount: workspace.openFileIds.length, recentHistory: context.room.history.slice(0, 5).map((entry) => ({ reason: entry.reason, fileId: entry.fileId, createdBy: entry.createdByUsername })), roomVersion: context.room.version } };
};

const getDiagnostics = (context: AgentToolContext): AgentToolResult => {
  if (!context.request.execution?.output) return { ok: true, summary: "No server-side diagnostics or execution output is available", data: { diagnostics: [], note: "The browser runner does not expose diagnostics to the server." } };
  return { ok: true, summary: context.request.execution.failed ? "Execution reported a failure" : "Execution output is available", data: { diagnostics: [{ severity: context.request.execution.failed ? "error" : "info", message: redacted(context.request.execution.output).slice(0, 6_000) }], failed: context.request.execution.failed } };
};

const makePatch = (context: AgentToolContext, path: string, expectedContent: string, replacement: string, applied: boolean): AgentPatch => {
  const file = safeFileOrThrow(context, path);
  const stats = countLineChanges(expectedContent, replacement);
  const preview = `--- ${path}\n+++ ${path}\n- ${expectedContent.slice(0, 3_800).replace(/\n/g, "\n- ")}\n+ ${replacement.slice(0, 3_800).replace(/\n/g, "\n+ ")}`;
  return { patchId: patchIdFor(context.room.roomId, file.id, expectedContent, replacement), roomId: context.room.roomId, workspaceId: context.room.workspace.id, fileId: file.id, path, expectedContent, replacement, ...stats, preview: clip(preview, 8_000), applied };
};

const applyPatch = (context: AgentToolContext, args: Record<string, unknown>): AgentToolResult => {
  const rawPath = stringArg(args, "path", 260);
  const expectedContent = typeof args.expectedContent === "string" ? args.expectedContent : typeof args.expectedOldContent === "string" ? args.expectedOldContent : null;
  const replacement = typeof args.replacement === "string" ? args.replacement : null;
  if (rawPath === null || expectedContent === null || replacement === null) return { ok: false, summary: "APPLY_PATCH requires path, expectedContent, and replacement" };
  if (expectedContent.length > MAX_PATCH_PART || replacement.length > MAX_PATCH_PART) return { ok: false, summary: "The patch is larger than the allowed limit" };
  if (containsSensitiveContent(replacement)) return { ok: false, summary: "The patch appears to contain a secret and was blocked" };
  const path = normalizeWorkspacePath(rawPath);
  const file = safeFileOrThrow(context, path);
  if (!expectedContent) return { ok: false, summary: "An empty expectedContent is not a stable patch anchor" };
  const first = file.content.indexOf(expectedContent);
  const second = first < 0 ? -1 : file.content.indexOf(expectedContent, first + expectedContent.length);
  if (first < 0) return { ok: false, summary: `Patch conflict: expected content was not found in ${path}` };
  if (second >= 0) return { ok: false, summary: `Patch is ambiguous: expected content occurs more than once in ${path}` };
  const nextContent = `${file.content.slice(0, first)}${replacement}${file.content.slice(first + expectedContent.length)}`;
  const proposed = makePatch(context, path, expectedContent, replacement, false);
  if (!context.allowPatchApplication) return { ok: true, summary: `Prepared a patch proposal for ${path}`, patch: proposed, data: { patch: proposed } };
  const result = roomStore.updateCode(context.room.roomId, context.request.userId, nextContent, file.id);
  const updatedFile = result.room.workspace.files[file.id] ?? file;
  const applied = { ...proposed, applied: true };
  context.onWorkspaceChanged?.(result.room, updatedFile, applied);
  return { ok: true, summary: `Applied the approved patch to ${path}`, patch: applied, data: { patch: applied, version: result.room.version } };
};

const runValidation = async (context: AgentToolContext, args: Record<string, unknown>): Promise<AgentToolResult> => {
  const category = stringArg(args, "category", 20) as ValidationCategory | null;
  if (!category || !["typecheck", "lint", "tests", "build"].includes(category)) return { ok: false, summary: "RUN_VALIDATION accepts only typecheck, lint, tests, or build" };
  const result = await (context.validationRunner ?? createValidationRunner())(category, context.signal);
  const output = clip(redacted([result.stdout, result.stderr].filter(Boolean).join("\n")), 12_000);
  return { ok: result.ok, summary: result.summary, validation: { category, ok: result.ok, summary: result.summary, output }, data: { category, ok: result.ok, exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, output } };
};

export const createAgentToolRegistry = (context: AgentToolContext): AgentToolRegistry => ({
  list: () => [...toolNames],
  async run(name, rawArgs) {
    if (!toolNames.includes(name as AgentToolName)) return { ok: false, summary: "Unknown agent tool" };
    if (!isRecord(rawArgs)) return { ok: false, summary: `${name} requires an object of arguments` };
    try {
      switch (name as AgentToolName) {
        case "READ_FILE": return readFile(context, rawArgs);
        case "LIST_FILES": return listFiles(context, rawArgs);
        case "SEARCH_CODE": return searchCode(context, rawArgs);
        case "GET_CURRENT_FILE": return getCurrentFile(context);
        case "GET_SELECTION": return getSelection(context);
        case "GET_WORKSPACE_SUMMARY": return getWorkspaceSummary(context);
        case "GET_DIAGNOSTICS": return getDiagnostics(context);
        case "APPLY_PATCH": return applyPatch(context, rawArgs);
        case "RUN_VALIDATION": return await runValidation(context, rawArgs);
      }
    } catch (error) {
      return { ok: false, summary: error instanceof Error ? error.message : "The agent tool could not complete" };
    }
  }
});
