import { AlertCircle, CheckCircle2, ChevronDown, CircleDashed, ExternalLink, Play, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { SupportedLanguage } from "../../types/collaboration";

export type WorkspacePanelTab = "run" | "output" | "terminal" | "problems";

interface WorkspaceOutputPanelProps {
  activeFileName: string;
  language: SupportedLanguage;
  activeTab: WorkspacePanelTab;
  onActiveTabChange: (tab: WorkspacePanelTab) => void;
  onChangeLanguage: (language: SupportedLanguage) => void;
  onRun: () => Promise<boolean>;
}

type RunnerState = "ready" | "opening" | "opened" | "failed";

const languageLabel: Record<SupportedLanguage, string> = { javascript: "JavaScript", python: "Python", cpp: "C++ (g++)" };

export const WorkspaceOutputPanel = ({ activeFileName, language, activeTab, onActiveTabChange, onChangeLanguage, onRun }: WorkspaceOutputPanelProps) => {
  const [inputMode, setInputMode] = useState("custom");
  const [customInput, setCustomInput] = useState("");
  const [runnerState, setRunnerState] = useState<RunnerState>("ready");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const run = async () => {
    setRunnerState("opening");
    setElapsedMs(null);
    const startedAt = performance.now();
    const opened = await onRun();
    setElapsedMs(Math.round(performance.now() - startedAt));
    setRunnerState(opened ? "opened" : "failed");
    if (opened) onActiveTabChange("output");
  };

  const stateLabel = runnerState === "opening" ? "Opening external runner" : runnerState === "opened" ? "External runner opened" : runnerState === "failed" ? "Unable to open external runner" : "Ready";
  const StateIcon = runnerState === "opened" ? CheckCircle2 : runnerState === "failed" ? AlertCircle : runnerState === "opening" ? CircleDashed : TerminalSquare;

  return (
    <section className="theme-panel-solid mt-2 flex h-[min(18rem,38vh)] shrink-0 flex-col overflow-hidden rounded-xl border shadow-[var(--shadow-soft)] sm:mt-3" aria-label="Workspace execution panel">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Workspace panel views">
          {(["run", "output", "terminal", "problems"] as WorkspacePanelTab[]).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => onActiveTabChange(tab)} className={`shrink-0 border-b-2 px-2.5 py-2 text-xs font-medium uppercase tracking-wide transition ${activeTab === tab ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
              {tab}
            </button>
          ))}
        </div>
        <span className="hidden truncate text-[11px] text-[var(--text-faint)] sm:block">{activeFileName}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-xs leading-5">
        {activeTab === "run" ? (
          <div className="grid gap-3">
            <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-[minmax(9rem,0.8fr)_minmax(10rem,1fr)_minmax(12rem,1.25fr)_auto] 2xl:items-end">
              <label className="grid min-w-0 gap-1 text-[11px] font-medium text-[var(--text-muted)]">Language
                <select value={language} onChange={(event) => onChangeLanguage(event.target.value as SupportedLanguage)} className="theme-input rounded-lg border px-2.5 py-2 text-xs text-[var(--text-primary)]">
                  {Object.entries(languageLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-[11px] font-medium text-[var(--text-muted)]">Input
                <span className="relative"><select value={inputMode} onChange={(event) => setInputMode(event.target.value)} className="theme-input w-full appearance-none rounded-lg border px-2.5 py-2 pr-8 text-xs text-[var(--text-primary)]"><option value="custom">Custom input</option></select><ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-muted)]" /></span>
              </label>
              <label className="grid min-w-0 gap-1 text-[11px] font-medium text-[var(--text-muted)]">Custom input
                <input value={customInput} onChange={(event) => setCustomInput(event.target.value)} disabled={inputMode !== "custom"} placeholder="Reserved for server execution" className="theme-input rounded-lg border px-2.5 py-2 text-xs text-[var(--text-primary)] disabled:opacity-50" />
              </label>
              <button type="button" onClick={() => void run()} disabled={runnerState === "opening"} className="theme-workspace-action inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"><Play className="h-3.5 w-3.5" />{runnerState === "opening" ? "Opening…" : "Run"}</button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--badge-bg)] px-3 py-2">
              <span className={`inline-flex items-center gap-1.5 font-medium ${runnerState === "failed" ? "text-rose-300" : runnerState === "opened" ? "text-emerald-300" : "text-[var(--text-secondary)]"}`}><StateIcon className={`h-4 w-4 ${runnerState === "opening" ? "animate-spin" : ""}`} />{stateLabel}</span>
              <span className="text-[11px] text-[var(--text-muted)]">{elapsedMs === null ? "Execution time: —" : `Open time: ${elapsedMs} ms`} · Exit code: —</span>
            </div>
            <p className="text-[11px] text-[var(--text-faint)]">The current runner copies the active file and opens the configured external compiler. Custom input, stdout, stderr, duration, and exit code are reserved for the upcoming server-side executor and are not fabricated here.</p>
          </div>
        ) : activeTab === "output" ? (
          <div className="space-y-2 font-mono text-xs text-[var(--text-muted)]"><p className="flex items-center gap-2 font-sans text-[var(--text-secondary)]"><ExternalLink className="h-4 w-4 text-[var(--accent)]" /> Execution output</p>{runnerState === "opened" ? <p>Code was copied and the external runner was opened. Its stdout, stderr, timing, and exit code are not available to this browser panel yet.</p> : runnerState === "failed" ? <p className="text-rose-300">The external runner could not be opened. Check the browser's popup settings and try again.</p> : <p>No execution output is available until an in-app server-side executor is added.</p>}</div>
        ) : activeTab === "terminal" ? (
          <div className="space-y-1.5 font-mono text-xs text-[var(--text-muted)]"><p className="flex items-center gap-2 font-sans text-[var(--text-secondary)]"><TerminalSquare className="h-4 w-4 text-[var(--accent)]" /> Workspace terminal</p><p><span className="text-emerald-400">›</span> Ready to run <span className="text-[var(--text-primary)]">{activeFileName}</span> as {languageLabel[language]}.</p><p className="text-[var(--text-faint)]">No shell command runs inside the browser.</p></div>
        ) : (
          <div className="flex items-start gap-2 text-[var(--text-muted)]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" /><p>No workspace problems are currently reported. Monaco editor diagnostics remain available in the editor.</p></div>
        )}
      </div>
    </section>
  );
};
