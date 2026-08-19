export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "local" | "unknown";
export type RepositoryMode = "local" | "git";
export type RepositoryAvailability = "ready" | "not-configured" | "invalid" | "unavailable";
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "ignored" | "conflicted" | "untracked";

export interface RepositoryMetadata {
  id: string;
  name: string;
  remoteUrl: string | null;
  provider: GitProvider;
  currentBranch: string | null;
  head: string | null;
  repositoryRootId: string | null;
  settings: { provider: GitProvider; defaultBranch: string | null; autoFetchEnabled: boolean };
  future: { pullRequests: boolean; releases: boolean; issues: boolean; tags: boolean; contributors: boolean; actions: boolean };
}

export interface GitStatusEntry {
  workspaceFileId: string | null;
  path: string;
  status: GitFileStatus;
  previousPath?: string;
}

export interface RepositorySummary {
  mode: RepositoryMode;
  availability: RepositoryAvailability;
  repository: RepositoryMetadata | null;
  status: { state: "clean" | "changes" | "unavailable"; entries: GitStatusEntry[]; scannedAt: number; cached: boolean };
  history: Array<{ sha: string; message: string; authorName: string; authoredAt: number }>;
  message?: string;
}

export interface RecentRepository {
  id: string;
  name: string;
  provider: GitProvider;
  openedAt: number;
}
