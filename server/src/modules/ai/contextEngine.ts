import type { RoomSnapshot, WorkspaceFile, WorkspaceState } from "../rooms/roomTypes";
import type { RepositorySummary } from "../git/gitTypes";
import type { AIChatMessage, AIContextPayload, AIRequestInput } from "./aiTypes";

const SUMMARY_CACHE_TTL_MS = 15_000;
const summaryCache = new Map<string, { expiresAt: number; value: string }>();
const ignoredDirectory = /^(node_modules|dist|build|coverage|\.git)$/i;
const sensitiveName = /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|id_rsa|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
const budgets = { minimal: 8_000, standard: 18_000, extended: 34_000 } as const;

const trimWithMarker = (value: string, limit: number) => value.length <= limit ? { value, truncated: false } : { value: `${value.slice(0, Math.max(0, limit - 30))}\n[...truncated for context budget]`, truncated: true };
const pathForFolder = (workspace: WorkspaceState, folderId: string | null) => {
  const parts: string[] = []; let current = folderId ? workspace.folders[folderId] : undefined;
  while (current) { parts.unshift(current.name); current = current.parentId ? workspace.folders[current.parentId] : undefined; }
  return parts.join("/");
};
const filePath = (workspace: WorkspaceState, file: WorkspaceFile) => `${pathForFolder(workspace, file.parentId)}/${file.name}`.replace(/^\//, "");
const isSensitive = (workspace: WorkspaceState, file: WorkspaceFile) => sensitiveName.test(filePath(workspace, file));

const compactWorkspaceSummary = (workspace: WorkspaceState) => {
  const cacheKey = `${workspace.id}:${workspace.updatedAt}`; const cached = summaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const folders = Object.values(workspace.folders).filter((folder) => !ignoredDirectory.test(folder.name)).slice(0, 40).map((folder) => `${pathForFolder(workspace, folder.id)}/`);
  const files = Object.values(workspace.files).filter((file) => !isSensitive(workspace, file) && !filePath(workspace, file).split("/").some((part) => ignoredDirectory.test(part))).slice(0, 80).map((file) => filePath(workspace, file));
  const value = [`${Object.keys(workspace.folders).length} folders, ${Object.keys(workspace.files).length} files.`, ...folders, ...files].join("\n");
  summaryCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS, value }); return value;
};

const relevantOpenFiles = (workspace: WorkspaceState, input: AIRequestInput, currentFileId: string) => {
  const words = input.prompt.toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? [];
  return workspace.openFileIds.filter((id) => id !== currentFileId).map((id) => workspace.files[id]).filter((file): file is WorkspaceFile => Boolean(file) && !isSensitive(workspace, file)).sort((left, right) => {
    const leftScore = words.some((word) => left.name.toLowerCase().includes(word)) ? 1 : 0;
    const rightScore = words.some((word) => right.name.toLowerCase().includes(word)) ? 1 : 0;
    return rightScore - leftScore;
  });
};

export const buildAIContext = (room: RoomSnapshot, input: AIRequestInput, repository: RepositorySummary | null): AIContextPayload => {
  // Reserve space for the JSON envelope, labels and accounting metadata. Every
  // user-controlled text section is then charged against the remaining budget.
  const workspace = room.workspace; const budget = budgets[input.settings.workspaceContextSize]; let remaining = Math.max(0, budget - 1_200); let truncated = false;
  const includedSections: string[] = []; const excludedSections: string[] = [];
  const include = (section: string, value: string, preferredLimit: number) => {
    if (!value || remaining <= 0) { if (value) excludedSections.push(section); return ""; }
    const clipped = trimWithMarker(value, Math.min(preferredLimit, remaining)); remaining -= clipped.value.length; truncated ||= clipped.truncated; includedSections.push(section); return clipped.value;
  };
  const currentRaw = workspace.files[input.currentFileId ?? workspace.activeFileId] ?? workspace.files[workspace.activeFileId] ?? null;
  const currentFile = currentRaw && !isSensitive(workspace, currentRaw) ? { id: currentRaw.id, name: currentRaw.name, language: currentRaw.language, content: "" } : null;
  if (currentRaw && !currentFile) excludedSections.push(`sensitive current file: ${currentRaw.name}`);
  const selectionAllowed = Boolean(input.selectedCode?.trim()) && Boolean(currentFile) && (!input.selectedCodeFileId || input.selectedCodeFileId === currentFile?.id);
  const selectedCode = selectionAllowed ? include("selected code", input.selectedCode!.trim(), input.settings.workspaceContextSize === "extended" ? 10_000 : 6_000) || undefined : undefined;
  if (input.selectedCode?.trim() && !selectionAllowed) excludedSections.push(input.selectedCodeFileId && input.selectedCodeFileId !== currentFile?.id ? "selected code from a different file" : "selected code from sensitive file");
  if (currentFile && currentRaw) currentFile.content = include(`current file: ${currentFile.name}`, currentRaw.content, input.settings.workspaceContextSize === "minimal" ? 3_000 : input.settings.workspaceContextSize === "extended" ? 14_000 : 7_000);
  const execution = input.execution?.output ? { output: include("execution output", input.execution.output, 5_000), failed: input.execution.failed } : undefined;
  const openFiles = relevantOpenFiles(workspace, input, currentFile?.id ?? "").slice(0, input.settings.workspaceContextSize === "extended" ? 4 : 2).flatMap((file) => {
    const content = include(`open file: ${file.name}`, file.content, input.settings.workspaceContextSize === "extended" ? 4_000 : 2_000);
    return content ? [{ id: file.id, name: file.name, language: file.language, content }] : [];
  });
  const workspaceSummary = include("workspace structure", compactWorkspaceSummary(workspace), 3_500);
  const projectMetadata = include("project metadata", [`Open tabs: ${workspace.openFileIds.length}`, `Active file: ${currentFile?.name ?? "none"}`, repository?.repository ? `Repository: ${repository.repository.name} (${repository.repository.provider}), branch ${repository.repository.currentBranch ?? "unknown"}` : "Repository: local workspace", repository?.status.state === "changes" ? `Git changes: ${repository.status.entries.length}` : "Git status: no scanned changes"].join("\n"), 1_000);
  const historyText = include("recent workspace history", room.history.slice(0, 5).map((entry) => `${entry.reason}: ${entry.createdByUsername} edited ${entry.fileId ?? "active file"}`).join("\n"), 700);
  const chatText = include("recent room chat", room.chat.slice(-4).map((message) => trimWithMarker(`${message.username}: ${message.message}`, 500).value).join("\n"), 1_200);
  const recentHistory = historyText ? historyText.split("\n") : [];
  const recentChat: AIChatMessage[] = chatText ? chatText.split("\n").map((content) => ({ role: "user", content })) : [];
  const context: AIContextPayload = { workspaceId: workspace.id, workspaceName: workspace.name, language: currentFile?.language ?? room.language, currentFile, selectedCode, openFiles, workspaceSummary, projectMetadata, recentChat, recentHistory, execution: execution?.output ? execution : undefined, characterCount: 0, estimatedTokens: 0, includedSections, excludedSections, truncated };
  context.characterCount = JSON.stringify(context).length;
  // The 1,200-character envelope reserve above is intentionally conservative,
  // but keep the accounting value truthful if future metadata grows.
  context.estimatedTokens = Math.ceil(context.characterCount / 4); return context;
};

export const invalidateAIContext = (workspaceId: string) => { for (const key of summaryCache.keys()) if (key.startsWith(`${workspaceId}:`)) summaryCache.delete(key); };
