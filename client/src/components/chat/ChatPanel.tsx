import { PanelRightClose, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { ChatMessage } from "../ui/ChatMessage";
import type { ChatMessage as ChatMessageType, Participant, TypingParticipant, UserSession } from "../../types/collaboration";

interface ChatPanelProps {
  messages: ChatMessageType[];
  participants: Participant[];
  typingUsers: TypingParticipant[];
  session: UserSession;
  roomId: string;
  socketRef: MutableRefObject<Socket | null>;
  onClose: () => void;
}

export const ChatPanel = ({ messages, participants, typingUsers, session, roomId, socketRef, onClose }: ChatPanelProps) => {
  const [message, setMessage] = useState("");
  const [typingListOpen, setTypingListOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef(false);
  const participantLookup = useMemo(
    () => new Map(participants.map((participant) => [participant.userId, participant])),
    [participants]
  );
  const visibleTypingUsers = useMemo(
    () => typingUsers.filter((participant) => participant.userId !== session.userId),
    [typingUsers, session.userId]
  );
  const typingSummary = visibleTypingUsers.length === 1 ? "1 person typing…" : `${visibleTypingUsers.length} people typing…`;

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [messages, visibleTypingUsers]);

  useEffect(
    () => () => {
      if (typingRef.current) {
        socketRef.current?.emit("chat:typing", {
          roomId,
          userId: session.userId,
          isTyping: false
        });
      }
    },
    [roomId, session.userId, socketRef]
  );

  const emitTyping = (isTyping: boolean) => {
    if (typingRef.current === isTyping) {
      return;
    }

    typingRef.current = isTyping;
    socketRef.current?.emit("chat:typing", {
      roomId,
      userId: session.userId,
      isTyping
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    socketRef.current?.emit("chat:send", {
      roomId,
      userId: session.userId,
      message: trimmed,
      messageId: crypto.randomUUID()
    });
    emitTyping(false);
    setMessage("");
  };

  return (
    <div className="chat-panel-shell flex h-full min-h-0 w-full flex-col border-l border-[var(--border)] bg-[var(--glass)] backdrop-blur-xl">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Chat</p>
          <p className="truncate font-display text-sm font-semibold text-[var(--text-primary)]">Room thread</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="theme-button-neutral rounded-lg border p-2"
          aria-label="Collapse chat"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex min-h-9 shrink-0 items-center border-b border-[var(--border)] px-3 text-[11px] text-[var(--text-muted)]">
        {visibleTypingUsers.length ? (
          <>
            <button type="button" onClick={() => setTypingListOpen((open) => !open)} className="rounded-md px-1.5 py-1 text-left hover:bg-[var(--badge-bg)]" aria-expanded={typingListOpen}>
              {typingSummary}
            </button>
            {typingListOpen ? <div className="absolute left-3 top-8 z-20 min-w-40 rounded-lg border border-[var(--border)] bg-[var(--surface-bg)] p-2 shadow-xl">
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Typing now</p>
              {visibleTypingUsers.map((participant) => <p key={participant.userId} className="rounded px-1 py-1 text-xs text-[var(--text-secondary)]">{participant.username}</p>)}
            </div> : null}
          </>
        ) : <span>Nobody is typing</span>}
      </div>

      <div className="theme-chat-thread chat-feed min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length || visibleTypingUsers.length ? (
          <div className="space-y-2">
            {messages.map((entry) => {
              const isCurrentUser = entry.userId === session.userId;
              const participant = participantLookup.get(entry.userId);

              return (
                <ChatMessage key={entry.id} message={entry} isSelf={isCurrentUser} participant={participant} />
              );
            })}
            {visibleTypingUsers.length ? (
              <div className="theme-surface chat-typing rounded-xl border px-3 py-2 text-xs text-[var(--text-muted)]">
                {typingSummary}
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        ) : (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center px-4 text-center text-xs text-[var(--text-muted)]">
            <p className="font-medium text-[var(--text-secondary)]">No messages yet</p>
            <p className="mt-1">Start the room conversation below. New messages appear here in real time.</p>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="theme-divider flex shrink-0 gap-2 border-t p-3">
        <input
          value={message}
          onChange={(event) => {
            const nextValue = event.target.value;
            setMessage(nextValue);
            emitTyping(Boolean(nextValue.trim()));
          }}
          onBlur={() => emitTyping(false)}
          placeholder="Message..."
          className="theme-input min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          className="theme-button-primary inline-flex shrink-0 items-center justify-center rounded-xl px-3 py-2 font-semibold"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
};

