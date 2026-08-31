import { randomUUID } from "node:crypto";
import { LANGUAGE_CONFIG, type SupportedLanguage } from "../../constants/languages";
import type { WorkspaceOperation, WorkspaceState, WorkspaceTrashEntry } from "./roomTypes";

const MAX_NAME_LENGTH = 120;
const MAX_TRASH_ENTRIES = 50;
export const MAX_WORKSPACE_FILES = 1_000;
export const MAX_WORKSPACE_FOLDERS = 500;
export const MAX_WORKSPACE_DEPTH = 32;
export const MAX_WORKSPACE_CONTENT_LENGTH = 4_000_000;
export const MAX_OPEN_FILES = 100;
const languageByExtension: Record<string, SupportedLanguage> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", ts: "javascript", tsx: "javascript",
  py: "python", pyw: "python", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", h: "cpp"
};

/** Workspace paths are virtual, but secret-like and VCS control files are
 * still excluded so they cannot be imported, created, or staged by accident. */
export const isProtectedWorkspacePath = (value: string) => /(^|\/)(?:\.env(?:\..*)?|\.git(?:\/|$)|id_rsa(?:\..*)?|.*(?:secret|password|credential|token).*|.*\.pem)$/i.test(value.replaceAll("\\", "/"));

const cleanName = (value: string | undefined) => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH || name === "." || name === ".." || isProtectedWorkspacePath(name) || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) {
    throw new Error("Use a valid file or folder name");
  }
  return name;
};

const extensionOf = (name: string) => {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
};

export const languageForFileName = (name: string, fallback: SupportedLanguage) => languageByExtension[extensionOf(name)] ?? fallback;

const initialFileName = (language: SupportedLanguage) => ({ javascript: "main.js", python: "main.py", cpp: "main.cpp" })[language];

const updateOpened = (workspace: WorkspaceState, fileId: string) => {
  workspace.openFileIds = [...new Set([...workspace.openFileIds.filter((id) => id !== fileId), fileId])];
  workspace.recentlyOpenedFileIds = [fileId, ...workspace.recentlyOpenedFileIds.filter((id) => id !== fileId)].slice(0, 30);
  workspace.activeFileId = fileId;
};

const containsName = (workspace: WorkspaceState, parentId: string, name: string, ignoredId?: string) => {
  const comparable = name.toLocaleLowerCase();
  return [...Object.values(workspace.files), ...Object.values(workspace.folders)].some(
    (node) => node.id !== ignoredId && node.parentId === parentId && node.name.toLocaleLowerCase() === comparable
  );
};

const requireFolder = (workspace: WorkspaceState, id: string | undefined) => {
  const folder = id ? workspace.folders[id] : undefined;
  if (!folder) throw new Error("Destination folder was not found");
  return folder;
};

const requireFile = (workspace: WorkspaceState, id: string | undefined) => {
  const file = id ? workspace.files[id] : undefined;
  if (!file) throw new Error("File was not found");
  return file;
};

const folderDepth = (workspace: WorkspaceState, folderId: string) => {
  let depth = 0;
  let current = workspace.folders[folderId];
  while (current?.parentId) {
    depth += 1;
    current = workspace.folders[current.parentId];
  }
  return depth;
};

const workspaceContentLength = (workspace: WorkspaceState) =>
  Object.values(workspace.files).reduce((total, file) => total + file.content.length, 0);

const assertWorkspaceContentLimit = (workspace: WorkspaceState, additionalLength = 0) => {
  if (workspaceContentLength(workspace) + additionalLength > MAX_WORKSPACE_CONTENT_LENGTH) {
    throw new Error("Workspace content limit reached");
  }
};

const uniqueName = (workspace: WorkspaceState, parentId: string, preferredName: string) => {
  if (!containsName(workspace, parentId, preferredName)) return preferredName;
  const dot = preferredName.lastIndexOf(".");
  const base = dot > 0 ? preferredName.slice(0, dot) : preferredName;
  const suffix = dot > 0 ? preferredName.slice(dot) : "";
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} copy ${index}${suffix}`;
    if (!containsName(workspace, parentId, candidate)) return candidate;
  }
  throw new Error("Could not choose a unique file name");
};

const descendantFolderIds = (workspace: WorkspaceState, folderId: string): string[] => {
  const ids = [folderId];
  for (let cursor = 0; cursor < ids.length; cursor += 1) {
    for (const folder of Object.values(workspace.folders)) if (folder.parentId === ids[cursor]) ids.push(folder.id);
  }
  return ids;
};

const removeNode = (workspace: WorkspaceState, nodeId: string, actorId: string) => {
  const file = workspace.files[nodeId];
  const folder = workspace.folders[nodeId];
  if (!file && !folder) throw new Error("Workspace item was not found");
  if (folder?.id === workspace.rootFolderId) throw new Error("The workspace root cannot be deleted");
  const folderIds = folder ? descendantFolderIds(workspace, folder.id) : [];
  const files = file ? [file] : Object.values(workspace.files).filter((entry) => folderIds.includes(entry.parentId));
  const folders = folder ? Object.values(workspace.folders).filter((entry) => folderIds.includes(entry.id)) : [];
  if (files.length === Object.keys(workspace.files).length) throw new Error("Create another file before deleting the last file");
  const trash: WorkspaceTrashEntry = { id: randomUUID(), kind: file ? "file" : "folder", deletedAt: Date.now(), deletedByUserId: actorId, files, folders };
  for (const entry of files) delete workspace.files[entry.id];
  for (const entry of folders) delete workspace.folders[entry.id];
  workspace.openFileIds = workspace.openFileIds.filter((id) => !files.some((entry) => entry.id === id));
  workspace.recentlyOpenedFileIds = workspace.recentlyOpenedFileIds.filter((id) => !files.some((entry) => entry.id === id));
  workspace.trash = [trash, ...workspace.trash].slice(0, MAX_TRASH_ENTRIES);
  if (!workspace.files[workspace.activeFileId]) {
    const fallback = workspace.openFileIds[workspace.openFileIds.length - 1] ?? Object.keys(workspace.files)[0] ?? "";
    if (fallback) updateOpened(workspace, fallback);
  }
};

export const createWorkspace = (ownerId: string, workspaceId: string, language: SupportedLanguage, code: string, name = "Untitled workspace"): WorkspaceState => {
  const now = Date.now();
  const rootFolderId = randomUUID();
  const fileId = randomUUID();
  const fileName = initialFileName(language);
  return {
    id: workspaceId, name, ownerId, language, rootFolderId,
    folders: { [rootFolderId]: { id: rootFolderId, name, parentId: null, createdAt: now, updatedAt: now, createdByUserId: ownerId } },
    files: { [fileId]: { id: fileId, name: fileName, parentId: rootFolderId, extension: extensionOf(fileName), language, content: code, createdAt: now, updatedAt: now, createdByUserId: ownerId, updatedByUserId: ownerId } },
    openFileIds: [fileId], activeFileId: fileId, recentlyOpenedFileIds: [fileId], execution: { entryFileId: fileId },
    git: { repositoryId: null, branch: null, provider: null, repositoryRootId: null }, ai: { indexedAt: null, contextVersion: 0 }, trash: [], createdAt: now, updatedAt: now
  };
};

export const activeWorkspaceFile = (workspace: WorkspaceState) => workspace.files[workspace.activeFileId] ?? Object.values(workspace.files)[0];

/**
 * Creates a new bounded virtual workspace from repository files. Nothing here
 * touches the host filesystem; the caller is responsible for filtering
 * repository paths before handing them to this function.
 */
export const createWorkspaceFromProjectFiles = (
  existing: WorkspaceState,
  files: Array<{ path: string; content: string; language?: SupportedLanguage }>,
  actorId: string,
  name: string
) => {
  if (!files.length) throw new Error("The selected repository branch has no importable source files");
  if (files.length > 500) throw new Error("A project import is limited to 500 files");
  const uniquePaths = new Set<string>();
  let totalLength = 0;
  for (const entry of files) {
    if (typeof entry.path !== "string" || !entry.path || entry.path.length > 300 || entry.path.startsWith("/") || entry.path.includes("\\")) throw new Error("Repository contains an unsafe file path");
    const segments = entry.path.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("Repository contains an unsafe file path");
    if (isProtectedWorkspacePath(entry.path)) throw new Error("Repository contains a protected file path");
    if (uniquePaths.has(entry.path)) throw new Error("Repository contains duplicate file paths");
    uniquePaths.add(entry.path);
    if (typeof entry.content !== "string") throw new Error("Repository file content is invalid");
    totalLength += entry.content.length;
  }
  if (totalLength > MAX_WORKSPACE_CONTENT_LENGTH) throw new Error("The selected repository is too large for a room workspace");
  const first = files[0];
  const firstName = first.path.split("/").pop() ?? "main.js";
  const fallbackLanguage = first.language ?? languageForFileName(firstName, existing.language);
  const now = Date.now();
  const rootFolderId = randomUUID();
  const folders: Record<string, WorkspaceState["folders"][string]> = {
    [rootFolderId]: { id: rootFolderId, name: cleanName(name) || existing.name, parentId: null, createdAt: now, updatedAt: now, createdByUserId: actorId }
  };
  const workspaceFiles: Record<string, WorkspaceState["files"][string]> = {};
  const folderIds = new Map<string, string>([["", rootFolderId]]);
  const getFolder = (parts: string[]) => {
    let path = "";
    let parentId: string = rootFolderId;
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      const known = folderIds.get(path);
      if (known) { parentId = known; continue; }
      const id = randomUUID();
      folders[id] = { id, name: cleanName(part), parentId, createdAt: now, updatedAt: now, createdByUserId: actorId };
      folderIds.set(path, id);
      parentId = id;
    }
    return parentId;
  };
  const openFileIds: string[] = [];
  for (const entry of files) {
    const parts = entry.path.split("/");
    const fileName = cleanName(parts.pop());
    const parentId = getFolder(parts);
    const id = randomUUID();
    const language = entry.language ?? languageForFileName(fileName, fallbackLanguage);
    workspaceFiles[id] = { id, name: fileName, parentId, extension: extensionOf(fileName), language, content: entry.content, createdAt: now, updatedAt: now, createdByUserId: actorId, updatedByUserId: actorId };
    openFileIds.push(id);
  }
  const activeFileId = openFileIds[0];
  return {
    ...existing,
    name: cleanName(name) || existing.name,
    language: workspaceFiles[activeFileId].language,
    rootFolderId,
    folders,
    files: workspaceFiles,
    openFileIds: openFileIds.slice(0, MAX_OPEN_FILES),
    activeFileId,
    recentlyOpenedFileIds: [activeFileId],
    execution: { entryFileId: activeFileId },
    ai: { indexedAt: null, contextVersion: existing.ai.contextVersion + 1 },
    trash: [],
    updatedAt: now
  } satisfies WorkspaceState;
};

export const updateWorkspaceFileContent = (workspace: WorkspaceState, fileId: string | undefined, content: string, actorId: string) => {
  const file = requireFile(workspace, fileId ?? workspace.activeFileId);
  assertWorkspaceContentLimit(workspace, content.length - file.content.length);
  file.content = content;
  file.updatedAt = Date.now();
  file.updatedByUserId = actorId;
  workspace.updatedAt = file.updatedAt;
  workspace.ai.contextVersion += 1;
  return file;
};

export const applyWorkspaceOperation = (workspace: WorkspaceState, operation: WorkspaceOperation, actorId: string) => {
  const now = Date.now();
  switch (operation.type) {
    case "create-file": {
      const parent = requireFolder(workspace, operation.parentId ?? workspace.rootFolderId);
      const name = cleanName(operation.name);
      if (Object.keys(workspace.files).length >= MAX_WORKSPACE_FILES) throw new Error("Workspace file limit reached");
      if (containsName(workspace, parent.id, name)) throw new Error("An item with that name already exists in this folder");
      const id = randomUUID();
      const language = languageForFileName(name, workspace.language);
      workspace.files[id] = { id, name, parentId: parent.id, extension: extensionOf(name), language, content: "", createdAt: now, updatedAt: now, createdByUserId: actorId, updatedByUserId: actorId };
      updateOpened(workspace, id);
      break;
    }
    case "create-folder": {
      const parent = requireFolder(workspace, operation.parentId ?? workspace.rootFolderId);
      const name = cleanName(operation.name);
      if (Object.keys(workspace.folders).length >= MAX_WORKSPACE_FOLDERS) throw new Error("Workspace folder limit reached");
      if (folderDepth(workspace, parent.id) >= MAX_WORKSPACE_DEPTH) throw new Error("Workspace folder depth limit reached");
      if (containsName(workspace, parent.id, name)) throw new Error("An item with that name already exists in this folder");
      const id = randomUUID();
      workspace.folders[id] = { id, name, parentId: parent.id, createdAt: now, updatedAt: now, createdByUserId: actorId };
      break;
    }
    case "rename": {
      const name = cleanName(operation.name);
      const node = workspace.files[operation.nodeId ?? ""] ?? workspace.folders[operation.nodeId ?? ""];
      if (!node || node.id === workspace.rootFolderId) throw new Error("Workspace item was not found");
      if (containsName(workspace, node.parentId ?? "", name, node.id)) throw new Error("An item with that name already exists in this folder");
      node.name = name; node.updatedAt = now;
      if ("extension" in node) { node.extension = extensionOf(name); node.language = languageForFileName(name, node.language); }
      break;
    }
    case "delete": removeNode(workspace, operation.nodeId ?? "", actorId); break;
    case "duplicate-file": {
      const source = requireFile(workspace, operation.sourceId ?? operation.nodeId);
      const parentId = operation.targetParentId ?? source.parentId;
      requireFolder(workspace, parentId);
      if (Object.keys(workspace.files).length >= MAX_WORKSPACE_FILES) throw new Error("Workspace file limit reached");
      assertWorkspaceContentLimit(workspace, source.content.length);
      const id = randomUUID(); const name = uniqueName(workspace, parentId, source.name);
      workspace.files[id] = { ...source, id, name, parentId, createdAt: now, updatedAt: now, createdByUserId: actorId, updatedByUserId: actorId };
      updateOpened(workspace, id); break;
    }
    case "move": {
      const node = workspace.files[operation.nodeId ?? ""] ?? workspace.folders[operation.nodeId ?? ""];
      const target = requireFolder(workspace, operation.targetParentId);
      if (!node || node.id === workspace.rootFolderId) throw new Error("Workspace item was not found");
      const movingFolder = workspace.folders[node.id];
      if (node.id === target.id || (movingFolder && descendantFolderIds(workspace, movingFolder.id).includes(target.id))) throw new Error("Folders cannot be moved into themselves");
      if (movingFolder) {
        const nestedDepth = Math.max(...descendantFolderIds(workspace, movingFolder.id).map((id) => folderDepth(workspace, id) - folderDepth(workspace, movingFolder.id)));
        if (folderDepth(workspace, target.id) + 1 + nestedDepth > MAX_WORKSPACE_DEPTH) throw new Error("Workspace folder depth limit reached");
      }
      if (containsName(workspace, target.id, node.name, node.id)) throw new Error("An item with that name already exists in this folder");
      node.parentId = target.id; node.updatedAt = now; break;
    }
    case "copy": requireFile(workspace, operation.sourceId ?? operation.nodeId); break;
    case "paste": {
      const source = requireFile(workspace, operation.sourceId);
      const parentId = operation.targetParentId ?? workspace.rootFolderId;
      requireFolder(workspace, parentId);
      if (Object.keys(workspace.files).length >= MAX_WORKSPACE_FILES) throw new Error("Workspace file limit reached");
      assertWorkspaceContentLimit(workspace, source.content.length);
      const id = randomUUID(); const name = uniqueName(workspace, parentId, source.name);
      workspace.files[id] = { ...source, id, name, parentId, createdAt: now, updatedAt: now, createdByUserId: actorId, updatedByUserId: actorId };
      updateOpened(workspace, id); break;
    }
    case "restore-file": {
      const trashIndex = workspace.trash.findIndex((entry) => entry.id === operation.nodeId && entry.kind === "file");
      if (trashIndex < 0) throw new Error("Deleted file was not found");
      const [trash] = workspace.trash.splice(trashIndex, 1); const file = trash.files[0];
      const parentId = workspace.folders[file.parentId] ? file.parentId : workspace.rootFolderId;
      const restored = { ...file, parentId, name: uniqueName(workspace, parentId, file.name), updatedAt: now, updatedByUserId: actorId };
      workspace.files[restored.id] = restored; updateOpened(workspace, restored.id); break;
    }
    case "set-active-file": updateOpened(workspace, requireFile(workspace, operation.nodeId).id); break;
    case "set-open-files": {
      const ids = (operation.fileIds ?? []).slice(-MAX_OPEN_FILES).filter((id) => Boolean(workspace.files[id]));
      workspace.openFileIds = [...new Set(ids)];
      if (!workspace.openFileIds.includes(workspace.activeFileId)) updateOpened(workspace, workspace.openFileIds[workspace.openFileIds.length - 1] ?? Object.keys(workspace.files)[0]);
      break;
    }
    case "set-file-language": {
      const file = requireFile(workspace, operation.nodeId);
      if (!operation.language || !LANGUAGE_CONFIG[operation.language]) throw new Error("Unsupported language");
      file.language = operation.language; file.updatedAt = now; file.updatedByUserId = actorId; break;
    }
  }
  workspace.updatedAt = now;
  workspace.ai.contextVersion += 1;
  return activeWorkspaceFile(workspace);
};
