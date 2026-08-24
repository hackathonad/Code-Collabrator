import { Activity, ArrowRight, Bot, FolderCode, Github, LogOut, Plus, RefreshCw, Settings, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useAuth } from "../context/AuthContext";
import { api, type AnalyticsDashboardResponse } from "../lib/api";

interface RecentRoomRow { room_id: string; label: string | null; last_visited_at: string; rooms?: { language?: string } | null; }
type Range = "7d" | "30d" | "90d" | "all";
const number = new Intl.NumberFormat();
const eventLabels: Record<string, string> = {
  room_created: "Created a room", room_joined: "Joined a collaboration", workspace_opened: "Opened a workspace",
  file_created: "Created a file", file_deleted: "Deleted a file", execution_completed: "Completed an execution",
  execution_failed: "Execution failed", ai_request_completed: "AI request completed", ai_request_failed: "AI request failed",
  git_commit: "Created a Git commit", git_push: "Pushed Git changes", git_pull: "Pulled Git changes",
  github_repository_imported: "Imported a GitHub repository", media_call_joined: "Joined a call",
  media_call_left: "Left a call", screen_share_started: "Started screen sharing", screen_share_stopped: "Stopped screen sharing"
};
const relativeTime = (value: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return "Just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr ago`;
  return new Date(value).toLocaleDateString();
};

const Stat = ({ label, value }: { label: string; value: number }) => <div className="theme-surface rounded-xl border p-4"><p className="text-xs uppercase tracking-[0.14em] theme-text-faint">{label}</p><p className="mt-2 font-display text-3xl theme-text-primary">{number.format(value)}</p></div>;
const Distribution = ({ title, items, empty }: { title: string; items: Array<{ name: string; count: number }>; empty: string }) => {
  const max = Math.max(...items.map((item) => item.count), 1);
  return <section className="theme-panel rounded-2xl border p-5"><h2 className="font-display text-xl theme-text-primary">{title}</h2>{items.length ? <ul className="mt-4 space-y-3" aria-label={`${title} distribution`}>{items.slice(0, 5).map((item) => <li key={item.name}><div className="flex justify-between gap-3 text-sm"><span className="capitalize theme-text-primary">{item.name}</span><span className="theme-text-muted">{number.format(item.count)}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--badge-bg)]" aria-hidden="true"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(item.count / max) * 100}%` }} /></div></li>)}</ul> : <p className="mt-4 text-sm theme-text-muted">{empty}</p>}</section>;
};

export const DashboardPage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RecentRoomRow[]>([]);
  const [dashboard, setDashboard] = useState<AnalyticsDashboardResponse | null>(null);
  const [range, setRange] = useState<Range>("30d");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextRange: Range, includeRooms = false) => {
    setError("");
    try {
      const requests: [Promise<{ ok: true; dashboard: AnalyticsDashboardResponse }>, Promise<{ ok: true; rooms: unknown[] }> | undefined] = [api.getAnalyticsDashboard(nextRange), includeRooms ? api.listRecentRooms() : undefined];
      const [analytics, recent] = await Promise.all([requests[0], requests[1]]);
      setDashboard(analytics.dashboard);
      if (recent) setRooms(recent.rooms as RecentRoomRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Analytics could not be refreshed.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { setLoading(true); void load(range, true); }, [load, range]);
  const trendMax = useMemo(() => Math.max(...(dashboard?.dailyActivity.map((item) => item.count) ?? []), 1), [dashboard]);
  const refresh = () => { setRefreshing(true); void load(range, true); };
  const signOutAndReturnHome = async () => {
    try {
      await signOut();
      navigate("/", { replace: true });
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Unable to sign out. Please try again.");
    }
  };
  const overview = dashboard?.overview;

  return <main className="theme-page-home min-h-screen px-4 py-6"><div className="mx-auto grid max-w-6xl gap-6">
    <nav className="theme-panel-solid flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4"><div className="flex items-center gap-3"><AppLogo size={34} /><div><p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Workspace analytics</p><h1 className="font-display text-2xl theme-text-primary">Welcome back, {user?.displayName ?? "member"}</h1></div></div><div className="flex items-center gap-2"><ThemeToggle /><Link className="theme-button-neutral rounded-lg border px-3 py-2 text-sm" to="/profile"><UserRound className="mr-1 inline h-4 w-4" />Profile</Link><Link className="theme-button-neutral rounded-lg border px-3 py-2 text-sm" to="/settings"><Settings className="mr-1 inline h-4 w-4" />Settings</Link><button type="button" onClick={() => { void signOutAndReturnHome(); }} className="theme-button-neutral rounded-lg border px-3 py-2 text-sm"><LogOut className="mr-1 inline h-4 w-4" />Log out</button></div></nav>

    <section className="grid gap-4 md:grid-cols-3"><button type="button" onClick={() => navigate("/")} className="theme-panel rounded-2xl border p-5 text-left"><Plus className="h-5 w-5 text-[var(--accent)]" /><h2 className="mt-4 font-display text-xl">Create room</h2><p className="mt-1 text-sm theme-text-muted">Start a collaborative workspace.</p></button><Link to="/settings" className="theme-panel rounded-2xl border p-5"><Github className="h-5 w-5 text-[var(--accent)]" /><h2 className="mt-4 font-display text-xl">Connect GitHub</h2><p className="mt-1 text-sm theme-text-muted">Manage repository access securely.</p></Link><Link to="/" className="theme-panel rounded-2xl border p-5"><FolderCode className="h-5 w-5 text-[var(--accent)]" /><h2 className="mt-4 font-display text-xl">Join a room</h2><p className="mt-1 text-sm theme-text-muted">Open a shared workspace with its room ID.</p></Link></section>

    <section className="theme-panel rounded-2xl border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Your activity</p><h2 className="mt-1 font-display text-2xl theme-text-primary">Developer insights</h2></div><div className="flex items-center gap-2"><label className="sr-only" htmlFor="analytics-range">Analytics range</label><select id="analytics-range" value={range} onChange={(event) => setRange(event.target.value as Range)} className="theme-button-neutral rounded-lg border px-3 py-2 text-sm" disabled={refreshing}>{[["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={refresh} className="theme-button-neutral rounded-lg border p-2" aria-label="Refresh analytics" title="Refresh analytics" disabled={refreshing}><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></button></div></div>
      <p className="mt-2 text-xs theme-text-muted">Analytics records activity metadata only—never source code, chat messages, AI prompts, audio, video, or credentials.</p>
      {error ? <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"><span>{dashboard ? "Showing the last available analytics. " : ""}{error}</span><button type="button" onClick={refresh} className="underline" disabled={refreshing}>Retry</button></div> : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading}>{[ ["Rooms created", overview?.roomsCreated], ["Rooms joined", overview?.roomsJoined], ["Active workspaces", overview?.activeWorkspaces], ["Executions", overview?.executions], ["AI requests", overview?.aiRequests], ["Git actions", overview?.gitActions], ["Collaboration sessions", overview?.collaborationSessions] ].map(([label, value]) => <Stat key={String(label)} label={String(label)} value={typeof value === "number" ? value : 0} />)}</div>
    </section>

    <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]"><div className="theme-panel rounded-2xl border p-5"><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-[var(--accent)]" /><h2 className="font-display text-xl theme-text-primary">Activity trend</h2></div>{dashboard?.dailyActivity.length ? <><div className="mt-5 flex h-36 items-end gap-1" role="img" aria-label={`${dashboard.dailyActivity.reduce((total, day) => total + day.count, 0)} recorded activity events across the selected range`}>{dashboard.dailyActivity.map((day) => <div key={day.date} className="flex min-w-0 flex-1 flex-col justify-end" title={`${new Date(`${day.date}T00:00:00`).toLocaleDateString()}: ${day.count} events`}><div className="min-h-1 rounded-t bg-[var(--accent)]" style={{ height: `${Math.max(4, (day.count / trendMax) * 100)}%` }} /></div>)}</div><p className="mt-3 text-xs theme-text-muted">{dashboard.dailyActivity.length} active day{dashboard.dailyActivity.length === 1 ? "" : "s"} in this range. Bars represent recorded product events, not coding hours.</p></> : <p className="mt-5 text-sm theme-text-muted">No activity yet. Create or join a room to start building your history.</p>}</div>
      <div className="theme-panel rounded-2xl border p-5"><div className="flex items-center gap-2"><Bot className="h-5 w-5 text-[var(--accent)]" /><h2 className="font-display text-xl theme-text-primary">AI & execution</h2></div><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="theme-text-muted">AI completion rate</dt><dd>{dashboard?.ai.requests ? `${Math.round((dashboard.ai.successful / dashboard.ai.requests) * 100)}%` : "No AI activity"}</dd></div><div className="flex justify-between gap-3"><dt className="theme-text-muted">Execution success rate</dt><dd>{dashboard?.execution.total ? `${dashboard.execution.successRate}%` : "No execution data"}</dd></div><div className="flex justify-between gap-3"><dt className="theme-text-muted">Calls joined</dt><dd>{number.format(dashboard?.collaboration.mediaCalls ?? 0)}</dd></div><div className="flex justify-between gap-3"><dt className="theme-text-muted">Screen shares</dt><dd>{number.format(dashboard?.collaboration.screenShares ?? 0)}</dd></div></dl></div></section>

    <section className="grid gap-4 md:grid-cols-2"><Distribution title="Workspace language distribution" items={dashboard?.languages ?? []} empty="Language activity appears as you work in rooms." /><Distribution title="AI actions" items={dashboard?.ai.actions ?? []} empty="Try the AI Assistant in a workspace to see actions here." /></section>

    <section className="grid gap-4 lg:grid-cols-2"><section className="theme-panel rounded-2xl border p-5"><div><p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Recent rooms</p><h2 className="mt-1 font-display text-2xl">Continue working</h2></div><div className="mt-5 grid gap-3">{loading && !rooms.length ? <p className="text-sm theme-text-muted">Loading recent rooms…</p> : rooms.length ? rooms.slice(0, 5).map((room) => <button type="button" key={room.room_id} onClick={() => navigate(`/room/${room.room_id}`)} className="theme-surface flex items-center justify-between rounded-xl border px-4 py-3 text-left"><span><strong className="block">{room.label || `Room ${room.room_id}`}</strong><span className="text-xs theme-text-muted">{room.rooms?.language ?? "Workspace"} · last opened {new Date(room.last_visited_at).toLocaleDateString()}</span></span><ArrowRight className="h-4 w-4" /></button>) : <div className="theme-surface-muted rounded-xl border border-dashed p-5 text-sm theme-text-muted">No saved rooms yet. Create or join a room to see it here.</div>}</div></section>
      <section className="theme-panel rounded-2xl border p-5"><div><p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Activity feed</p><h2 className="mt-1 font-display text-2xl">Recent activity</h2></div><ol className="mt-5 space-y-3">{dashboard?.recentActivity.length ? dashboard.recentActivity.map((activity, index) => <li key={`${activity.createdAt}-${index}`} className="theme-surface rounded-xl border px-4 py-3"><p className="text-sm theme-text-primary">{eventLabels[activity.type] ?? "Workspace activity"}{activity.language ? ` · ${activity.language}` : ""}</p><p className="mt-1 text-xs theme-text-muted">{relativeTime(activity.createdAt)}</p></li>) : <li className="theme-surface-muted rounded-xl border border-dashed p-5 text-sm theme-text-muted">No activity has been recorded yet.</li>}</ol></section></section>
  </div></main>;
};
