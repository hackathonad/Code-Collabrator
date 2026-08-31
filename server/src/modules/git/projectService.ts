import { randomUUID } from "node:crypto";
import type { WorkspaceFile, WorkspaceState } from "../rooms/roomTypes";
import type { GitDiffFile, GitStatusEntry, GitCommitSummary, ProjectSummary, RepositorySummary } from "./gitTypes";

const projects = new Map<string, ProjectRecord>();
const MAX_HISTORY = 40;
const sensitivePath = /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|id_rsa|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;

interface ProjectRecord {
  project: ProjectSummary;
  baseHead: string;
  baseFiles: Map<string, string>;
  staged: Set<string>;
  history: GitCommitSummary[];
  pendingCommit?: { id: string; message: string; branch: string; baseHead: string; createdAt: number };
}

export interface ProjectImportInput {
  roomId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  owner: string;
  repository: string;
  repositoryUrl: string;
  defaultBranch: string;
  branch: string;
  head: string;
  files: Array<{ path: string; content: string }>;
  history?: GitCommitSummary[];
}

const keyFor = (roomId: string, workspaceId: string) => `${roomId}:${workspaceId}`;

const pathForFile = (workspace: WorkspaceState, file: WorkspaceFile) => {
  const parts = [file.name];
  let current = workspace.folders[file.parentId];
  let guard = 0;
  while (current && current.parentId && guard < 40) {
    parts.unshift(current.name);
    current = workspace.folders[current.parentId];
    guard += 1;
  }
  return parts.join("/");
};

const workspaceFilesByPath = (workspace: WorkspaceState) => new Map(Object.values(workspace.files).map((file) => [pathForFile(workspace, file), file]));
const lineCount = (value: string) => value ? value.split("\n").length : 0;

const calculateDiff = (record: ProjectRecord, workspace: WorkspaceState) => {
  const current = workspaceFilesByPath(workspace);
  const paths = new Set([...record.baseFiles.keys(), ...current.keys()]);
  const diffs: GitDiffFile[] = [];
  for (const path of [...paths].sort()) {
    const file = current.get(path);
    const before = record.baseFiles.get(path) ?? "";
    const after = file?.content ?? "";
    if (!file && !record.baseFiles.has(path)) continue;
    if (sensitivePath.test(path)) continue;
    if (!file && record.baseFiles.has(path)) {
      diffs.push({ path, status: "deleted", staged: record.staged.has(path), additions: 0, deletions: lineCount(before), before, after });
    } else if (!record.baseFiles.has(path)) {
      diffs.push({ path, status: "untracked", staged: record.staged.has(path), additions: lineCount(after), deletions: 0, before, after });
    } else if (before !== after) {
      const beforeLines = before.split("\n"); const afterLines = after.split("\n");
      let prefix = 0; while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
      let suffix = 0; while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) suffix += 1;
      diffs.push({ path, status: "modified", staged: record.staged.has(path), additions: Math.max(0, afterLines.length - prefix - suffix), deletions: Math.max(0, beforeLines.length - prefix - suffix), before, after });
    }
  }
  return diffs.slice(0, 500);
};

const statusEntries = (record: ProjectRecord, workspace: WorkspaceState): GitStatusEntry[] => {
  const current = workspaceFilesByPath(workspace);
  const entries: GitStatusEntry[] = [];
  for (const diff of calculateDiff(record, workspace)) entries.push({ workspaceFileId: current.get(diff.path)?.id ?? null, path: diff.path, status: diff.status, staged: diff.staged });
  for (const [path, file] of current) if (sensitivePath.test(path)) entries.push({ workspaceFileId: file.id, path, status: "ignored", staged: false });
  return entries.sort((left, right) => left.path.localeCompare(right.path));
};

const summaryFor = (record: ProjectRecord, workspace: WorkspaceState, cached = false): RepositorySummary => {
  const entries = statusEntries(record, workspace);
  const diff = calculateDiff(record, workspace);
  return {
    mode: "git",
    availability: "ready",
    repository: { id: `${record.project.repositoryOwner}/${record.project.repositoryName}`, name: record.project.repositoryName, owner: record.project.repositoryOwner, description: record.project.description, remoteUrl: record.project.repositoryUrl, provider: "github", currentBranch: record.project.selectedBranch, defaultBranch: record.project.defaultBranch, head: record.baseHead, repositoryRootId: workspace.rootFolderId, settings: { provider: "github", defaultBranch: record.project.defaultBranch, autoFetchEnabled: false }, future: { pullRequests: true, releases: false, issues: false, tags: false, contributors: false, actions: false } },
    status: { state: entries.length ? "changes" : "clean", entries, scannedAt: Date.now(), cached },
    history: record.history.slice(0, MAX_HISTORY),
    diff: diff.slice(0, 20),
    project: record.project,
    message: entries.length ? `${entries.length} working-tree change${entries.length === 1 ? "" : "s"}.` : "Working tree is clean."
  };
};

export const projectService = {
  importProject(input: ProjectImportInput) {
    const baseFiles = new Map<string, string>();
    let total = 0;
    for (const file of input.files.slice(0, 500)) {
      if (!file.path || sensitivePath.test(file.path) || file.content.length > 256_000) continue;
      total += file.content.length;
      if (total > 4_000_000) throw new Error("The selected repository is too large for a room workspace");
      baseFiles.set(file.path, file.content);
    }
    if (!baseFiles.size) throw new Error("The selected repository has no importable text files");
    const now = Date.now();
    const project: ProjectSummary = { id: randomUUID(), roomId: input.roomId, workspaceId: input.workspaceId, name: input.name.slice(0, 120), description: input.description?.slice(0, 500) ?? null, provider: "github", repositoryOwner: input.owner, repositoryName: input.repository, repositoryUrl: input.repositoryUrl, defaultBranch: input.defaultBranch, selectedBranch: input.branch, createdAt: now, updatedAt: now };
    const record: ProjectRecord = { project, baseHead: input.head, baseFiles, staged: new Set(), history: (input.history ?? []).slice(0, MAX_HISTORY) };
    projects.set(keyFor(input.roomId, input.workspaceId), record);
    return record;
  },

  get(roomId: string, workspaceId: string) { return projects.get(keyFor(roomId, workspaceId)); },
  getByWorkspace(workspaceId: string) { return [...projects.values()].find((record) => record.project.workspaceId === workspaceId); },
  getSummary(workspace: WorkspaceState) { const record = this.getByWorkspace(workspace.id); return record ? summaryFor(record, workspace) : null; },
  getDiff(roomId: string, workspace: WorkspaceState) { const record = this.get(roomId, workspace.id); return record ? calculateDiff(record, workspace) : []; },
  getStatusEntries(roomId: string, workspace: WorkspaceState) { const record = this.get(roomId, workspace.id); return record ? statusEntries(record, workspace) : []; },
  setBranch(roomId: string, workspaceId: string, branch: string) { const record = projects.get(keyFor(roomId, workspaceId)); if (!record) throw new Error("Project is not initialized"); record.project = { ...record.project, selectedBranch: branch, updatedAt: Date.now() }; return record; },
  replaceBaseline(roomId: string, workspaceId: string, branch: string, head: string, files: Array<{ path: string; content: string }>, history?: GitCommitSummary[]) { const record = projects.get(keyFor(roomId, workspaceId)); if (!record) throw new Error("Project is not initialized"); record.project = { ...record.project, selectedBranch: branch, updatedAt: Date.now() }; record.baseHead = head; record.baseFiles = new Map(files.filter((file) => !sensitivePath.test(file.path)).map((file) => [file.path, file.content])); record.staged.clear(); record.pendingCommit = undefined; if (history) record.history = history.slice(0, MAX_HISTORY); return record; },
  stage(roomId: string, workspace: WorkspaceState, path: string, staged: boolean) { const record = projects.get(keyFor(roomId, workspace.id)); if (!record) throw new Error("Project is not initialized"); if (sensitivePath.test(path)) throw new Error("Secret-like files cannot be staged"); if (!calculateDiff(record, workspace).some((entry) => entry.path === path)) throw new Error("The selected file has no working-tree change"); if (staged) record.staged.add(path); else record.staged.delete(path); return summaryFor(record, workspace); },
  planCommit(roomId: string, workspace: WorkspaceState, message: string) { const record = projects.get(keyFor(roomId, workspace.id)); if (!record) throw new Error("Project is not initialized"); const cleanMessage = message.trim(); if (!cleanMessage || cleanMessage.length > 200) throw new Error("A commit message between 1 and 200 characters is required"); const staged = calculateDiff(record, workspace).filter((entry) => record.staged.has(entry.path)); if (!staged.length) throw new Error("Stage at least one change before committing"); const pending = { id: randomUUID(), message: cleanMessage, branch: record.project.selectedBranch, baseHead: record.baseHead, createdAt: Date.now() }; record.pendingCommit = pending; return { ...pending, files: staged.map((entry) => ({ path: entry.path, status: entry.status })) }; },
  getPending(roomId: string, workspaceId: string) { return projects.get(keyFor(roomId, workspaceId))?.pendingCommit; },
  markPushed(roomId: string, workspace: WorkspaceState, sha: string, message: string, authorName = "Code Collaborator") { const record = projects.get(keyFor(roomId, workspace.id)); if (!record) throw new Error("Project is not initialized"); record.baseFiles = new Map([...workspaceFilesByPath(workspace)].filter(([path]) => !sensitivePath.test(path)).map(([path, file]) => [path, file.content])); record.baseHead = sha; record.staged.clear(); record.pendingCommit = undefined; record.history = [{ sha, message, authorName, authoredAt: Date.now() }, ...record.history].slice(0, MAX_HISTORY); record.project = { ...record.project, updatedAt: Date.now() }; return record; },
  clearRoom(roomId: string) { for (const [key, record] of projects) if (record.project.roomId === roomId) projects.delete(key); },
  clear() { projects.clear(); }
};

export const repositorySummaryForWorkspace = (workspace: WorkspaceState) => projectService.getSummary(workspace);
