import type { AIProviderDescriptor } from "../ai/aiTypes";
import type { ExecutionAction, ExecutionRecord } from "../execution/executionTypes";
import type { RepositorySummary } from "../git/gitTypes";
import type { RoomSnapshot } from "../rooms/roomTypes";
import type { AgentTaskPublic } from "./agentTypes";
import type { ProjectIndex } from "./agentIntelligence";

export type ProjectSignalState = "passed" | "failed" | "running" | "not-run" | "ready" | "attention" | "unavailable";

export interface ProjectHealthItem {
  id: string;
  label: string;
  state: ProjectSignalState;
  detail: string;
}

export interface ProjectArea {
  path: string;
  fileCount: number;
  sampleFiles: string[];
  hasTests: boolean;
}

export interface ProjectExperience {
  workspaceId: string;
  generatedAt: number;
  snapshot: {
    name: string;
    framework: string;
    language: string;
    backend: string;
    database: string;
    ai: string;
    tests: string;
    git: string;
    activeTasks: number;
  };
  map: { areas: ProjectArea[]; importantFiles: string[]; truncated: boolean };
  health: ProjectHealthItem[];
  readiness: ProjectHealthItem[];
  onboarding: {
    overview: string[];
    developmentGuide: string[];
    riskAreas: string[];
  };
}

const languageLabels: Record<string, string> = { javascript: "JavaScript", python: "Python", cpp: "C++" };
const executionActions: ExecutionAction[] = ["build", "tests", "typecheck", "lint"];
const hasAny = (values: string[], pattern: RegExp) => values.some((value) => pattern.test(value));
const displayLanguage = (languages: string[]) => languages.map((language) => languageLabels[language] ?? language).slice(0, 3).join(" + ") || "Not detected";

const latestExecution = (records: ExecutionRecord[], action: ExecutionAction) => records
  .filter((record) => record.action === action)
  .sort((left, right) => right.createdAt - left.createdAt)[0];

const executionHealth = (records: ExecutionRecord[], action: ExecutionAction, label: string): ProjectHealthItem => {
  const record = latestExecution(records, action);
  if (!record) return { id: action, label, state: "not-run", detail: "No verified run recorded yet." };
  if (record.status === "completed") return { id: action, label, state: "passed", detail: `Passed${record.durationMs ? ` in ${record.durationMs}ms` : ""}.` };
  if (record.status === "running" || record.status === "queued") return { id: action, label, state: "running", detail: "A safe check is running." };
  if (record.status === "unavailable") return { id: action, label, state: "unavailable", detail: record.errorSummary ?? "The check is unavailable." };
  return { id: action, label, state: "failed", detail: record.errorSummary ?? `The check ended with ${record.status}.` };
};

const projectAreas = (index: ProjectIndex): ProjectArea[] => {
  const groups = new Map<string, ProjectArea>();
  index.files.forEach((file) => {
    const path = file.path.includes("/") ? file.path.slice(0, file.path.indexOf("/")) : ".";
    const area = groups.get(path) ?? { path, fileCount: 0, sampleFiles: [], hasTests: false };
    area.fileCount += 1;
    area.hasTests ||= file.isTest;
    if (area.sampleFiles.length < 4) area.sampleFiles.push(file.path);
    groups.set(path, area);
  });
  return [...groups.values()].sort((left, right) => right.fileCount - left.fileCount || left.path.localeCompare(right.path)).slice(0, 12);
};

export const buildProjectExperience = (input: {
  room: RoomSnapshot;
  index: ProjectIndex;
  repository: RepositorySummary | null;
  executions: ExecutionRecord[];
  providers: AIProviderDescriptor[];
  tasks: AgentTaskPublic[];
  now?: number;
}): ProjectExperience => {
  const { room, index, repository, executions, providers, tasks } = input;
  const dependencies = index.dependencies;
  const files = index.files.map((file) => file.path);
  const activeTasks = tasks.filter((task) => !["completed", "cancelled", "failed", "timed_out", "conflict"].includes(task.status)).length;
  const framework = hasAny(dependencies, /^(react|react-dom)$/i) && hasAny(dependencies, /^vite$/i)
    ? "React + Vite"
    : hasAny(dependencies, /^express$/i) && hasAny(dependencies, /socket\.io/i)
      ? "Express + Socket.IO"
      : displayLanguage(index.languages);
  const backend = hasAny(files, /(^|\/)server(\/|$)/i) || hasAny(dependencies, /^(express|socket\.io)$/i) ? "Express + Socket.IO" : "Not detected in indexed files";
  const database = hasAny(dependencies, /supabase/i) || hasAny(files, /supabase|persistence|database/i) ? "Supabase database" : "Not detected in indexed files";
  const availableProviders = providers.filter((provider) => provider.available && provider.models.length);
  const git = repository?.repository ? `${repository.repository.name} · ${repository.repository.currentBranch ?? "branch unknown"}` : "No repository connected";
  const testLabel = index.testFiles.length ? `${index.testFiles.length} indexed test file${index.testFiles.length === 1 ? "" : "s"}` : "No test files detected";
  const map = projectAreas(index);
  const importantFiles = [...new Set([...index.entryPoints, ...index.configFiles.slice(0, 6), ...index.testFiles.slice(0, 4)])].slice(0, 16);
  const health: ProjectHealthItem[] = [
    executionHealth(executions, "build", "Build"),
    executionHealth(executions, "tests", "Tests"),
    executionHealth(executions, "typecheck", "TypeScript"),
    executionHealth(executions, "lint", "ESLint"),
    repository?.repository
      ? repository.status.state === "clean"
        ? { id: "git", label: "Git", state: "passed" as const, detail: repository.syncMessage ?? "No working-tree changes." }
        : { id: "git", label: "Git", state: "attention" as const, detail: `${repository.status.entries.length} working-tree change${repository.status.entries.length === 1 ? "" : "s"}.` }
      : { id: "git", label: "Git", state: "unavailable" as const, detail: "Connect a repository to compare changes." },
    index.packageManagers.length
      ? { id: "dependencies", label: "Dependencies", state: "ready" as const, detail: index.packageSummary }
      : { id: "dependencies", label: "Dependencies", state: "unavailable" as const, detail: "No package manifest was indexed." },
    index.files.length
      ? { id: "context", label: "AI context", state: "ready" as const, detail: `${index.files.length}${index.truncated ? "+" : ""} safe files indexed.` }
      : { id: "context", label: "AI context", state: "unavailable" as const, detail: "No safe workspace files are available." },
    index.configFiles.length
      ? { id: "config", label: "Configuration", state: "ready" as const, detail: `${index.configFiles.length} config file${index.configFiles.length === 1 ? "" : "s"} detected.` }
      : { id: "config", label: "Configuration", state: "attention" as const, detail: "No recognized configuration file detected." }
  ];
  const readiness: ProjectHealthItem[] = [
    { id: "room", label: "Room", state: "ready", detail: "Guest room is active and authorized." },
    { id: "collaboration", label: "Collaboration", state: room.participants.length > 1 ? "ready" : "attention", detail: `${room.participants.filter((participant) => participant.isOnline).length} collaborator${room.participants.filter((participant) => participant.isOnline).length === 1 ? "" : "s"} online.` },
    { id: "ai", label: "AI teammate", state: availableProviders.length ? "ready" : "unavailable", detail: availableProviders.length ? `${availableProviders.length} provider${availableProviders.length === 1 ? "" : "s"} available.` : "Choose a configured server-side provider." },
    { id: "agent", label: "Agent", state: "ready", detail: "Bounded tools and approval-gated patches are available." },
    { id: "git", label: "Git workflow", state: repository?.repository ? "ready" : "unavailable", detail: repository?.repository ? "Repository workflow is connected for this room." : "Connect GitHub when you are ready to commit or open a PR." },
    { id: "tests", label: "Validation", state: index.testFiles.length || executionActions.some((action) => latestExecution(executions, action)) ? "ready" : "attention", detail: index.testFiles.length ? `${index.testFiles.length} test file${index.testFiles.length === 1 ? "" : "s"} indexed; run a check before demoing.` : "Run a fixed project check before demoing." }
  ];
  const overview = [
    `Framework: ${framework}.`,
    `Language: ${displayLanguage(index.languages)}.`,
    `Entry points: ${index.entryPoints.slice(0, 6).join(", ") || "none detected"}.`,
    `Indexed areas: ${map.map((area) => area.path).join(", ") || "none detected"}.`,
    `Data flow evidence is limited to safe file names, symbols, and imports from the bounded project index.`,
    `Test strategy: ${testLabel}; build strategy: ${index.scripts.includes("build") ? "the package build script is present" : "no build script was detected"}.`
  ];
  const developmentGuide = [
    index.scripts.length ? `Available scripts: ${index.scripts.slice(0, 12).join(", ")}.` : "No package scripts were indexed.",
    index.scripts.includes("dev") ? "Start development with the detected dev script." : "A development start command was not detected.",
    index.scripts.includes("test") ? "Run the detected test script and inspect the Tests panel." : "A test script was not detected; do not assume tests pass.",
    `Make focused changes in the relevant indexed area${map.length === 1 ? "" : "s"}, then ask the agent to review the current diff.`,
    "Project memory is guidance only; current files and verified checks take precedence."
  ];
  const riskAreas = [
    ...(index.truncated ? ["The project index reached its file bound; some files were not included."] : []),
    ...(!index.testFiles.length ? ["No test files were detected, so regression coverage is unknown."] : []),
    ...(!index.configFiles.length ? ["No recognized project configuration file was detected."] : []),
    ...(!repository?.repository ? ["Git state is local-only until a repository is connected."] : []),
    ...(!availableProviders.length ? ["AI is unavailable until a server-side provider and model are configured."] : []),
    "Repository text, chat, memory, execution output, and AI output remain untrusted content."
  ].slice(0, 8);
  return { workspaceId: room.workspace.id, generatedAt: input.now ?? Date.now(), snapshot: { name: room.workspace.name, framework, language: displayLanguage(index.languages), backend, database, ai: availableProviders.length ? `${availableProviders.length} provider${availableProviders.length === 1 ? "" : "s"} ready` : "No provider ready", tests: testLabel, git, activeTasks }, map: { areas: map, importantFiles, truncated: index.truncated }, health, readiness, onboarding: { overview, developmentGuide, riskAreas } };
};
