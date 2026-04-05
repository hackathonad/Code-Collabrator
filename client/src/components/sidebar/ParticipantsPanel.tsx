import { Copy, Crown, ShieldCheck, Trash2, Users } from "lucide-react";
import type { MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { titleCase } from "../../lib/format";
import type { Participant, UserSession } from "../../types/collaboration";
import { Panel } from "../ui/Panel";

interface ParticipantsPanelProps {
  participants: Participant[];
  session: UserSession;
  ownerId: string;
  roomId: string;
  socketRef: MutableRefObject<Socket | null>;
}

export const ParticipantsPanel = ({ participants, session, ownerId, roomId, socketRef }: ParticipantsPanelProps) => {
  const isOwner = ownerId === session.userId;

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
  };

  const updateRole = (targetUserId: string, role: "editor" | "viewer") => {
    socketRef.current?.emit("room:role", {
      roomId,
      actingUserId: session.userId,
      targetUserId,
      role
    });
  };

  const deleteRoom = () => {
    socketRef.current?.emit("room:delete", {
      roomId,
      userId: session.userId
    });
  };

  return (
    <Panel className="flex h-full flex-col gap-4 animate-fade">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">Room Control</p>
          <h2 className="mt-2 flex items-center gap-2 font-display text-2xl text-white">
            <Users className="h-5 w-5 text-sky-300" />
            Live Crew
          </h2>
        </div>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-sky-400/40 hover:bg-sky-400/10"
        >
          <Copy className="h-4 w-4" />
          Share
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface-900/80 p-3">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Room ID</p>
        <p className="mt-2 font-mono text-lg text-white">{roomId}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-auto pr-1">
        {participants.map((participant) => (
          <article
            key={participant.userId}
            className="rounded-2xl border border-white/8 bg-white/[0.03] p-3 transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-3 w-3 rounded-full accent-${participant.accent}`} />
                  <p className="truncate font-medium text-white">
                    {participant.username}
                    {participant.userId === session.userId ? " (You)" : ""}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Line {participant.cursor.lineNumber}, Col {participant.cursor.column}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {participant.userId === ownerId ? <Crown className="h-4 w-4 text-amber-300" /> : null}
                {participant.isOnline ? (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                    Online
                  </span>
                ) : (
                  <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Away
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                <ShieldCheck className="h-3 w-3" />
                {titleCase(participant.role)}
              </span>

              {isOwner && participant.userId !== ownerId ? (
                <select
                  value={participant.role}
                  onChange={(event) => updateRole(participant.userId, event.target.value as "editor" | "viewer")}
                  className="rounded-full border border-white/10 bg-surface-700 px-3 py-1 text-xs text-slate-100 outline-none transition hover:border-sky-400/40"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {isOwner ? (
        <button
          type="button"
          onClick={deleteRoom}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20"
        >
          <Trash2 className="h-4 w-4" />
          Delete Room
        </button>
      ) : null}
    </Panel>
  );
};

