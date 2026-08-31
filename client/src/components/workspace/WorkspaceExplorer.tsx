import { ChevronDown, ChevronRight, Copy, FileCode2, FileText, Folder, FolderInput, FolderOpen, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Users } from "lucide-react";
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
  mode?: "explorer" | "search" | "source-control";
  onOpenMessages?: () => void;
  onOpenActivity?: () => void;
  onOpenFile?: (fileId: string) => void;
  onRefreshGit?: () => Promise<void>;
  onReviewDiff?: () => void;
}

const byName = <T extends { name: string }>(left: T, right: T) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
const operationId = () => crypto.randomUUID();

export const WorkspaceExplorer = ({ roomId, session, workspace, socketRef, onNotify, repository = null, gitLoading = false, gitError = null, gitStatusByFileId = {}, mode = "explorer", onOpenMessages, onOpenActivity, onOpenFile, onRefreshGit, onReviewDiff }: WorkspaceExplorerProps) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [clipboardFileId, setClipboardFileId] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [searchType, setSearchType] = useState<"files" | "content">("files");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fileType, setFileType] = useState("all");
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
  const contentResults = useMemo(() => {
    const query = fileQuery.trim();
    if (mode !== "search" || !query) return [] as Array<{ file: WorkspaceFile; line: number; text: string }>;
    const normalizedQuery = caseSensitive ? query : query.toLocaleLowerCase();
    const files = Object.values(workspace.files).slice(0, 500).filter((file) => fileType === "all" || file.extension === fileType);
    const results: Array<{ file: WorkspaceFile; line: number; text: string }> = [];
    for (const file of files) {
      file.content.split("\n").forEach((text, index) => {
        const haystack = caseSensitive ? text : text.toLocaleLowerCase();
        if (haystack.includes(normalizedQuery) && results.length < 20) results.push({ file, line: index + 1, text: text.trim().slice(0, 180) });
      });
      if (results.length >= 20) break;
    }
    return results;
  }, [caseSensitive, fileQuery, fileType, mode, workspace.files]);

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
  const refreshWorkspace = () => {
    if (!socketRef.current?.connected) { onNotify("Reconnect to refresh the workspace."); return; }
    socketRef.current.emit("room:join", { roomId, userId: session.userId });
    onNotify("Refreshing workspace…");
  };
  const copyRoomId = async () => {
    try { await navigator.clipboard.writeText(roomId); onNotify("Room ID copied"); }
    catch { onNotify("Could not copy the room ID"); }
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
    const query = fileQuery.trim().toLocaleLowerCase();
    const childFiles = (filesByParent.get(folder.id) ?? []).filter((file) => !query || file.name.toLocaleLowerCase().includes(query));
    const hasMatchingDescendant = (folderId: string): boolean => {
      const directFiles = (filesByParent.get(folderId) ?? []).some((file) => !query || file.name.toLocaleLowerCase().includes(query));
      if (!query) return true;
      return directFiles || (foldersByParent.get(folderId) ?? []).some((child) => hasMatchingDescendant(child.id));
    };
    const childFolders = (foldersByParent.get(folder.id) ?? []).filter((child) => hasMatchingDescendant(child.id));
    if (query && !childFiles.length && !childFolders.length && folder.id !== workspace.rootFolderId) return null;
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
  if (mode === "source-control") return <div className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--glass)] py-3 backdrop-blur-xl">
    <div className="flex items-center justify-between gap-2 px-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Workspace</p><h2 className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">Source control</h2></div><button type="button" onClick={refreshWorkspace} title="Refresh workspace status" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--badge-bg)] hover:text-[var(--text-primary)]"><RefreshCw className="h-4 w-4" /></button></div>
    <div className="min-h-0 flex-1 overflow-auto pt-2"><SourceControlPanel roomId={roomId} session={session} repository={repository} loading={gitLoading} error={gitError} onRefresh={onRefreshGit ?? (async () => undefined)} onNotify={onNotify} onReviewDiff={onReviewDiff} /></div>
    <div className="mx-3 mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3"><span className="truncate font-mono text-[10px] text-[var(--text-faint)]">{roomId}</span><button type="button" onClick={() => void copyRoomId()} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--badge-bg)] hover:text-[var(--text-primary)]" title="Copy room ID"><Copy className="h-3.5 w-3.5" /></button></div>
  </div>;
  if (mode === "search") return <div className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--glass)] py-3 backdrop-blur-xl">
    <div className="flex items-center justify-between gap-2 px-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Workspace</p><h2 className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">Search</h2></div><Search className="h-4 w-4 text-[var(--accent)]" /></div>
    <div className="grid gap-2 px-3 pt-3"><div className="flex gap-1"><select value={searchType} onChange={(event) => setSearchType(event.target.value as "files" | "content")} className="theme-input rounded border px-2 py-1.5 text-[11px]"><option value="files">File names</option><option value="content">File contents</option></select><select value={fileType} onChange={(event) => setFileType(event.target.value)} className="theme-input min-w-0 flex-1 rounded border px-2 py-1.5 text-[11px]"><option value="all">All types</option>{[...new Set(Object.values(workspace.files).map((file) => file.extension).filter(Boolean))].slice(0, 20).map((extension) => <option key={extension} value={extension}>.{extension}</option>)}</select></div><input autoFocus value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder={searchType === "content" ? "Search in project…" : "Search file names…"} aria-label="Search project" className="theme-input w-full rounded border px-2 py-1.5 text-xs outline-none" /><label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> Case sensitive</label></div>
    <div className="mt-3 min-h-0 flex-1 overflow-auto px-2">{searchType === "content" ? contentResults.map((result) => <button key={`${result.file.id}-${result.line}`} type="button" onClick={() => onOpenFile?.(result.file.id)} className="mb-1 w-full rounded-md border border-transparent px-2 py-2 text-left hover:border-[var(--border)] hover:bg-[var(--badge-bg)]"><span className="block truncate text-[11px] text-[var(--text-secondary)]">{result.file.name}:{result.line}</span><span className="block truncate font-mono text-[10px] text-[var(--text-faint)]">{result.text || "(blank line)"}</span></button>) : Object.values(workspace.files).slice(0, 500).filter((file) => { const query = caseSensitive ? fileQuery.trim() : fileQuery.trim().toLocaleLowerCase(); const name = caseSensitive ? file.name : file.name.toLocaleLowerCase(); return (!query || name.includes(query)) && (fileType === "all" || file.extension === fileType); }).slice(0, 20).map((file) => <button key={file.id} type="button" onClick={() => onOpenFile?.(file.id)} className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[var(--badge-bg)]"><FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" /><span className="min-w-0 truncate">{file.name}</span><span className="ml-auto text-[10px] text-[var(--text-faint)]">{file.extension ? `.${file.extension}` : "file"}</span></button>)}{fileQuery.trim() && searchType === "content" && !contentResults.length ? <p className="px-2 py-4 text-[11px] text-[var(--text-faint)]">No content matches in the bounded workspace search.</p> : null}</div>
  </div>;
  return <div className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--glass)] py-3 backdrop-blur-xl">
    <div className="flex items-center justify-between gap-2 px-3">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Explorer</p><h2 className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">{workspace.name}</h2></div>
      <div className="flex items-center gap-1"><button type="button" className="rounded p-1.5 hover:bg-[var(--badge-bg)]" title="New file" onClick={() => create("create-file")}><Plus className="h-4 w-4" /></button><button type="button" className="rounded p-1.5 hover:bg-[var(--badge-bg)]" title="New folder" onClick={() => create("create-folder")}><FolderPlus className="h-4 w-4" /></button><button type="button" className="rounded p-1.5 hover:bg-[var(--badge-bg)]" title="Refresh workspace" onClick={refreshWorkspace}><RefreshCw className="h-4 w-4" /></button></div>
    </div>
    {clipboardFileId ? <button type="button" className="mx-3 mt-2 rounded border border-[var(--border)] px-2 py-1 text-left text-[11px] text-[var(--text-muted)] hover:bg-[var(--badge-bg)]" onClick={() => emit({ type: "paste", sourceId: clipboardFileId, targetParentId: workspace.rootFolderId })}>Paste copied file in root</button> : null}
    {restore ? <button type="button" className="mx-3 mt-2 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--badge-bg)]" onClick={() => emit({ type: "restore-file", nodeId: restore.id })}><RotateCcw className="h-3 w-3" /> Restore {restore.files[0]?.name}</button> : null}
    <div className="mx-3 mt-3"><input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search files" aria-label="Search workspace files" className="theme-input w-full rounded border px-2 py-1.5 text-xs outline-none" /></div>
    <div className="mt-3 min-h-0 flex-1 overflow-auto px-2">{renderFolder(workspace.folders[workspace.rootFolderId], 0)}</div>
    <div className="mx-3 mt-3 border-t border-[var(--border)] pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Room</p>
      <div className="mt-2 grid gap-1">{onOpenMessages ? <button type="button" onClick={onOpenMessages} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--badge-bg)]"><MessageSquare className="h-3.5 w-3.5 text-[var(--accent)]" />Messages</button> : null}{onOpenActivity ? <button type="button" onClick={onOpenActivity} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--badge-bg)]"><Users className="h-3.5 w-3.5 text-[var(--accent)]" />Participants & activity</button> : null}</div>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--badge-bg)] px-2 py-1.5"><span className="truncate font-mono text-[10px] text-[var(--text-muted)]">Room ID: {roomId}</span><button type="button" onClick={() => void copyRoomId()} className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Copy room ID"><Copy className="h-3.5 w-3.5" /></button></div>
    </div>
  </div>;
};
