export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "local" | "unknown";
export type RepositoryMode = "local" | "git";
export type RepositoryAvailability = "ready" | "not-configured" | "invalid" | "unavailable";
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "ignored" | "conflicted" | "untracked";
export type GitOperationName = "import" | "clone" | "open" | "disconnect" | "refresh" | "fetch" | "pull" | "push" | "commit" | "branch" | "status" | "history" | "diff";

export interface RepositorySettings {
  provider: GitProvider;
  defaultBranch: string | null;
  autoFetchEnabled: boolean;
}

export interface RepositoryMetadata {
  id: string;
  name: string;
  remoteUrl: string | null;
  provider: GitProvider;
  currentBranch: string | null;
  head: string | null;
  repositoryRootId: string | null;
  settings: RepositorySettings;
  future: { pullRequests: boolean; releases: boolean; issues: boolean; tags: boolean; contributors: boolean; actions: boolean };
}

export interface GitStatusEntry {
  workspaceFileId: string | null;
  path: string;
  status: GitFileStatus;
  previousPath?: string;
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
}

export interface RepositorySummary {
  mode: RepositoryMode;
  availability: RepositoryAvailability;
  repository: RepositoryMetadata | null;
  status: RepositoryStatus;
  history: GitCommitSummary[];
  message?: string;
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
