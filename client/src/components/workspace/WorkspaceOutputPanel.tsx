import { AlertCircle, CheckCircle2, ClipboardCopy, Download, ExternalLink, LoaderCircle, PanelBottomClose, PanelBottomOpen, Play, RotateCcw, Square, TerminalSquare, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentDiagnostic } from "../../types/agent";
import type { SupportedLanguage } from "../../types/collaboration";
import type { ExecutionAction, ExecutionCapabilities, ExecutionRecord, ExecutionStatus } from "../../types/execution";

export type WorkspacePanelTab = "run" | "terminal" | "tests" | "problems" | "output";

interface WorkspaceOutputPanelProps {
  open: boolean;
  onToggle: () => void;
  activeFileName: string;
  code: string;
  language: SupportedLanguage;
  activeTab: WorkspacePanelTab;
  onActiveTabChange: (tab: WorkspacePanelTab) => void;
  onChangeLanguage: (language: SupportedLanguage) => void;
  onRunExternal: () => Promise<boolean>;
  onRunAction: (action: ExecutionAction, target?: string) => Promise<ExecutionRecord | null>;
  onCancelExecution: (executionId: string) => Promise<void>;
  executions: ExecutionRecord[];
  capabilities: ExecutionCapabilities | null;
  executionError: string | null;
  diagnostics: AgentDiagnostic[];
  onOpenDiagnostic: (diagnostic: AgentDiagnostic) => void;
  onDebugDiagnostic: (diagnostic: AgentDiagnostic) => void;
  onCopy: () => Promise<boolean>;
  onDownload: () => boolean;
}

const actionLabels: Record<ExecutionAction, string> = {
  run: "Run project",
  tests: "All tests",
  "targeted-tests": "Targeted test",
  build: "Build",
  typecheck: "TypeScript",
  lint: "ESLint",
  diagnostics: "Diagnostics",
};

const statusLabels: Record<ExecutionStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Passed",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  unavailable: "Unavailable",
};

const languageLabel: Record<SupportedLanguage, string> = { javascript: "JavaScript", python: "Python", cpp: "C++" };
const statusClass = (status: ExecutionStatus) => status === "completed" ? "text-emerald-300" : status === "failed" || status === "timed_out" ? "text-rose-300" : status === "unavailable" ? "text-amber-300" : "text-[var(--text-secondary)]";
const prettyCommand = (command: string) => command.replace(/^node .*npm-cli\.js /, "npm ");

export const WorkspaceOutputPanel = ({ open, onToggle, activeFileName, code, language, activeTab, onActiveTabChange, onChangeLanguage, onRunExternal, onRunAction, onCancelExecution, executions, capabilities, executionError, diagnostics, onOpenDiagnostic, onDebugDiagnostic, onCopy, onDownload }: WorkspaceOutputPanelProps) => {
  const [action, setAction] = useState<ExecutionAction>("tests");
  const [target, setTarget] = useState("server/test/productionSmoke.test.cjs");
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "copied" | "downloaded">("idle");
  const current = executions.find((entry) => entry.executionId === selectedExecutionId) ?? executions[0];
  const running = executions.find((entry) => entry.status === "queued" || entry.status === "running");
  const availableActions = useMemo(() => new Set(capabilities?.actions.filter((entry) => entry.available).map((entry) => entry.action) ?? Object.keys(actionLabels)), [capabilities]);

  const run = async (nextAction = action, nextTarget = target) => {
    setBusy(true);
    try {
      const result = await onRunAction(nextAction, nextAction === "targeted-tests" ? nextTarget : undefined);
      if (result) {
        setSelectedExecutionId(result.executionId);
        onActiveTabChange(result.action === "tests" || result.action === "targeted-tests" ? "tests" : "output");
      }
    } finally {
      setBusy(false);
    }
  };

  const rerun = (record: ExecutionRecord) => {
    setAction(record.action);
    void run(record.action, record.target);
  };

  const copy = async () => {
    if (await onCopy()) {
      setFeedback("copied");
      window.setTimeout(() => setFeedback("idle"), 1_500);
    }
  };

  const download = () => {
    if (onDownload()) {
      setFeedback("downloaded");
      window.setTimeout(() => setFeedback("idle"), 1_500);
    }
  };

  return (
    <section className={`theme-panel-solid mt-2 flex shrink-0 flex-col overflow-hidden rounded-xl border shadow-[var(--shadow-soft)] sm:mt-3 ${open ? "h-[min(24rem,46vh)]" : "h-11"}`} aria-label="Workspace execution panel">
      <div className="flex min-h-0 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Workspace panel views">
          {["run", "terminal", "tests", "problems", "output"].map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => { onActiveTabChange(tab as WorkspacePanelTab); if (!open) onToggle(); }} className={`shrink-0 border-b-2 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide transition sm:px-2.5 sm:text-xs ${activeTab === tab ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>{tab}</button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-40 truncate text-[11px] text-[var(--text-faint)] sm:block">{activeFileName}</span>
          <button type="button" onClick={onToggle} className="ui-focus-ring rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--badge-bg)] hover:text-[var(--text-primary)]" aria-expanded={open} aria-label={open ? "Collapse output panel" : "Expand output panel"}>{open ? <PanelBottomClose className="h-4 w-4" /> : <PanelBottomOpen className="h-4 w-4" />}</button>
        </div>
      </div>

      <div className={`${open ? "min-h-0 flex-1 overflow-auto px-3 py-3 text-xs leading-5" : "hidden"}`}>
        {activeTab === "run" ? (
          <div className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1fr)_auto] xl:items-end">
              <label className="grid gap-1 text-[11px] font-medium text-[var(--text-muted)]">Language<select value={language} onChange={(event) => onChangeLanguage(event.target.value as SupportedLanguage)} className="theme-input rounded-lg border px-2.5 py-2 text-xs text-[var(--text-primary)]"><option value="javascript">JavaScript</option><option value="python">Python</option><option value="cpp">C++</option></select></label>
              <label className="grid gap-1 text-[11px] font-medium text-[var(--text-muted)]">Action<select value={action} onChange={(event) => setAction(event.target.value as ExecutionAction)} className="theme-input rounded-lg border px-2.5 py-2 text-xs text-[var(--text-primary)]">{(Object.keys(actionLabels) as ExecutionAction[]).map((entry) => <option key={entry} value={entry} disabled={!availableActions.has(entry)}>{actionLabels[entry]}{entry === "run" ? " (external only)" : ""}</option>)}</select></label>
              {action === "targeted-tests" ? <label className="grid gap-1 text-[11px] font-medium text-[var(--text-muted)]">Existing server test path<input value={target} onChange={(event) => setTarget(event.target.value)} className="theme-input rounded-lg border px-2.5 py-2 font-mono text-xs text-[var(--text-primary)]" /></label> : <div className="rounded-lg border border-[var(--border)] bg-[var(--badge-bg)] px-3 py-2 text-[11px] text-[var(--text-muted)]">{action === "run" ? "Room source stays virtual; use the external runner below." : "Fixed allowlisted command. No shell input is accepted."}</div>}
              <button type="button" onClick={() => void run()} disabled={busy || Boolean(running) || !capabilities?.available || !availableActions.has(action)} className="theme-workspace-action inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"><Play className="h-3.5 w-3.5" />{busy ? "Starting…" : running ? "Busy…" : "Run"}</button>
            </div>
            <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void onRunExternal()} className="theme-button-neutral inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"><ExternalLink className="h-3.5 w-3.5" />Open external runner</button><button type="button" onClick={() => void copy()} className="theme-button-neutral inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"><ClipboardCopy className="h-3.5 w-3.5" />{feedback === "copied" ? "Copied" : "Copy code"}</button><button type="button" onClick={download} className="theme-button-neutral inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"><Download className="h-3.5 w-3.5" />{feedback === "downloaded" ? "Downloaded" : "Download"}</button><span className="text-[11px] text-[var(--text-faint)]">{activeFileName} · {languageLabel[language]} · {code.length.toLocaleString()} chars</span></div>
            {running ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2"><span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]"><LoaderCircle className="h-4 w-4 animate-spin text-[var(--accent)]" />{actionLabels[running.action]} {statusLabels[running.status].toLowerCase()}</span><button type="button" onClick={() => void onCancelExecution(running.executionId)} className="inline-flex items-center gap-1 rounded border border-rose-500/30 px-2 py-1 text-[11px] text-rose-200"><Square className="h-3 w-3" />Cancel</button></div> : null}
            {executionError ? <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{executionError}</p> : null}
            <p className="text-[11px] text-[var(--text-faint)]">{capabilities?.message ?? "Loading safe execution tools…"}</p>
          </div>
        ) : null}

        {activeTab === "terminal" ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]"><TerminalSquare className="h-4 w-4 text-[var(--accent)]" /><span>Safe validation terminal</span></div>
            <div className="grid gap-2 sm:grid-cols-3">{(["tests", "build", "typecheck", "lint", "diagnostics"] as ExecutionAction[]).map((entry) => <button key={entry} type="button" disabled={busy || Boolean(running) || !capabilities?.available || !availableActions.has(entry)} onClick={() => { setAction(entry); void run(entry); }} className="theme-button-neutral rounded-lg border px-3 py-2 text-left text-xs font-semibold disabled:opacity-50">{actionLabels[entry]}<span className="mt-0.5 block text-[10px] font-normal text-[var(--text-faint)]">Allowlisted only</span></button>)}</div>
            {executionError ? <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{executionError}</p> : null}
          </div>
        ) : null}

        {activeTab === "tests" ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-[var(--text-primary)]">Tests</p><p className="text-[11px] text-[var(--text-faint)]">Run the bounded project test command or a server test file.</p></div><button type="button" disabled={busy || Boolean(running) || !capabilities?.available} onClick={() => { setAction("tests"); void run("tests"); }} className="theme-workspace-action inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"><Play className="h-3.5 w-3.5" />Run all tests</button></div>
            {executions.filter((entry) => entry.action === "tests" || entry.action === "targeted-tests").length ? <div className="grid gap-1.5">{executions.filter((entry) => entry.action === "tests" || entry.action === "targeted-tests").map((record) => <ExecutionRow key={record.executionId} record={record} selected={current?.executionId === record.executionId} onSelect={() => setSelectedExecutionId(record.executionId)} onCancel={() => void onCancelExecution(record.executionId)} onRerun={() => rerun(record)} />)}</div> : <EmptyState text="No test runs yet." />}
          </div>
        ) : null}

        {activeTab === "problems" ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between"><p className="font-semibold text-[var(--text-primary)]">Problems</p><span className="text-[11px] text-[var(--text-faint)]">{diagnostics.length} diagnostic{diagnostics.length === 1 ? "" : "s"}</span></div>
            {diagnostics.length ? diagnostics.map((diagnostic, index) => <div key={`${diagnostic.fileId}-${diagnostic.startLine}-${diagnostic.startColumn}-${index}`} className="grid gap-2 rounded-lg border border-[var(--border)] px-3 py-2"><button type="button" onClick={() => onOpenDiagnostic(diagnostic)} className="text-left"><span className={`font-semibold ${diagnostic.severity === "error" ? "text-rose-300" : "text-amber-200"}`}>{diagnostic.severity.toUpperCase()}</span><span className="ml-2 text-[var(--text-secondary)]">{diagnostic.message}</span><span className="mt-0.5 block font-mono text-[10px] text-[var(--text-faint)]">{diagnostic.fileId ?? diagnostic.path ?? "current file"}:{diagnostic.startLine ?? 1}:{diagnostic.startColumn ?? 1}</span></button><button type="button" onClick={() => onDebugDiagnostic(diagnostic)} className="justify-self-start rounded border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Debug with AI</button></div>) : <EmptyState text="No current problems. Diagnostics from the active workspace appear here." />}
          </div>
        ) : null}

        {activeTab === "output" ? (
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2"><div><p className="font-semibold text-[var(--text-primary)]">Output</p><p className="text-[11px] text-[var(--text-faint)]">Execution output is bounded and treated as untrusted data.</p></div>{current ? <button type="button" onClick={() => rerun(current)} className="theme-button-neutral inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold"><RotateCcw className="h-3.5 w-3.5" />Rerun</button> : null}</div>
            {current ? <div className="grid gap-2"><div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]"><StatusIcon status={current.status} /><span>{actionLabels[current.action]}</span><span>·</span><span className={statusClass(current.status)}>{statusLabels[current.status]}</span>{current.exitCode !== null ? <span>· exit {current.exitCode}</span> : null}{current.durationMs !== null ? <span>· {current.durationMs}ms</span> : null}</div><pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-black/20 p-3 font-mono text-[11px] text-[var(--text-secondary)]">{current.output || current.errorSummary || "No output."}</pre>{current.command ? <p className="break-all font-mono text-[10px] text-[var(--text-faint)]">{prettyCommand(current.command)}</p> : null}</div> : <EmptyState text="Run a safe validation action to see output here." />}
          </div>
        ) : null}
      </div>
    </section>
  );
};

const EmptyState = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-[11px] text-[var(--text-faint)]">{text}</p>;

const ExecutionRow = ({ record, selected, onSelect, onCancel, onRerun }: { record: ExecutionRecord; selected: boolean; onSelect: () => void; onCancel: () => void; onRerun: () => void }) => (
  <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${selected ? "border-[var(--accent)]/50 bg-[var(--badge-bg)]" : "border-[var(--border)]"}`}>
    <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left"><StatusIcon status={record.status} /><span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">{actionLabels[record.action]}{record.target ? ` · ${record.target}` : ""}</span><span className={`ml-auto shrink-0 text-[10px] ${statusClass(record.status)}`}>{statusLabels[record.status]}</span></button>
    {record.status === "queued" || record.status === "running" ? <button type="button" onClick={onCancel} className="rounded p-1 text-rose-300" aria-label="Cancel execution" title="Cancel execution"><Square className="h-3 w-3" /></button> : <button type="button" onClick={onRerun} className="rounded p-1 text-[var(--text-muted)]" aria-label="Rerun execution" title="Rerun execution"><RotateCcw className="h-3 w-3" /></button>}
  </div>
);

const StatusIcon = ({ status }: { status: ExecutionStatus }) => status === "running" || status === "queued" ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" /> : status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : status === "failed" || status === "timed_out" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-300" /> : status === "unavailable" ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-300" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />;
