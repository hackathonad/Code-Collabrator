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
import { buildProjectIndex, projectIndexForContext } from "./agentIntelligence";
import { getAgentTaskHistory } from "./agentTaskHistory";
import type {
  AgentPatch,
  AgentPatchFile,
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
const MAX_PATCH_FILES = 10;
const MAX_PATCH_TOTAL = 60_000;
const toolNames: AgentToolName[] = [
  "READ_FILE", "LIST_FILES", "SEARCH_CODE", "GET_CURRENT_FILE", "GET_SELECTION",
  "GET_WORKSPACE_SUMMARY", "GET_PROJECT_INDEX", "GET_TASK_HISTORY", "GET_DIAGNOSTICS", "APPLY_PATCH", "RUN_VALIDATION"
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

const getProjectIndex = (context: AgentToolContext): AgentToolResult => {
  const index = buildProjectIndex(context.room);
  return { ok: true, summary: index.summary, data: { ...projectIndexForContext(index), workspaceId: index.workspaceId, version: index.version, generatedAt: index.generatedAt } };
};

const getTaskHistory = (context: AgentToolContext): AgentToolResult => {
  const history = getAgentTaskHistory(context.room.roomId, context.request.userId).map(({ taskId, roomId, mode, intent, summary, status, patchStatus, validationStatus, patchCount, createdAt, updatedAt }) => ({ taskId, roomId, mode, intent, summary, status, patchStatus, validationStatus, patchCount, createdAt, updatedAt }));
  return { ok: true, summary: `Found ${history.length} recent coding-agent task(s)`, data: { tasks: history } };
};

const getDiagnostics = (context: AgentToolContext): AgentToolResult => {
  const diagnostics = context.request.diagnostics ?? [];
  const execution = context.request.execution?.output ? { output: redacted(context.request.execution.output).slice(0, 6_000), failed: context.request.execution.failed } : undefined;
  if (!diagnostics.length && !execution) return { ok: true, summary: "No editor diagnostics or execution output was provided", data: { diagnostics: [], note: "The external browser runner does not expose compiler or runtime diagnostics to the server." } };
  return {
    ok: true,
    summary: diagnostics.length ? `${diagnostics.length} editor diagnostic(s) available${execution ? " and execution output is available" : ""}` : "Execution output is available; no editor diagnostics were provided",
    data: { diagnostics, ...(execution ? { execution } : {}) }
  };
};

interface PatchChange { file: WorkspaceFile; path: string; expectedContent: string; replacement: string; }

const parsePatchChanges = (context: AgentToolContext, args: Record<string, unknown>): PatchChange[] | null => {
  const rawChanges = Array.isArray(args.changes) ? args.changes : Array.isArray(args.files) ? args.files : [args];
  if (!rawChanges.length || rawChanges.length > MAX_PATCH_FILES) return null;
  const seen = new Set<string>();
  const changes: PatchChange[] = [];
  let total = 0;
  for (const raw of rawChanges) {
    if (!isRecord(raw)) return null;
    const rawPath = stringArg(raw, "path", 260);
    const expectedContent = typeof raw.expectedContent === "string" ? raw.expectedContent : typeof raw.expectedOldContent === "string" ? raw.expectedOldContent : null;
    const replacement = typeof raw.replacement === "string" ? raw.replacement : null;
    if (rawPath === null || expectedContent === null || replacement === null || expectedContent.length > MAX_PATCH_PART || replacement.length > MAX_PATCH_PART || !expectedContent || containsSensitiveContent(replacement)) return null;
    const path = normalizeWorkspacePath(rawPath);
    if (seen.has(path)) return null;
    const file = safeFileOrThrow(context, path);
    seen.add(path); total += expectedContent.length + replacement.length;
    if (total > MAX_PATCH_TOTAL) return null;
    changes.push({ file, path, expectedContent, replacement });
  }
  return changes;
};

const patchFile = (change: PatchChange): AgentPatchFile => {
  const stats = countLineChanges(change.expectedContent, change.replacement);
  const preview = `--- ${change.path}\n+++ ${change.path}\n- ${change.expectedContent.slice(0, 3_800).replace(/\n/g, "\n- ")}\n+ ${change.replacement.slice(0, 3_800).replace(/\n/g, "\n+ ")}`;
  return { fileId: change.file.id, path: change.path, expectedContent: change.expectedContent, replacement: change.replacement, ...stats, preview: clip(preview, 8_000) };
};

const makePatch = (context: AgentToolContext, changes: PatchChange[], applied: boolean): AgentPatch => {
  const first = changes[0];
  const files = changes.map(patchFile);
  const stats = files.reduce((total, file) => ({ additions: total.additions + file.additions, deletions: total.deletions + file.deletions }), { additions: 0, deletions: 0 });
  const preview = clip(files.map((file) => file.preview).join("\n\n"), 12_000);
  const patchId = patchIdFor(context.room.roomId, files.map((file) => file.fileId).join(","), JSON.stringify(files.map((file) => file.expectedContent)), JSON.stringify(files.map((file) => file.replacement)));
  return { patchId, ...(context.request.taskId ? { taskId: context.request.taskId } : {}), roomId: context.room.roomId, workspaceId: context.room.workspace.id, fileId: first.file.id, path: first.path, baseVersion: context.room.version, expectedContent: first.expectedContent, replacement: first.replacement, ...stats, preview, applied, status: applied ? "applied" : "pending", ...(files.length > 1 ? { files } : {}) };
};

const applyPatch = (context: AgentToolContext, args: Record<string, unknown>): AgentToolResult => {
  const authoritativeRoom = context.allowPatchApplication ? roomStore.getRoomSnapshot(context.room.roomId) : context.room;
  const authoritativeContext = authoritativeRoom === context.room ? context : { ...context, room: authoritativeRoom };
  const suppliedBaseVersion = typeof args.baseVersion === "number" && Number.isInteger(args.baseVersion) ? args.baseVersion : context.room.version;
  if (context.allowPatchApplication && suppliedBaseVersion !== authoritativeRoom.version) return { ok: false, summary: "Patch conflict: the room changed after this proposal was created" };
  const changes = parsePatchChanges(authoritativeContext, args);
  if (!changes) return { ok: false, summary: "APPLY_PATCH requires one stable change or a bounded changes array" };
  const nextChanges: Array<PatchChange & { content: string }> = [];
  for (const change of changes) {
    const first = change.file.content.indexOf(change.expectedContent);
    const second = first < 0 ? -1 : change.file.content.indexOf(change.expectedContent, first + change.expectedContent.length);
    if (first < 0) return { ok: false, summary: `Patch conflict: expected content was not found in ${change.path}` };
    if (second >= 0) return { ok: false, summary: `Patch is ambiguous: expected content occurs more than once in ${change.path}` };
    nextChanges.push({ ...change, content: `${change.file.content.slice(0, first)}${change.replacement}${change.file.content.slice(first + change.expectedContent.length)}` });
  }
  const proposed = makePatch(authoritativeContext, changes, false);
  if (!context.allowPatchApplication) return { ok: true, summary: `Prepared a patch proposal for ${changes.length} file(s)`, patch: proposed, data: { patch: proposed } };
  const result = roomStore.applyAgentPatchBatch(authoritativeRoom.roomId, context.request.userId, nextChanges.map((change) => ({ fileId: change.file.id, content: change.content })));
  const applied = { ...proposed, applied: true, status: "applied" as const };
  for (const change of changes) context.onWorkspaceChanged?.(result.room, result.room.workspace.files[change.file.id] ?? change.file, applied);
  return { ok: true, summary: `Applied the approved patch to ${changes.length} file(s)`, patch: applied, data: { patch: applied, version: result.room.version } };
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
        case "GET_PROJECT_INDEX": return getProjectIndex(context);
        case "GET_TASK_HISTORY": return getTaskHistory(context);
        case "GET_DIAGNOSTICS": return getDiagnostics(context);
        case "APPLY_PATCH": return applyPatch(context, rawArgs);
        case "RUN_VALIDATION": return await runValidation(context, rawArgs);
      }
      return { ok: false, summary: "Unknown agent tool" };
    } catch (error) {
      return { ok: false, summary: error instanceof Error ? error.message : "The agent tool could not complete" };
    }
  }
});
