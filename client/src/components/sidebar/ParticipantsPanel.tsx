import { Copy, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { SidebarItem } from "../ui/SidebarItem";
import { UserCard } from "../ui/UserCard";
import type { Participant, TypingParticipant, UserSession } from "../../types/collaboration";

interface ParticipantsPanelProps {
  participants: Participant[];
  editorTypingUsers: TypingParticipant[];
  session: UserSession;
  ownerId: string;
  roomId: string;
  socketRef: MutableRefObject<Socket | null>;
  onNotify: (message: string) => void;
}

export const ParticipantsPanel = ({
  participants,
  editorTypingUsers,
  session,
  ownerId,
  roomId,
  socketRef,
  onNotify
}: ParticipantsPanelProps) => {
  const [, setClock] = useState(Date.now());
  const isOwner = ownerId === session.userId;
  const onlineParticipants = participants.filter((participant) => participant.isOnline).length;
  const typingUserIds = useMemo(() => new Set(editorTypingUsers.map((participant) => participant.userId)), [editorTypingUsers]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock(Date.now());
    }, 5_000);

    return () => window.clearInterval(interval);
  }, []);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    onNotify("Invite link copied");
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
      actingUserId: session.userId
    });
    onNotify("Room deleted");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 border-r border-[var(--border)] bg-[var(--glass)] px-3 py-3 backdrop-blur-xl sm:px-4">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Presence</p>
            <h2 className="mt-1 flex items-center gap-2 font-display text-lg font-semibold text-[var(--text-primary)]">
              <Users className="h-4 w-4 text-[var(--accent)] opacity-80" aria-hidden />
              Team
            </h2>
          </div>
          <button
            type="button"
            onClick={copyLink}
            className="theme-button-neutral inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
          >
            <Copy className="h-3.5 w-3.5" />
            Invite
          </button>
        </div>
        <SidebarItem leading={<span className="font-mono text-[10px] text-[var(--text-faint)]">ID</span>}>
          <p className="truncate font-mono text-sm text-[var(--text-primary)]">{roomId}</p>
        </SidebarItem>
        <SidebarItem leading={<span className="text-[10px] text-[var(--text-faint)]">●</span>} active>
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">{onlineParticipants}</span> online
          </p>
        </SidebarItem>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {participants.map((participant) => (
          <UserCard
            key={participant.userId}
            participant={participant}
            isSelf={participant.userId === session.userId}
            isRoomOwner={participant.userId === ownerId}
            typingUserIds={typingUserIds}
            canChangeRole={isOwner && participant.userId !== ownerId}
            onChangeRole={updateRole}
          />
        ))}
      </div>

      {isOwner ? (
        <div className="theme-divider shrink-0 border-t pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Owner</p>
          <button
            type="button"
            onClick={deleteRoom}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/18"
          >
            <Trash2 className="h-4 w-4" />
            Delete room
          </button>
        </div>
      ) : null}
    </div>
  );
};
