import type { AIAction, AIProviderDescriptor } from "../ai/aiTypes";
import type { RoomSnapshot, WorkspaceFile, WorkspaceFolder } from "../rooms/roomTypes";
import { containsSensitiveContent, isSafeWorkspaceFile, workspacePathForFile } from "./agentSecurity";
import type { AgentMode, AgentPatch, AgentRequest, AgentReviewFinding } from "./agentTypes";

export interface ProjectIndexFile {
  id: string;
  path: string;
  name: string;
  language: WorkspaceFile["language"];
  extension: string;
  size: number;
  isTest: boolean;
  isConfig: boolean;
  symbols: string[];
  imports: string[];
  updatedAt: number;
}

export interface ProjectIndex {
  workspaceId: string;
  version: number;
  generatedAt: number;
  files: ProjectIndexFile[];
  folders: string[];
  languages: string[];
  testFiles: string[];
  configFiles: string[];
  packageManagers: string[];
  scripts: string[];
  dependencies: string[];
  summary: string;
  truncated: boolean;
}

export interface RelevantFile {
  file: ProjectIndexFile;
  score: number;
  reasons: string[];
}

export interface ProviderRecommendation {
  providerId: AIProviderDescriptor["id"];
  model: string;
  reason: string;
}

const MAX_INDEX_FILES = 500;
const MAX_INDEX_FOLDERS = 200;
const MAX_INDEX_CACHE_ENTRIES = 100;
const MAX_SYMBOLS = 20;
const MAX_IMPORTS = 20;
const indexCache = new Map<string, ProjectIndex>();

const filePath = (workspace: RoomSnapshot["workspace"], file: WorkspaceFile) => {
  try {
    return workspacePathForFile(workspace, file);
  } catch {
    return file.name;
  }
};
const folderPath = (workspace: RoomSnapshot["workspace"], folderId: string) => {
  const parts: string[] = [];
  let current: WorkspaceFolder | undefined = workspace.folders[folderId];
  while (current && current.id !== workspace.rootFolderId) {
    parts.unshift(current.name);
    current = current.parentId ? workspace.folders[current.parentId] : undefined;
  }
  return parts.join("/");
};

const isTestPath = (path: string) => /(^|\/)(?:__tests__|test|tests)(?:\/|$)|(?:\.test|\.spec)\.[^.]+$/i.test(path);
const isConfigPath = (path: string) => /(^|\/)(?:package\.json|tsconfig(?:\.[^.]+)?\.json|vite\.config\.[^.]+|eslint\.config\.[^.]+|\.eslintrc(?:\.[^.]+)?|\.prettierrc(?:\.[^.]+)?|webpack\.config\.[^.]+|pyproject\.toml|cargo\.toml|go\.mod|requirements(?:\.txt)?|dockerfile)$/i.test(path);
const unique = (values: string[], limit: number) => [...new Set(values.filter(Boolean))].slice(0, limit);

const extractSymbols = (content: string) => unique([...content.slice(0, 40_000).matchAll(/\b(?:function|class|interface|type|enum|def|struct|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]), MAX_SYMBOLS);
const extractImports = (content: string) => unique([...content.slice(0, 40_000).matchAll(/\b(?:import\s+(?:[\s\S]*?\s+from\s+|)|require\s*\(|from\s+)['"]([^'"]+)['"]/g)].map((match) => match[1]), MAX_IMPORTS);

const packageInfo = (files: ProjectIndexFile[], sourceByPath: Map<string, WorkspaceFile>) => {
  const packageFile = files.find((file) => file.path.toLocaleLowerCase() === "package.json");
  if (!packageFile) return { packageManagers: [] as string[], scripts: [] as string[], dependencies: [] as string[] };
  const source = sourceByPath.get(packageFile.path);
  if (!source) return { packageManagers: ["npm"], scripts: [] as string[], dependencies: [] as string[] };
  try {
    const value = JSON.parse(source.content) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    return {
      packageManagers: ["npm"],
      scripts: Object.keys(value.scripts ?? {}).slice(0, 40),
      dependencies: unique([...Object.keys(value.dependencies ?? {}), ...Object.keys(value.devDependencies ?? {})], 80)
    };
  } catch {
    return { packageManagers: ["npm"], scripts: [], dependencies: [] as string[] };
  }
};

export const buildProjectIndex = (room: RoomSnapshot): ProjectIndex => {
  const key = `${room.workspace.id}:${room.workspace.updatedAt}:${room.version}`;
  const cached = indexCache.get(key);
  if (cached) return cached;
  for (const cacheKey of indexCache.keys()) if (cacheKey.startsWith(`${room.workspace.id}:`)) indexCache.delete(cacheKey);

  const sourceByPath = new Map<string, WorkspaceFile>();
  const files = Object.values(room.workspace.files).flatMap((file) => {
    if (!isSafeWorkspaceFile(room.workspace, file)) return [];
    const path = filePath(room.workspace, file);
    sourceByPath.set(path, file);
    return [{
      id: file.id,
      path,
      name: file.name,
      language: file.language,
      extension: file.extension,
      size: file.content.length,
      isTest: isTestPath(path),
      isConfig: isConfigPath(path),
      symbols: extractSymbols(file.content),
      imports: extractImports(file.content),
      updatedAt: file.updatedAt
    } satisfies ProjectIndexFile];
  }).sort((left, right) => right.updatedAt - left.updatedAt);
  const boundedFiles = files.slice(0, MAX_INDEX_FILES);
  const folders = Object.values(room.workspace.folders).map((folder) => folderPath(room.workspace, folder.id)).filter(Boolean).slice(0, MAX_INDEX_FOLDERS);
  const packages = packageInfo(boundedFiles, sourceByPath);
  const index: ProjectIndex = {
    workspaceId: room.workspace.id,
    version: room.version,
    generatedAt: Date.now(),
    files: boundedFiles,
    folders,
    languages: unique(boundedFiles.map((file) => file.language), 12),
    testFiles: boundedFiles.filter((file) => file.isTest).map((file) => file.path).slice(0, 80),
    configFiles: boundedFiles.filter((file) => file.isConfig).map((file) => file.path).slice(0, 80),
    packageManagers: packages.packageManagers,
    scripts: packages.scripts,
    dependencies: packages.dependencies,
    summary: "",
    truncated: files.length > boundedFiles.length
  };
  index.summary = [
    `Project index: ${boundedFiles.length}${index.truncated ? "+" : ""} safe files in ${index.languages.join(", ") || "unknown"}.`,
    index.configFiles.length ? `Configuration: ${index.configFiles.slice(0, 12).join(", ")}.` : "Configuration files: none detected.",
    index.testFiles.length ? `Tests: ${index.testFiles.slice(0, 12).join(", ")}.` : "Tests: no test files detected.",
    index.scripts.length ? `Scripts: ${index.scripts.join(", ")}.` : "Scripts: none detected.",
    index.dependencies.length ? `Dependencies: ${index.dependencies.slice(0, 24).join(", ")}.` : "Dependencies: none indexed."
  ].join("\n");
  indexCache.set(key, index);
  while (indexCache.size > MAX_INDEX_CACHE_ENTRIES) {
    const oldestKey = indexCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    indexCache.delete(oldestKey);
  }
  return index;
};

export const selectRelevantFiles = (room: RoomSnapshot, request: { userInstruction: string; currentFileId?: string; relevantFiles?: string[]; diagnostics?: AgentRequest["diagnostics"]; intent?: AgentRequest["intent"]; mode?: AgentMode }, index = buildProjectIndex(room)): RelevantFile[] => {
  const words = unique((request.userInstruction.toLocaleLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? []), 60);
  const hints = [...(request.relevantFiles ?? []), ...(request.diagnostics ?? []).flatMap((diagnostic) => [diagnostic.path, diagnostic.fileId].filter((value): value is string => Boolean(value)))].map((value) => value.toLocaleLowerCase());
  const recentIds = new Set(room.workspace.recentlyOpenedFileIds.slice(0, 12));
  return index.files.map((file) => {
    let score = file.id === request.currentFileId ? 100 : 0;
    const reasons: string[] = file.id === request.currentFileId ? ["current editor file"] : [];
    if (room.workspace.openFileIds.includes(file.id)) { score += 28; reasons.push("open tab"); }
    if (recentIds.has(file.id)) { score += 16; reasons.push("recently edited"); }
    if (hints.some((hint) => file.path.toLocaleLowerCase().includes(hint) || hint.includes(file.path.toLocaleLowerCase()))) { score += 55; reasons.push("requested or diagnostic path"); }
    for (const word of words) {
      if (file.path.toLocaleLowerCase().includes(word)) { score += 12; reasons.push("filename match"); }
      if (file.symbols.some((symbol) => symbol.toLocaleLowerCase().includes(word))) { score += 18; reasons.push("symbol match"); }
      if (file.imports.some((dependency) => dependency.toLocaleLowerCase().includes(word))) { score += 8; reasons.push("dependency match"); }
    }
    if (request.intent === "test" && file.isTest) { score += 35; reasons.push("test workflow"); }
    if (["review", "refactor", "fix", "error"].includes(request.intent ?? "") && (file.isConfig || file.isTest)) { score += 10; reasons.push("workflow support file"); }
    if (request.mode === "DEBUG" && file.isConfig) { score += 14; reasons.push("debug configuration"); }
    return { file, score, reasons: unique(reasons, 8) };
  }).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path)).slice(0, 20);
};

export const projectIndexForContext = (index: ProjectIndex) => ({
  files: index.files.slice(0, 80).map((file) => ({ path: file.path, language: file.language, size: file.size, isTest: file.isTest, isConfig: file.isConfig, symbols: file.symbols.slice(0, 8), imports: file.imports.slice(0, 8) })),
  languages: index.languages,
  testFiles: index.testFiles.slice(0, 40),
  configFiles: index.configFiles.slice(0, 40),
  scripts: index.scripts,
  dependencies: index.dependencies.slice(0, 40),
  truncated: index.truncated
});

export const isComplexTask = (request: Pick<AgentRequest, "userInstruction" | "intent" | "mode">) => /multi[- ]?file|multiple files|entire project|across|several|regression|complex|refactor|review|tests?|diagnostic|debug|fix|plan/i.test(request.userInstruction) || ["review", "test", "refactor", "optimize"].includes(request.intent ?? "") || request.mode === "DEBUG";

export const createTaskPlan = (request: Pick<AgentRequest, "intent" | "mode">, relevant: RelevantFile[]) => {
  const files = relevant.slice(0, 3).map((entry) => entry.file.path);
  const inspect = files.length ? `Inspect ${files.join(", ")}` : "Inspect the current editor and project index";
  if (request.intent === "review") return [inspect, "Check correctness, security, races, errors, and tests", "Report severity and evidence-backed locations", "Suggest fixes without changing code"];
  if (request.intent === "test") return [inspect, "Locate the existing test framework and nearby patterns", "Propose focused regression tests", "Run validation only when explicitly requested"];
  if (request.intent === "refactor" || request.mode === "EDIT") return [inspect, "Trace the relevant symbols and dependencies", "Propose the smallest complete patch", "Review and validate the proposal before approval"];
  if (request.mode === "DEBUG") return [inspect, "Correlate diagnostics, code, configuration, and recent changes", "State the likely cause and evidence limits", "Propose a minimal fix and validation"];
  return [inspect, "Answer using only verified workspace evidence", "Call out uncertainty when evidence is insufficient"];
};

export const actionForRequest = (request: Pick<AgentRequest, "mode" | "intent">): AIAction => {
  if (request.intent === "error") return "fix";
  if (request.intent) return request.intent;
  return request.mode === "DEBUG" ? "fix" : request.mode === "EDIT" ? "generate" : "explain";
};

export const recommendProvider = (providers: AIProviderDescriptor[], intent: AIAction): ProviderRecommendation | null => {
  const available = providers.filter((provider) => provider.available && provider.models.length);
  if (!available.length) return null;
  const complex = ["review", "test", "refactor", "optimize", "fix"].includes(intent);
  const ranked = available.map((provider) => {
    let score = provider.supportsStreaming ? 2 : 0;
    if (provider.supportsToolCalling) score += 3;
    if (provider.supportsLocalModels && !complex) score += 3;
    if (complex && provider.id !== "ollama") score += 1;
    if (provider.id === "openai" || provider.id === "anthropic") score += complex ? 3 : 1;
    return { provider, score };
  }).sort((left, right) => right.score - left.score);
  const selected = ranked[0].provider;
  return { providerId: selected.id, model: selected.defaultModel ?? selected.models[0].id, reason: complex ? "Best available fit for a structured development task" : "Fast available fit for an explanation or focused question" };
};

export const reviewPatch = (patch: Pick<AgentPatch, "path" | "replacement" | "files">): AgentReviewFinding[] => {
  const findings: AgentReviewFinding[] = [];
  const paths = patch.files?.map((file) => file.path) ?? [patch.path];
  const content = patch.files?.length
    ? patch.files.map((file) => file.replacement).join("\n")
    : patch.replacement;
  if (containsSensitiveContent(content)) findings.push({ severity: "critical", file: patch.path, title: "Sensitive content", explanation: "The proposed replacement matches a secret-like pattern.", suggestion: "Remove credentials and use server-side configuration instead." });
  if (/\b(?:child_process|execSync|spawnSync|eval)\b/.test(content)) findings.push({ severity: "high", file: patch.path, title: "Execution surface changed", explanation: "The proposal introduces a process or dynamic-evaluation surface that needs explicit security review.", suggestion: "Prefer fixed, allowlisted operations and validate all inputs." });
  if (paths.length > 8) findings.push({ severity: "medium", title: "Large patch scope", explanation: `This proposal changes ${paths.length} files, which increases review and regression risk.`, suggestion: "Split the work into smaller proposals where practical." });
  if (!content.trim()) findings.push({ severity: "medium", file: patch.path, title: "Empty replacement", explanation: "The proposal does not contain replacement code.", suggestion: "Regenerate the proposal with a complete replacement." });
  return findings;
};
