import { formatTimestamp, titleCase } from "../../lib/format";
import type { ChatMessage as ChatMessageType, Participant } from "../../types/collaboration";

export interface ChatMessageProps {
  message: ChatMessageType;
  isSelf: boolean;
  participant?: Participant;
}

export const ChatMessage = ({ message, isSelf, participant }: ChatMessageProps) => (
  <article
    className={`chat-message rounded-xl border px-3 py-2.5 ${isSelf ? "theme-chat-self" : "theme-chat-message"}`}
  >
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{isSelf ? "You" : message.username}</p>
        {participant ? (
          <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--badge-bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {titleCase(participant.role)}
          </span>
        ) : null}
      </div>
      <time className="shrink-0 text-[11px] text-[var(--text-faint)] tabular-nums">{formatTimestamp(message.timestamp)}</time>
    </div>
    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{message.message}</p>
  </article>
);
