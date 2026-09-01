import { env } from "../../config/env";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_RESPONSE_LENGTH = 5_000_000;
export const MAX_REPOSITORY_FILES = 500;
export const MAX_FILE_CONTENT_LENGTH = 256_000;
export const MAX_PROJECT_CONTENT_LENGTH = 4_000_000;

export class GitHubApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export type GitHubFetch = (input: string, init?: RequestInit) => Promise<Response>;

const textValue = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";

export const validateRepositoryPart = (value: string, label: "owner" | "repository") => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value) || value === "." || value === "..") {
    throw new GitHubApiError(400, "INVALID_REPOSITORY", `Invalid GitHub ${label}.`);
  }
  return value;
};

export const validateBranchName = (value: string) => {
  const branch = value.trim();
  if (!branch || branch.length > 120 || branch.startsWith("/") || branch.endsWith("/") || branch.startsWith(".") || branch.endsWith(".") || branch.includes("..") || branch.includes("//") || branch.includes("@{") || /[\u0000-\u001f ~^:?*\\[\\]/.test(branch)) {
    throw new GitHubApiError(400, "INVALID_BRANCH", "Use a valid Git branch name.");
  }
  return branch;
};

export const validateRepositoryPath = (value: string) => {
  const path = value.trim();
  const sensitive = /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|id_rsa|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
  if (!path || path.length > 300 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === ".." || /[\u0000-\u001f]/.test(part)) || sensitive.test(path)) {
    throw new GitHubApiError(400, "UNSAFE_REPOSITORY_PATH", "This repository path is not allowed in a project workspace.");
  }
  return path;
};

const repositoryPath = (owner: string, repository: string, suffix = "") => `/repos/${encodeURIComponent(validateRepositoryPart(owner, "owner"))}/${encodeURIComponent(validateRepositoryPart(repository, "repository"))}${suffix}`;

const normalizeRepository = (value: Record<string, unknown>) => {
  const ownerValue = value.owner && typeof value.owner === "object" ? (value.owner as Record<string, unknown>).login : undefined;
  const owner = textValue(ownerValue ?? value.owner, 100);
  const name = textValue(value.name, 100);
  return {
    id: String(value.id ?? `${owner}/${name}`).slice(0, 140),
    name,
    owner,
    fullName: textValue(value.full_name, 220) || `${owner}/${name}`,
    description: value.description == null ? null : textValue(value.description, 500),
    private: value.private === true,
    defaultBranch: textValue(value.default_branch, 120) || "main",
    htmlUrl: textValue(value.html_url, 500),
    updatedAt: value.updated_at == null ? null : textValue(value.updated_at, 60)
  };
};

export class GitHubClient {
  private readonly fetcher: GitHubFetch;
  private readonly token: string;

  constructor(options: { token?: string; fetcher?: GitHubFetch } = {}) {
    this.token = options.token ?? env.githubToken;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  get configured() { return Boolean(this.token); }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) throw new GitHubApiError(503, "GITHUB_NOT_CONFIGURED", "GitHub is not configured on this server.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(`${GITHUB_API_ORIGIN}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "code-collaborator-server",
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {})
        }
      });
      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_LENGTH) throw new GitHubApiError(502, "GITHUB_RESPONSE_TOO_LARGE", "GitHub returned an oversized response.");
      let payload: unknown = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new GitHubApiError(502, "GITHUB_MALFORMED_RESPONSE", "GitHub returned an invalid response."); }
      if (!response.ok) {
        const retryHeader = response.headers.get("retry-after");
        const remaining = response.headers.get("x-ratelimit-remaining");
        const rateLimited = response.status === 429 || (response.status === 403 && remaining === "0");
        throw new GitHubApiError(response.status, rateLimited ? "GITHUB_RATE_LIMITED" : response.status === 401 ? "GITHUB_UNAUTHORIZED" : response.status === 404 ? "GITHUB_NOT_FOUND" : "GITHUB_REQUEST_FAILED", rateLimited ? "GitHub API rate limit reached. Try again later." : response.status === 404 ? "GitHub repository or resource was not found." : response.status === 401 ? "The server-side GitHub connection was rejected." : "GitHub could not complete the request.", retryHeader ? Number(retryHeader) : undefined);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof GitHubApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new GitHubApiError(504, "GITHUB_TIMEOUT", "GitHub request timed out.");
      throw new GitHubApiError(503, "GITHUB_UNAVAILABLE", "GitHub is temporarily unavailable.");
    } finally {
      clearTimeout(timer);
    }
  }

  async getAuthenticatedUser() {
    const payload = await this.request<Record<string, unknown>>("/user");
    return { login: textValue(payload.login, 100) || "GitHub user" };
  }

  async listRepositories(page = 1) {
    const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), 10);
    const payload = await this.request<unknown[]>(`/user/repos?per_page=50&page=${safePage}&sort=updated`);
    return payload.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")).slice(0, 50).map(normalizeRepository);
  }

  async getRepository(owner: string, repository: string) {
    const payload = await this.request<Record<string, unknown>>(repositoryPath(owner, repository));
    return normalizeRepository(payload);
  }

  async listBranches(owner: string, repository: string) {
    const payload = await this.request<unknown[]>(`${repositoryPath(owner, repository)}/branches?per_page=100`);
    return payload.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")).slice(0, 100).flatMap((entry) => {
      const name = typeof entry.name === "string" ? entry.name : "";
      const commit = entry.commit && typeof entry.commit === "object" ? entry.commit as Record<string, unknown> : {};
      const sha = typeof commit.sha === "string" ? commit.sha : "";
      return name && sha ? [{ name: validateBranchName(name), sha: sha.slice(0, 80), protected: entry.protected === true }] : [];
    });
  }

  async getBranch(owner: string, repository: string, branch: string) {
    const payload = await this.request<{ object?: { sha?: string } }>(`${repositoryPath(owner, repository)}/git/ref/heads/${encodeURIComponent(validateBranchName(branch))}`);
    const sha = payload.object?.sha;
    if (typeof sha !== "string" || !sha) throw new GitHubApiError(502, "GITHUB_MALFORMED_RESPONSE", "GitHub returned an invalid branch reference.");
    return sha;
  }

  async getTree(owner: string, repository: string, ref: string) {
    const payload = await this.request<{ truncated?: boolean; tree?: unknown[] }>(`${repositoryPath(owner, repository)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (payload.truncated) throw new GitHubApiError(413, "REPOSITORY_TOO_LARGE", "This repository is too large to import into a room workspace.");
    return (payload.tree ?? []).filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")).slice(0, MAX_REPOSITORY_FILES).flatMap((entry) => {
      const path = typeof entry.path === "string" ? entry.path : "";
      const sha = typeof entry.sha === "string" ? entry.sha : "";
      const type = entry.type === "blob" ? "blob" : entry.type === "tree" ? "tree" : "other";
      if (!path || !sha || type !== "blob") return [];
      try { return [{ path: validateRepositoryPath(path), sha, size: typeof entry.size === "number" ? entry.size : 0 }]; } catch (error) {
        if (error instanceof GitHubApiError && error.code === "UNSAFE_REPOSITORY_PATH") return [];
        throw error;
      }
    });
  }

  async getBlob(owner: string, repository: string, sha: string) {
    if (!/^[A-Fa-f0-9]{7,80}$/.test(sha)) throw new GitHubApiError(400, "INVALID_BLOB", "Invalid GitHub file reference.");
    const payload = await this.request<{ encoding?: string; content?: string; size?: number }>(`${repositoryPath(owner, repository)}/git/blobs/${encodeURIComponent(sha)}`);
    if (payload.encoding !== "base64" || typeof payload.content !== "string") throw new GitHubApiError(502, "GITHUB_MALFORMED_RESPONSE", "GitHub returned an unsupported file encoding.");
    const content = Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
    if (content.length > MAX_FILE_CONTENT_LENGTH) throw new GitHubApiError(413, "FILE_TOO_LARGE", "A repository file is too large for the room workspace.");
    if (content.includes("\u0000")) throw new GitHubApiError(415, "BINARY_FILE", "Binary repository files are not imported.");
    return content;
  }

  async listCommits(owner: string, repository: string, branch: string) {
    const payload = await this.request<unknown[]>(`${repositoryPath(owner, repository)}/commits?sha=${encodeURIComponent(validateBranchName(branch))}&per_page=10`);
    return payload.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")).slice(0, 10).flatMap((entry) => {
      const commit = entry.commit && typeof entry.commit === "object" ? entry.commit as Record<string, unknown> : {};
      const author = commit.author && typeof commit.author === "object" ? commit.author as Record<string, unknown> : {};
      const sha = typeof entry.sha === "string" ? entry.sha : "";
      const message = typeof commit.message === "string" ? commit.message.split("\n")[0].slice(0, 240) : "";
      return sha && message ? [{ sha: sha.slice(0, 80), message, authorName: textValue(author.name, 120) || "Unknown", authoredAt: typeof author.date === "string" ? Date.parse(author.date) || Date.now() : Date.now() }] : [];
    });
  }

  async createBranch(owner: string, repository: string, branch: string, fromBranch: string) {
    const sha = await this.getBranch(owner, repository, fromBranch);
    const payload = await this.request<{ ref?: string; object?: { sha?: string } }>(`${repositoryPath(owner, repository)}/git/refs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: `refs/heads/${validateBranchName(branch)}`, sha }) });
    return { name: validateBranchName(branch), sha: payload.object?.sha ?? sha };
  }

  async createBlob(owner: string, repository: string, content: string) {
    if (content.length > MAX_FILE_CONTENT_LENGTH || content.includes("\u0000")) throw new GitHubApiError(413, "FILE_TOO_LARGE", "A workspace file is too large or binary for a GitHub commit.");
    const payload = await this.request<{ sha?: string }>(`${repositoryPath(owner, repository)}/git/blobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, encoding: "utf-8" }) });
    if (!payload.sha) throw new GitHubApiError(502, "GITHUB_MALFORMED_RESPONSE", "GitHub did not return a file object.");
    return payload.sha;
  }

  async createTree(owner: string, repository: string, baseTree: string, entries: Array<{ path: string; sha: string | null }>) {
    const payload = await this.request<{ sha?: string }>(`${repositoryPath(owner, repository)}/git/trees`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_tree: baseTree, tree: entries.map((entry) => ({ path: validateRepositoryPath(entry.path), mode: "100644", type: "blob", sha: entry.sha })) }) });
    if (!payload.sha) throw new GitHubApiError(502, "GITHUB_MALFORMED_RESPONSE", "GitHub did not return a tree object.");
    return payload.sha;
  }

  async createCommit(owner: string, repository: string, message: string, tree: string, parent: string) {
    const payload = await this.request<{ sha?: string; html_url?: string }>(`${repositoryPath(owner, repository)}/git/commits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.trim().slice(0, 200), tree, parents: [parent] }) });
    if (!payload.sha) throw new GitHubApiError(502, "GITHUB_MALFORMED_RESPONSE", "GitHub did not return a commit object.");
    return { sha: payload.sha, url: textValue(payload.html_url, 500) || null };
  }

  async updateBranch(owner: string, repository: string, branch: string, sha: string) {
    const payload = await this.request<{ object?: { sha?: string } }>(`${repositoryPath(owner, repository)}/git/refs/heads/${encodeURIComponent(validateBranchName(branch))}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha, force: false }) });
    return payload.object?.sha ?? sha;
  }

  async compare(owner: string, repository: string, baseBranch: string, headBranch: string) {
    const payload = await this.request<{ status?: string; ahead_by?: number; behind_by?: number; files?: unknown[] }>(`${repositoryPath(owner, repository)}/compare/${encodeURIComponent(validateBranchName(baseBranch))}...${encodeURIComponent(validateBranchName(headBranch))}`);
    return { status: textValue(payload.status, 30) || "unknown", aheadBy: typeof payload.ahead_by === "number" ? payload.ahead_by : 0, behindBy: typeof payload.behind_by === "number" ? payload.behind_by : 0, files: (payload.files ?? []).filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")).slice(0, 100).map((entry) => ({ path: typeof entry.filename === "string" ? validateRepositoryPath(entry.filename) : "unknown", status: typeof entry.status === "string" ? entry.status.slice(0, 30) : "modified", additions: typeof entry.additions === "number" ? entry.additions : 0, deletions: typeof entry.deletions === "number" ? entry.deletions : 0 })).filter((entry) => entry.path !== "unknown") };
  }

  async createPullRequest(owner: string, repository: string, title: string, body: string, head: string, base: string) {
    const payload = await this.request<{ number?: number; html_url?: string; state?: string; title?: string; head?: { ref?: string }; base?: { ref?: string } }>(`${repositoryPath(owner, repository)}/pulls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim().slice(0, 200), body: body.trim().slice(0, 10_000), head: validateBranchName(head), base: validateBranchName(base) }) });
    if (!Number.isInteger(payload.number) || typeof payload.html_url !== "string") throw new GitHubApiError(502, "GITHUB_MALFORMED_RESPONSE", "GitHub did not return a pull request.");
    return { number: payload.number, url: payload.html_url.slice(0, 500), state: textValue(payload.state, 30) || "open", title: textValue(payload.title, 200), head: textValue(payload.head?.ref, 120) || head, base: textValue(payload.base?.ref, 120) || base };
  }

  async listPullRequests(owner: string, repository: string) {
    const payload = await this.request<unknown[]>(`${repositoryPath(owner, repository)}/pulls?state=all&per_page=20`);
    return payload.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")).slice(0, 20).flatMap((entry) => {
      const number = typeof entry.number === "number" ? entry.number : 0;
      const head = entry.head && typeof entry.head === "object" ? entry.head as Record<string, unknown> : {};
      const base = entry.base && typeof entry.base === "object" ? entry.base as Record<string, unknown> : {};
      return number && typeof entry.html_url === "string" ? [{ number, url: entry.html_url.slice(0, 500), title: textValue(entry.title, 200), state: textValue(entry.state, 30) || "open", head: textValue(head.ref, 120), base: textValue(base.ref, 120) }] : [];
    });
  }

  async listIssues(owner: string, repository: string) {
    const payload = await this.request<unknown[]>(`${repositoryPath(owner, repository)}/issues?state=open&per_page=20`);
    return payload.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !(entry as Record<string, unknown>).pull_request)).slice(0, 20).flatMap((entry) => {
      const number = typeof entry.number === "number" ? entry.number : 0;
      const labels = Array.isArray(entry.labels) ? entry.labels.flatMap((label) => label && typeof label === "object" && typeof (label as Record<string, unknown>).name === "string" ? [(label as Record<string, unknown>).name as string].slice(0, 40) : []).slice(0, 10) : [];
      return number && typeof entry.html_url === "string" && typeof entry.title === "string" ? [{ number, title: entry.title.slice(0, 200), body: typeof entry.body === "string" ? entry.body.slice(0, 10_000) : "", url: entry.html_url.slice(0, 500), state: textValue(entry.state, 30) || "open", labels }] : [];
    });
  }
}

export const createGitHubClient = (options?: { token?: string; fetcher?: GitHubFetch }) => new GitHubClient(options);
