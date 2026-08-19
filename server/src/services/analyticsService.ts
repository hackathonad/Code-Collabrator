import { supabaseAdmin } from "../lib/supabase";
import type { SupportedLanguage } from "../constants/languages";

/** Metadata-only analytics. Never add code, prompts, chat, media, tokens or credentials. */
export const analyticsEventTypes = [
  "room_created", "room_joined", "room_left", "workspace_opened", "file_created", "file_deleted",
  "execution_started", "execution_completed", "execution_failed", "ai_request", "ai_request_completed",
  "ai_request_failed", "git_commit", "git_push", "git_pull", "github_repository_imported",
  "media_call_joined", "media_call_left", "screen_share_started", "screen_share_stopped"
] as const;

export type AnalyticsEventType = typeof analyticsEventTypes[number];
export type AnalyticsRange = "7d" | "30d" | "90d" | "all";
export interface AnalyticsMetadata { language?: SupportedLanguage; provider?: string; model?: string; action?: string; success?: boolean; durationMs?: number; streaming?: boolean; }
export interface AnalyticsEvent { type: AnalyticsEventType; userId?: string; roomId?: string; workspaceId?: string; metadata?: AnalyticsMetadata; }
interface AnalyticsRow { event_type: AnalyticsEventType; room_id: string | null; workspace_id: string | null; metadata: Record<string, unknown> | null; created_at: string; }
export interface AnalyticsDashboard {
  range: AnalyticsRange;
  overview: { roomsCreated: number; roomsJoined: number; activeWorkspaces: number; executions: number; aiRequests: number; gitActions: number; collaborationSessions: number };
  dailyActivity: Array<{ date: string; count: number }>;
  languages: Array<{ name: string; count: number }>;
  ai: { requests: number; successful: number; providers: Array<{ name: string; count: number }>; actions: Array<{ name: string; count: number }> };
  execution: { total: number; successful: number; failed: number; successRate: number };
  git: { total: number; commits: number; pushes: number; pulls: number; repositoryImports: number };
  collaboration: { rooms: number; sessions: number; mediaCalls: number; screenShares: number };
  recentActivity: Array<{ type: AnalyticsEventType; createdAt: string; roomId: string | null; workspaceId: string | null; language?: string }>;
}

const ranges: Record<AnalyticsRange, number> = { "7d": 7, "30d": 30, "90d": 90, all: 3650 };
const validLanguages = new Set<SupportedLanguage>(["javascript", "python", "cpp"]);
const safeText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;
const increment = (bucket: Map<string, number>, key: string | undefined) => { if (key) bucket.set(key, (bucket.get(key) ?? 0) + 1); };
const entries = (bucket: Map<string, number>) => [...bucket.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
const isEventType = (value: unknown): value is AnalyticsEventType => typeof value === "string" && (analyticsEventTypes as readonly string[]).includes(value);

/** Exported for tests; the returned object contains only the defined allow-list. */
export const sanitizeAnalyticsMetadata = (metadata?: AnalyticsMetadata) => {
  const language = validLanguages.has(metadata?.language as SupportedLanguage) ? metadata?.language : undefined;
  const duration = typeof metadata?.durationMs === "number" && Number.isFinite(metadata.durationMs) ? Math.max(0, Math.min(Math.round(metadata.durationMs), 3_600_000)) : undefined;
  const provider = safeText(metadata?.provider, 48), model = safeText(metadata?.model, 120), action = safeText(metadata?.action, 48);
  return { ...(language ? { language } : {}), ...(provider ? { provider } : {}), ...(model ? { model } : {}), ...(action ? { action } : {}), ...(typeof metadata?.success === "boolean" ? { success: metadata.success } : {}), ...(duration !== undefined ? { duration_ms: duration } : {}), ...(typeof metadata?.streaming === "boolean" ? { streaming: metadata.streaming } : {}) };
};

export const createEmptyAnalyticsDashboard = (range: AnalyticsRange): AnalyticsDashboard => ({
  range, overview: { roomsCreated: 0, roomsJoined: 0, activeWorkspaces: 0, executions: 0, aiRequests: 0, gitActions: 0, collaborationSessions: 0 }, dailyActivity: [], languages: [], ai: { requests: 0, successful: 0, providers: [], actions: [] }, execution: { total: 0, successful: 0, failed: 0, successRate: 0 }, git: { total: 0, commits: 0, pushes: 0, pulls: 0, repositoryImports: 0 }, collaboration: { rooms: 0, sessions: 0, mediaCalls: 0, screenShares: 0 }, recentActivity: []
});

export const aggregateAnalyticsRows = (rows: AnalyticsRow[], range: AnalyticsRange): AnalyticsDashboard => {
  const dashboard = createEmptyAnalyticsDashboard(range);
  const daily = new Map<string, number>(), languages = new Map<string, number>(), providers = new Map<string, number>(), actions = new Map<string, number>();
  const rooms = new Set<string>(), workspaces = new Set<string>();
  for (const row of rows) {
    if (!isEventType(row.event_type)) continue;
    const metadata = row.metadata ?? {};
    increment(daily, String(row.created_at).slice(0, 10)); increment(languages, typeof metadata.language === "string" ? metadata.language : undefined);
    if (row.room_id) rooms.add(row.room_id); if (row.workspace_id) workspaces.add(row.workspace_id);
    if (row.event_type === "room_created") dashboard.overview.roomsCreated += 1;
    if (row.event_type === "room_joined") dashboard.overview.roomsJoined += 1;
    if (row.event_type === "execution_completed" || row.event_type === "execution_failed") { dashboard.execution.total += 1; dashboard.overview.executions += 1; if (row.event_type === "execution_completed") dashboard.execution.successful += 1; else dashboard.execution.failed += 1; }
    if (row.event_type === "ai_request_completed" || row.event_type === "ai_request_failed") { dashboard.ai.requests += 1; dashboard.overview.aiRequests += 1; if (row.event_type === "ai_request_completed") dashboard.ai.successful += 1; increment(providers, typeof metadata.provider === "string" ? metadata.provider : undefined); increment(actions, typeof metadata.action === "string" ? metadata.action : undefined); }
    if (["git_commit", "git_push", "git_pull", "github_repository_imported"].includes(row.event_type)) { dashboard.git.total += 1; dashboard.overview.gitActions += 1; if (row.event_type === "git_commit") dashboard.git.commits += 1; if (row.event_type === "git_push") dashboard.git.pushes += 1; if (row.event_type === "git_pull") dashboard.git.pulls += 1; if (row.event_type === "github_repository_imported") dashboard.git.repositoryImports += 1; }
    if (row.event_type === "media_call_joined") dashboard.collaboration.mediaCalls += 1;
    if (row.event_type === "screen_share_started") dashboard.collaboration.screenShares += 1;
  }
  dashboard.overview.activeWorkspaces = workspaces.size; dashboard.overview.collaborationSessions = dashboard.overview.roomsCreated + dashboard.overview.roomsJoined; dashboard.collaboration = { ...dashboard.collaboration, rooms: rooms.size, sessions: dashboard.overview.collaborationSessions }; dashboard.execution.successRate = dashboard.execution.total ? Math.round((dashboard.execution.successful / dashboard.execution.total) * 100) : 0;
  dashboard.dailyActivity = entries(daily).map(({ name, count }) => ({ date: name, count })).sort((a, b) => a.date.localeCompare(b.date)); dashboard.languages = entries(languages); dashboard.ai.providers = entries(providers); dashboard.ai.actions = entries(actions);
  dashboard.recentActivity = rows.slice(0, 20).filter((row) => isEventType(row.event_type)).map((row) => ({ type: row.event_type, createdAt: row.created_at, roomId: row.room_id, workspaceId: row.workspace_id, language: typeof row.metadata?.language === "string" ? row.metadata.language : undefined }));
  return dashboard;
};

const cache = new Map<string, { expiresAt: number; value: AnalyticsDashboard }>();
const recentEvents = new Map<string, number>();
const rangeValue = (value: unknown): AnalyticsRange => value === "7d" || value === "90d" || value === "all" ? value : "30d";

export const analyticsService = {
  async record(event: AnalyticsEvent): Promise<void> {
    if (!event.userId || !isEventType(event.type) || !supabaseAdmin) return;
    const key = [event.userId, event.type, event.roomId ?? "", event.workspaceId ?? ""].join(":"); const now = Date.now();
    if (now - (recentEvents.get(key) ?? 0) < 15_000) return;
    recentEvents.set(key, now);
    if (recentEvents.size > 5_000) {
      for (const [recentKey, timestamp] of recentEvents) if (now - timestamp > 60_000) recentEvents.delete(recentKey);
    }
    try {
      await supabaseAdmin.from("analytics_events").insert({ event_type: event.type, user_id: event.userId, room_id: event.roomId ?? null, workspace_id: event.workspaceId ?? null, metadata: sanitizeAnalyticsMetadata(event.metadata) });
      for (const cacheKey of cache.keys()) if (cacheKey.startsWith(`${event.userId}:`)) cache.delete(cacheKey);
    } catch { /* Analytics is fail-open and never logs sensitive event inputs. */ }
  },
  async dashboard(userId: string, requestedRange: AnalyticsRange = "30d", scope?: { roomId?: string; workspaceId?: string }): Promise<AnalyticsDashboard> {
    const range = rangeValue(requestedRange), cacheKey = `${userId}:${range}:${scope?.roomId ?? ""}:${scope?.workspaceId ?? ""}`, cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const empty = createEmptyAnalyticsDashboard(range); if (!supabaseAdmin) return empty;
    try {
      let query = supabaseAdmin.from("analytics_events").select("event_type, room_id, workspace_id, metadata, created_at").eq("user_id", userId);
      if (range !== "all") query = query.gte("created_at", new Date(Date.now() - ranges[range] * 86_400_000).toISOString());
      if (scope?.roomId) query = query.eq("room_id", scope.roomId); if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(500); if (error) return empty;
      const value = aggregateAnalyticsRows((data ?? []) as AnalyticsRow[], range); cache.set(cacheKey, { expiresAt: Date.now() + 15_000, value }); return value;
    } catch { return empty; }
  }
};
