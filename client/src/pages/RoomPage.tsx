import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Cloud, FolderTree, GitBranch, Search, Settings, TerminalSquare, Users } from "lucide-react";
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
import { CommandPalette, type WorkspaceCommand } from "../components/workspace/CommandPalette";
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
import { useExecutionStore } from "../store/useExecutionStore";
import { useTheme } from "../context/ThemeContext";
import type { RoomSnapshot, SupportedLanguage } from "../types/collaboration";
import type { AgentDiagnostic, AgentPatch, ValidationCategory } from "../types/agent";
import type { ExecutionAction, ExecutionRecord } from "../types/execution";

type CollaborationPanel = "chat" | "ai" | "people" | "activity" | null;
type OpenCollaborationPanel = Exclude<CollaborationPanel, null>;
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
  const [activity, setActivity] = useState<"explorer" | "search" | "source-control" | "ai" | "run" | "deploy" | "settings">("explorer");
  const [mobileWorkspaceOpen, setMobileWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [executionContext, setExecutionContext] = useState<ExecutionContext>(undefined);
  const [diagnostics, setDiagnostics] = useState<AgentDiagnostic[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const editorAIActionsRef = useRef<{ insertAtCursor: (code: string) => boolean; replaceSelection: (selection: { fileId: string; code: string; startOffset: number; endOffset: number }, code: string) => boolean; replaceFile: (code: string) => boolean; revealLocation: (fileId: string, line: number, column: number) => boolean } | null>(null);
  const { room, session, connectionStatus, error, chatTypingUsers, editorTypingUsers, activity: roomActivity, setRoom, setSession, setError } =
    useRoomStore();
  const { toasts, pushToast, dismissToast } = useToast();
  const { setThemeId, themeId } = useTheme();
  const socketRef = useRoomSocket(roomId, session);
  const aiSelection = useAIStore((state) => state.selection);
  const setAISelection = useAIStore((state) => state.setSelection);
  const setAIAction = useAIStore((state) => state.setAction);
  const setAIDraft = useAIStore((state) => state.setDraft);
  const { roomId: gitRoomId, repository, loading: gitLoading, error: gitError, initialize: initializeGit, refresh: refreshGit, clear: clearGit } = useGitStore();
  const executionRecords = useExecutionStore((state) => state.records);
  const executionCapabilities = useExecutionStore((state) => state.capabilities);
  const executionError = useExecutionStore((state) => state.error);
  const initializeExecution = useExecutionStore((state) => state.initialize);
  const startExecution = useExecutionStore((state) => state.start);
  const cancelExecution = useExecutionStore((state) => state.cancel);
  const clearExecution = useExecutionStore((state) => state.clear);

  const initialRoom = (location.state as { room?: import("../types/collaboration").RoomSnapshot; session?: import("../types/collaboration").UserSession } | null)?.room;
  const initialSession = (location.state as { room?: import("../types/collaboration").RoomSnapshot; session?: import("../types/collaboration").UserSession } | null)?.session;
  const homePath = guestMode ? "/guest" : "/app";
  const currentRoomId = room?.roomId ?? "";
  const currentWorkspaceId = room?.workspace.id ?? "";

  const showPanel = (panel: OpenCollaborationPanel) => {
    setIsMediaOpen(false);
    setActivePanel(panel);
  };

  const selectActivity = (next: "explorer" | "search" | "source-control" | "ai" | "run" | "deploy" | "settings") => {
    setActivity(next);
    if (next === "explorer" || next === "search" || next === "source-control" || next === "deploy") setMobileWorkspaceOpen(true);
    else setMobileWorkspaceOpen(false);
    if (next === "deploy") pushToast("Deploy is ready for a connected hosting provider or an exported workspace.");
    if (next !== "ai" && activePanel === "ai") setActivePanel(null);
    if (next === "ai") {
      if (activePanel === "ai") setActivePanel(null);
      else showPanel("ai");
    }
    if (next === "run") { setWorkspacePanelTab("run"); setIsOutputOpen(true); }
    if (next === "settings") setSettingsOpen(true);
  };

  useEffect(() => {
    if (aiSelection && room && aiSelection.fileId !== room.workspace.activeFileId) setAISelection(null);
  }, [aiSelection, room, setAISelection]);

  useEffect(() => {
    if (!currentRoomId || !currentWorkspaceId || !session) { clearExecution(); return; }
    void initializeExecution(currentRoomId, currentWorkspaceId, session);
    return () => clearExecution();
  }, [clearExecution, currentRoomId, currentWorkspaceId, initializeExecution, session]);

  useEffect(() => {
    const latest = executionRecords[0];
    if (!latest || !latest.output || ["queued", "running"].includes(latest.status)) return;
    setExecutionContext({ output: latest.output, failed: latest.status !== "completed" });
  }, [executionRecords]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === "p") { event.preventDefault(); setCommandPaletteOpen(true); }
      if (event.key.toLowerCase() === "f" && event.shiftKey) { event.preventDefault(); setActivity("search"); setMobileWorkspaceOpen(true); }
      if (event.key === "`") { event.preventDefault(); setWorkspacePanelTab("terminal"); setIsOutputOpen(true); }
      if (event.key.toLowerCase() === "s" && !event.shiftKey) { event.preventDefault(); pushToast("Edits sync automatically with the room."); }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [pushToast]);

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
    if (activePanel === "chat") setActivePanel(null);
    else showPanel("chat");
  };

  const openMedia = () => {
    setActivePanel(null);
    setIsMediaOpen(true);
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

  const applyAgentPatch = async (patch: AgentPatch) => {
    if (!room || !session || room.isPaused) {
      pushToast("Resume editing before applying an agent patch");
      return;
    }
    if (patch.status !== "pending" || patch.baseVersion !== room.version) {
      useAIStore.getState().markAgentPatchStatus(patch.patchId, "stale");
      pushToast("This proposal is stale. Generate a new patch.");
      return;
    }
    let effectivePatch = patch;
    if (!patch.expectedContent || patch.files?.some((file) => !file.expectedContent)) {
      try {
        effectivePatch = (await api.getAgentProposal(room.roomId, session.guestToken, patch.patchId)).patch;
      } catch (issue) {
        pushToast(issue instanceof Error ? issue.message : "The proposal details could not be loaded");
        return;
      }
    }
    const patchFiles = effectivePatch.files ?? [{ fileId: effectivePatch.fileId, expectedContent: effectivePatch.expectedContent }];
    if (patchFiles.some((file) => room.workspace.files[file.fileId]?.content !== file.expectedContent)) {
      useAIStore.getState().markAgentPatchStatus(patch.patchId, "stale");
      pushToast("The file changed after this proposal. Generate a new patch.");
      return;
    }
    try {
      const result = await api.applyAgentPatch(room.roomId, session.guestToken, effectivePatch);
      storage.saveRoomSnapshot(result.room);
      setRoom(result.room);
      useAIStore.getState().markAgentPatchStatus(patch.patchId, "applied");
      pushToast(`Applied agent patch to ${effectivePatch.files?.length ?? 1} file(s)`);
    } catch (issue) {
      if (issue instanceof ApiRequestError && issue.code === "PATCH_STALE") useAIStore.getState().markAgentPatchStatus(patch.patchId, "stale");
      pushToast(issue instanceof Error ? issue.message : "The patch could not be applied");
    }
  };

  const validateAgentPatch = async (patch: AgentPatch, category: ValidationCategory) => {
    if (!session) return;
    try {
      const result = await api.validateAgent(roomId, session.guestToken, category, patch.taskId);
      useAIStore.getState().recordAgentValidation(patch.patchId, result.validation);
      pushToast(`${category} ${result.validation.status}: ${result.validation.summary}`);
    } catch (issue) {
      pushToast(issue instanceof Error ? issue.message : "Validation could not be completed");
    }
  };

  const rejectAgentPatch = async (patch: AgentPatch) => {
    if (!session) return;
    try {
      await api.rejectAgentPatch(roomId, session.guestToken, patch.patchId);
      useAIStore.getState().markAgentPatchStatus(patch.patchId, "rejected");
      pushToast(`Rejected agent patch for ${patch.path}`);
    } catch (issue) {
      pushToast(issue instanceof Error ? issue.message : "The patch could not be rejected");
    }
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
      setExecutionContext(undefined);
      await runCodeExternally({
        code: room.workspace.files[room.workspace.activeFileId]?.content ?? room.code,
        language: room.workspace.files[room.workspace.activeFileId]?.language ?? room.language
      });
      pushToast("Code copied - run in the new tab");
      return true;
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "Unable to open external runner";
      setExecutionContext(undefined);
      setError(message);
      pushToast("Unable to open external runner");
      return false;
    }
  };

  const handleRunAction = async (action: ExecutionAction, target?: string): Promise<ExecutionRecord | null> => {
    if (!room || !session) return null;
    try {
      const record = await startExecution(room.roomId, room.workspace.id, session, action, target);
      setExecutionContext(record.output ? { output: record.output, failed: record.status !== "completed" } : undefined);
      pushToast(record.status === "unavailable" ? "This execution is unavailable for virtual room source." : `${action} queued`);
      return record;
    } catch (issue) {
      pushToast(issue instanceof Error ? issue.message : "The safe execution request failed");
      return null;
    }
  };

  const handleCancelExecution = async (executionId: string) => {
    if (!room || !session) return;
    try { await cancelExecution(room.roomId, room.workspace.id, session, executionId); pushToast("Execution cancelled"); }
    catch (issue) { pushToast(issue instanceof Error ? issue.message : "Execution could not be cancelled"); }
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
  const openDiagnostic = (diagnostic: AgentDiagnostic) => {
    const targetFileId = diagnostic.fileId && room.workspace.files[diagnostic.fileId] ? diagnostic.fileId : room.workspace.activeFileId;
    if (targetFileId !== room.workspace.activeFileId) socketRef.current?.emit("workspace:operation", { roomId: room.roomId, userId: session.userId, operation: { id: crypto.randomUUID(), type: "set-active-file", nodeId: targetFileId } });
    if (diagnostic.startLine) window.setTimeout(() => { editorAIActionsRef.current?.revealLocation(targetFileId, diagnostic.startLine ?? 1, diagnostic.startColumn ?? 1); }, 80);
    setWorkspacePanelTab("problems");
    setIsOutputOpen(true);
  };
  const debugDiagnostic = (diagnostic: AgentDiagnostic) => {
    openDiagnostic(diagnostic);
    setAIAction("fix");
    setAIDraft("Debug this problem and propose a safe fix.");
    showPanel("ai");
  };
  const reviewDiff = () => {
    setAIAction("review");
    setAIDraft("Review the actual current source-control diff in this workspace. Identify correctness, security, unintended changes, regressions, and scope creep. Do not propose edits until you explain the findings.");
    showPanel("ai");
    pushToast("AI diff review is ready in the assistant panel");
  };
  const openWorkspaceFile = (fileId: string) => {
    socketRef.current?.emit("workspace:operation", { roomId: room.roomId, userId: session.userId, operation: { id: crypto.randomUUID(), type: "set-active-file", nodeId: fileId } });
  };
  const workspaceCommands: WorkspaceCommand[] = [
    { id: "open-file", label: "Open current file", hint: room.workspace.files[room.workspace.activeFileId]?.name, run: () => { setActivity("explorer"); setMobileWorkspaceOpen(true); } },
    { id: "search-project", label: "Search project", hint: "Ctrl/Cmd+Shift+F", run: () => selectActivity("search") },
    { id: "save", label: "Save workspace", hint: "Changes sync automatically", run: () => pushToast("Edits sync automatically with the room.") },
    { id: "close-tab", label: "Close active tab", hint: room.workspace.openFileIds.length > 1 ? "Close the current editor tab" : "The last tab stays open", run: () => { if (room.workspace.openFileIds.length > 1) socketRef.current?.emit("workspace:operation", { roomId: room.roomId, userId: session.userId, operation: { id: crypto.randomUUID(), type: "set-open-files", fileIds: room.workspace.openFileIds.filter((id) => id !== room.workspace.activeFileId) } }); } },
    { id: "toggle-explorer", label: "Toggle Explorer", run: () => selectActivity("explorer") },
    { id: "toggle-ai", label: "Open AI assistant", run: () => { showPanel("ai"); setActivity("ai"); } },
    { id: "toggle-terminal", label: "Toggle terminal", hint: "Ctrl/Cmd+`", run: () => { setWorkspacePanelTab("terminal"); setIsOutputOpen(true); } },
    { id: "run-project", label: "Run project", hint: "External runner only for room source", run: () => { setWorkspacePanelTab("run"); setIsOutputOpen(true); void handleRunAction("run"); } },
    { id: "run-tests", label: "Run tests", run: () => { setWorkspacePanelTab("tests"); setIsOutputOpen(true); void handleRunAction("tests"); } },
    { id: "typecheck", label: "Run TypeScript check", run: () => { setWorkspacePanelTab("output"); setIsOutputOpen(true); void handleRunAction("typecheck"); } },
    { id: "lint", label: "Run ESLint", run: () => { setWorkspacePanelTab("output"); setIsOutputOpen(true); void handleRunAction("lint"); } },
    { id: "git-status", label: "Open Git status", run: () => selectActivity("source-control") },
    { id: "ask-ai", label: "Ask AI about this file", run: () => { setAIAction("custom"); showPanel("ai"); } },
    { id: "review-code", label: "Review current file with AI", run: () => { setAIAction("review"); showPanel("ai"); } }
  ];

  return (
    <main className="theme-page-room flex h-[100dvh] w-screen max-w-[100vw] flex-col overflow-hidden">
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      {activePanel === "ai" ? (
        <div className="fixed inset-x-3 bottom-3 z-50 h-[min(78dvh,44rem)] sm:left-auto sm:right-4 sm:w-[min(30rem,calc(100vw-2rem))]" role="dialog" aria-label="AI assistant">
          <AIAssistantPanel
            roomId={room.roomId}
            workspaceId={room.workspace.id}
            currentFileId={room.workspace.activeFileId}
            currentFileName={room.workspace.files[room.workspace.activeFileId]?.name ?? "current file"}
            currentVersion={room.version}
            fileContents={Object.fromEntries(Object.values(room.workspace.files).map((file) => [file.id, file.content]))}
            session={session}
            canInsert={!room.isPaused}
            execution={executionContext}
            diagnostics={diagnostics}
            onClose={() => setActivePanel(null)}
            onInsertCode={insertAICode}
            onReplaceSelection={replaceAISelection}
            onReplaceFile={replaceAIFile}
            onApplyPatch={applyAgentPatch}
            onRejectPatch={rejectAgentPatch}
            onValidatePatch={validateAgentPatch}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => showPanel("ai")}
          className="ui-focus-ring fixed bottom-4 right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--accent)]/40 bg-[var(--accent)] text-[var(--bg-primary)] shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition hover:scale-105 hover:shadow-[0_16px_34px_rgba(0,0,0,0.42)]"
          aria-label="Open AI assistant"
          title="Open AI assistant"
        >
          <Bot className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <CommandPalette open={commandPaletteOpen} commands={workspaceCommands} onClose={() => setCommandPaletteOpen(false)} />
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
        <aside className="theme-panel-solid hidden w-[72px] shrink-0 flex-col items-center gap-2 border-r border-[var(--border)] py-3 lg:flex" aria-label="Activity bar">
          {[
            ["explorer", FolderTree, "Explorer"],
            ["search", Search, "Search"],
            ["source-control", GitBranch, "Source control"],
            ["run", TerminalSquare, "Run & Debug"],
            ["deploy", Cloud, "Deploy"],
            ["settings", Settings, "Settings"]
          ].map(([id, Icon, label]) => (
            <button key={id as string} type="button" onClick={() => selectActivity(id as "explorer" | "search" | "source-control" | "ai" | "run" | "deploy" | "settings")} title={label as string} aria-label={label as string} className={`flex w-14 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] transition ${activity === id ? "bg-[var(--badge-bg)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)] hover:text-[var(--text-primary)]"}`}>
              <Icon className="h-5 w-5" />
              <span className="truncate">{label as string}</span>
            </button>
          ))}
        </aside>

        <aside className="hidden w-[280px] shrink-0 overflow-hidden lg:block">
          <WorkspaceExplorer roomId={room.roomId} session={session} workspace={room.workspace} socketRef={socketRef} onNotify={pushToast} repository={gitRoomId === room.roomId ? repository : null} gitLoading={gitRoomId === room.roomId && gitLoading} gitError={gitRoomId === room.roomId ? gitError : null} gitStatusByFileId={gitRoomId === room.roomId ? gitStatusByFileId : {}} mode={activity === "source-control" ? "source-control" : activity === "search" ? "search" : activity === "deploy" ? "deploy" : "explorer"} onOpenFile={openWorkspaceFile} onCopyRoomLink={() => void handleCopyRoomLink()} onDownloadFile={handleDownloadFile} onRefreshGit={refreshGit} onReviewDiff={reviewDiff} />
        </aside>

        <nav className="theme-panel-solid flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] px-2 py-1 lg:hidden" aria-label="Mobile workspace navigation">
          <button type="button" onClick={() => selectActivity("explorer")} className={`shrink-0 rounded px-3 py-1.5 text-xs ${activity === "explorer" && mobileWorkspaceOpen ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>Explorer</button>
          <button type="button" onClick={() => selectActivity("search")} className={`shrink-0 rounded px-3 py-1.5 text-xs ${activity === "search" && mobileWorkspaceOpen ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>Search</button>
          <button type="button" onClick={() => selectActivity("source-control")} className={`shrink-0 rounded px-3 py-1.5 text-xs ${activity === "source-control" && mobileWorkspaceOpen ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>Source control</button>
          <button type="button" onClick={() => selectActivity("run")} className="shrink-0 rounded px-3 py-1.5 text-xs text-[var(--text-muted)]">Run &amp; debug</button>
          <button type="button" onClick={() => selectActivity("deploy")} className={`shrink-0 rounded px-3 py-1.5 text-xs ${activity === "deploy" && mobileWorkspaceOpen ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>Deploy</button>
          <button type="button" onClick={() => { setMobileWorkspaceOpen(false); showPanel("chat"); }} className="shrink-0 rounded px-3 py-1.5 text-xs text-[var(--text-muted)]">Chat</button>
        </nav>

        {mobileWorkspaceOpen ? <div className="fixed inset-x-0 bottom-0 top-[7.25rem] z-20 flex min-h-0 flex-col border-t border-[var(--border)] bg-[var(--panel)] shadow-2xl lg:hidden"><div className="flex shrink-0 justify-end border-b border-[var(--border)] px-3 py-1"><button type="button" onClick={() => setMobileWorkspaceOpen(false)} className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--badge-bg)]">Close</button></div><div className="min-h-0 flex-1"><WorkspaceExplorer roomId={room.roomId} session={session} workspace={room.workspace} socketRef={socketRef} onNotify={pushToast} repository={gitRoomId === room.roomId ? repository : null} gitLoading={gitRoomId === room.roomId && gitLoading} gitError={gitRoomId === room.roomId ? gitError : null} gitStatusByFileId={gitRoomId === room.roomId ? gitStatusByFileId : {}} mode={activity === "source-control" ? "source-control" : activity === "search" ? "search" : activity === "deploy" ? "deploy" : "explorer"} onOpenFile={openWorkspaceFile} onCopyRoomLink={() => void handleCopyRoomLink()} onDownloadFile={handleDownloadFile} onRefreshGit={refreshGit} onReviewDiff={reviewDiff} /></div></div> : null}

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
            onDiagnosticsChange={setDiagnostics}
            onOpenAIAssistant={(action) => { setAIAction(action ?? "custom"); showPanel("ai"); }}
            onEditorAIReady={(actions) => { editorAIActionsRef.current = actions; }}
            /></div>
          </div>
          <WorkspaceOutputPanel open={isOutputOpen} onToggle={() => setIsOutputOpen((open) => !open)} activeFileName={room.workspace.files[room.workspace.activeFileId]?.name ?? "Untitled"} code={room.workspace.files[room.workspace.activeFileId]?.content ?? room.code} language={room.workspace.files[room.workspace.activeFileId]?.language ?? room.language} activeTab={workspacePanelTab} onActiveTabChange={(tab) => { setWorkspacePanelTab(tab); setIsOutputOpen(true); }} onChangeLanguage={changeLanguage} onRunExternal={handleRunExternal} onRunAction={handleRunAction} onCancelExecution={handleCancelExecution} executions={executionRecords} capabilities={executionCapabilities} executionError={executionError} diagnostics={diagnostics} onOpenDiagnostic={openDiagnostic} onDebugDiagnostic={debugDiagnostic} onCopy={handleCopyCode} onDownload={handleDownloadFile} />
        </section>

        <div
          className={`min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            (activePanel !== null && activePanel !== "ai") || isMediaOpen
              ? "fixed inset-y-16 right-0 z-30 flex w-[min(100vw-1rem,24rem)] border-l border-[var(--border)] shadow-[-16px_0_36px_rgba(0,0,0,0.28)] xl:static xl:w-[22rem] xl:border-l-0 xl:shadow-none 2xl:w-[24rem]"
              : "hidden xl:flex xl:w-0"
          }`}
        >
          {isMediaOpen ? <MediaCallPanel roomId={room.roomId} session={session} onClose={() => setIsMediaOpen(false)} /> : activePanel !== "ai" ? <aside className="theme-panel-solid flex min-h-0 w-full flex-col border-l border-[var(--border)]" aria-label="Collaboration panel">
            <div className="flex shrink-0 items-center border-b border-[var(--border)] px-2 pt-1">
              <button type="button" onClick={() => showPanel("chat")} className={`border-b-2 px-2.5 py-2 text-xs font-medium ${activePanel === "chat" ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)]"}`}>Chat</button>
              <button type="button" onClick={() => showPanel("people")} className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] ${activePanel === "people" ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)]"}`}><Users className="h-3.5 w-3.5" />People</button>
              <button type="button" onClick={() => showPanel("activity")} className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] ${activePanel === "activity" ? "bg-[var(--badge-bg)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--badge-bg)]"}`}>Activity</button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
          {activePanel === "chat" ? (
            <ChatPanel
              messages={room.chat}
              participants={room.participants}
              typingUsers={chatTypingUsers}
              session={session}
              roomId={room.roomId}
              socketRef={socketRef}
              onClose={() => setActivePanel(null)}
              onAskAI={(message, asTask) => {
                setAIAction(asTask ? "generate" : "custom");
                setAIDraft(asTask ? `Turn this collaborator request into a shared AI task and investigate it: “${message}”` : `Answer this collaborator question using the current shared workspace: “${message}”`);
                showPanel("ai");
              }}
            />
          ) : activePanel === "people" ? <ParticipantsPanel participants={room.participants} editorTypingUsers={editorTypingUsers} session={session} ownerId={room.ownerId} roomId={room.roomId} socketRef={socketRef} onNotify={pushToast} /> : <RoomActivityPanel history={room.history} activity={roomActivity} participants={room.participants} />}
            </div>
          </aside> : null
          }
        </div>
      </div>
    </main>
  );
};
