export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "local" | "unknown";
export type RepositoryMode = "local" | "git";
export type RepositoryAvailability = "ready" | "not-configured" | "invalid" | "unavailable";
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "ignored" | "conflicted" | "untracked";
export type GitSyncState = "clean" | "ahead" | "behind" | "diverged" | "conflicted" | "offline" | "unavailable";

export interface RepositoryMetadata {
  id: string;
  name: string;
  owner?: string;
  description?: string | null;
  remoteUrl: string | null;
  provider: GitProvider;
  currentBranch: string | null;
  defaultBranch?: string | null;
  head: string | null;
  repositoryRootId: string | null;
  settings: { provider: GitProvider; defaultBranch: string | null; autoFetchEnabled: boolean };
  future: { pullRequests: boolean; releases: boolean; issues: boolean; tags: boolean; contributors: boolean; actions: boolean };
}

export interface GitStatusEntry {
  workspaceFileId: string | null;
  path: string;
  status: GitFileStatus;
  staged?: boolean;
  previousPath?: string;
}

export interface GitDiffFile {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  additions: number;
  deletions: number;
  before: string;
  after: string;
}

export interface GitBranchSummary { name: string; sha: string; protected: boolean; }

export interface GitHubRepositorySummary {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string | null;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  labels: string[];
}

export interface ProjectSummary {
  id: string;
  roomId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  provider: "github";
  repositoryOwner: string;
  repositoryName: string;
  repositoryUrl: string;
  defaultBranch: string;
  selectedBranch: string;
  createdAt: number;
  updatedAt: number;
}

export interface RepositorySummary {
  mode: RepositoryMode;
  availability: RepositoryAvailability;
  repository: RepositoryMetadata | null;
  status: { state: "clean" | "changes" | "unavailable"; entries: GitStatusEntry[]; scannedAt: number; cached: boolean };
  history: Array<{ sha: string; message: string; authorName: string; authoredAt: number; changedFiles?: string[] }>;
  remoteState?: "unknown" | "synchronized" | "remote-ahead" | "local-ahead" | "diverged";
  syncState?: GitSyncState;
  syncMessage?: string;
  diff?: GitDiffFile[];
  project?: ProjectSummary | null;
  message?: string;
}

export interface GitHubConnectionStatus {
  provider: "github";
  configured: boolean;
  connected: boolean;
  available: boolean;
  accountLabel: string | null;
  message: string;
}

export interface GitStateEvent {
  roomId: string;
  workspace: import("./collaboration").WorkspaceState;
  summary: RepositorySummary;
  version: number;
  code: string;
  language: import("./collaboration").SupportedLanguage;
  history: import("./collaboration").HistoryEntry[];
  operation: "import" | "status" | "branch" | "commit" | "push" | "pull" | "pr";
}

export interface RecentRepository {
  id: string;
  name: string;
  provider: GitProvider;
  openedAt: number;
}
