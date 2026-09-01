import { Activity, Bot, Clock3, FilePenLine, Filter, GitBranch, Users } from "lucide-react";
import { useState } from "react";
import type { HistoryEntry, Participant, RoomActivityEntry } from "../../types/collaboration";

interface RoomActivityPanelProps {
  history: HistoryEntry[];
  activity: RoomActivityEntry[];
  participants: Participant[];
}

const reasonLabel: Record<HistoryEntry["reason"], string> = {
  initial: "opened the room",
  autosave: "saved workspace changes",
  "language-change": "changed the workspace language",
  restart: "restored starter code",
  restore: "restored workspace state",
  checkpoint: "created a checkpoint"
};

const relativeTime = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "Just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr ago`;
  return new Date(timestamp).toLocaleDateString();
};

export const RoomActivityPanel = ({ history, activity, participants }: RoomActivityPanelProps) => {
  const entries = activity.length ? activity.slice(0, 24) : history.slice(0, 16).map((entry) => ({ id: entry.id, roomId: "", actorId: entry.createdByUserId, actorName: entry.createdByUsername, kind: "file" as const, message: reasonLabel[entry.reason], createdAt: entry.createdAt, fileId: entry.fileId }));
  const activePeople = participants.filter((participant) => participant.isOnline);
  const [filter, setFilter] = useState<"all" | "humans" | "ai" | "git" | "tests">("all");
  const iconFor = (kind: RoomActivityEntry["kind"]) => kind === "agent" || kind === "patch" || kind === "validation" ? Bot : kind === "presence" ? Users : kind === "git" ? GitBranch : FilePenLine;
  const filteredEntries = entries.filter((entry) => filter === "all" || filter === "humans" && entry.actorId !== "ai" && !["agent", "patch", "validation"].includes(entry.kind) || filter === "ai" && (entry.actorId === "ai" || ["agent", "patch"].includes(entry.kind)) || filter === "git" && entry.kind === "git" || filter === "tests" && entry.kind === "validation");

  return (
    <aside className="chat-panel-shell flex h-full min-h-0 w-full flex-col border-l border-[var(--border)] bg-[var(--glass)] backdrop-blur-xl" aria-label="Room activity">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <Activity className="h-4 w-4 text-[var(--accent)]" />
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Activity</p><p className="font-display text-sm font-semibold text-[var(--text-primary)]">Workspace timeline</p></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--badge-bg)] p-3">
          <p className="text-xs font-medium text-[var(--text-primary)]">{activePeople.length} collaborator{activePeople.length === 1 ? "" : "s"} online</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Presence, edits, and room history update in real time.</p>
        </div>
        <div className="mb-3 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Activity filters"><Filter className="mr-1 h-3 w-3 shrink-0 text-[var(--text-faint)]" />{(["all", "humans", "ai", "git", "tests"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`shrink-0 rounded-md px-2 py-1 text-[10px] capitalize ${filter === value ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)] hover:text-[var(--text-primary)]"}`}>{value === "ai" ? "AI" : value}</button>)}</div>
        {filteredEntries.length ? <ol className="space-y-3">{filteredEntries.map((entry) => { const EntryIcon = iconFor(entry.kind); return <li key={entry.id} className="flex gap-2.5"><div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--badge-bg)]"><EntryIcon className="h-3.5 w-3.5 text-[var(--accent)]" /></div><div className="min-w-0 flex-1"><p className="text-xs leading-5 text-[var(--text-secondary)]"><span className="font-medium text-[var(--text-primary)]">{entry.actorName}</span> {entry.message}</p><p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-faint)]"><Clock3 className="h-3 w-3" />{relativeTime(entry.createdAt)}</p></div></li>; })}</ol> : <div className="flex min-h-[150px] flex-col items-center justify-center text-center"><Activity className="h-6 w-6 text-[var(--accent)]" /><p className="mt-3 text-sm text-[var(--text-muted)]">{entries.length ? "Nothing in this filter yet." : "Room activity will appear here."}</p><p className="mt-1 text-[11px] text-[var(--text-faint)]">Join, file, AI, Git, and validation updates stay bounded and room-scoped.</p></div>}
      </div>
    </aside>
  );
};
