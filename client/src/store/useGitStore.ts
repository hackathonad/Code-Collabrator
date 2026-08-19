import { create } from "zustand";
import { api } from "../lib/api";
import type { RecentRepository, RepositorySummary } from "../types/git";

const RECENT_REPOSITORIES_KEY = "code-sphere-recent-repositories";
const readRecentRepositories = (): RecentRepository[] => {
  try { return JSON.parse(window.localStorage.getItem(RECENT_REPOSITORIES_KEY) ?? "[]") as RecentRepository[]; } catch { return []; }
};
const saveRecentRepository = (repository: NonNullable<RepositorySummary["repository"]>) => {
  const next = [{ id: repository.id, name: repository.name, provider: repository.provider, openedAt: Date.now() }, ...readRecentRepositories().filter((entry) => entry.id !== repository.id)].slice(0, 10);
  window.localStorage.setItem(RECENT_REPOSITORIES_KEY, JSON.stringify(next));
  return next;
};

interface GitStoreState {
  roomId: string | null;
  workspaceId: string | null;
  repository: RepositorySummary | null;
  recentRepositories: RecentRepository[];
  loading: boolean;
  error: string | null;
  initialize: (roomId: string, workspaceId: string) => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useGitStore = create<GitStoreState>((set, get) => ({
  roomId: null,
  workspaceId: null,
  repository: null,
  recentRepositories: typeof window === "undefined" ? [] : readRecentRepositories(),
  loading: false,
  error: null,
  initialize: async (roomId, workspaceId) => {
    if (get().roomId === roomId && get().workspaceId === workspaceId && get().repository) return;
    set({ roomId, workspaceId, loading: true, error: null });
    try {
      const repository = await api.getRepository(roomId);
      const recentRepositories = repository.repository ? saveRecentRepository(repository.repository) : get().recentRepositories;
      set({ repository, recentRepositories, loading: false });
    } catch (error) {
      set({ repository: null, loading: false, error: error instanceof Error ? error.message : "Repository state is unavailable" });
    }
  },
  refresh: async () => {
    const roomId = get().roomId;
    if (!roomId) return;
    set({ loading: true, error: null });
    try {
      const repository = await api.refreshRepository(roomId);
      const recentRepositories = repository.repository ? saveRecentRepository(repository.repository) : get().recentRepositories;
      set({ repository, recentRepositories, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : "Repository state is unavailable" });
    }
  },
  clear: () => set({ roomId: null, workspaceId: null, repository: null, error: null, loading: false })
}));
