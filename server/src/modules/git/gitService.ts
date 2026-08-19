import type { GitOperationRequest, GitProvider, GitProviderAdapter, GitService, RepositorySummary } from "./gitTypes";
import { GitOperationUnavailableError } from "./gitTypes";

const CACHE_TTL_MS = 15_000;

const providerFromMapping = (value: GitProvider | null | undefined): GitProvider => value ?? "unknown";

export const createGitService = (initialAdapters: GitProviderAdapter[] = []): GitService => {
  const adapters = new Map(initialAdapters.map((adapter) => [adapter.provider, adapter]));
  const cache = new Map<string, { expiresAt: number; summary: RepositorySummary }>();

  return {
  async getSummary(workspace) {
    const cached = cache.get(workspace.id);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.summary, status: { ...cached.summary.status, cached: true } };

    const repositoryId = workspace.git?.repositoryId;
    const mappedProvider = workspace.git?.provider;
    const adapter = mappedProvider && mappedProvider !== "unknown" ? adapters.get(mappedProvider) : undefined;
    if (repositoryId && adapter) {
      const summary = await adapter.getSummary(workspace);
      cache.set(workspace.id, { expiresAt: Date.now() + CACHE_TTL_MS, summary });
      return summary;
    }
    const summary: RepositorySummary = repositoryId
      ? {
          mode: "git",
          availability: "unavailable",
          repository: {
            id: repositoryId,
            name: workspace.name,
            remoteUrl: null,
            provider: providerFromMapping(workspace.git?.provider),
            currentBranch: workspace.git?.branch ?? null,
            head: null,
            repositoryRootId: workspace.git?.repositoryRootId ?? workspace.rootFolderId,
            settings: { provider: providerFromMapping(workspace.git?.provider), defaultBranch: null, autoFetchEnabled: false },
            future: { pullRequests: true, releases: true, issues: true, tags: true, contributors: true, actions: true }
          },
          status: { state: "unavailable", entries: [], scannedAt: Date.now(), cached: false },
          history: [],
          message: "Repository metadata is mapped, but a Git provider is not configured."
        }
      : {
          mode: "local",
          availability: "not-configured",
          repository: null,
          status: { state: "unavailable", entries: [], scannedAt: Date.now(), cached: false },
          history: [],
          message: "This is a local workspace. Connect a repository when a provider is configured."
        };

    cache.set(workspace.id, { expiresAt: Date.now() + CACHE_TTL_MS, summary });
    return summary;
  },

  async run(request: GitOperationRequest): Promise<never> {
    const adapter = request.provider && request.provider !== "unknown" ? adapters.get(request.provider) : undefined;
    if (adapter) return adapter.run(request);
    throw new GitOperationUnavailableError(request.operation);
  },

  registerProvider(adapter) {
    adapters.set(adapter.provider, adapter);
    cache.clear();
  },

  invalidate(workspaceId) {
    cache.delete(workspaceId);
  }
};
};

export const gitService = createGitService();
