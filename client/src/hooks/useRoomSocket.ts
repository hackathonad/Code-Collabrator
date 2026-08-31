import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { storage } from "../lib/storage";
import { useRoomStore } from "../store/useRoomStore";
import { useMediaStore } from "../store/useMediaStore";
import { useAIStore } from "../store/useAIStore";
import { useGitStore } from "../store/useGitStore";
import type { ChatMessage, CursorUpdate, HistoryEntry, Participant, RoomSnapshot, SupportedLanguage, TypingParticipant, UserSession } from "../types/collaboration";
import type { AgentProposalEvent, AgentTaskEvent, AgentTaskPublic } from "../types/agent";
import type { GitStateEvent } from "../types/git";
import type { ExecutionEvent, ExecutionRecord } from "../types/execution";
import { useExecutionStore } from "../store/useExecutionStore";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL?.replace(/\/+$/, "") ?? "";

const isVercelWithoutRealtimeBackend = () => !SOCKET_URL
  && typeof window !== "undefined"
  && (window.location.hostname.endsWith(".vercel.app") || import.meta.env.PROD);

const resolveSocketUrl = () => {
  if (SOCKET_URL) {
    return SOCKET_URL;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "";
};

export const useRoomSocket = (roomId: string, session: UserSession | null) => {
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);
  const {
    setConnectionStatus,
    setRoom,
    setError,
    replaceParticipants,
    appendMessage,
    upsertParticipant,
    updateParticipantCursor,
    setHistory,
    setChatTypingState,
    setEditorTypingState,
    clearTypingUsers,
    syncEditor,
    syncWorkspace
  } = useRoomStore();

  useEffect(() => {
    if (!session) {
      return;
    }

    if (isVercelWithoutRealtimeBackend()) {
      setConnectionStatus("error");
      setError("Realtime backend is not configured for this Vercel deployment. Set VITE_SOCKET_URL to a deployed Socket.IO server.");
      return;
    }

    let disposed = false;
    let socket: Socket | null = null;

    const connectSocket = () => {
      if (disposed) return;
      const options = {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 8,
        auth: {
          guestToken: session.guestToken
        }
      };

      socket = resolveSocketUrl() ? io(resolveSocketUrl(), options) : io(options);
      socketRef.current = socket;
      setConnectionStatus("connecting");
      setError(null);

      socket.on("connect", () => {
        setConnectionStatus("connected");
        setError(null);
        socket?.emit("room:join", {
          roomId,
          userId: session.userId
        });
      });

      socket.on("reconnect_attempt", () => setConnectionStatus("connecting"));

      socket.on("disconnect", (reason) => {
        clearTypingUsers();
        setConnectionStatus(socket?.active ? "connecting" : "error");
        if (!socket?.active && reason !== "io client disconnect") {
          setError("Realtime connection disconnected. Refresh or rejoin if it does not recover.");
        }
      });

      socket.on("connect_error", () => {
        setConnectionStatus("error");
        setError("Unable to reach the realtime server.");
      });

      socket.on("room:snapshot", (snapshot: RoomSnapshot) => {
        storage.saveRoomSnapshot(snapshot);
        setRoom(snapshot);
        replaceParticipants(snapshot.participants);
        useAIStore.getState().markAgentPatchesStale(snapshot.version);
      });

      socket.on("workspace:sync", (payload: { workspace: import("../types/collaboration").WorkspaceState; code: string; language: SupportedLanguage; version: number; history: HistoryEntry[] }) => {
        syncWorkspace(payload.workspace, payload.code, payload.language, payload.version, payload.history);
        useAIStore.getState().markAgentPatchesStale(payload.version);
      });

      socket.on("room:participants", (participants: Participant[]) => replaceParticipants(participants));
      socket.on("presence:update", (participant: Participant) => upsertParticipant(participant));
      socket.on("cursor-update", (cursor: CursorUpdate) => updateParticipantCursor(cursor));
      socket.on("history:update", (history: HistoryEntry[]) => setHistory(history));
      socket.on("chat:new", (message: ChatMessage) => appendMessage(message));

      socket.on("chat:typing", (payload: TypingParticipant & { isTyping: boolean }) => {
        setChatTypingState({ userId: payload.userId, username: payload.username }, payload.isTyping);
      });

      socket.on("editor:typing", (payload: TypingParticipant & { isTyping: boolean }) => {
        setEditorTypingState({ userId: payload.userId, username: payload.username }, payload.isTyping);
      });

      socket.on("editor:sync", (payload: { code: string; language: SupportedLanguage; version: number; fileId?: string }) => {
        syncEditor(payload.code, payload.language, payload.version, payload.fileId);
        useAIStore.getState().markAgentPatchesStale(payload.version);
      });

      socket.on("git:state", (event: GitStateEvent) => {
        if (!event || event.roomId !== roomId) return;
        useGitStore.getState().setRepository(event.summary);
        syncWorkspace(event.workspace, event.code, event.language, event.version, event.history);
        useAIStore.getState().markAgentPatchesStale(event.version);
      });

      socket.on("agent:proposal", (event: AgentProposalEvent) => {
        if (!event || event.roomId !== roomId) return;
        useAIStore.getState().receiveAgentProposalEvent(event);
      });
      socket.on("agent:task", (event: AgentTaskEvent) => {
        if (!event?.task || event.task.roomId !== roomId) return;
        useAIStore.getState().receiveAgentTask(event);
      });
      socket.on("agent:task_history", (tasks: AgentTaskPublic[]) => useAIStore.getState().setAgentTaskHistory(tasks));
      socket.on("agent:proposal_history", (events: AgentProposalEvent[]) => useAIStore.getState().setAgentProposalHistory(events));
      socket.on("agent:proposal_state", (proposals: import("../types/agent").AgentProposalPublic[]) => useAIStore.getState().setAgentProposalState(proposals));
      socket.on("execution:history", (records: ExecutionRecord[]) => {
        const scopedRecords = records.filter((record) => record.roomId === roomId);
        if (scopedRecords.length) useExecutionStore.getState().hydrate(roomId, scopedRecords[0].workspaceId, scopedRecords);
      });
      socket.on("execution:state", (event: ExecutionEvent) => {
        if (!event?.record || event.record.roomId !== roomId) return;
        useExecutionStore.getState().receive(event.record);
      });

      socket.on("room:deleted", () => {
        void useMediaStore.getState().leave();
        storage.removeRoom(roomId);
        navigate(window.location.pathname.startsWith("/guest/") ? "/guest" : "/app");
      });

      socket.on("room:error", (message: string) => {
        setError(message);
        if (/room not found|room no longer exists|room.*deleted/i.test(message)) {
          storage.removeRoom(roomId);
          setRoom(null);
          navigate(window.location.pathname.startsWith("/guest/") ? "/guest" : "/app", { replace: true });
        }
      });
    };

    connectSocket();

    return () => {
      disposed = true;
      clearTypingUsers();
      socket?.removeAllListeners();
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [
    appendMessage,
    clearTypingUsers,
    navigate,
    replaceParticipants,
    roomId,
    session,
    setConnectionStatus,
    setError,
    setHistory,
    syncEditor,
    setRoom,
    syncWorkspace,
    setChatTypingState,
    setEditorTypingState,
    updateParticipantCursor,
    upsertParticipant
  ]);

  return socketRef;
};
