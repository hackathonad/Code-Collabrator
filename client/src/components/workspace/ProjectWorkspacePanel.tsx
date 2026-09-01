import { CheckCircle2, ChevronDown, CircleAlert, CircleDashed, FolderTree, LoaderCircle, Map as MapIcon, RefreshCw, Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { AgentTaskPublic } from "../../types/agent";
import type { AIAction, AIProviderDescriptor } from "../../types/ai";
import type { UserSession, WorkspaceFile, WorkspaceFolder, WorkspaceState } from "../../types/collaboration";
import type { ProjectExperience, ProjectHealthItem, ProjectSignalState } from "../../types/project";

interface ProjectWorkspacePanelProps {
  roomId: string;
  session: UserSession;
  workspace: WorkspaceState;
  providers: AIProviderDescriptor[];
  tasks: AgentTaskPublic[];
  onOpenFile: (fileId: string) => void;
  onAskAI: (prompt: string, action: AIAction) => void;
}

const stateTone = (state: ProjectSignalState) => state === "passed" || state === "ready" ? "text-emerald-300" : state === "failed" || state === "attention" ? "text-amber-200" : state === "running" ? "text-sky-300" : "text-[var(--text-faint)]";
const StateIcon = ({ state, className }: { state: ProjectSignalState; className: string }) => state === "passed" || state === "ready" ? <CheckCircle2 className={className} /> : state === "failed" || state === "attention" ? <CircleAlert className={className} /> : state === "running" ? <LoaderCircle className={className} /> : <CircleDashed className={className} />;
const pathForFile = (workspace: WorkspaceState, file: WorkspaceFile) => {
  const parts = [file.name];
  let folder: WorkspaceFolder | undefined = workspace.folders[file.parentId];
  while (folder && folder.id !== workspace.rootFolderId) { parts.unshift(folder.name); folder = folder.parentId ? workspace.folders[folder.parentId] : undefined; }
  return parts.join("/");
};

const HealthRow = ({ item }: { item: ProjectHealthItem }) => {
  return <div className="flex min-w-0 items-center gap-1.5" title={item.detail}><StateIcon state={item.state} className={`h-3 w-3 shrink-0 ${stateTone(item.state)} ${item.state === "running" ? "animate-spin" : ""}`} /><span className="truncate text-[10px] text-[var(--text-secondary)]">{item.label}</span></div>;
};

export const ProjectWorkspacePanel = ({ roomId, session, workspace, providers, tasks, onOpenFile, onAskAI }: ProjectWorkspacePanelProps) => {
  const [experience, setExperience] = useState<ProjectExperience | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const filesByPath = useMemo(() => new Map<string, string>(Object.values(workspace.files).map((file) => [pathForFile(workspace, file), file.id] as [string, string])), [workspace]);
  const activeTasks = tasks.filter((task) => !["completed", "cancelled", "failed", "timed_out", "conflict"].includes(task.status)).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setExperience(await api.getProjectExperience(roomId, session)); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Project intelligence is unavailable until the backend reconnects."); }
    finally { setLoading(false); }
  }, [roomId, session]);

  useEffect(() => { void load(); }, [load, workspace.id]);

  const openPath = (path: string) => { const fileId = filesByPath.get(path); if (fileId) onOpenFile(fileId); };
  const ask = (prompt: string, action: AIAction) => onAskAI(prompt, action);
  const availableProviders = providers.filter((provider) => provider.available && provider.models.length).length;

  return <section className="mx-2 mt-2 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--badge-bg)]" aria-label="Project intelligence">
    <div className="flex items-center gap-2 px-2.5 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/12 text-[var(--accent)]"><MapIcon className="h-3.5 w-3.5" /></div>
      <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[var(--text-primary)]">Project snapshot</p><p className="truncate text-[10px] text-[var(--text-faint)]">{experience?.snapshot.framework ?? workspace.name}</p></div>
      <span className="hidden items-center gap-1 text-[10px] text-[var(--text-faint)] sm:inline-flex"><Users className="h-3 w-3" />{experience?.snapshot.activeTasks ?? activeTasks} tasks</span>
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded p-1 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]" title="Refresh project snapshot" aria-label="Refresh project snapshot"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
    </div>
    <div className="border-t border-[var(--border)] px-2.5 py-2">
      {loading && !experience ? <div className="flex items-center gap-2 py-1 text-[10px] text-[var(--text-muted)]"><LoaderCircle className="h-3 w-3 animate-spin text-[var(--accent)]" />Reading bounded project state…</div> : null}
      {error && !experience ? <div className="flex items-start gap-1.5 py-1 text-[10px] leading-4 text-amber-200"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /><span>{error}</span></div> : null}
      {experience ? <>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <p className="truncate text-[10px] text-[var(--text-muted)]" title={experience.snapshot.language}><span className="text-[var(--text-faint)]">Language </span>{experience.snapshot.language}</p>
          <p className="truncate text-[10px] text-[var(--text-muted)]" title={experience.snapshot.git}><span className="text-[var(--text-faint)]">Git </span>{experience.snapshot.git}</p>
          <p className="truncate text-[10px] text-[var(--text-muted)]" title={experience.snapshot.backend}><span className="text-[var(--text-faint)]">Backend </span>{experience.snapshot.backend}</p>
          <p className="truncate text-[10px] text-[var(--text-muted)]" title={experience.snapshot.tests}><span className="text-[var(--text-faint)]">Tests </span>{experience.snapshot.tests}</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--border)] pt-2" aria-label="Project health">{experience.health.slice(0, 8).map((item) => <HealthRow key={item.id} item={item} />)}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => ask("Understand this project from the bounded project index. Explain the framework, entry points, important directories, major modules, data flow, test strategy, build strategy, development guide, and risk areas. State only what the inspected workspace supports.", "summarize")} className="theme-button-primary inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold"><Sparkles className="h-3 w-3" />Understand project</button>
          <button type="button" onClick={() => ask("Give me a concise tour of this project. Cover the entry point, core architecture, important modules, data flow, tests, and development workflow using only inspected evidence.", "summarize")} className="theme-button-neutral rounded-lg border px-2 py-1.5 text-[10px]">Tour</button>
        </div>
        <details open={mapOpen} onToggle={(event) => setMapOpen(event.currentTarget.open)} className="mt-2 border-t border-[var(--border)] pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-[var(--text-secondary)]"><ChevronDown className={`h-3 w-3 transition-transform ${mapOpen ? "rotate-180" : ""}`} /><FolderTree className="h-3 w-3 text-[var(--accent)]" />Project map <span className="font-normal text-[var(--text-faint)]">{experience.map.areas.length} areas</span></summary>
          <div className="mt-1.5 space-y-1">{experience.map.areas.slice(0, 8).map((area) => <div key={area.path} className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 hover:bg-white/5"><button type="button" onClick={() => openPath(area.sampleFiles[0])} className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{area.path === "." ? "root" : area.path}/ <span className="font-sans text-[var(--text-faint)]">{area.fileCount}</span></button><button type="button" onClick={() => ask(`Explain the ${area.path} project area. Inspect its relevant files and describe responsibilities, dependencies, risks, and where a safe change would belong.`, "explain")} className="shrink-0 rounded px-1.5 py-1 text-[10px] text-[var(--accent)] hover:bg-[var(--accent)]/10">Ask</button></div>)}</div>
          {experience.map.importantFiles.length ? <div className="mt-2 border-t border-[var(--border)] pt-1.5"><p className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-faint)]">Important files</p><div className="mt-1 flex flex-wrap gap-1">{experience.map.importantFiles.slice(0, 6).map((path) => <button key={path} type="button" onClick={() => openPath(path)} className="max-w-full truncate rounded bg-black/10 px-1.5 py-1 font-mono text-[9px] text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]">{path}</button>)}</div></div> : null}
        </details>
        <details open={readinessOpen} onToggle={(event) => setReadinessOpen(event.currentTarget.open)} className="mt-2 border-t border-[var(--border)] pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-[var(--text-secondary)]"><ChevronDown className={`h-3 w-3 transition-transform ${readinessOpen ? "rotate-180" : ""}`} />Demo readiness <span className="font-normal text-[var(--text-faint)]">{availableProviders ? "AI available" : "honest status"}</span></summary>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">{experience.readiness.map((item) => <HealthRow key={item.id} item={item} />)}</div>
        </details>
        <div className="mt-2 flex flex-wrap gap-1 border-t border-[var(--border)] pt-2"><button type="button" onClick={() => ask("What’s happening in this room? Summarize the current project, branch, collaborators, active AI tasks, recent changes, and the next useful step using bounded current evidence.", "summarize")} className="rounded px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]">What’s happening?</button><button type="button" onClick={() => ask("Summarize this coding session with what we worked on, actual changes, verified tests, open tasks, and next steps. Say not run or unknown when evidence is missing.", "summarize")} className="rounded px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]">Session summary</button><button type="button" onClick={() => ask("Prepare a concise teammate handoff from the current room state: current work, changed areas, verified validation, remaining tasks, and next step. Use only evidence.", "summarize")} className="rounded px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]">Handoff</button></div>
      </> : null}
    </div>
  </section>;
};
