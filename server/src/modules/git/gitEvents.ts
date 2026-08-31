import type { HistoryEntry, WorkspaceState } from "../rooms/roomTypes";
import type { RepositorySummary } from "./gitTypes";

export interface GitStateEvent {
  roomId: string;
  workspace: WorkspaceState;
  summary: RepositorySummary;
  version: number;
  code: string;
  language: WorkspaceState["language"];
  history: HistoryEntry[];
  operation: "import" | "status" | "branch" | "commit" | "push" | "pull" | "pr";
}

const subscribers = new Set<(event: GitStateEvent) => void>();

export const publishGitState = (event: GitStateEvent) => {
  for (const subscriber of subscribers) {
    try { subscriber(event); } catch { /* one subscriber must not break room state */ }
  }
};

export const subscribeGitState = (subscriber: (event: GitStateEvent) => void) => {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
};

export const clearGitStateSubscribers = () => subscribers.clear();
