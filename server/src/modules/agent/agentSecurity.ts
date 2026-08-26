import { createHash } from "node:crypto";
import type { WorkspaceFile, WorkspaceState } from "../rooms/roomTypes";

const MAX_PATH_LENGTH = 260;
const ignoredSegment = /^(?:node_modules|dist|build|coverage|\.git)$/i;
const sensitiveSegment = /^(?:\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|.*\.(?:pem|key|p12|pfx))$/i;
const sensitiveContent = /(-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{12,}|(?:sk|ghp|github_pat|xox[baprs])-[_A-Za-z0-9-]{12,}|(?:AIza|gsk_|xai-|github_pat_)[A-Za-z0-9_-]{20,})/i;

export class AgentSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSecurityError";
  }
}

const decodePathOnce = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AgentSecurityError("The workspace path is malformed");
  }
};

export const normalizeWorkspacePath = (value: unknown, allowEmpty = false) => {
  if (typeof value !== "string") throw new AgentSecurityError("A workspace-relative path is required");
  const decoded = decodePathOnce(value.trim());
  if (!decoded && allowEmpty) return "";
  if (!decoded || decoded.length > MAX_PATH_LENGTH || decoded.includes("\\") || decoded.includes("\u0000") || /[\u0000-\u001f]/.test(decoded)) {
    throw new AgentSecurityError("Use a valid workspace-relative path");
  }
  if (decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded) || decoded.startsWith("//") || decoded.startsWith("\\\\")) {
    throw new AgentSecurityError("Absolute paths are not allowed");
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new AgentSecurityError("Path traversal is not allowed");
  }
  if (segments.some((segment) => sensitiveSegment.test(segment))) throw new AgentSecurityError("Sensitive files are not available to the agent");
  if (segments.some((segment) => ignoredSegment.test(segment))) throw new AgentSecurityError("Ignored workspace directories are not available to the agent");
  return segments.join("/");
};

const parentPath = (workspace: WorkspaceState, parentId: string) => {
  const parts: string[] = [];
  let current: WorkspaceState["folders"][string] | undefined = workspace.folders[parentId];
  while (current && current.id !== workspace.rootFolderId) {
    parts.unshift(current.name);
    current = current.parentId ? workspace.folders[current.parentId] : undefined;
  }
  return parts.join("/");
};

export const workspacePathForFile = (workspace: WorkspaceState, file: WorkspaceFile) => {
  const folder = parentPath(workspace, file.parentId);
  return folder ? `${folder}/${file.name}` : file.name;
};

export const isSafeWorkspaceFile = (workspace: WorkspaceState, file: WorkspaceFile) => {
  try {
    normalizeWorkspacePath(workspacePathForFile(workspace, file));
    return !sensitiveContent.test(file.content);
  } catch {
    return false;
  }
};

export const findWorkspaceFile = (workspace: WorkspaceState, path: string) => {
  const normalized = normalizeWorkspacePath(path);
  return Object.values(workspace.files).find((file) => workspacePathForFile(workspace, file) === normalized);
};

export const findWorkspaceFolder = (workspace: WorkspaceState, path: string) => {
  const normalized = normalizeWorkspacePath(path, true);
  if (!normalized) return workspace.folders[workspace.rootFolderId];
  return Object.values(workspace.folders).find((folder) => {
    const parts: string[] = [];
    let current: typeof folder | undefined = folder;
    while (current && current.id !== workspace.rootFolderId) {
      parts.unshift(current.name);
      current = current.parentId ? workspace.folders[current.parentId] : undefined;
    }
    return parts.join("/") === normalized;
  });
};

export const countLineChanges = (before: string, after: string) => {
  const beforeLines = before ? before.split("\n").length : 0;
  const afterLines = after ? after.split("\n").length : 0;
  return { additions: Math.max(0, afterLines - beforeLines), deletions: Math.max(0, beforeLines - afterLines) };
};

export const patchIdFor = (roomId: string, fileId: string, expectedContent: string, replacement: string) =>
  createHash("sha256").update(`${roomId}\u0000${fileId}\u0000${expectedContent}\u0000${replacement}`).digest("hex").slice(0, 24);

export const containsSensitiveContent = (value: string) => sensitiveContent.test(value);
