import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChatPanel } from "../components/chat/ChatPanel";
import { CollaborativeEditor } from "../components/editor/CollaborativeEditor";
import { RoomToolbar } from "../components/layout/RoomToolbar";
import { ParticipantsPanel } from "../components/sidebar/ParticipantsPanel";
import { SettingsModal } from "../components/ui/SettingsModal";
import { ToastViewport } from "../components/ui/ToastViewport";
import { useToast } from "../hooks/useToast";
import { copyRoomCode, runCodeExternally } from "../lib/editorActions";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { useRoomStore } from "../store/useRoomStore";
import { useTheme } from "../context/ThemeContext";
import type { SupportedLanguage } from "../types/collaboration";

export const RoomPage = () => {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [joining, setJoining] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { room, session, connectionStatus, error, chatTypingUsers, editorTypingUsers, setRoom, setSession, setError } =
    useRoomStore();
  const { toasts, pushToast, dismissToast } = useToast();
  const { setThemeId, themeId } = useTheme();
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

  useEffect(() => {
    if (!session) {
      return;
    }

    storage.touchRecentRoom(session.roomId, session.username);
  }, [session]);

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
      pushToast("Unable to join the room");
    } finally {
      setJoining(false);
    }
  };

  const changeLanguage = (language: SupportedLanguage) => {
    if (!session || room?.isPaused) {
      return;
    }

    socketRef.current?.emit("room:language", {
      roomId,
      userId: session.userId,
      language,
      resetCode: true
    });
  };

  const handleRunExternal = async () => {
    if (!room) {
      return;
    }

    try {
      await runCodeExternally({
        code: room.code,
        language: room.language
      });
      pushToast("Code copied — run in the new tab");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Unable to open external runner");
      pushToast("Unable to open external runner");
    }
  };

  const handleCopyCode = async () => {
    if (!room) {
      return;
    }

    try {
      await copyRoomCode(room.code);
      pushToast("Code copied to clipboard");
    } catch {
      pushToast("Could not copy code");
    }
  };

  const togglePause = () => {
    if (!session || !room) {
      return;
    }

    socketRef.current?.emit("room:pause", {
      roomId,
      actingUserId: session.userId,
      isPaused: !room.isPaused
    });
    pushToast(room.isPaused ? "Room resumed" : "Room paused");
  };

  const restartRoom = () => {
    if (!session) {
      return;
    }

    socketRef.current?.emit("room:restart", {
      roomId,
      actingUserId: session.userId
    });
    pushToast("Room editor cleared");
  };

  if (!session) {
    return (
      <main className="theme-page-join flex min-h-[100dvh] w-full items-center justify-center px-4 py-8">
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
        <div className="theme-panel w-full max-w-md rounded-2xl border p-8 shadow-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--text-faint)]">Join room</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[var(--text-primary)]">Enter your name</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Join room `{roomId}` to start collaborating.</p>

          <div className="mt-6 grid gap-3">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Display name"
              className="theme-input rounded-xl border px-4 py-3 outline-none"
            />
            <button
              type="button"
              onClick={joinRoom}
              disabled={joining}
              className="theme-button-primary rounded-xl px-4 py-3 font-semibold disabled:opacity-50"
            >
              {joining ? "Joining…" : "Join room"}
            </button>
          </div>

          {error ? (
            <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p>
          ) : null}
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="theme-page-loading flex min-h-[100dvh] w-full items-center justify-center px-4">
        <div className="theme-panel-solid flex items-center gap-3 rounded-xl border px-5 py-4">
          <LoaderCircle className="h-5 w-5 animate-spin text-[var(--accent)]" />
          <span className="text-sm text-[var(--text-secondary)]">Loading `{roomId}`…</span>
        </div>
      </main>
    );
  }

  const activeParticipants = room.participants.filter((participant) => participant.isOnline).length;
  const isOwner = room.ownerId === session.userId;

  return (
    <main className="theme-page-room flex h-[100dvh] w-screen max-w-[100vw] flex-col overflow-hidden">
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} themeId={themeId} onSelectTheme={setThemeId} />

      <RoomToolbar
        roomId={room.roomId}
        connectionStatus={connectionStatus}
        isPaused={room.isPaused}
        isOwner={isOwner}
        activeParticipants={activeParticipants}
        chatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((open) => !open)}
        onCopyCode={() => void handleCopyCode()}
        onRun={() => void handleRunExternal()}
        onPauseToggle={togglePause}
        onRestart={restartRoom}
        onOpenSettings={() => setSettingsOpen(true)}
        onHome={() => navigate("/")}
      />

      {room.isPaused ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-100 sm:text-sm">
          <CircleAlert className="h-4 w-4 shrink-0" />
          Editing is paused for everyone. Owners can resume from the toolbar.
        </div>
      ) : null}

      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-100 sm:text-sm">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="hidden w-[260px] shrink-0 overflow-hidden sm:flex lg:w-[280px]">
          <ParticipantsPanel
            participants={room.participants}
            editorTypingUsers={editorTypingUsers}
            session={session}
            ownerId={room.ownerId}
            roomId={room.roomId}
            socketRef={socketRef}
            onNotify={pushToast}
          />
        </aside>

        <section className="min-h-0 min-w-0 flex-1 p-2 sm:p-3">
          <CollaborativeEditor
            code={room.code}
            language={room.language}
            participants={room.participants}
            editorTypingUsers={editorTypingUsers}
            session={session}
            roomId={room.roomId}
            socketRef={socketRef}
            onChangeLanguage={changeLanguage}
            isPaused={room.isPaused}
          />
        </section>

        <div
          className={`flex min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            isChatOpen ? "w-[min(100vw-1rem,20rem)] sm:w-80" : "w-0"
          }`}
        >
          {isChatOpen ? (
            <ChatPanel
              messages={room.chat}
              participants={room.participants}
              typingUsers={chatTypingUsers}
              session={session}
              roomId={room.roomId}
              socketRef={socketRef}
              onClose={() => setIsChatOpen(false)}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
};
