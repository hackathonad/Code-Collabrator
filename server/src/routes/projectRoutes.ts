import { Router } from "express";
import { env } from "../config/env";
import { aiService } from "../modules/ai/aiService";
import { buildProjectIndex } from "../modules/agent/agentIntelligence";
import { getPublicAgentTaskHistory } from "../modules/agent/agentTaskHistory";
import { buildProjectExperience } from "../modules/agent/projectExperience";
import { executionService } from "../modules/execution/executionService";
import { guestSession, type GuestRequest } from "../middleware/guestSession";
import { GitHubApiError, GitHubClient, validateBranchName, validateRepositoryPart } from "../modules/git/githubClient";
import { publishGitState } from "../modules/git/gitEvents";
import { projectService } from "../modules/git/projectService";
import { gitService } from "../modules/git/gitService";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { loadRoomIfNeeded, roomErrorStatus, roomParticipantId, sendError } from "./roomRoutes";
import { logSafeEvent } from "../utils/safeLogger";
import { sanitizeBoolean, sanitizeRoomId } from "../utils/validation";

const router = Router();
const connections = new Map<string, string>();
const rateWindows = new Map<string, { startedAt: number; count: number }>();
const RATE_WINDOW_MS = 60_000;

const connectionKey = (roomId: string, userId: string) => `${roomId}:${userId}`;
const clientForRequest = () => new GitHubClient();

const requireRoom = async (request: GuestRequest) => {
  const roomId = sanitizeRoomId(request.params.roomId);
  if (!roomId || !(await loadRoomIfNeeded(roomId))) throw new GitHubApiError(404, "ROOM_NOT_FOUND", "Room not found.");
  const userId = roomParticipantId(request, roomId);
  if (!userId) throw new GitHubApiError(403, "ROOM_FORBIDDEN", "Join this room before using project tools.");
  return { roomId, userId, room: roomStore.getRoomSnapshot(roomId) };
};

const requireConnection = (roomId: string, userId: string) => {
  if (!env.githubToken) throw new GitHubApiError(503, "GITHUB_NOT_CONFIGURED", "GitHub is not configured on this server.");
  if (!connections.has(connectionKey(roomId, userId))) throw new GitHubApiError(403, "GITHUB_NOT_CONNECTED", "Connect GitHub for this room before using repository tools.");
};

const checkLimit = (scope: string, roomId: string, userId: string, limit: number) => {
  const key = `${scope}:${connectionKey(roomId, userId)}`;
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) { rateWindows.set(key, { startedAt: now, count: 1 }); return; }
  current.count += 1;
  if (current.count > limit) {
    logSafeEvent("git", "rate_limited", { scope, roomId, userId });
    throw new GitHubApiError(429, "RATE_LIMITED", "Git project actions are temporarily rate limited.");
  }
};

const projectName = (value: unknown, fallback: string) => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  return name || fallback;
};
const description = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 500) || null : null;
const bodyString = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";

const readRemoteFiles = async (client: GitHubClient, owner: string, repository: string, branch: string) => {
  const tree = await client.getTree(owner, repository, branch);
  const files: Array<{ path: string; content: string }> = [];
  let total = 0;
  for (const entry of tree.slice(0, 500)) {
    try {
      const content = await client.getBlob(owner, repository, entry.sha);
      total += content.length;
      if (total > 4_000_000) throw new GitHubApiError(413, "REPOSITORY_TOO_LARGE", "The selected branch is too large for a room workspace.");
      files.push({ path: entry.path, content });
    } catch (error) {
      if (error instanceof GitHubApiError && ["FILE_TOO_LARGE", "BINARY_FILE", "UNSAFE_REPOSITORY_PATH"].includes(error.code)) continue;
      throw error;
    }
  }
  return files;
};

const emitState = (roomId: string, operation: "import" | "status" | "branch" | "commit" | "push" | "pull" | "pr") => {
  const room = roomStore.getRoomSnapshot(roomId);
  const summary = projectService.getSummary(room.workspace) ?? { mode: "local" as const, availability: "not-configured" as const, repository: null, status: { state: "unavailable" as const, entries: [], scannedAt: Date.now(), cached: false }, history: [], message: "No project is connected." };
  publishGitState({ roomId, workspace: room.workspace, summary: { ...summary, diff: undefined }, version: room.version, code: room.code, language: room.language, history: room.history, operation });
  gitService.invalidate(room.workspace.id);
  return summary;
};

const operationError = (error: unknown) => {
  if (error instanceof GitHubApiError) {
    if (error.code === "ROOM_NOT_FOUND") return { status: 404, message: error.message };
    if (error.code === "ROOM_FORBIDDEN" || error.code === "GITHUB_NOT_CONNECTED") return { status: 403, message: error.message };
    if (error.code === "GITHUB_NOT_CONFIGURED" || error.code === "GITHUB_UNAVAILABLE" || error.code === "GITHUB_TIMEOUT" || error.code === "GITHUB_UNAUTHORIZED") return { status: error.status, message: error.message };
    if (error.code === "GITHUB_RATE_LIMITED" || error.code === "RATE_LIMITED") return { status: 429, message: error.message };
    if (error.code === "GITHUB_NOT_FOUND") return { status: 404, message: error.message };
    if (error.code === "INVALID_BRANCH" || error.code === "INVALID_REPOSITORY" || error.code === "UNSAFE_REPOSITORY_PATH") return { status: 400, message: error.message };
    if (["LOCAL_CHANGES", "REMOTE_AHEAD", "DIVERGED"].includes(error.code)) return { status: 409, message: error.message };
    return { status: error.status >= 400 && error.status < 500 ? error.status : 502, message: error.message };
  }
  const status = roomErrorStatus(error, 400);
  return { status, message: error instanceof Error ? error.message : "Git project action failed." };
};

const withError = async (request: GuestRequest, response: Parameters<typeof sendError>[0], work: () => Promise<void>) => {
  void request;
  try { await work(); } catch (error) { const result = operationError(error); sendError(response, result.status, result.message); }
};

router.get("/:roomId/github/status", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId } = await requireRoom(request as GuestRequest);
  const key = connectionKey(roomId, userId);
  response.json({ ok: true, connection: { provider: "github", configured: Boolean(env.githubToken), connected: connections.has(key), available: Boolean(env.githubToken && connections.has(key)), accountLabel: connections.get(key) ?? null, message: env.githubToken ? connections.has(key) ? "GitHub is connected for this guest room session." : "GitHub is available when explicitly connected." : "GitHub is not configured on this server." } });
}));

router.post("/:roomId/github/connect", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId } = await requireRoom(request as GuestRequest);
  requireConnectionNotNeeded();
  checkLimit("github-connect", roomId, userId, env.githubApiRateLimit);
  const account = await clientForRequest().getAuthenticatedUser();
  connections.set(connectionKey(roomId, userId), account.login);
  logSafeEvent("git", "github_connected", { roomId, userId, account: account.login });
  response.json({ ok: true, connection: { provider: "github", configured: true, connected: true, available: true, accountLabel: account.login, message: "GitHub connected for this guest room session." } });
}));

const requireConnectionNotNeeded = () => { if (!env.githubToken) throw new GitHubApiError(503, "GITHUB_NOT_CONFIGURED", "GitHub is not configured on this server."); };

router.post("/:roomId/github/disconnect", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId } = await requireRoom(request as GuestRequest);
  connections.delete(connectionKey(roomId, userId));
  logSafeEvent("git", "github_disconnected", { roomId, userId });
  response.json({ ok: true });
}));

router.get("/:roomId/github/repositories", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("github-list", roomId, userId, env.githubApiRateLimit);
  const search = bodyString(request.query.search, 80).toLocaleLowerCase();
  const page = Math.min(Math.max(Number(request.query.page) || 1, 1), 10);
  const repositories = (await clientForRequest().listRepositories(page)).filter((repo) => !search || `${repo.fullName} ${repo.description ?? ""}`.toLocaleLowerCase().includes(search));
  response.json({ ok: true, repositories });
}));

router.get("/:roomId/github/repositories/:owner/:repository", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("github-repository", roomId, userId, env.githubApiRateLimit);
  const owner = validateRepositoryPart(String(request.params.owner), "owner"); const repository = validateRepositoryPart(String(request.params.repository), "repository");
  response.json({ ok: true, repository: await clientForRequest().getRepository(owner, repository) });
}));

router.get("/:roomId/github/repositories/:owner/:repository/branches", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("github-branches", roomId, userId, env.githubApiRateLimit);
  response.json({ ok: true, branches: await clientForRequest().listBranches(validateRepositoryPart(String(request.params.owner), "owner"), validateRepositoryPart(String(request.params.repository), "repository")) });
}));

router.get("/:roomId/github/repositories/:owner/:repository/issues", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("github-issues", roomId, userId, env.githubApiRateLimit);
  response.json({ ok: true, issues: await clientForRequest().listIssues(validateRepositoryPart(String(request.params.owner), "owner"), validateRepositoryPart(String(request.params.repository), "repository")) });
}));

router.get("/:roomId/project", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { room } = await requireRoom(request as GuestRequest);
  response.json({ ok: true, project: projectService.getSummary(room.workspace)?.project ?? null, repository: projectService.getSummary(room.workspace) });
}));

router.get("/:roomId/project/experience", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { room } = await requireRoom(request as GuestRequest);
  const repository = await gitService.getSummary(room.workspace).catch(() => null);
  const experience = buildProjectExperience({ room, index: buildProjectIndex(room), repository, executions: executionService.list(room.roomId, room.workspace.id), providers: aiService.getProviders(), tasks: getPublicAgentTaskHistory(room.roomId) });
  response.json({ ok: true, experience });
}));

router.post("/:roomId/project/import", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("github-import", roomId, userId, env.githubApiRateLimit);
  const owner = validateRepositoryPart(bodyString(request.body?.owner, 100), "owner"); const repository = validateRepositoryPart(bodyString(request.body?.repository, 100), "repository");
  const client = clientForRequest(); const remote = await client.getRepository(owner, repository); const branch = validateBranchName(bodyString(request.body?.branch, 120) || remote.defaultBranch); const head = await client.getBranch(owner, repository, branch); const files = await readRemoteFiles(client, owner, repository, branch); const history = await client.listCommits(owner, repository, branch);
  const imported = projectService.importProject({ roomId, workspaceId: room.workspace.id, name: projectName(request.body?.projectName, remote.name), description: description(request.body?.description) ?? remote.description, owner, repository, repositoryUrl: `https://github.com/${owner}/${repository}`, defaultBranch: remote.defaultBranch, branch, head, files, history });
  const updated = roomStore.replaceWorkspaceFromProject(roomId, userId, files, { name: imported.project.name, repositoryId: `${owner}/${repository}`, branch, provider: "github" });
  void roomPersistence.saveRoom(updated.room);
  logSafeEvent("git", "project_imported", { roomId, userId, repository: `${owner}/${repository}`, branch, fileCount: files.length });
  response.json({ ok: true, project: imported.project, repository: emitState(roomId, "import"), room: updated.room });
}));

router.get("/:roomId/git/status", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest);
  checkLimit("git-status", roomId, userId, env.githubApiRateLimit);
  const summary = await gitService.getSummary(room.workspace);
  const record = projectService.get(roomId, room.workspace.id);
  if (!record) {
    summary.syncState = "unavailable";
    summary.syncMessage = "Connect a repository to compare this workspace with a remote branch.";
    response.json({ ok: true, repository: summary });
    return;
  }
  const hasLocalChanges = summary.status.entries.some((entry) => entry.status !== "ignored");
  if (!connections.has(connectionKey(roomId, userId))) {
    summary.remoteState = "unknown";
    summary.syncState = "unavailable";
    summary.syncMessage = "GitHub is not connected for this guest session, so remote status is unavailable.";
    response.json({ ok: true, repository: summary });
    return;
  }
  try {
    const remoteHead = await clientForRequest().getBranch(record.project.repositoryOwner, record.project.repositoryName, record.project.selectedBranch);
    if (remoteHead === record.baseHead) {
      summary.remoteState = hasLocalChanges ? "local-ahead" : "synchronized";
      summary.syncState = hasLocalChanges ? "ahead" : "clean";
      summary.syncMessage = hasLocalChanges ? "Local workspace changes are ahead of the last remote commit." : "Workspace and remote branch are synchronized.";
    } else {
      summary.remoteState = hasLocalChanges ? "diverged" : "remote-ahead";
      summary.syncState = hasLocalChanges ? "diverged" : "behind";
      summary.syncMessage = hasLocalChanges ? "Remote changes and local workspace changes both need review." : "Remote changes are available. Pull only after reviewing the incoming workspace.";
    }
  } catch (error) {
    if (error instanceof GitHubApiError && ["GITHUB_UNAVAILABLE", "GITHUB_TIMEOUT", "GITHUB_RATE_LIMITED"].includes(error.code)) {
      summary.remoteState = "unknown";
      summary.syncState = "offline";
      summary.syncMessage = "GitHub status is temporarily unavailable. Local workspace status is still current.";
    } else throw error;
  }
  response.json({ ok: true, repository: summary });
}));

router.get("/:roomId/git/diff", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-diff", roomId, userId, env.githubApiRateLimit); const summary = await gitService.getSummary(room.workspace); response.json({ ok: true, files: summary.diff ?? [], repository: summary });
}));

router.get("/:roomId/git/compare", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-compare", roomId, userId, env.githubApiRateLimit); const record = projectService.get(roomId, room.workspace.id); if (!record) throw new Error("Project is not initialized"); const base = validateBranchName(bodyString(request.query.base, 120) || record.project.defaultBranch); const head = validateBranchName(bodyString(request.query.head, 120) || record.project.selectedBranch); response.json({ ok: true, comparison: await clientForRequest().compare(record.project.repositoryOwner, record.project.repositoryName, base, head) });
}));

router.post("/:roomId/git/stage", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); checkLimit("git-stage", roomId, userId, env.gitWriteRateLimit); const path = bodyString(request.body?.path, 300); const staged = sanitizeBoolean(request.body?.staged); projectService.stage(roomId, room.workspace, path, staged); response.json({ ok: true, repository: emitState(roomId, "status") });
}));

router.post("/:roomId/git/branch", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-branch", roomId, userId, env.gitWriteRateLimit); const record = projectService.get(roomId, room.workspace.id); if (!record) throw new Error("Project is not initialized"); const branch = validateBranchName(bodyString(request.body?.branch, 120)); const fromBranch = validateBranchName(bodyString(request.body?.fromBranch, 120) || record.project.selectedBranch); const result = await clientForRequest().createBranch(record.project.repositoryOwner, record.project.repositoryName, branch, fromBranch); logSafeEvent("git", "branch_created", { roomId, userId, repository: `${record.project.repositoryOwner}/${record.project.repositoryName}`, branch, fromBranch }); response.json({ ok: true, branch: result, repository: emitState(roomId, "branch") });
}));

router.post("/:roomId/git/switch", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-switch", roomId, userId, env.gitWriteRateLimit); const record = projectService.get(roomId, room.workspace.id); if (!record) throw new Error("Project is not initialized"); const current = await gitService.getSummary(room.workspace); if (current.status.entries.some((entry) => entry.status !== "ignored")) throw new GitHubApiError(409, "LOCAL_CHANGES", "Resolve or stage local changes before switching branches."); const branch = validateBranchName(bodyString(request.body?.branch, 120)); const client = clientForRequest(); const head = await client.getBranch(record.project.repositoryOwner, record.project.repositoryName, branch); const files = await readRemoteFiles(client, record.project.repositoryOwner, record.project.repositoryName, branch); const updated = roomStore.replaceWorkspaceFromProject(roomId, userId, files, { name: record.project.name, repositoryId: `${record.project.repositoryOwner}/${record.project.repositoryName}`, branch, provider: "github" }); projectService.replaceBaseline(roomId, room.workspace.id, branch, head, files, await client.listCommits(record.project.repositoryOwner, record.project.repositoryName, branch)); void roomPersistence.saveRoom(updated.room); response.json({ ok: true, room: updated.room, repository: emitState(roomId, "branch") });
}));

router.post("/:roomId/git/commit", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); checkLimit("git-commit", roomId, userId, env.gitWriteRateLimit); const pending = projectService.planCommit(roomId, room.workspace, bodyString(request.body?.message, 200)); logSafeEvent("git", "commit_planned", { roomId, userId, branch: pending.branch, fileCount: pending.files.length }); response.json({ ok: true, pending, repository: await gitService.getSummary(room.workspace) });
}));

router.post("/:roomId/git/push", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-push", roomId, userId, env.gitWriteRateLimit); const record = projectService.get(roomId, room.workspace.id); if (!record) throw new Error("Project is not initialized"); const pending = projectService.getPending(roomId, room.workspace.id); if (!pending) throw new Error("Create an explicit commit plan before pushing"); const client = clientForRequest(); const remoteHead = await client.getBranch(record.project.repositoryOwner, record.project.repositoryName, pending.branch); if (remoteHead !== pending.baseHead) throw new GitHubApiError(409, "REMOTE_AHEAD", "The remote branch changed. Pull or regenerate the commit before pushing."); const staged = projectService.getDiff(roomId, room.workspace).filter((entry) => entry.staged); if (!staged.length) throw new Error("No staged changes are available to push"); const entries = []; for (const entry of staged) { entries.push({ path: entry.path, sha: entry.status === "deleted" ? null : await client.createBlob(record.project.repositoryOwner, record.project.repositoryName, entry.after) }); } const tree = await client.createTree(record.project.repositoryOwner, record.project.repositoryName, pending.baseHead, entries); const commit = await client.createCommit(record.project.repositoryOwner, record.project.repositoryName, pending.message, tree, pending.baseHead); await client.updateBranch(record.project.repositoryOwner, record.project.repositoryName, pending.branch, commit.sha); projectService.markPushed(roomId, room.workspace, commit.sha, pending.message, connections.get(connectionKey(roomId, userId)) ?? "GitHub user"); logSafeEvent("git", "pushed", { roomId, userId, branch: pending.branch, commit: commit.sha.slice(0, 12), fileCount: staged.length }); response.json({ ok: true, commit, repository: emitState(roomId, "push") });
}));

router.post("/:roomId/git/pull", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-pull", roomId, userId, env.gitWriteRateLimit); const record = projectService.get(roomId, room.workspace.id); if (!record) throw new Error("Project is not initialized"); const current = await gitService.getSummary(room.workspace); if (current.status.entries.some((entry) => entry.status !== "ignored")) throw new GitHubApiError(409, "LOCAL_CHANGES", "Resolve local changes before pulling remote work."); const client = clientForRequest(); const remoteHead = await client.getBranch(record.project.repositoryOwner, record.project.repositoryName, record.project.selectedBranch); if (remoteHead === record.baseHead) { response.json({ ok: true, state: "synchronized", repository: current }); return; } const files = await readRemoteFiles(client, record.project.repositoryOwner, record.project.repositoryName, record.project.selectedBranch); const updated = roomStore.replaceWorkspaceFromProject(roomId, userId, files, { name: record.project.name, repositoryId: `${record.project.repositoryOwner}/${record.project.repositoryName}`, branch: record.project.selectedBranch, provider: "github" }); projectService.replaceBaseline(roomId, room.workspace.id, record.project.selectedBranch, remoteHead, files, await client.listCommits(record.project.repositoryOwner, record.project.repositoryName, record.project.selectedBranch)); void roomPersistence.saveRoom(updated.room); logSafeEvent("git", "pulled", { roomId, userId, branch: record.project.selectedBranch, fileCount: files.length }); response.json({ ok: true, state: "updated", room: updated.room, repository: emitState(roomId, "pull") });
}));

router.post("/:roomId/pull-requests", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-pr", roomId, userId, env.gitWriteRateLimit); const record = projectService.get(roomId, room.workspace.id); if (!record) throw new Error("Project is not initialized"); const head = validateBranchName(bodyString(request.body?.head, 120) || record.project.selectedBranch); const base = validateBranchName(bodyString(request.body?.base, 120) || record.project.defaultBranch); const title = bodyString(request.body?.title, 200); if (!title) throw new Error("A pull request title is required"); const result = await clientForRequest().createPullRequest(record.project.repositoryOwner, record.project.repositoryName, title, bodyString(request.body?.body, 10_000), head, base); logSafeEvent("git", "pull_request_created", { roomId, userId, repository: `${record.project.repositoryOwner}/${record.project.repositoryName}`, head, base, number: result.number }); response.json({ ok: true, pullRequest: result, repository: emitState(roomId, "pr") });
}));

router.get("/:roomId/pull-requests", guestSession, (request, response) => withError(request as GuestRequest, response, async () => {
  const { roomId, userId, room } = await requireRoom(request as GuestRequest); requireConnection(roomId, userId); checkLimit("git-pr-list", roomId, userId, env.githubApiRateLimit); const record = projectService.get(roomId, room.workspace.id); if (!record) throw new Error("Project is not initialized"); response.json({ ok: true, pullRequests: await clientForRequest().listPullRequests(record.project.repositoryOwner, record.project.repositoryName) });
}));

export const clearProjectRuntime = () => { connections.clear(); rateWindows.clear(); };
export default router;
