import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { formatTimestamp } from "../../lib/format";
import type { ChatMessage, UserSession } from "../../types/collaboration";
import { Panel } from "../ui/Panel";

interface ChatPanelProps {
  messages: ChatMessage[];
  session: UserSession;
  roomId: string;
  socketRef: MutableRefObject<Socket | null>;
}

export const ChatPanel = ({ messages, session, roomId, socketRef }: ChatPanelProps) => {
  const [message, setMessage] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    socketRef.current?.emit("chat:send", {
      roomId,
      userId: session.userId,
      message: trimmed
    });
    setMessage("");
  };

  return (
    <Panel className="flex min-h-[320px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-sky-400/10 p-2 text-sky-200">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">Room Chat</p>
          <h3 className="font-display text-xl text-white">Fast conversation</h3>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 space-y-3 overflow-auto rounded-2xl border border-white/10 bg-surface-900/80 p-3">
        {messages.length ? (
          messages.map((entry) => (
            <article key={entry.id} className="rounded-2xl bg-white/[0.04] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-white">{entry.username}</p>
                <time className="text-xs text-slate-400">{formatTimestamp(entry.timestamp)}</time>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-200">{entry.message}</p>
            </article>
          ))
        ) : (
          <div className="flex h-full min-h-[180px] items-center justify-center text-center text-sm text-slate-400">
            Conversation in this room will appear here in real time.
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex gap-3">
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Drop a note for the room..."
          className="flex-1 rounded-2xl border border-white/10 bg-surface-900 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/40"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-2xl bg-sky-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-sky-300"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </Panel>
  );
};

