import { X } from "lucide-react";
import type { MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import type { UserSession, WorkspaceOperation, WorkspaceState } from "../../types/collaboration";

interface WorkspaceTabsProps {
  roomId: string;
  session: UserSession;
  workspace: WorkspaceState;
  socketRef: MutableRefObject<Socket | null>;
}

const emitOperation = (socketRef: MutableRefObject<Socket | null>, roomId: string, session: UserSession, operation: Omit<WorkspaceOperation, "id">) =>
  socketRef.current?.emit("workspace:operation", { roomId, userId: session.userId, operation: { ...operation, id: crypto.randomUUID() } });

export const WorkspaceTabs = ({ roomId, session, workspace, socketRef }: WorkspaceTabsProps) => {
  const files = workspace.openFileIds.map((id) => workspace.files[id]).filter(Boolean);
  return <div className="flex min-h-9 shrink-0 overflow-x-auto border-b border-[var(--border)] bg-[var(--glass)]">
    {files.map((file) => <div key={file.id} className={`group flex shrink-0 items-center gap-2 border-r border-[var(--border)] px-3 text-xs ${file.id === workspace.activeFileId ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)]"}`}>
      <button type="button" className="max-w-40 truncate py-2 text-left" onClick={() => emitOperation(socketRef, roomId, session, { type: "set-active-file", nodeId: file.id })}>{file.name}</button>
      <button type="button" className="rounded opacity-0 transition hover:bg-white/10 group-hover:opacity-100" title="Close tab" onClick={() => emitOperation(socketRef, roomId, session, { type: "set-open-files", fileIds: workspace.openFileIds.filter((id) => id !== file.id) })}><X className="h-3.5 w-3.5" /></button>
    </div>)}
  </div>;
};
