import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Cloud, FolderTree, GitBranch, Phone, Settings, TerminalSquare, Users } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChatPanel } from "../components/chat/ChatPanel";
import { AIAssistantPanel } from "../components/ai/AIAssistantPanel";
import { MediaCallPanel } from "../components/media/MediaCallPanel";
import { CollaborativeEditor } from "../components/editor/CollaborativeEditor";
import { RoomToolbar } from "../components/layout/RoomToolbar";
import { ParticipantsPanel } from "../components/sidebar/ParticipantsPanel";
import { RoomActivityPanel } from "../components/sidebar/RoomActivityPanel";
import { WorkspaceExplorer } from "../components/workspace/WorkspaceExplorer";
import { WorkspaceTabs } from "../components/workspace/WorkspaceTabs";
import { WorkspaceOutputPanel, type WorkspacePanelTab } from "../components/workspace/WorkspaceOutputPanel";
import { SettingsModal } from "../components/ui/SettingsModal";
import { ToastViewport } from "../components/ui/ToastViewport";
import { useToast } from "../hooks/useToast";
import { copyRoomCode, downloadSourceFile, runCodeExternally } from "../lib/editorActions";
import { ApiNetworkError, ApiRequestError, api } from "../lib/api";
import { storage } from "../lib/storage";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { useRoomStore } from "../store/useRoomStore";
import { useGitStore } from "../store/useGitStore";
import { useAIStore } from "../store/useAIStore";
import { useMediaStore } from "../store/useMediaStore";
import { useTheme } from "../context/ThemeContext";
import type { RoomSnapshot, SupportedLanguage } from "../types/collaboration";

type CollaborationPanel = "chat" | "ai" | "people" | "activity" | null;
type ExecutionContext = { output: string; failed: boolean } | undefined;

export const RoomPage = ({ guestMode = false }: { guestMode?: boolean }) => {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [joining, setJoining] = useState(false);
  const [activePanel, setActivePanel] = useState<CollaborationPanel>(null);
  const [isMediaOpen, setIsMediaOpen] = useState(false);
  const [isOutputOpen, setIsOutputOpen] = useState(false);
  const [workspacePanelTab, setWorkspacePanelTab] = useState<WorkspacePanelTab>("run");
  const [activity, setActivity] = useState<"explorer" | "source-control" | "ai" | "run" | "deploy" | "settings">("explorer");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [executionContext, setExecutionContext] = useState<ExecutionContext>(undefined);
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
  const homePath = guestMode ? "/guest" : "/app";

  useEffect(() => {
    if (aiSelection && room && aiSelection.fileId !== room.workspace.activeFileId) setAISelection(null);
  }, [aiSelection, room, setAISelection]);

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
  }, [roomId, initialRoom, initialSession, setError, setRoom, setSession]);

  useEffect(() => {
    if (!session) {
      return;
    }

    storage.touchRecentRoom(session.roomId, session.username);
  }, [session]);

  const toggleChat = () => {
    setActivePanel((current) => current === "chat" ? null : "chat");
  };

  const openMedia = () => {
    setActivePanel("chat");
    setIsMediaOpen(true);
  };

  const selectActivity = (next: "explorer" | "source-control" | "ai" | "run" | "deploy" | "settings") => {
    setActivity(next);
    if (next === "ai") {
      setActivePanel((current) => current === "ai" ? null : "ai");
    }
    if (next === "run") { setWorkspacePanelTab("run"); setIsOutputOpen(true); }
    if (next === "deploy") pushToast("Deploy this workspace from your connected hosting provider.");
    if (next === "settings") setSettingsOpen(true);
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
      } catch (issue) {
        if (cachedRoom && issue instanceof ApiNetworkError && isMounted) {
          setRoom(cachedRoom);
        } else {
          if (issue instanceof ApiRequestError && issue.status === 404) storage.removeRoom(roomId);
          setError(issue instanceof Error ? issue.message : "Failed to load room");
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

  const gitTargetRoomId = room?.roomId ?? "";
  const gitTargetWorkspaceId = room?.workspace.id ?? "";

  useEffect(() => {
    if (!gitTargetRoomId || !gitTargetWorkspaceId) {
      clearGit();
      return;
    }

    void initializeGit(gitTargetRoomId, gitTargetWorkspaceId);
    return () => clearGit();
  }, [gitTargetRoomId, gitTargetWorkspaceId, initializeGit, clearGit]);

  const gitStatusByFileId = useMemo(() => Object.fromEntries(
    (repository?.status.entries ?? [])
      .filter((entry): entry is typeof entry & { workspaceFileId: string } => Boolean(entry.workspaceFileId))
      .map((entry) => [entry.workspaceFileId, entry.status])
  ), [repository]);

  const changeLanguage = (language: SupportedLanguage) => {
    if (!session || room?.isPaused) {
      return;
    }

    setExecutionContext(undefined);

    socketRef.current?.emit("room:language", {
      roomId,
      userId: session.userId,
      language,
      resetCode: true
    });
  };

  const handleRunExternal = async () => {
    if (!room) {
      return false;
    }

    try {
      setExecutionContext({ output: "Opening the external runner. Its execution output remains on that site.", failed: false });
      await runCodeExternally({
        code: room.workspace.files[room.workspace.activeFileId]?.content ?? room.code,
        language: room.workspace.files[room.workspace.activeFileId]?.language ?? room.language
      });
      pushToast("Code copied - run in the new tab");
      return true;
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "Unable to open external runner";
      setExecutionContext({ output: message, failed: true });
      setError(message);
      pushToast("Unable to open external runner");
      return false;
    }
  };

  const handleCopyCode = async () => {
    if (!room) {
      return false;
    }

    try {
      await copyRoomCode(room.workspace.files[room.workspace.activeFileId]?.content ?? room.code);
      pushToast("Code copied to clipboard");
      return true;
    } catch {
      pushToast("Could not copy code");
      return false;
    }
  };

  const handleDownloadFile = () => {
    if (!room) return false;
    try {
      const file = room.workspace.files[room.workspace.activeFileId];
      downloadSourceFile(file?.content ?? room.code, file?.name ?? "main", file?.language ?? room.language);
      pushToast("Source file downloaded");
      return true;
    } catch {
      pushToast("Could not download the source file");
      return false;
    }
  };

  const handleCopyRoomLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      pushToast("Invite link copied");
    } catch {
      pushToast("Could not copy the invite link");
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
    setResetConfirmOpen(true);
  };

  const confirmRestartRoom = () => {
    setResetConfirmOpen(false);
    if (!session || !socketRef.current) return;
    socketRef.current.emit("room:restart", { roomId, actingUserId: session.userId }, (reply: { ok: boolean; room?: RoomSnapshot; message?: string }) => {
      if (!reply.ok || !reply.room) {
        setError(reply.message ?? "Unable to reset code.");
        return;
      }
      setRoom(reply.room);
      setExecutionContext(undefined);
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
              <div className="flex flex-wrap justify-center gap-2"><button type="button" onClick={() => navigate(homePath)} className="theme-button-primary rounded-lg px-3 py-2 text-xs">Go home</button><button type="button" onClick={() => window.location.reload()} className="theme-button-neutral rounded-lg border px-3 py-2 text-xs">Retry</button></div>
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
      {resetConfirmOpen ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-4" role="dialog" aria-modal="true" aria-labelledby="reset-code-title"><div className="theme-panel-solid w-full max-w-sm rounded-2xl border p-5 shadow-2xl"><h2 id="reset-code-title" className="font-display text-base font-semibold text-[var(--text-primary)]">Reset shared code?</h2><p className="mt-2 text-sm leading-5 text-[var(--text-muted)]">Your current edits will be replaced with the {room.language} starter template for everyone in this room.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setResetConfirmOpen(false)} className="theme-button-neutral rounded-lg border px-3 py-2 text-xs">Cancel</button><button type="button" onClick={confirmRestartRoom} className="theme-button-primary rounded-lg px-3 py-2 text-xs">Reset code</button></div></div></div> : null}

      <RoomToolbar
        roomId={room.roomId}
        roomName={room.workspace.name}
        connectionStatus={connectionStatus}
        isPaused={room.isPaused}
        isOwner={isOwner}
        activeParticipants={activeParticipants}
        chatOpen={activePanel === "chat"}
        session={session}
        onOpenMedia={openMedia}
        onToggleChat={toggleChat}
        onCopyCode={() => void handleCopyCode()}
        onRun={() => { setWorkspacePanelTab("run"); setIsOutputOpen(true); }}
        onCopyRoomLink={() => void handleCopyRoomLink()}
        onPauseToggle={togglePause}
        onRestart={restartRoom}
        onOpenSettings={() => setSettingsOpen(true)}
        onHome={() => navigate(homePath)}
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
        <aside className="theme-panel-solid hidden w-[72px] shrink-0 flex-col items-center gap-2 border-r border-[var(--border)] py-3 md:flex" aria-label="Activity bar">
          {[
            ["explorer", FolderTree, "Explorer"],
            ["source-control", GitBranch, "Source control"],
            ["ai", Bot, "AI Assistant"],
            ["run", TerminalSquare, "Run & Debug"],
            ["deploy", Cloud, "Deploy"],
            ["settings", Settings, "Settings"]
          ].map(([id, Icon, label]) => (
            <button key={id as string} type="button" onClick={() => selectActivity(id as "explorer" | "source-control" | "ai" | "run" | "deploy" | "settings")} title={label as string} aria-label={label as string} className={`flex w-14 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] transition ${activity === id ? "bg-[var(--badge-bg)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)] hover:text-[var(--text-primary)]"}`}>
              <Icon className="h-5 w-5" />
              <span className="truncate">{label as string}</span>
            </button>
          ))}
        </aside>

        <aside className="hidden w-[280px] shrink-0 overflow-hidden xl:block">
          <WorkspaceExplorer roomId={room.roomId} session={session} workspace={room.workspace} socketRef={socketRef} onNotify={pushToast} repository={gitRoomId === room.roomId ? repository : null} gitLoading={gitRoomId === room.roomId && gitLoading} gitError={gitRoomId === room.roomId ? gitError : null} gitStatusByFileId={gitRoomId === room.roomId ? gitStatusByFileId : {}} mode={activity === "source-control" ? "source-control" : "explorer"} onOpenMessages={() => setActivePanel("chat")} onOpenActivity={() => setActivePanel("activity")} />
        </aside>

        <section className="min-h-0 min-w-0 flex flex-1 flex-col p-2 sm:p-3">
          <div className="theme-panel-solid flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-[var(--shadow-soft)]">
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
            onOpenAIAssistant={(action) => { setAIAction(action ?? "custom"); setActivePanel("ai"); }}
            onEditorAIReady={(actions) => { editorAIActionsRef.current = actions; }}
            /></div>
          </div>
          <WorkspaceOutputPanel open={isOutputOpen} onToggle={() => setIsOutputOpen((open) => !open)} activeFileName={room.workspace.files[room.workspace.activeFileId]?.name ?? "Untitled"} code={room.workspace.files[room.workspace.activeFileId]?.content ?? room.code} language={room.workspace.files[room.workspace.activeFileId]?.language ?? room.language} activeTab={workspacePanelTab} onActiveTabChange={(tab) => { setWorkspacePanelTab(tab); setIsOutputOpen(true); }} onChangeLanguage={changeLanguage} onRun={handleRunExternal} onCopy={handleCopyCode} onDownload={handleDownloadFile} />
        </section>

        <div
          className={`min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            activePanel !== null
              ? "fixed inset-y-16 right-0 z-30 flex w-[min(100vw-1rem,24rem)] border-l border-[var(--border)] shadow-[-16px_0_36px_rgba(0,0,0,0.28)] xl:static xl:w-[22rem] xl:border-l-0 xl:shadow-none 2xl:w-[24rem]"
              : "hidden xl:flex xl:w-0"
          }`}
        >
          <aside className="theme-panel-solid flex min-h-0 w-full flex-col border-l border-[var(--border)]" aria-label="Collaboration panel">
            <div className="flex shrink-0 items-center border-b border-[var(--border)] px-2 pt-1">
              <button type="button" onClick={() => setActivePanel("chat")} className={`border-b-2 px-2.5 py-2 text-xs font-medium ${activePanel === "chat" ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)]"}`}>Chat</button>
              <button type="button" onClick={() => setActivePanel("people")} className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] ${activePanel === "people" ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)]"}`}><Users className="h-3.5 w-3.5" />People</button>
              <button type="button" onClick={() => setActivePanel("activity")} className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] ${activePanel === "activity" ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)]"}`}>Activity</button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
          {activePanel === "ai" ? (
            <AIAssistantPanel
              roomId={room.roomId}
              workspaceId={room.workspace.id}
              currentFileId={room.workspace.activeFileId}
              session={session}
              canInsert={!room.isPaused}
              execution={executionContext}
              onClose={() => setActivePanel(null)}
              onInsertCode={insertAICode}
              onReplaceSelection={replaceAISelection}
              onReplaceFile={replaceAIFile}
            />
          ) : activePanel === "chat" ? (
            <ChatPanel
              messages={room.chat}
              participants={room.participants}
              typingUsers={chatTypingUsers}
              session={session}
              roomId={room.roomId}
              socketRef={socketRef}
              onClose={() => setActivePanel(null)}
            />
          ) : activePanel === "people" ? <ParticipantsPanel participants={room.participants} editorTypingUsers={editorTypingUsers} session={session} ownerId={room.ownerId} roomId={room.roomId} socketRef={socketRef} onNotify={pushToast} /> : <RoomActivityPanel history={room.history} participants={room.participants} />}
            </div>
            <div className="h-[236px] shrink-0 border-t border-[var(--border)]">
              {isMediaOpen ? <MediaCallPanel roomId={room.roomId} session={session} onClose={() => setIsMediaOpen(false)} /> : <div className="flex h-full flex-col items-center justify-center p-4 text-center"><Phone className="h-6 w-6 text-[var(--accent)]" /><p className="mt-2 text-sm font-medium text-[var(--text-primary)]">Voice &amp; Video</p><p className="mt-1 text-xs text-[var(--text-muted)]">Join a room call without leaving the workspace.</p><button type="button" onClick={openMedia} className="theme-button-primary mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"><Phone className="h-3.5 w-3.5" />Join call</button></div>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
};
