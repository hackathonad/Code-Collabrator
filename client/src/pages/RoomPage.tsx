import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChatPanel } from "../components/chat/ChatPanel";
import { AIAssistantPanel } from "../components/ai/AIAssistantPanel";
import { MediaCallPanel } from "../components/media/MediaCallPanel";
import { CollaborativeEditor } from "../components/editor/CollaborativeEditor";
import { RoomToolbar } from "../components/layout/RoomToolbar";
import { ParticipantsPanel } from "../components/sidebar/ParticipantsPanel";
import { WorkspaceExplorer } from "../components/workspace/WorkspaceExplorer";
import { WorkspaceTabs } from "../components/workspace/WorkspaceTabs";
import { SettingsModal } from "../components/ui/SettingsModal";
import { ToastViewport } from "../components/ui/ToastViewport";
import { useToast } from "../hooks/useToast";
import { copyRoomCode, runCodeExternally } from "../lib/editorActions";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { useRoomStore } from "../store/useRoomStore";
import { useGitStore } from "../store/useGitStore";
import { useAIStore } from "../store/useAIStore";
import { useMediaStore } from "../store/useMediaStore";
import { useTheme } from "../context/ThemeContext";
import type { RoomSnapshot, SupportedLanguage } from "../types/collaboration";

export const RoomPage = () => {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [joining, setJoining] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isMediaOpen, setIsMediaOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const editorAIActionsRef = useRef<{ insertAtCursor: (code: string) => boolean; replaceSelection: (selection: { fileId: string; code: string; startOffset: number; endOffset: number }, code: string) => boolean; replaceFile: (code: string) => boolean } | null>(null);
  const { room, session, connectionStatus, error, chatTypingUsers, editorTypingUsers, setRoom, setSession, setError } =
    useRoomStore();
  const { toasts, pushToast, dismissToast } = useToast();
  const { setThemeId, themeId } = useTheme();
  const socketRef = useRoomSocket(roomId, session);
  const aiSelection = useAIStore((state) => state.selection);
  const setAISelection = useAIStore((state) => state.setSelection);
  const setAIAction = useAIStore((state) => state.setAction);
  const { roomId: gitRoomId, repository, loading: gitLoading, error: gitError, initialize: initializeGit, clear: clearGit } = useGitStore();

  const initialRoom = (location.state as { room?: import("../types/collaboration").RoomSnapshot; session?: import("../types/collaboration").UserSession } | null)?.room;
  const initialSession = (location.state as { room?: import("../types/collaboration").RoomSnapshot; session?: import("../types/collaboration").UserSession } | null)?.session;

  useEffect(() => {
    setRoom(null);
    setError(null);

    if (initialSession) {
      storage.saveSession(initialSession);
      setSession(initialSession);
      setUsername(initialSession.username);
      if (initialRoom) {
        storage.saveRoomSnapshot(initialRoom);
        setRoom(initialRoom);
      }
      return;
    }

    const savedSession = storage.getSession(roomId);
    if (savedSession) {
      setSession(savedSession);
      setUsername(savedSession.username);
      return;
    }

    setSession(null);
    setUsername("");
  }, [roomId, initialRoom, initialSession, setRoom, setSession]);

  useEffect(() => {
    if (!session) {
      return;
    }

    storage.touchRecentRoom(session.roomId, session.username);
  }, [session]);

  const toggleChat = () => {
    setIsChatOpen((open) => {
      const next = !open;
      if (next) setIsAIOpen(false);
      return next;
    });
  };

  const toggleAI = () => {
    setIsAIOpen((open) => {
      const next = !open;
      if (next) setIsChatOpen(false);
      return next;
    });
  };

  const openMedia = () => {
    setIsMediaOpen(true);
    setIsChatOpen(false);
    setIsAIOpen(false);
  };

  const insertAICode = (generatedCode: string) => {
    if (!room || room.isPaused) {
      pushToast("Resume editing before inserting AI code");
      return;
    }
    if (!editorAIActionsRef.current?.insertAtCursor(generatedCode)) pushToast("Open the target file before inserting AI code");
    else pushToast("AI code inserted at the cursor");
  };

  const replaceAISelection = (generatedCode: string) => {
    if (!room || room.isPaused || !aiSelection) { pushToast("Select the original code before replacing it"); return; }
    if (!editorAIActionsRef.current?.replaceSelection(aiSelection, generatedCode)) { pushToast("The selection changed. AI code was not applied."); return; }
    setAISelection(null); pushToast("AI code replaced the selection");
  };

  const replaceAIFile = (generatedCode: string) => {
    if (!room || room.isPaused || !window.confirm("Replace the active file with this AI code? You can undo this in the editor.")) return;
    if (!editorAIActionsRef.current?.replaceFile(generatedCode)) pushToast("Open the target file before replacing it");
    else pushToast("Active file replaced with AI code");
  };

  useEffect(() => () => {
    useAIStore.getState().clearRuntime();
    void useMediaStore.getState().leave();
  }, [roomId]);

  useEffect(() => {
    if (!session || room) {
      return;
    }

    const cachedRoom = storage.getRoomSnapshot(roomId);
    let isMounted = true;

    (async () => {
      try {
        const fetchedRoom = await api.getRoom(roomId, session);
        if (isMounted) {
          storage.saveRoomSnapshot(fetchedRoom);
          setRoom(fetchedRoom);
        }
      } catch (err) {
        if (cachedRoom && isMounted) {
          setRoom(cachedRoom);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load room");
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [roomId, room, session, setRoom, setError]);

  const joinRoom = async () => {
    if (!username.trim()) {
      setError("Username is required to join the room");
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const previousSession = storage.getSession(roomId);
      const result = await api.joinRoom(roomId, username.trim(), previousSession);
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

  useEffect(() => {
    if (!room) {
      clearGit();
      return;
    }

    void initializeGit(room.roomId, room.workspace.id);
    return () => clearGit();
  }, [room?.roomId, room?.workspace.id, initializeGit, clearGit]);

  const gitStatusByFileId = useMemo(() => Object.fromEntries(
    (repository?.status.entries ?? [])
      .filter((entry): entry is typeof entry & { workspaceFileId: string } => Boolean(entry.workspaceFileId))
      .map((entry) => [entry.workspaceFileId, entry.status])
  ), [repository]);

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
        code: room.workspace.files[room.workspace.activeFileId]?.content ?? room.code,
        language: room.workspace.files[room.workspace.activeFileId]?.language ?? room.language
      });
      pushToast("Code copied - run in the new tab");
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
      await copyRoomCode(room.workspace.files[room.workspace.activeFileId]?.content ?? room.code);
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
    if (!session || !socketRef.current) {
      setError("Reconnect before resetting code.");
      return;
    }
    socketRef.current.emit("room:restart", { roomId, actingUserId: session.userId }, (reply: { ok: boolean; room?: RoomSnapshot; message?: string }) => {
      if (!reply.ok || !reply.room) {
        setError(reply.message ?? "Unable to reset code.");
        return;
      }
      setRoom(reply.room);
      pushToast("Default boilerplate restored");
    });
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
              {joining ? "Joining..." : "Join room"}
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
        <div className="theme-panel-solid flex flex-col items-center gap-4 rounded-xl border px-5 py-6 text-center">
          {error ? (
            <>
              <CircleAlert className="h-5 w-5 text-rose-400" />
              <p className="text-sm font-semibold text-rose-100">{error}</p>
              <p className="max-w-sm text-xs text-rose-200">The room may have been deleted, the session may have expired, or the backend may be unavailable.</p>
              <div className="flex flex-wrap justify-center gap-2"><button type="button" onClick={() => navigate("/")} className="theme-button-primary rounded-lg px-3 py-2 text-xs">Go home</button><button type="button" onClick={() => window.location.reload()} className="theme-button-neutral rounded-lg border px-3 py-2 text-xs">Retry</button></div>
            </>
          ) : (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin text-[var(--accent)]" />
              <span className="text-sm text-[var(--text-secondary)]">Loading `{roomId}`...</span>
            </>
          )}
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
        aiOpen={isAIOpen}
        session={session}
        onOpenMedia={openMedia}
        onToggleChat={toggleChat}
        onToggleAI={toggleAI}
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
        <aside className="hidden w-[260px] shrink-0 flex-col overflow-hidden sm:flex lg:w-[280px]">
          <div className="min-h-0 flex-[3] overflow-hidden"><WorkspaceExplorer roomId={room.roomId} session={session} workspace={room.workspace} socketRef={socketRef} onNotify={pushToast} repository={gitRoomId === room.roomId ? repository : null} gitLoading={gitRoomId === room.roomId && gitLoading} gitError={gitRoomId === room.roomId ? gitError : null} gitStatusByFileId={gitRoomId === room.roomId ? gitStatusByFileId : {}} /></div>
          <div className="min-h-0 flex-[2] overflow-hidden"><ParticipantsPanel participants={room.participants} editorTypingUsers={editorTypingUsers} session={session} ownerId={room.ownerId} roomId={room.roomId} socketRef={socketRef} onNotify={pushToast} /></div>
        </aside>

        <section className="min-h-0 min-w-0 flex flex-1 flex-col p-2 sm:p-3">
          <WorkspaceTabs roomId={room.roomId} session={session} workspace={room.workspace} socketRef={socketRef} />
          <div className="min-h-0 flex-1"><CollaborativeEditor
            code={room.workspace.files[room.workspace.activeFileId]?.content ?? room.code}
            language={room.workspace.files[room.workspace.activeFileId]?.language ?? room.language}
            participants={room.participants}
            editorTypingUsers={editorTypingUsers}
            session={session}
            roomId={room.roomId}
            fileId={room.workspace.activeFileId}
            openFileIds={room.workspace.openFileIds}
            socketRef={socketRef}
            onChangeLanguage={changeLanguage}
            isPaused={room.isPaused}
            onSelectionChange={setAISelection}
            onOpenAIAssistant={(action) => { setAIAction(action ?? "custom"); setIsAIOpen(true); setIsChatOpen(false); }}
            onEditorAIReady={(actions) => { editorAIActionsRef.current = actions; }}
          /></div>
        </section>

        <div
          className={`flex min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            isChatOpen || isAIOpen || isMediaOpen ? "w-[min(100vw-1rem,20rem)] sm:w-[25rem]" : "w-0"
          }`}
        >
          {isMediaOpen ? (
            <MediaCallPanel roomId={room.roomId} session={session} onClose={() => setIsMediaOpen(false)} />
          ) : isAIOpen ? (
            <AIAssistantPanel
              roomId={room.roomId}
              workspaceId={room.workspace.id}
              currentFileId={room.workspace.activeFileId}
              session={session}
              canInsert={!room.isPaused}
              onClose={() => setIsAIOpen(false)}
              onInsertCode={insertAICode}
              onReplaceSelection={replaceAISelection}
              onReplaceFile={replaceAIFile}
            />
          ) : isChatOpen ? (
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
