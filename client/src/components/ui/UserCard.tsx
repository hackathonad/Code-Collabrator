import { Crown } from "lucide-react";
import type { Participant } from "../../types/collaboration";
import { formatRelativeTime, titleCase } from "../../lib/format";

export interface UserCardProps {
  participant: Participant;
  isSelf: boolean;
  /** True when this participant is the room owner */
  isRoomOwner: boolean;
  typingUserIds: Set<string>;
  canChangeRole: boolean;
  onChangeRole?: (userId: string, role: "editor" | "viewer") => void;
}

const statusLabel = (participant: Participant) => {
  if (participant.status === "offline") {
    return "Offline";
  }

  return participant.status === "active" ? "Active" : "Idle";
};

const statusDescription = (participant: Participant, typingUserIds: Set<string>) => {
  if (typingUserIds.has(participant.userId)) {
    return "Typing in editor";
  }

  if (participant.status === "active") {
    return "Active in room";
  }

  return `Last active ${formatRelativeTime(participant.lastActiveAt)}`;
};

export const UserCard = ({ participant, isSelf, isRoomOwner, typingUserIds, canChangeRole, onChangeRole }: UserCardProps) => {
  const initials = participant.username
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <article
      className={`rounded-xl border p-3 transition duration-200 ${
        isSelf
          ? "border-[var(--border-strong)] bg-[var(--bg-secondary)] shadow-[0_0_0_1px_var(--accent-glow)]"
          : "border-[var(--border)] bg-[var(--surface-bg)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-elevated)"
          }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-[var(--text-primary)]">
              {participant.username}
              {isSelf ? " · You" : ""}
            </p>
            <span className="rounded-md border border-[var(--border)] bg-[var(--badge-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {titleCase(participant.role)}
            </span>
            {isRoomOwner ? <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-label="Room owner" /> : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Line {participant.cursor.lineNumber}, col {participant.cursor.column}
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-faint)]">{statusDescription(participant, typingUserIds)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`h-2 w-2 rounded-full ${
              participant.status === "active" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]" : "bg-zinc-500"
            }`}
            title={statusLabel(participant)}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--text-faint)]">{statusLabel(participant)}</span>
        {canChangeRole && onChangeRole ? (
          <select
            value={participant.role}
            onChange={(event) => onChangeRole(participant.userId, event.target.value as "editor" | "viewer")}
            className="theme-input max-w-[7rem] rounded-lg border px-2 py-1 text-xs outline-none"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        ) : null}
      </div>
    </article>
  );
};
