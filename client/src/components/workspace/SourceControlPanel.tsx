import { GitBranch, GitFork, LoaderCircle } from "lucide-react";
import type { RepositorySummary } from "../../types/git";

interface SourceControlPanelProps {
  repository: RepositorySummary | null;
  loading: boolean;
  error: string | null;
}

const statusLabel = (count: number) => count === 1 ? "1 changed file" : `${count} changed files`;

export const SourceControlPanel = ({ repository, loading, error }: SourceControlPanelProps) => {
  const metadata = repository?.repository;
  const changedFiles = repository?.status.entries ?? [];

  return <section className="shrink-0 border-t border-[var(--border)] px-3 pt-3">
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">
      <GitBranch className="h-3.5 w-3.5" /> Source control
    </div>
    {loading ? <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]"><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Checking workspace?</div> : null}
    {!loading && error ? <p className="mt-2 text-xs text-rose-300">Source control is unavailable.</p> : null}
    {!loading && !error && metadata ? <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--badge-bg)] px-2.5 py-2 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-2"><span className="truncate font-medium text-[var(--text-primary)]">{metadata.name}</span><span className="shrink-0 text-[var(--text-faint)]">{metadata.provider}</span></div>
      <div className="mt-1 flex items-center gap-1.5 text-[var(--text-muted)]"><GitFork className="h-3 w-3" />{metadata.currentBranch ?? "No branch selected"}</div>
      <p className="mt-1.5 text-[var(--text-secondary)]">{repository.status.state === "changes" ? statusLabel(changedFiles.length) : repository.message ?? "Working tree is clean."}</p>
    </div> : null}
    {!loading && !error && !metadata ? <p className="mt-2 pb-1 text-xs leading-5 text-[var(--text-muted)]">Local workspace. Repository import and provider actions are ready to be connected.</p> : null}
  </section>;
};
