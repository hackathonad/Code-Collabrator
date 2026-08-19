import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { storage } from "../lib/storage";
import { getAccessToken } from "../lib/supabase";
import { useRoomStore } from "../store/useRoomStore";
import { useMediaStore } from "../store/useMediaStore";
import type { ChatMessage, CursorUpdate, HistoryEntry, Participant, RoomSnapshot, SupportedLanguage, TypingParticipant, UserSession } from "../types/collaboration";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL?.replace(/\/+$/, "") ?? "";

const isVercelWithoutRealtimeBackend = () => !SOCKET_URL
  && typeof window !== "undefined"
  && window.location.hostname.endsWith(".vercel.app");

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
    setCode,
    setLanguage,
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

    const connectSocket = async () => {
      const accessToken = await getAccessToken();
      if (disposed) {
        return;
      }

      const options = {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 8,
        auth: {
          accessToken,
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
      });

      socket.on("workspace:sync", (payload: { workspace: import("../types/collaboration").WorkspaceState; code: string; language: SupportedLanguage; version: number; history: HistoryEntry[] }) => {
        syncWorkspace(payload.workspace, payload.code, payload.language, payload.version, payload.history);
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
        setLanguage(payload.language, payload.fileId);
        setCode(payload.code, payload.version, payload.fileId);
      });

      socket.on("room:deleted", () => {
        void useMediaStore.getState().leave();
        storage.removeRoom(roomId);
        navigate("/");
      });

      socket.on("room:error", (message: string) => setError(message));
    };

    void connectSocket();

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
    setCode,
    setConnectionStatus,
    setError,
    setHistory,
    setLanguage,
    setRoom,
    syncWorkspace,
    setChatTypingState,
    setEditorTypingState,
    updateParticipantCursor,
    upsertParticipant
  ]);

  return socketRef;
};
