import { GitBranch, GitFork, GitPullRequest, LoaderCircle, RefreshCw, Upload, Download, Check, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { UserSession } from "../../types/collaboration";
import type { GitBranchSummary, GitHubConnectionStatus, GitHubRepositorySummary, RepositorySummary } from "../../types/git";

interface SourceControlPanelProps {
  roomId: string;
  session: UserSession;
  repository: RepositorySummary | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onNotify: (message: string) => void;
  onReviewDiff?: () => void;
}

const statusLabel = (count: number) => count === 1 ? "1 changed file" : `${count} changed files`;

export const SourceControlPanel = ({ roomId, session, repository, loading, error, onRefresh, onNotify, onReviewDiff }: SourceControlPanelProps) => {
  const metadata = repository?.repository;
  const changedFiles = repository?.status.entries ?? [];
  const [connection, setConnection] = useState<GitHubConnectionStatus | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [search, setSearch] = useState("");
  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [pendingCommit, setPendingCommit] = useState(false);
  const [busy, setBusy] = useState("");
  const [showDiff, setShowDiff] = useState(false);

  const loadConnection = useCallback(async () => {
    try { setConnection(await api.getGitHubStatus(roomId, session)); } catch (issue) { onNotify(issue instanceof Error ? issue.message : "GitHub status is unavailable"); }
  }, [onNotify, roomId, session]);
  const loadRepositories = useCallback(async (term = search) => {
    try { setRepositories(await api.listGitHubRepositories(roomId, session, term)); } catch (issue) { onNotify(issue instanceof Error ? issue.message : "Could not list GitHub repositories"); }
  }, [onNotify, roomId, search, session]);
  useEffect(() => { void loadConnection(); }, [loadConnection]);
  useEffect(() => {
    if (!connection?.connected || !metadata?.owner || !metadata.name) return;
    void api.listGitHubBranches(roomId, session, metadata.owner, metadata.name).then(setBranches).catch(() => undefined);
  }, [connection?.connected, metadata?.owner, metadata?.name, roomId, session]);
  useEffect(() => {
    if (metadata?.owner && metadata.name) {
      setSelectedRepo(`${metadata.owner}/${metadata.name}`);
      setSelectedBranch(metadata.currentBranch ?? metadata.defaultBranch ?? "");
    }
  }, [metadata?.owner, metadata?.name, metadata?.currentBranch, metadata?.defaultBranch]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try { await action(); } catch (issue) { onNotify(issue instanceof Error ? issue.message : `${label} failed`); } finally { setBusy(""); }
  };
  const connect = () => void run("connect", async () => { const next = await api.connectGitHub(roomId, session); setConnection(next); await loadRepositories(""); onNotify(`Connected to GitHub${next.accountLabel ? ` as ${next.accountLabel}` : ""}`); });
  const disconnect = () => void run("disconnect", async () => { await api.disconnectGitHub(roomId, session); setConnection((current) => current ? { ...current, connected: false, available: false, accountLabel: null } : current); onNotify("GitHub disconnected for this room session"); });
  const chooseRepository = (value: string) => { setSelectedRepo(value); const [owner, name] = value.split("/"); if (owner && name) void run("branches", async () => setBranches(await api.listGitHubBranches(roomId, session, owner, name))); };
  const importRepository = () => void run("import", async () => { const [owner, repositoryName] = selectedRepo.split("/"); if (!owner || !repositoryName) throw new Error("Choose a GitHub repository first"); const result = await api.importGitHubProject(roomId, session, { owner, repository: repositoryName, branch: selectedBranch || undefined }); await onRefresh(); setBranches(await api.listGitHubBranches(roomId, session, owner, repositoryName)); onNotify(`Imported ${result.project.name} into the shared workspace`); });
  const createBranch = () => void run("branch", async () => { const result = await api.createGitBranch(roomId, session, branchName); setBranches((current) => [...current, result.branch]); setBranchName(""); onNotify(`Created branch ${result.branch.name}`); });
  const switchBranch = () => void run("switch", async () => { if (!selectedBranch || selectedBranch === metadata?.currentBranch) return; if (!window.confirm(`Switch to ${selectedBranch}? Any unstaged changes must already be resolved.`)) return; await api.switchGitBranch(roomId, session, selectedBranch); await onRefresh(); onNotify(`Switched to ${selectedBranch}`); });
  const stage = (path: string, staged: boolean) => void run("stage", async () => { await api.stageGitFile(roomId, session, path, staged); await onRefresh(); });
  const planCommit = () => void run("commit", async () => { await api.planGitCommit(roomId, session, commitMessage); setPendingCommit(true); onNotify("Commit prepared. Push remains a separate explicit action."); });
  const push = () => void run("push", async () => { if (!window.confirm("Push this prepared commit to GitHub?")) return; const result = await api.pushGitCommit(roomId, session); setPendingCommit(false); setCommitMessage(""); await onRefresh(); onNotify(`Pushed commit ${result.commit.sha.slice(0, 8)}`); });
  const pull = () => void run("pull", async () => { const result = await api.pullGitBranch(roomId, session); await onRefresh(); onNotify(result.state === "synchronized" ? "Already synchronized with GitHub" : "Pulled the remote branch into the workspace"); });
  const createPr = () => void run("pull request", async () => { if (!window.confirm("Create this pull request on GitHub?")) return; const result = await api.createPullRequest(roomId, session, { title: prTitle, body: prBody }); onNotify(`Pull request #${result.pullRequest.number} created`); setPrTitle(""); setPrBody(""); });

  return <section className="shrink-0 border-t border-[var(--border)] px-3 pt-3 pb-3">
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]"><GitBranch className="h-3.5 w-3.5" /> Source control</div>
    {loading ? <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]"><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Checking workspace status…</div> : null}
    {!loading && error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    {!loading && !error && !metadata ? <div className="mt-2 grid gap-2 text-xs text-[var(--text-muted)]"><p>{repository?.message ?? "No repository is connected to this workspace."}</p>{connection?.configured ? <><button type="button" onClick={connection.connected ? () => void loadRepositories() : connect} disabled={Boolean(busy)} className="theme-button-primary rounded-md px-2 py-1.5 text-xs">{connection.connected ? "Refresh repositories" : "Connect GitHub"}</button>{connection.connected ? <><div className="flex gap-1"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter repositories" className="theme-input min-w-0 flex-1 rounded border px-2 py-1" /><button type="button" onClick={() => void loadRepositories()} className="rounded border px-2 py-1" aria-label="Search GitHub repositories">Search</button></div><select value={selectedRepo} onChange={(event) => chooseRepository(event.target.value)} className="theme-input rounded border px-2 py-1"><option value="">Select repository</option>{repositories.map((repo) => <option key={repo.fullName} value={repo.fullName}>{repo.fullName}</option>)}</select>{branches.length ? <select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} className="theme-input rounded border px-2 py-1"><option value="">Select branch</option>{branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select> : null}<button type="button" onClick={importRepository} disabled={!selectedRepo || Boolean(busy)} className="theme-button-primary rounded-md px-2 py-1.5 text-xs">{busy === "import" ? "Importing…" : "Import project"}</button></> : null}</> : <p className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-amber-100">GitHub integration is not configured on this server.</p>}</div> : null}
    {!loading && !error && metadata ? <div className="mt-2 grid gap-2 text-xs">
      <div className="rounded-md border border-[var(--border)] bg-[var(--badge-bg)] px-2.5 py-2"><div className="flex min-w-0 items-center justify-between gap-2"><span className="truncate font-medium text-[var(--text-primary)]">{metadata.owner ? `${metadata.owner}/` : ""}{metadata.name}</span><span className="shrink-0 text-[var(--text-faint)]">{metadata.provider}</span></div><div className="mt-1 flex items-center gap-1.5 text-[var(--text-muted)]"><GitFork className="h-3 w-3" />{metadata.currentBranch ?? "No branch selected"}</div><p className="mt-1.5 text-[var(--text-secondary)]">{repository?.status.state === "changes" ? statusLabel(changedFiles.length) : repository?.message ?? "Working tree is clean."}</p></div>
      <div className="flex gap-1"><button type="button" onClick={() => void onRefresh()} className="flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1.5 text-[var(--text-muted)] hover:bg-[var(--badge-bg)]"><RefreshCw className="h-3 w-3" />Refresh</button>{connection?.connected ? <button type="button" onClick={disconnect} className="rounded border px-2 py-1.5 text-[var(--text-muted)]">Disconnect</button> : <button type="button" onClick={connect} className="theme-button-primary rounded px-2 py-1.5">Connect GitHub</button>}</div>
      {connection?.connected ? <><div className="flex gap-1"><select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} className="theme-input min-w-0 flex-1 rounded border px-2 py-1.5"><option value={metadata.currentBranch ?? ""}>{metadata.currentBranch ?? "Current branch"}</option>{branches.filter((branch) => branch.name !== metadata.currentBranch).map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select><button type="button" onClick={switchBranch} disabled={!selectedBranch || selectedBranch === metadata.currentBranch || Boolean(busy)} className="rounded border px-2 py-1.5">Switch</button></div><div className="flex gap-1"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="new branch" className="theme-input min-w-0 flex-1 rounded border px-2 py-1.5" /><button type="button" onClick={createBranch} disabled={!branchName || Boolean(busy)} className="rounded border px-2 py-1.5" title="Create branch"><Plus className="h-3.5 w-3.5" /></button></div></> : <p className="text-[11px] text-amber-200">Connect GitHub to run branch and sync actions.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-[var(--text-secondary)]">Changes</span><div className="flex items-center gap-2"><button type="button" onClick={() => setShowDiff((value) => !value)} className="text-[11px] text-[var(--accent)]">{showDiff ? "Hide diff" : "View diff"}</button>{onReviewDiff && changedFiles.length ? <button type="button" onClick={onReviewDiff} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Review with AI</button> : null}</div></div>
      {changedFiles.length ? <div className="grid gap-1">{changedFiles.map((entry) => <div key={entry.path} className="flex items-center gap-2 rounded border border-[var(--border)] px-2 py-1.5"><button type="button" onClick={() => stage(entry.path, !entry.staged)} disabled={entry.status === "ignored" || Boolean(busy)} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${entry.staged ? "bg-[var(--accent)] text-black" : "text-transparent"}`} title={entry.staged ? "Unstage" : "Stage"}><Check className="h-3 w-3" /></button><span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={entry.path}>{entry.path}</span><span className="shrink-0 font-mono text-[10px] text-[var(--text-faint)]">{entry.status}</span></div>)}</div> : <p className="text-[11px] text-[var(--text-muted)]">No working-tree changes.</p>}
      {showDiff && repository?.diff?.length ? <div className="max-h-56 overflow-auto rounded border border-[var(--border)] bg-black/10">{repository.diff.map((file) => <details key={file.path} className="border-b border-[var(--border)] p-2 last:border-b-0"><summary className="cursor-pointer text-[11px] text-[var(--text-secondary)]">{file.path} <span className="text-emerald-300">+{file.additions}</span> <span className="text-rose-300">-{file.deletions}</span></summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">{file.after || "[deleted]"}</pre></details>)}</div> : null}
      <div className="grid gap-1 rounded border border-[var(--border)] p-2"><p className="font-semibold text-[var(--text-secondary)]">Commit &amp; sync</p><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" className="theme-input rounded border px-2 py-1.5" /><div className="flex gap-1"><button type="button" onClick={planCommit} disabled={!commitMessage || Boolean(busy)} className="theme-button-primary flex-1 rounded px-2 py-1.5">{busy === "commit" ? "Preparing…" : "Prepare commit"}</button><button type="button" onClick={push} disabled={!pendingCommit || Boolean(busy)} className="flex items-center gap-1 rounded border px-2 py-1.5"><Upload className="h-3 w-3" />Push</button></div><button type="button" onClick={pull} disabled={Boolean(busy) || !connection?.connected} className="flex items-center justify-center gap-1 rounded border px-2 py-1.5"><Download className="h-3 w-3" />Pull / sync</button></div>
      <details className="rounded border border-[var(--border)] p-2"><summary className="cursor-pointer font-semibold text-[var(--text-secondary)]"><GitPullRequest className="mr-1 inline h-3.5 w-3.5" />Pull request</summary><div className="mt-2 grid gap-1"><input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder="PR title" className="theme-input rounded border px-2 py-1.5" /><textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} placeholder="Describe the change" rows={3} className="theme-input resize-none rounded border px-2 py-1.5" /><button type="button" onClick={createPr} disabled={!prTitle || Boolean(busy) || !connection?.connected} className="theme-button-primary rounded px-2 py-1.5">Create pull request</button></div></details>
    </div> : null}
  </section>;
};
