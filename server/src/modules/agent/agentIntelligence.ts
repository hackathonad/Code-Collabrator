import type { AIAction, AIProviderDescriptor } from "../ai/aiTypes";
import type { RoomSnapshot, WorkspaceFile, WorkspaceFolder } from "../rooms/roomTypes";
import { containsSensitiveContent, isSafeWorkspaceFile, workspacePathForFile } from "./agentSecurity";
import type { AgentMode, AgentPatch, AgentRequest, AgentReviewFinding, AgentTaskClassification, AgentTaskKind } from "./agentTypes";

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
  summary: string;
  updatedAt: number;
}

export interface ProjectIndex {
  workspaceId: string;
  version: number;
  generatedAt: number;
  files: ProjectIndexFile[];
  folders: string[];
  relevantDirectories: string[];
  entryPoints: string[];
  languages: string[];
  testFiles: string[];
  configFiles: string[];
  packageManagers: string[];
  scripts: string[];
  dependencies: string[];
  packageSummary: string;
  summary: string;
  truncated: boolean;
}

export interface RelevantFile { file: ProjectIndexFile; score: number; reasons: string[]; }
export interface ProviderRecommendation { providerId: AIProviderDescriptor["id"]; model: string; reason: string; }

const MAX_INDEX_FILES = 500;
const MAX_INDEX_FOLDERS = 200;
const MAX_INDEX_CACHE_ENTRIES = 100;
const MAX_SYMBOLS = 20;
const MAX_IMPORTS = 20;
const MAX_FILE_SUMMARY = 180;
interface IndexCacheEntry { fingerprint: string; index: ProjectIndex; lastUsedAt: number; }
const indexCache = new Map<string, IndexCacheEntry>();

const clip = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
const filePath = (workspace: RoomSnapshot["workspace"], file: WorkspaceFile) => { try { return workspacePathForFile(workspace, file); } catch { return file.name; } };
const folderPath = (workspace: RoomSnapshot["workspace"], folderId: string) => {
  const parts: string[] = [];
  let current: WorkspaceFolder | undefined = workspace.folders[folderId];
  while (current && current.id !== workspace.rootFolderId) { parts.unshift(current.name); current = current.parentId ? workspace.folders[current.parentId] : undefined; }
  return parts.join("/");
};
const isTestPath = (path: string) => /(^|\/)(?:__tests__|test|tests)(?:\/|$)|(?:\.test|\.spec)\.[^.]+$/i.test(path);
const isConfigPath = (path: string) => /(^|\/)(?:package\.json|tsconfig(?:\.[^.]+)?\.json|vite\.config\.[^.]+|eslint\.config\.[^.]+|\.eslintrc(?:\.[^.]+)?|\.prettierrc(?:\.[^.]+)?|webpack\.config\.[^.]+|pyproject\.toml|cargo\.toml|go\.mod|requirements(?:\.txt)?|dockerfile)$/i.test(path);
const unique = (values: string[], limit: number) => [...new Set(values.filter(Boolean))].slice(0, limit);
const extractSymbols = (content: string) => unique([...content.slice(0, 40_000).matchAll(/\b(?:function|class|interface|type|enum|def|struct|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]), MAX_SYMBOLS);
const extractImports = (content: string) => unique([...content.slice(0, 40_000).matchAll(/\b(?:import\s+(?:[\s\S]*?\s+from\s+|)|require\s*\(|from\s+)['"]([^'"]+)['"]/g)].map((match) => match[1]), MAX_IMPORTS);
const extractSummary = (content: string, symbols: string[], imports: string[]) => {
  const firstLine = content.split("\n").map((line) => line.trim()).find(Boolean)?.replace(/^(?:\/\/|#|\/\*+|\*|<!--)\s*/, "") ?? "";
  return clip([firstLine, symbols.length ? `symbols: ${symbols.slice(0, 5).join(", ")}` : "", imports.length ? `imports: ${imports.slice(0, 4).join(", ")}` : ""].filter(Boolean).join(" · "), MAX_FILE_SUMMARY);
};

interface PackageInfo { packageManagers: string[]; scripts: string[]; dependencies: string[]; entryPoints: string[]; summary: string; }
const packageInfo = (files: ProjectIndexFile[], sourceByPath: Map<string, WorkspaceFile>): PackageInfo => {
  const packageFile = files.find((file) => file.path.toLocaleLowerCase() === "package.json");
  if (!packageFile) return { packageManagers: [], scripts: [], dependencies: [], entryPoints: [], summary: "No package manifest indexed." };
  const source = sourceByPath.get(packageFile.path);
  if (!source) return { packageManagers: ["npm"], scripts: [], dependencies: [], entryPoints: [], summary: "npm package manifest indexed." };
  try {
    const value = JSON.parse(source.content) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; main?: unknown; module?: unknown; bin?: unknown };
    const manifestEntries = [value.main, value.module, ...(typeof value.bin === "string" ? [value.bin] : typeof value.bin === "object" && value.bin ? Object.values(value.bin) : [])].filter((entry): entry is string => typeof entry === "string");
    return { packageManagers: ["npm"], scripts: Object.keys(value.scripts ?? {}).slice(0, 40), dependencies: unique([...Object.keys(value.dependencies ?? {}), ...Object.keys(value.devDependencies ?? {})], 80), entryPoints: unique(manifestEntries, 12), summary: clip(`${Object.keys(value.scripts ?? {}).length} scripts, ${Object.keys(value.dependencies ?? {}).length + Object.keys(value.devDependencies ?? {}).length} dependencies`, 180) };
  } catch { return { packageManagers: ["npm"], scripts: [], dependencies: [], entryPoints: [], summary: "npm manifest is present but could not be parsed." }; }
};

const cacheKeyFor = (room: RoomSnapshot) => `${room.roomId}:${room.workspace.id}`;
const fingerprintFor = (room: RoomSnapshot) => JSON.stringify({ version: room.version, updatedAt: room.workspace.updatedAt, contextVersion: room.workspace.ai.contextVersion, files: Object.values(room.workspace.files).map((file) => [file.id, file.parentId, file.name, file.updatedAt, file.content.length]).sort(), folders: Object.values(room.workspace.folders).map((folder) => [folder.id, folder.parentId, folder.name, folder.updatedAt]).sort() });
const touchCache = (key: string, entry: IndexCacheEntry) => {
  entry.lastUsedAt = Date.now(); indexCache.delete(key); indexCache.set(key, entry);
  while (indexCache.size > MAX_INDEX_CACHE_ENTRIES) indexCache.delete(indexCache.keys().next().value as string);
};

export const invalidateProjectIndexCache = (roomId: string, workspaceId?: string) => { for (const key of indexCache.keys()) if (key.startsWith(`${roomId}:`) && (!workspaceId || key === `${roomId}:${workspaceId}`)) indexCache.delete(key); };
export const getProjectIndexCacheStats = () => ({ size: indexCache.size, keys: [...indexCache.keys()] });

export const buildProjectIndex = (room: RoomSnapshot): ProjectIndex => {
  const key = cacheKeyFor(room); const fingerprint = fingerprintFor(room); const cached = indexCache.get(key);
  if (cached?.fingerprint === fingerprint) { touchCache(key, cached); return cached.index; }
  if (cached) indexCache.delete(key);
  const sourceByPath = new Map<string, WorkspaceFile>();
  const files = Object.values(room.workspace.files).flatMap((file) => {
    if (!isSafeWorkspaceFile(room.workspace, file)) return [];
    const path = filePath(room.workspace, file); sourceByPath.set(path, file);
    const symbols = extractSymbols(file.content); const imports = extractImports(file.content);
    return [{ id: file.id, path, name: file.name, language: file.language, extension: file.extension, size: file.content.length, isTest: isTestPath(path), isConfig: isConfigPath(path), symbols, imports, summary: extractSummary(file.content, symbols, imports), updatedAt: file.updatedAt } satisfies ProjectIndexFile];
  }).sort((left, right) => right.updatedAt - left.updatedAt);
  const boundedFiles = files.slice(0, MAX_INDEX_FILES);
  const folders = Object.values(room.workspace.folders).map((folder) => folderPath(room.workspace, folder.id)).filter(Boolean).slice(0, MAX_INDEX_FOLDERS);
  const packages = packageInfo(boundedFiles, sourceByPath);
  const conventionalEntries = boundedFiles.filter((file) => /(^|\/)(?:src\/)?(?:index|main)\.[^.]+$/i.test(file.path)).map((file) => file.path);
  const entryPoints = unique([...packages.entryPoints, ...conventionalEntries], 20);
  const relevantDirectories = unique([...boundedFiles.map((file) => file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "."), ...folders], 80);
  const index: ProjectIndex = { workspaceId: room.workspace.id, version: room.version, generatedAt: Date.now(), files: boundedFiles, folders, relevantDirectories, entryPoints, languages: unique(boundedFiles.map((file) => file.language), 12), testFiles: boundedFiles.filter((file) => file.isTest).map((file) => file.path).slice(0, 80), configFiles: boundedFiles.filter((file) => file.isConfig).map((file) => file.path).slice(0, 80), packageManagers: packages.packageManagers, scripts: packages.scripts, dependencies: packages.dependencies, packageSummary: packages.summary, summary: "", truncated: files.length > boundedFiles.length };
  index.summary = [`Project index: ${boundedFiles.length}${index.truncated ? "+" : ""} safe files in ${index.languages.join(", ") || "unknown"}.`, index.entryPoints.length ? `Entry points: ${index.entryPoints.slice(0, 8).join(", ")}.` : "Entry points: none detected.", index.configFiles.length ? `Configuration: ${index.configFiles.slice(0, 12).join(", ")}.` : "Configuration files: none detected.", index.testFiles.length ? `Tests: ${index.testFiles.slice(0, 12).join(", ")}.` : "Tests: no test files detected.", index.scripts.length ? `Scripts: ${index.scripts.join(", ")}.` : "Scripts: none detected.", index.dependencies.length ? `Dependencies: ${index.dependencies.slice(0, 24).join(", ")}.` : "Dependencies: none indexed."].join("\n");
  touchCache(key, { fingerprint, index, lastUsedAt: Date.now() }); return index;
};

const withoutExtension = (value: string) => value.replace(/\.(?:[cm]?[jt]sx?|pyw?|cpp|cc|cxx|hpp|h)$/i, "").replace(/\/index$/i, "");
const normalizeImport = (sourcePath: string, imported: string) => {
  if (!imported.startsWith(".")) return "";
  const parts = sourcePath.split("/"); parts.pop();
  for (const segment of imported.split("/")) { if (!segment || segment === ".") continue; if (segment === "..") parts.pop(); else parts.push(segment); }
  return parts.join("/");
};

export const relatedFilesFor = (index: ProjectIndex, target: string, limit = 20): RelevantFile[] => {
  const targetFile = index.files.find((file) => file.id === target || file.path === target); if (!targetFile) return [];
  const targetStem = withoutExtension(targetFile.path).toLocaleLowerCase();
  return index.files.map((file) => {
    let score = file.id === targetFile.id ? 100 : 0; const reasons: string[] = file.id === targetFile.id ? ["requested file"] : [];
    if (file.imports.some((entry) => withoutExtension(normalizeImport(file.path, entry)).toLocaleLowerCase() === targetStem)) { score += 65; reasons.push("imports requested file"); }
    if (targetFile.imports.some((entry) => withoutExtension(normalizeImport(targetFile.path, entry)).toLocaleLowerCase() === withoutExtension(file.path).toLocaleLowerCase())) { score += 55; reasons.push("requested file imports it"); }
    if (withoutExtension(file.path).toLocaleLowerCase() === targetStem && file.id !== targetFile.id) { score += 35; reasons.push("same module path"); }
    if (file.name.toLocaleLowerCase() === targetFile.name.toLocaleLowerCase() && file.id !== targetFile.id) { score += 12; reasons.push("matching filename"); }
    return { file, score, reasons: unique(reasons, 6) };
  }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path)).slice(0, Math.min(20, Math.max(1, limit)));
};

export const selectRelevantFiles = (room: RoomSnapshot, request: { userInstruction: string; currentFileId?: string; relevantFiles?: string[]; diagnostics?: AgentRequest["diagnostics"]; continuitySummary?: string; intent?: AgentRequest["intent"]; mode?: AgentMode }, index = buildProjectIndex(room)): RelevantFile[] => {
  const words = unique(`${request.userInstruction} ${request.continuitySummary ?? ""}`.toLocaleLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? [], 80);
  const hints = [...(request.relevantFiles ?? []), ...(request.diagnostics ?? []).flatMap((diagnostic) => [diagnostic.path, diagnostic.fileId].filter((value): value is string => Boolean(value)))].map((value) => value.toLocaleLowerCase());
  const recentIds = new Set(room.workspace.recentlyOpenedFileIds.slice(0, 12)); const recentTimestamp = Math.max(...index.files.map((file) => file.updatedAt), 0);
  return index.files.map((file) => {
    let score = file.id === request.currentFileId ? 100 : 0; const reasons: string[] = file.id === request.currentFileId ? ["current editor file"] : []; const path = file.path.toLocaleLowerCase();
    if (room.workspace.openFileIds.includes(file.id)) { score += 28; reasons.push("open tab"); }
    if (recentIds.has(file.id)) { score += 16; reasons.push("recently edited"); }
    if (recentTimestamp && file.updatedAt >= recentTimestamp - 60_000) { score += 8; reasons.push("recent workspace change"); }
    if (hints.some((hint) => path.includes(hint) || hint.includes(path) || hint === file.id.toLocaleLowerCase())) { score += 55; reasons.push("requested or diagnostic path"); }
    for (const word of words) { if (path.includes(word)) { score += 12; reasons.push("filename match"); } if (file.symbols.some((symbol) => symbol.toLocaleLowerCase().includes(word))) { score += 18; reasons.push("symbol match"); } if (file.imports.some((dependency) => dependency.toLocaleLowerCase().includes(word))) { score += 8; reasons.push("dependency match"); } }
    if (request.intent === "test" && file.isTest) { score += 35; reasons.push("test workflow"); }
    if (["review", "refactor", "fix", "error"].includes(request.intent ?? "") && (file.isConfig || file.isTest)) { score += 10; reasons.push("workflow support file"); }
    if (request.mode === "DEBUG" && file.isConfig) { score += 14; reasons.push("debug configuration"); }
    return { file, score, reasons: unique(reasons, 8) };
  }).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path)).slice(0, 20);
};

export const projectIndexForContext = (index: ProjectIndex) => ({ files: index.files.slice(0, 80).map((file) => ({ path: file.path, language: file.language, size: file.size, isTest: file.isTest, isConfig: file.isConfig, symbols: file.symbols.slice(0, 8), imports: file.imports.slice(0, 8), summary: file.summary })), languages: index.languages, entryPoints: index.entryPoints, relevantDirectories: index.relevantDirectories.slice(0, 40), testFiles: index.testFiles.slice(0, 40), configFiles: index.configFiles.slice(0, 40), scripts: index.scripts, dependencies: index.dependencies.slice(0, 40), packageSummary: index.packageSummary, truncated: index.truncated });

const explicitKind = (intent: AIAction | undefined): AgentTaskKind | null => { const mapping: Partial<Record<AIAction, AgentTaskKind>> = { review: "review", test: "test", refactor: "refactor", generate: "edit", fix: "debug", error: "debug", optimize: "performance", document: "documentation", explain: "explain", summarize: "explain" }; return intent ? mapping[intent] ?? null : null; };
export const classifyTask = (request: Pick<AgentRequest, "userInstruction" | "intent" | "mode">): AgentTaskClassification => {
  const explicit = explicitKind(request.intent); if (explicit) return { kind: explicit, confidence: "high", reason: `Explicit ${request.intent} workflow selected` };
  if (request.mode === "DEBUG") return { kind: "debug", confidence: "high", reason: "Debug mode selected" }; if (request.mode === "EDIT") return { kind: "edit", confidence: "high", reason: "Edit mode selected" };
  const text = request.userInstruction.toLocaleLowerCase(); const patterns: Array<[AgentTaskKind, RegExp, string]> = [["security", /security|secret|auth|permission|vulnerab|injection/, "Security language detected"], ["architecture", /architecture|design|boundary|module|scalab/, "Architecture language detected"], ["performance", /performance|slow|latency|optimi[sz]|memory|bundle/, "Performance language detected"], ["review", /review|audit|inspect|risk|bug/, "Review language detected"], ["test", /test|coverage|regression|spec/, "Testing language detected"], ["refactor", /refactor|restructure|clean up|simplify/, "Refactoring language detected"], ["edit", /change|update|add|remove|implement|fix|write|create/, "Change language detected"], ["explain", /explain|what does|how does|why|meaning|summari[sz]/, "Explanation language detected"]];
  const match = patterns.find(([, pattern]) => pattern.test(text)); return match ? { kind: match[0], confidence: "medium", reason: match[2] } : { kind: "question", confidence: "low", reason: "No explicit workflow signal was provided" };
};

export const isComplexTask = (request: Pick<AgentRequest, "userInstruction" | "intent" | "mode">) => { const classification = classifyTask(request); return /multi[- ]?file|multiple files|entire project|across|several|regression|complex|plan/i.test(request.userInstruction) || ["review", "test", "refactor", "performance", "debug", "architecture", "security"].includes(classification.kind); };

export const createTaskPlan = (request: Pick<AgentRequest, "userInstruction" | "intent" | "mode">, relevant: RelevantFile[]) => {
  const files = relevant.slice(0, 3).map((entry) => entry.file.path); const inspect = files.length ? `Inspect ${files.join(", ")}` : "Inspect the current editor and project index"; const kind = classifyTask(request).kind;
  if (kind === "review") return [inspect, "Check correctness, security, races, errors, and tests", "Report severity and evidence-backed locations", "Suggest fixes without changing code"];
  if (kind === "test") return [inspect, "Locate the existing test framework and nearby patterns", "Propose focused regression tests", "Run validation only when explicitly requested"];
  if (kind === "refactor" || kind === "edit") return [inspect, "Trace the relevant symbols and dependencies", "Propose the smallest complete patch", "Review and validate the proposal before approval"];
  if (kind === "debug") return [inspect, "Correlate diagnostics, code, configuration, and recent changes", "State confirmed, likely, and possible causes with evidence", "Propose a minimal fix and validation"];
  if (kind === "security") return [inspect, "Trace trust boundaries and sensitive-data flows", "Report evidence-backed security risks", "Propose the smallest safe remediation"];
  return [inspect, "Answer using only verified workspace evidence", "Call out uncertainty when evidence is insufficient"];
};

export const actionForRequest = (request: Pick<AgentRequest, "mode" | "intent">): AIAction => { if (request.intent === "error") return "fix"; if (request.intent) return request.intent; return request.mode === "DEBUG" ? "fix" : request.mode === "EDIT" ? "generate" : "explain"; };

export const recommendProvider = (providers: AIProviderDescriptor[], intent: AIAction): ProviderRecommendation | null => {
  const available = providers.filter((provider) => provider.available && provider.models.length); if (!available.length) return null; const complex = ["review", "test", "refactor", "optimize", "fix"].includes(intent);
  const ranked = available.map((provider) => { let score = provider.supportsStreaming ? 2 : 0; if (provider.supportsToolCalling) score += 3; if (provider.supportsLocalModels && !complex) score += 3; if (complex && provider.id !== "ollama") score += 1; if (provider.id === "openai" || provider.id === "anthropic") score += complex ? 3 : 1; return { provider, score }; }).sort((left, right) => right.score - left.score);
  const selected = ranked[0].provider; return { providerId: selected.id, model: selected.defaultModel ?? selected.models[0].id, reason: complex ? "Best available fit for a structured development task" : "Fast available fit for an explanation or focused question" };
};

export const reviewPatch = (patch: Pick<AgentPatch, "path" | "replacement" | "files">): AgentReviewFinding[] => {
  const findings: AgentReviewFinding[] = []; const paths = patch.files?.map((file) => file.path) ?? [patch.path]; const content = patch.files?.length ? patch.files.map((file) => file.replacement).join("\n") : patch.replacement;
  if (containsSensitiveContent(content)) findings.push({ severity: "critical", file: patch.path, title: "Sensitive content", explanation: "The proposed replacement matches a secret-like pattern.", suggestion: "Remove credentials and use server-side configuration instead." });
  if (/\b(?:child_process|execSync|spawnSync|eval)\b/.test(content)) findings.push({ severity: "high", file: patch.path, title: "Execution surface changed", explanation: "The proposal introduces a process or dynamic-evaluation surface that needs explicit security review.", suggestion: "Prefer fixed, allowlisted operations and validate all inputs." });
  if (paths.length > 8) findings.push({ severity: "medium", title: "Large patch scope", explanation: `This proposal changes ${paths.length} files, which increases review and regression risk.`, suggestion: "Split the work into smaller proposals where practical." });
  if (!content.trim()) findings.push({ severity: "medium", file: patch.path, title: "Empty replacement", explanation: "The proposal does not contain replacement code.", suggestion: "Regenerate the proposal with a complete replacement." });
  return findings;
};
