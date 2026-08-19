import { ChevronDown, ChevronRight, Copy, FileCode2, FileText, Folder, FolderInput, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState, type MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import type { UserSession, WorkspaceFile, WorkspaceFolder, WorkspaceOperation, WorkspaceState } from "../../types/collaboration";
import type { GitFileStatus, RepositorySummary } from "../../types/git";
import { SourceControlPanel } from "./SourceControlPanel";

interface WorkspaceExplorerProps {
  roomId: string;
  session: UserSession;
  workspace: WorkspaceState;
  socketRef: MutableRefObject<Socket | null>;
  onNotify: (message: string) => void;
  repository?: RepositorySummary | null;
  gitLoading?: boolean;
  gitError?: string | null;
  gitStatusByFileId?: Partial<Record<string, GitFileStatus>>;
}

const byName = <T extends { name: string }>(left: T, right: T) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
const operationId = () => crypto.randomUUID();

export const WorkspaceExplorer = ({ roomId, session, workspace, socketRef, onNotify, repository = null, gitLoading = false, gitError = null, gitStatusByFileId = {} }: WorkspaceExplorerProps) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [clipboardFileId, setClipboardFileId] = useState<string | null>(null);
  const foldersByParent = useMemo(() => {
    const index = new Map<string, WorkspaceFolder[]>();
    Object.values(workspace.folders).forEach((folder) => {
      if (!folder.parentId) return;
      index.set(folder.parentId, [...(index.get(folder.parentId) ?? []), folder]);
    });
    index.forEach((items) => items.sort(byName));
    return index;
  }, [workspace.folders]);
  const filesByParent = useMemo(() => {
    const index = new Map<string, WorkspaceFile[]>();
    Object.values(workspace.files).forEach((file) => index.set(file.parentId, [...(index.get(file.parentId) ?? []), file]));
    index.forEach((items) => items.sort(byName));
    return index;
  }, [workspace.files]);

  const emit = (operation: Omit<WorkspaceOperation, "id">) => socketRef.current?.emit("workspace:operation", { roomId, userId: session.userId, operation: { ...operation, id: operationId() } });
  const askName = (label: string) => window.prompt(label)?.trim();
  const create = (type: "create-file" | "create-folder", parentId = workspace.rootFolderId) => {
    const name = askName(type === "create-file" ? "New file name" : "New folder name");
    if (name) emit({ type, parentId, name });
  };
  const rename = (node: WorkspaceFile | WorkspaceFolder) => {
    const name = window.prompt("Rename", node.name)?.trim();
    if (name && name !== node.name) emit({ type: "rename", nodeId: node.id, name });
  };
  const remove = (node: WorkspaceFile | WorkspaceFolder) => {
    if (window.confirm(`Delete ${node.name}?`)) emit({ type: "delete", nodeId: node.id });
  };
  const open = (file: WorkspaceFile) => emit({ type: "set-active-file", nodeId: file.id });
  const move = (node: WorkspaceFile | WorkspaceFolder) => {
    const destinationName = window.prompt("Move to folder (enter its name)")?.trim();
    if (!destinationName) return;
    const destination = Object.values(workspace.folders).find((folder) => folder.name === destinationName);
    if (!destination) { onNotify("Destination folder was not found"); return; }
    emit({ type: "move", nodeId: node.id, targetParentId: destination.id });
  };

  const renderFile = (file: WorkspaceFile, depth: number) => {
    const gitStatus = gitStatusByFileId[file.id];
    const decoration = gitStatus ? ({ modified: "M", added: "A", deleted: "D", renamed: "R", ignored: "I", conflicted: "!", untracked: "U" } as const)[gitStatus] : null;
    return (
    <div key={file.id} className={`group flex min-w-0 items-center gap-1 rounded-md pr-1 text-sm ${file.id === workspace.activeFileId ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--badge-bg)]"}`} style={{ paddingLeft: 10 + depth * 14 }}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left" onClick={() => open(file)} title={file.name}>
        {file.extension ? <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{file.name}</span>
        {decoration ? <span className="ml-auto shrink-0 text-[10px] font-semibold text-[var(--accent)]" title={`Git: ${gitStatus}`}>{decoration}</span> : null}
      </button>
      <div className="hidden shrink-0 items-center group-hover:flex">
        <button type="button" className="rounded p-1 hover:bg-white/10" title="Copy" onClick={() => { setClipboardFileId(file.id); onNotify(`Copied ${file.name}`); }}><Copy className="h-3 w-3" /></button>
        <button type="button" className="rounded p-1 hover:bg-white/10" title="Duplicate" onClick={() => emit({ type: "duplicate-file", sourceId: file.id })}><MoreHorizontal className="h-3 w-3" /></button>
        <button type="button" className="rounded p-1 hover:bg-white/10" title="Move" onClick={() => move(file)}><FolderInput className="h-3 w-3" /></button>
        <button type="button" className="rounded p-1 hover:bg-white/10" title="Rename" onClick={() => rename(file)}><Pencil className="h-3 w-3" /></button>
        <button type="button" className="rounded p-1 text-rose-300 hover:bg-rose-500/10" title="Delete" onClick={() => remove(file)}><Trash2 className="h-3 w-3" /></button>
      </div>
    </div>
    );
  };

  const renderFolder = (folder: WorkspaceFolder, depth: number) => {
    const isCollapsed = collapsed.has(folder.id);
    const childFolders = foldersByParent.get(folder.id) ?? [];
    const childFiles = filesByParent.get(folder.id) ?? [];
    return <div key={folder.id}>
      <div className="group flex min-w-0 items-center gap-1 rounded-md pr-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--badge-bg)]" style={{ paddingLeft: 6 + depth * 14 }}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left" onClick={() => setCollapsed((current) => { const next = new Set(current); if (isCollapsed) next.delete(folder.id); else next.add(folder.id); return next; })}>
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {isCollapsed ? <Folder className="h-3.5 w-3.5 text-amber-300" /> : <FolderOpen className="h-3.5 w-3.5 text-amber-300" />}
          <span className="truncate">{folder.name}</span>
        </button>
        <div className="hidden shrink-0 items-center group-hover:flex">
          <button type="button" className="rounded p-1 hover:bg-white/10" title="New file" onClick={() => create("create-file", folder.id)}><Plus className="h-3 w-3" /></button>
          <button type="button" className="rounded p-1 hover:bg-white/10" title="New folder" onClick={() => create("create-folder", folder.id)}><FolderPlus className="h-3 w-3" /></button>
          {folder.id !== workspace.rootFolderId ? <><button type="button" className="rounded p-1 hover:bg-white/10" title="Move folder" onClick={() => move(folder)}><FolderInput className="h-3 w-3" /></button><button type="button" className="rounded p-1 hover:bg-white/10" title="Rename" onClick={() => rename(folder)}><Pencil className="h-3 w-3" /></button><button type="button" className="rounded p-1 text-rose-300 hover:bg-rose-500/10" title="Delete folder" onClick={() => remove(folder)}><Trash2 className="h-3 w-3" /></button></> : null}
        </div>
      </div>
      {!isCollapsed ? <div>{childFolders.map((child) => renderFolder(child, depth + 1))}{childFiles.map((file) => renderFile(file, depth + 1))}</div> : null}
    </div>;
  };

  const restore = workspace.trash.find((entry) => entry.kind === "file");
  return <div className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--glass)] py-3 backdrop-blur-xl">
    <div className="flex items-center justify-between gap-2 px-3">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Explorer</p><h2 className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">{workspace.name}</h2></div>
      <div className="flex items-center gap-1"><button type="button" className="rounded p-1.5 hover:bg-[var(--badge-bg)]" title="New file" onClick={() => create("create-file")}><Plus className="h-4 w-4" /></button><button type="button" className="rounded p-1.5 hover:bg-[var(--badge-bg)]" title="New folder" onClick={() => create("create-folder")}><FolderPlus className="h-4 w-4" /></button></div>
    </div>
    {clipboardFileId ? <button type="button" className="mx-3 mt-2 rounded border border-[var(--border)] px-2 py-1 text-left text-[11px] text-[var(--text-muted)] hover:bg-[var(--badge-bg)]" onClick={() => emit({ type: "paste", sourceId: clipboardFileId, targetParentId: workspace.rootFolderId })}>Paste copied file in root</button> : null}
    {restore ? <button type="button" className="mx-3 mt-2 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--badge-bg)]" onClick={() => emit({ type: "restore-file", nodeId: restore.id })}><RotateCcw className="h-3 w-3" /> Restore {restore.files[0]?.name}</button> : null}
    <div className="mt-3 min-h-0 flex-1 overflow-auto px-2">{renderFolder(workspace.folders[workspace.rootFolderId], 0)}</div>
    <SourceControlPanel repository={repository} loading={gitLoading} error={gitError} />
  </div>;
};
