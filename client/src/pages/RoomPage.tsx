import { ArrowLeftRight, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChatPanel } from "../components/chat/ChatPanel";
import { CollaborativeEditor } from "../components/editor/CollaborativeEditor";
import { ExecutionPanel } from "../components/execution/ExecutionPanel";
import { ParticipantsPanel } from "../components/sidebar/ParticipantsPanel";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { useRoomStore } from "../store/useRoomStore";
import type { SupportedLanguage } from "../types/collaboration";

export const RoomPage = () => {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [joining, setJoining] = useState(false);
  const { room, session, connectionStatus, error, setRoom, setSession, setError } = useRoomStore();
  const socketRef = useRoomSocket(roomId, session);

  useEffect(() => {
    setRoom(null);
    const savedSession = storage.getSession(roomId);
    if (savedSession) {
      setSession(savedSession);
      setUsername(savedSession.username);
      return;
    }

    setSession(null);
    setUsername("");
  }, [roomId, setRoom, setSession]);

  const joinRoom = async () => {
    if (!username.trim()) {
      setError("Username is required to join the room");
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const previousSession = storage.getSession(roomId);
      const result = await api.joinRoom(roomId, username.trim(), previousSession?.userId);
      storage.saveSession(result.session);
      setRoom(result.room);
      setSession(result.session);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Unable to join room");
    } finally {
      setJoining(false);
    }
  };

  const currentUser = useMemo(
    () => room?.participants.find((participant) => participant.userId === session?.userId) ?? null,
    [room?.participants, session?.userId]
  );

  const changeLanguage = (language: SupportedLanguage) => {
    if (!session) {
      return;
    }

    socketRef.current?.emit("room:language", {
      roomId,
      userId: session.userId,
      language,
      resetCode: true
    });
  };

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),linear-gradient(180deg,_#020617_0%,_#07111f_100%)] px-4 py-8">
        <div className="w-full max-w-lg rounded-[32px] border border-white/10 bg-surface-800/80 p-8 shadow-panel backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">Join Room</p>
          <h1 className="mt-3 font-display text-4xl text-white">Reconnect to collaborate</h1>
          <p className="mt-4 text-slate-300">Enter a display name to join room `{roomId}`.</p>

          <div className="mt-6 grid gap-4">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Your display name"
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-sky-400/40"
            />
            <button
              type="button"
              onClick={joinRoom}
              disabled={joining}
              className="rounded-2xl bg-sky-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-50"
            >
              {joining ? "Joining..." : "Join Room"}
            </button>
          </div>

          {error ? <p className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,_#020617_0%,_#07111f_100%)] px-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-surface-800/80 px-5 py-4 text-slate-200 shadow-panel">
          <LoaderCircle className="h-5 w-5 animate-spin text-sky-300" />
          Loading room `{roomId}`...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_18%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.12),_transparent_16%),linear-gradient(180deg,_#020617_0%,_#07111f_40%,_#020617_100%)] px-4 py-4 text-white">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col justify-between gap-4 rounded-[28px] border border-white/10 bg-surface-800/70 px-5 py-4 shadow-panel backdrop-blur-xl xl:flex-row xl:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">Code Sphere Room</p>
            <h1 className="mt-2 font-display text-3xl text-white">Collaborative coding cockpit</h1>
            <p className="mt-2 text-sm text-slate-300">
              {room.participants.filter((participant) => participant.isOnline).length} active collaborator(s) • socket {connectionStatus}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
              <ArrowLeftRight className="h-4 w-4 text-sky-300" />
              Room {room.roomId}
            </div>

            <select
              value={room.language}
              onChange={(event) => changeLanguage(event.target.value as SupportedLanguage)}
              disabled={currentUser?.role === "viewer"}
              className="rounded-full border border-white/10 bg-surface-700 px-4 py-2 text-sm text-white outline-none transition focus:border-sky-400/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="cpp">C++</option>
            </select>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20"
            >
              Home
            </button>
          </div>
        </header>

        {error ? (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <CircleAlert className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        <section className="grid min-h-[calc(100vh-180px)] gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <ParticipantsPanel participants={room.participants} session={session} ownerId={room.ownerId} roomId={room.roomId} socketRef={socketRef} />

          <div className="min-h-[640px]">
            <CollaborativeEditor
              code={room.code}
              language={room.language}
              participants={room.participants}
              session={session}
              roomId={room.roomId}
              socketRef={socketRef}
            />
          </div>

          <div className="flex flex-col gap-4">
            <ChatPanel messages={room.chat} session={session} roomId={room.roomId} socketRef={socketRef} />
            <ExecutionPanel code={room.code} language={room.language} />
          </div>
        </section>
      </div>
    </main>
  );
};
