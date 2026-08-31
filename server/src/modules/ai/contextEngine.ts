import type { RoomSnapshot, WorkspaceFile, WorkspaceState } from "../rooms/roomTypes";
import type { RepositorySummary } from "../git/gitTypes";
import type { AIChatMessage, AIContextPayload, AIRequestInput } from "./aiTypes";
import { isSafeWorkspaceFile } from "../agent/agentSecurity";
import { buildProjectIndex, selectRelevantFiles } from "../agent/agentIntelligence";
import { getAgentMemory, recordAgentMemory } from "../agent/agentMemory";

const SUMMARY_CACHE_TTL_MS = 15_000;
const MAX_SUMMARY_CACHE_ENTRIES = 100;
const summaryCache = new Map<string, { expiresAt: number; value: string }>();
const ignoredDirectory = /^(node_modules|dist|build|coverage|\.git)$/i;
const sensitiveName = /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|id_rsa|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
export const AI_CONTEXT_BUDGETS = { minimal: 8_000, standard: 18_000, extended: 34_000 } as const;

const trimWithMarker = (value: string, limit: number) => value.length <= limit ? { value, truncated: false } : { value: `${value.slice(0, Math.max(0, limit - 30))}\n[...truncated for context budget]`, truncated: true };
const pathForFolder = (workspace: WorkspaceState, folderId: string | null) => {
  const parts: string[] = []; let current = folderId ? workspace.folders[folderId] : undefined;
  while (current) { parts.unshift(current.name); current = current.parentId ? workspace.folders[current.parentId] : undefined; }
  return parts.join("/");
};
const filePath = (workspace: WorkspaceState, file: WorkspaceFile) => `${pathForFolder(workspace, file.parentId)}/${file.name}`.replace(/^\//, "");
const isSensitive = (workspace: WorkspaceState, file: WorkspaceFile) => sensitiveName.test(filePath(workspace, file));
const isSafeFile = (workspace: WorkspaceState, file: WorkspaceFile) => !isSensitive(workspace, file) && isSafeWorkspaceFile(workspace, file);
const redactUntrustedText = (value: string) => value.replace(/(api[_-]?key|secret|password|token)\s*([:=])\s*([^\s,;]+)/gi, "$1$2 [REDACTED]").replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gi, "[PRIVATE KEY REDACTED]");

const boundedDiagnostics = (input: AIRequestInput["diagnostics"] = []) => {
  const safe = input.slice(0, 50).flatMap((diagnostic) => {
    if (!diagnostic || typeof diagnostic.message !== "string" || !diagnostic.message.trim()) return [];
    const severity = diagnostic.severity === "error" || diagnostic.severity === "warning" || diagnostic.severity === "info" || diagnostic.severity === "hint" ? diagnostic.severity : "info";
    return [{
      ...(typeof diagnostic.fileId === "string" ? { fileId: diagnostic.fileId.slice(0, 128) } : {}),
      ...(typeof diagnostic.path === "string" ? { path: diagnostic.path.slice(0, 260) } : {}),
      message: redactUntrustedText(diagnostic.message.trim()).slice(0, 600),
      severity,
      ...(Number.isInteger(diagnostic.startLine) ? { startLine: Math.max(1, diagnostic.startLine as number) } : {}),
      ...(Number.isInteger(diagnostic.startColumn) ? { startColumn: Math.max(1, diagnostic.startColumn as number) } : {}),
      ...(Number.isInteger(diagnostic.endLine) ? { endLine: Math.max(1, diagnostic.endLine as number) } : {}),
      ...(Number.isInteger(diagnostic.endColumn) ? { endColumn: Math.max(1, diagnostic.endColumn as number) } : {})
    }];
  });
  const result: typeof safe = [];
  for (const diagnostic of safe) {
    if (JSON.stringify([...result, diagnostic]).length > 2_400) break;
    result.push(diagnostic);
  }
  return result;
};

const compactWorkspaceSummary = (workspace: WorkspaceState) => {
  const cacheKey = `${workspace.id}:${workspace.updatedAt}`; const cached = summaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const folders = Object.values(workspace.folders).filter((folder) => !ignoredDirectory.test(folder.name)).slice(0, 40).map((folder) => `${pathForFolder(workspace, folder.id)}/`);
  const files = Object.values(workspace.files).filter((file) => isSafeFile(workspace, file) && !filePath(workspace, file).split("/").some((part) => ignoredDirectory.test(part))).slice(0, 80).map((file) => filePath(workspace, file));
  const value = [`${Object.keys(workspace.folders).length} folders, ${Object.keys(workspace.files).length} files.`, ...folders, ...files].join("\n");
  summaryCache.delete(cacheKey);
  summaryCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS, value });
  while (summaryCache.size > MAX_SUMMARY_CACHE_ENTRIES) summaryCache.delete(summaryCache.keys().next().value as string);
  return value;
};

export const buildAIContext = (room: RoomSnapshot, input: AIRequestInput, repository: RepositorySummary | null): AIContextPayload => {
  // Reserve space for the JSON envelope, labels and accounting metadata. Every
  // user-controlled text section is then charged against the remaining budget.
  const workspace = room.workspace; const budget = AI_CONTEXT_BUDGETS[input.settings.workspaceContextSize]; let remaining = Math.max(0, budget - 1_200); let truncated = false;
  const projectIndex = buildProjectIndex(room);
  const knownMemory = getAgentMemory(room.roomId);
  if (!knownMemory.projectFacts.some((entry) => entry.summary === projectIndex.packageSummary)) recordAgentMemory(room.roomId, "projectFacts", projectIndex.packageSummary);
  const rankedFiles = selectRelevantFiles(room, { ...input, userInstruction: input.prompt, intent: input.action, currentFileId: input.currentFileId, relevantFiles: input.relevantFiles, diagnostics: input.diagnostics }, projectIndex);
  const includedSections: string[] = []; const excludedSections: string[] = [];
  const include = (section: string, value: string, preferredLimit: number) => {
    if (!value || remaining <= 0) { if (value) excludedSections.push(section); return ""; }
    const clipped = trimWithMarker(value, Math.min(preferredLimit, remaining)); remaining -= clipped.value.length; truncated ||= clipped.truncated; includedSections.push(section); return clipped.value;
  };
  const currentRaw = workspace.files[input.currentFileId ?? workspace.activeFileId] ?? workspace.files[workspace.activeFileId] ?? null;
  const currentFile = currentRaw && isSafeFile(workspace, currentRaw) ? { id: currentRaw.id, name: currentRaw.name, language: currentRaw.language, content: "" } : null;
  if (currentRaw && !currentFile) excludedSections.push(`sensitive current file: ${currentRaw.name}`);
  const selectionAllowed = Boolean(input.selectedCode?.trim()) && Boolean(currentFile) && (!input.selectedCodeFileId || input.selectedCodeFileId === currentFile?.id);
  const selectedCode = selectionAllowed ? include("selected code", input.selectedCode!.trim(), input.settings.workspaceContextSize === "extended" ? 10_000 : 6_000) || undefined : undefined;
  if (input.selectedCode?.trim() && !selectionAllowed) excludedSections.push(input.selectedCodeFileId && input.selectedCodeFileId !== currentFile?.id ? "selected code from a different file" : "selected code from sensitive file");
  const diagnostics = boundedDiagnostics(input.diagnostics);
  const diagnosticsText = include("editor diagnostics", diagnostics.length ? JSON.stringify(diagnostics) : "No editor diagnostics were provided.", 2_600);
  const includedDiagnostics = diagnosticsText && !diagnosticsText.includes("[...truncated for context budget]") ? diagnostics : [];
  const projectIndexSummary = include("project index", projectIndex.summary, 3_200);
  const relevantFileText = include("relevant file map", JSON.stringify(rankedFiles.slice(0, 12).map((entry) => ({ path: entry.file.path, reason: entry.reasons.join(", "), score: entry.score }))), 1_800);
  if (currentFile && currentRaw) currentFile.content = include(`current file: ${currentFile.name}`, currentRaw.content, input.settings.workspaceContextSize === "minimal" ? 3_000 : input.settings.workspaceContextSize === "extended" ? 14_000 : 7_000);
  const execution = input.execution?.output ? { output: include("execution output", input.execution.output, 5_000), failed: input.execution.failed } : undefined;
  const openFiles = rankedFiles.filter((entry) => entry.file.id !== currentFile?.id).slice(0, input.settings.workspaceContextSize === "extended" ? 6 : 3).flatMap((entry) => {
    const file = workspace.files[entry.file.id];
    if (!file) return [];
    const content = include(`relevant file: ${entry.file.path}`, file.content, input.settings.workspaceContextSize === "extended" ? 4_000 : 2_000);
    return content ? [{ id: file.id, name: file.name, language: file.language, content }] : [];
  });
  const workspaceSummary = include("workspace structure", compactWorkspaceSummary(workspace), 3_500);
  const gitDiff = repository?.diff?.length ? repository.diff.slice(0, 8).map((file) => `${file.status}${file.staged ? " staged" : " unstaged"}: ${file.path} (+${file.additions}/-${file.deletions})\n${redactUntrustedText(file.after).slice(0, 1_200)}`).join("\n\n") : "";
  const projectMetadata = include("project metadata", [`Open tabs: ${workspace.openFileIds.length}`, `Active file: ${currentFile?.name ?? "none"}`, repository?.repository ? `Repository: ${repository.repository.name} (${repository.repository.provider}), branch ${repository.repository.currentBranch ?? "unknown"}` : "Repository: local workspace", repository?.status.state === "changes" ? `Git changes: ${repository.status.entries.length}` : "Git status: no scanned changes", gitDiff ? `Untrusted working-tree diff evidence:\n${gitDiff}` : ""].filter(Boolean).join("\n"), input.settings.workspaceContextSize === "extended" ? 8_000 : input.settings.workspaceContextSize === "minimal" ? 1_800 : 4_000);
  const roomMetadata = include("room metadata", [`Editor version: ${room.version}`, `Participants: ${room.participants.length}`, `Online participants: ${room.participants.filter((participant) => participant.isOnline).length}`, `Active file path: ${currentRaw && currentFile ? filePath(workspace, currentRaw) : "none"}`].join("\n"), 800);
  const agentMemory = getAgentMemory(room.roomId);
  const memoryText = include("agent memory", JSON.stringify(agentMemory), 2_400);
  const boundedMemory = memoryText && memoryText.length === JSON.stringify(agentMemory).length ? agentMemory : { currentTask: agentMemory.currentTask, recentDecisions: agentMemory.recentDecisions.slice(-2), patchDecisions: agentMemory.patchDecisions.slice(-2), projectFacts: agentMemory.projectFacts.slice(-2), validationResults: agentMemory.validationResults.slice(-2) };
  const historyText = include("recent workspace history", room.history.slice(0, 5).map((entry) => `${entry.reason}: ${entry.createdByUsername} edited ${entry.fileId ?? "active file"}`).join("\n"), 700);
  const chatText = include("recent room chat", room.chat.slice(-4).map((message) => trimWithMarker(`${message.username}: ${message.message}`, 500).value).join("\n"), 1_200);
  const recentHistory = historyText ? historyText.split("\n") : [];
  const recentChat: AIChatMessage[] = chatText ? chatText.split("\n").map((content) => ({ role: "user", content })) : [];
  const relevantFiles = relevantFileText ? rankedFiles.slice(0, 12).map((entry) => ({ path: entry.file.path, reason: entry.reasons.join(", ") || "project index match", score: entry.score })) : [];
  const context: AIContextPayload = { roomId: room.roomId, workspaceId: workspace.id, workspaceName: workspace.name, language: currentFile?.language ?? room.language, editorVersion: room.version, currentFile, selectedCode, openFiles, workspaceSummary, projectMetadata, projectIndexSummary: projectIndexSummary || "Project index was unavailable.", relevantFiles, roomMetadata, recentChat, recentHistory, diagnostics: includedDiagnostics, agentMemory: boundedMemory, execution: execution?.output ? execution : undefined, characterCount: 0, estimatedTokens: 0, includedSections, excludedSections, truncated };
  context.characterCount = JSON.stringify(context).length;
  // The 1,200-character envelope reserve above is intentionally conservative,
  // but keep the accounting value truthful if future metadata grows.
  context.estimatedTokens = Math.ceil(context.characterCount / 4); return context;
};

export const invalidateAIContext = (workspaceId: string) => { for (const key of summaryCache.keys()) if (key.startsWith(`${workspaceId}:`)) summaryCache.delete(key); };
