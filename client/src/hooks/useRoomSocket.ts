import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { storage } from "../lib/storage";
import { useRoomStore } from "../store/useRoomStore";
import type { ChatMessage, Participant, RoomSnapshot, SupportedLanguage, UserSession } from "../types/collaboration";

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

    socket.on("chat:new", (message: ChatMessage) => {
      appendMessage(message);
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
      socket.disconnect();
      socketRef.current = null;
    };
  }, [appendMessage, navigate, replaceParticipants, roomId, session, setCode, setConnectionStatus, setError, setLanguage, setRoom, upsertParticipant]);

  return socketRef;
};
