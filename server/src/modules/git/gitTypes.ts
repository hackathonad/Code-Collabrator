export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "local" | "unknown";
export type RepositoryMode = "local" | "git";
export type RepositoryAvailability = "ready" | "not-configured" | "invalid" | "unavailable";
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "ignored" | "conflicted" | "untracked";
export type GitOperationName = "import" | "clone" | "open" | "disconnect" | "refresh" | "fetch" | "pull" | "push" | "commit" | "branch" | "status" | "history" | "diff";
export type GitSyncState = "clean" | "ahead" | "behind" | "diverged" | "conflicted" | "offline" | "unavailable";

export interface RepositorySettings {
  provider: GitProvider;
  defaultBranch: string | null;
  autoFetchEnabled: boolean;
}

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
  settings: RepositorySettings;
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

export interface GitBranchSummary {
  name: string;
  sha: string;
  protected: boolean;
}

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

export interface RepositoryStatus {
  state: "clean" | "changes" | "unavailable";
  entries: GitStatusEntry[];
  scannedAt: number;
  cached: boolean;
}

export interface GitCommitSummary {
  sha: string;
  message: string;
  authorName: string;
  authoredAt: number;
  changedFiles?: string[];
}

export interface RepositorySummary {
  mode: RepositoryMode;
  availability: RepositoryAvailability;
  repository: RepositoryMetadata | null;
  status: RepositoryStatus;
  history: GitCommitSummary[];
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

export interface GitOperationRequest {
  operation: GitOperationName;
  provider?: GitProvider;
  repositoryId?: string;
  branch?: string;
  message?: string;
  remoteUrl?: string;
}

export interface GitWorkspaceReference {
  id: string;
  name: string;
  rootFolderId: string;
  git?: { repositoryId: string | null; branch: string | null; provider?: GitProvider | null; repositoryRootId?: string | null };
}

export interface GitProviderAdapter {
  provider: Exclude<GitProvider, "unknown">;
  getSummary(workspace: GitWorkspaceReference): Promise<RepositorySummary>;
  run(request: GitOperationRequest): Promise<never>;
}

export interface GitService {
  getSummary(workspace: GitWorkspaceReference): Promise<RepositorySummary>;
  run(request: GitOperationRequest): Promise<never>;
  registerProvider(adapter: GitProviderAdapter): void;
  invalidate(workspaceId: string): void;
}

export class GitOperationUnavailableError extends Error {
  constructor(public readonly operation: GitOperationName, message = "Git is not configured for this workspace yet") {
    super(message);
    this.name = "GitOperationUnavailableError";
  }
}
