import { AlertCircle, Check, CheckCircle2, ChevronDown, CircleDashed, ClipboardCopy, Download, ExternalLink, Play, TerminalSquare, PanelBottomClose, PanelBottomOpen } from "lucide-react";
import { useState } from "react";
import type { SupportedLanguage } from "../../types/collaboration";

export type WorkspacePanelTab = "run" | "output" | "terminal" | "problems";

interface WorkspaceOutputPanelProps {
  open: boolean;
  onToggle: () => void;
  activeFileName: string;
  code: string;
  language: SupportedLanguage;
  activeTab: WorkspacePanelTab;
  onActiveTabChange: (tab: WorkspacePanelTab) => void;
  onChangeLanguage: (language: SupportedLanguage) => void;
  onRun: () => Promise<boolean>;
  onCopy: () => Promise<boolean>;
  onDownload: () => boolean;
}

type RunnerState = "ready" | "opening" | "opened" | "failed";

const languageLabel: Record<SupportedLanguage, string> = { javascript: "JavaScript", python: "Python", cpp: "C++ (g++)" };

export const WorkspaceOutputPanel = ({ open, onToggle, activeFileName, code, language, activeTab, onActiveTabChange, onChangeLanguage, onRun, onCopy, onDownload }: WorkspaceOutputPanelProps) => {
  const [inputMode, setInputMode] = useState("custom");
  const [customInput, setCustomInput] = useState("");
  const [runnerState, setRunnerState] = useState<RunnerState>("ready");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "downloaded">("idle");

  const run = async () => {
    setRunnerState("opening");
    setElapsedMs(null);
    const startedAt = performance.now();
    const opened = await onRun();
    setElapsedMs(Math.round(performance.now() - startedAt));
    setRunnerState(opened ? "opened" : "failed");
    if (opened) onActiveTabChange("output");
  };

  const copy = async () => {
    const copied = await onCopy();
    setCopyFeedback(copied ? "copied" : "idle");
    if (copied) window.setTimeout(() => setCopyFeedback("idle"), 1_500);
  };

  const download = () => {
    if (!onDownload()) return;
    setCopyFeedback("downloaded");
    window.setTimeout(() => setCopyFeedback("idle"), 1_500);
  };

  const stateLabel = runnerState === "opening" ? "Opening external runner" : runnerState === "opened" ? "External runner opened" : runnerState === "failed" ? "Unable to open external runner" : "Ready";
  const StateIcon = runnerState === "opened" ? CheckCircle2 : runnerState === "failed" ? AlertCircle : runnerState === "opening" ? CircleDashed : TerminalSquare;

  return (
    <section className={`theme-panel-solid mt-2 flex shrink-0 flex-col overflow-hidden rounded-xl border shadow-[var(--shadow-soft)] sm:mt-3 ${open ? "h-[min(18rem,38vh)]" : "h-11"}`} aria-label="Workspace execution panel">
      <div className="flex min-h-0 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Workspace panel views">
          {(["run", "output", "terminal", "problems"] as WorkspacePanelTab[]).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => { onActiveTabChange(tab); if (!open) onToggle(); }} className={`shrink-0 border-b-2 px-2.5 py-2 text-xs font-medium uppercase tracking-wide transition ${activeTab === tab ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
              {tab}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-40 truncate text-[11px] text-[var(--text-faint)] sm:block">{activeFileName}</span>
          <button type="button" onClick={onToggle} className="ui-focus-ring rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--badge-bg)] hover:text-[var(--text-primary)]" aria-expanded={open} aria-label={open ? "Collapse output panel" : "Expand output panel"} title={open ? "Collapse output panel" : "Expand output panel"}>
            {open ? <PanelBottomClose className="h-4 w-4" /> : <PanelBottomOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className={`${open ? "min-h-0 flex-1 overflow-auto px-3 py-3 text-xs leading-5" : "hidden"}`}>
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
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void copy()} className="theme-button-neutral inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"><span className="inline-flex items-center gap-1.5">{copyFeedback === "copied" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <ClipboardCopy className="h-3.5 w-3.5" />}{copyFeedback === "copied" ? "Copied" : "Copy code"}</span></button>
              <button type="button" onClick={download} className="theme-button-neutral inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"><Download className="h-3.5 w-3.5" />{copyFeedback === "downloaded" ? "Downloaded" : "Download file"}</button>
              <span className="text-[11px] text-[var(--text-faint)]">{activeFileName} · {code.length.toLocaleString()} characters</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--badge-bg)] px-3 py-2">
              <span className={`inline-flex items-center gap-1.5 font-medium ${runnerState === "failed" ? "text-rose-300" : runnerState === "opened" ? "text-emerald-300" : "text-[var(--text-secondary)]"}`}><StateIcon className={`h-4 w-4 ${runnerState === "opening" ? "animate-spin" : ""}`} />{stateLabel}</span>
              <span className="text-[11px] text-[var(--text-muted)]">{elapsedMs === null ? "Execution time: —" : `Open time: ${elapsedMs} ms`} · Exit code: —</span>
            </div>
            <p className="text-[11px] text-[var(--text-faint)]">Run copies the active file and opens the configured external compiler. The browser cannot read that site's stdout, stderr, timing, or exit code, so no internal execution success is claimed.</p>
          </div>
        ) : activeTab === "output" ? (
          <div className="space-y-2 font-mono text-xs text-[var(--text-muted)]"><p className="flex items-center gap-2 font-sans text-[var(--text-secondary)]"><ExternalLink className="h-4 w-4 text-[var(--accent)]" /> Execution output</p>{runnerState === "opened" ? <p>Code was copied and the external runner was opened. Its stdout, stderr, timing, and exit code remain on that external site.</p> : runnerState === "failed" ? <p className="text-rose-300">Runner unavailable: the code could not be copied or the external runner was blocked. Retry after allowing clipboard/pop-up access.</p> : <p>No execution output is available because this project does not run user code inside the backend or browser.</p>}</div>
        ) : activeTab === "terminal" ? (
          <div className="space-y-1.5 font-mono text-xs text-[var(--text-muted)]"><p className="flex items-center gap-2 font-sans text-[var(--text-secondary)]"><TerminalSquare className="h-4 w-4 text-[var(--accent)]" /> Workspace terminal</p><p><span className="text-emerald-400">›</span> Ready to run <span className="text-[var(--text-primary)]">{activeFileName}</span> as {languageLabel[language]}.</p><p className="text-[var(--text-faint)]">No shell command runs inside the browser.</p></div>
        ) : (
          <div className="flex items-start gap-2 text-[var(--text-muted)]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" /><p>No workspace problems are currently reported. Monaco editor diagnostics remain available in the editor.</p></div>
        )}
      </div>
    </section>
  );
};
