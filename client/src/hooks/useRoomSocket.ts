import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { storage } from "../lib/storage";
import { useRoomStore } from "../store/useRoomStore";
import type { ChatMessage, CursorUpdate, HistoryEntry, Participant, RoomSnapshot, SupportedLanguage, TypingParticipant, UserSession } from "../types/collaboration";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4000";

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
    setLanguage
  } = useRoomStore();

  useEffect(() => {
    if (!session) {
      return;
    }

    const socket = io(SOCKET_URL, {
      transports: ["websocket"]
    });

    socketRef.current = socket;
    setConnectionStatus("connecting");
    setError(null);

    socket.on("connect", () => {
      setConnectionStatus("connected");
      socket.emit("room:join", {
        roomId,
        userId: session.userId
      });
    });

    socket.on("disconnect", () => {
      setConnectionStatus("error");
    });

    socket.on("room:snapshot", (snapshot: RoomSnapshot) => {
      setRoom(snapshot);
      replaceParticipants(snapshot.participants);
    });

    socket.on("room:participants", (participants: Participant[]) => {
      replaceParticipants(participants);
    });

    socket.on("presence:update", (participant: Participant) => {
      upsertParticipant(participant);
    });

    socket.on("cursor-update", (cursor: CursorUpdate) => {
      updateParticipantCursor(cursor);
    });

    socket.on("history:update", (history: HistoryEntry[]) => {
      setHistory(history);
    });

    socket.on("chat:new", (message: ChatMessage) => {
      appendMessage(message);
    });

    socket.on("chat:typing", (payload: TypingParticipant & { isTyping: boolean }) => {
      setChatTypingState(
        {
          userId: payload.userId,
          username: payload.username
        },
        payload.isTyping
      );
    });

    socket.on("editor:typing", (payload: TypingParticipant & { isTyping: boolean }) => {
      setEditorTypingState(
        {
          userId: payload.userId,
          username: payload.username
        },
        payload.isTyping
      );
    });

    socket.on("editor:sync", (payload: { code: string; language: SupportedLanguage; version: number }) => {
      setLanguage(payload.language);
      setCode(payload.code, payload.version);
    });

    socket.on("room:deleted", () => {
      storage.removeSession(roomId);
      navigate("/");
    });

    socket.on("room:error", (message: string) => {
      setError(message);
    });

    return () => {
      clearTypingUsers();
      socket.disconnect();
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
    setChatTypingState,
    setEditorTypingState,
    updateParticipantCursor,
    upsertParticipant
  ]);

  return socketRef;
};
