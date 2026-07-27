import type { Server, Socket } from "socket.io";
import { supportedLanguages, type SupportedLanguage } from "../constants/languages";
import { roomStore } from "../modules/rooms/roomStore";
import type { CursorState, RoomRole } from "../modules/rooms/roomTypes";

interface JoinPayload {
  roomId: string;
  userId: string;
}

interface EditorPayload {
  roomId: string;
  userId: string;
  code: string;
}

interface CursorPayload {
  roomId: string;
  userId: string;
  cursor: CursorState;
}

interface CursorUpdatePayload {
  userId: string;
  username: string;
  lineNumber: number;
  column: number;
}

interface LanguagePayload {
  roomId: string;
  userId: string;
  language: SupportedLanguage;
  resetCode: boolean;
}

interface ChatPayload {
  roomId: string;
  userId: string;
  message: string;
}

interface TypingPayload {
  roomId: string;
  userId: string;
  isTyping: boolean;
}

interface RolePayload {
  roomId: string;
  actingUserId: string;
  targetUserId: string;
  role: Exclude<RoomRole, "owner">;
}

interface DeletePayload {
  roomId: string;
  actingUserId: string;
}

interface PausePayload {
  roomId: string;
  actingUserId: string;
  isPaused: boolean;
}

interface RestartPayload {
  roomId: string;
  actingUserId: string;
}

const socketRoomBindings = new Map<string, JoinPayload>();
const presenceTimers = new Map<string, NodeJS.Timeout>();
const chatTypingTimers = new Map<string, NodeJS.Timeout>();
const editorTypingTimers = new Map<string, NodeJS.Timeout>();
const IDLE_TIMEOUT_MS = 20_000;
const CHAT_TYPING_TIMEOUT_MS = 2_500;
const EDITOR_TYPING_TIMEOUT_MS = 1_800;

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

const participantKey = (roomId: string, userId: string) => `${roomId}:${userId}`;

export const registerCollaborationSocket = (io: Server) => {
  const clearPresenceTimer = (roomId: string, userId: string) => {
    const key = participantKey(roomId, userId);
    const timer = presenceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      presenceTimers.delete(key);
    }
  };

  const scheduleIdleStatus = (roomId: string, userId: string) => {
    clearPresenceTimer(roomId, userId);
    const key = participantKey(roomId, userId);
    const timer = setTimeout(() => {
      try {
        const participant = roomStore.setParticipantStatus(roomId, userId, "idle");
        io.to(roomId).emit("presence:update", participant);
      } catch {
        // Room or participant may no longer exist.
      } finally {
        presenceTimers.delete(key);
      }
    }, IDLE_TIMEOUT_MS);

    presenceTimers.set(key, timer);
  };

  const markParticipantActive = (roomId: string, userId: string) => {
    const participant = roomStore.recordParticipantActivity(roomId, userId);
    io.to(roomId).emit("presence:update", participant);
    scheduleIdleStatus(roomId, userId);
  };

  const clearTypingTimer = (timers: Map<string, NodeJS.Timeout>, roomId: string, userId: string) => {
    const key = participantKey(roomId, userId);
    const timer = timers.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.delete(key);
    }
  };

  const emitTyping = (eventName: "chat:typing" | "editor:typing", roomId: string, userId: string, isTyping: boolean) => {
    const participant = roomStore.getParticipant(roomId, userId);
    io.to(roomId).emit(eventName, {
      userId,
      username: participant.username,
      isTyping
    });
  };

  const scheduleTypingReset = (
    timers: Map<string, NodeJS.Timeout>,
    timeoutMs: number,
    eventName: "chat:typing" | "editor:typing",
    roomId: string,
    userId: string
  ) => {
    clearTypingTimer(timers, roomId, userId);
    const key = participantKey(roomId, userId);
    const timer = setTimeout(() => {
      try {
        emitTyping(eventName, roomId, userId, false);
      } catch {
        // Room or participant may no longer exist.
      } finally {
        timers.delete(key);
      }
    }, timeoutMs);

    timers.set(key, timer);
  };

  const clearRoomTracking = (roomId: string) => {
    for (const [socketId, binding] of socketRoomBindings.entries()) {
      if (binding.roomId === roomId) {
        clearPresenceTimer(binding.roomId, binding.userId);
        clearTypingTimer(chatTypingTimers, binding.roomId, binding.userId);
        clearTypingTimer(editorTypingTimers, binding.roomId, binding.userId);
        socketRoomBindings.delete(socketId);
      }
    }
  };

  const handlePauseRoom = (payload: PausePayload, socket: Socket) => {
    try {
      const snapshot = roomStore.setPauseState(payload.roomId, payload.actingUserId, payload.isPaused);
      io.to(payload.roomId).emit("room:snapshot", snapshot);
    } catch (error) {
      socket.emit("room:error", error instanceof Error ? error.message : "Unable to update room state");
    }
  };

  const handleRestartRoom = (payload: RestartPayload, socket: Socket) => {
    try {
      const result = roomStore.restartRoom(payload.roomId, payload.actingUserId);
      io.to(payload.roomId).emit("room:snapshot", result.room);
      io.to(payload.roomId).emit("history:update", result.room.history);
    } catch (error) {
      socket.emit("room:error", error instanceof Error ? error.message : "Unable to restart room");
    }
  };

  const handleDeleteRoom = (payload: DeletePayload, socket: Socket) => {
    try {
      roomStore.deleteRoom(payload.roomId, payload.actingUserId);
      io.to(payload.roomId).emit("room:deleted");
      clearRoomTracking(payload.roomId);
      io.in(payload.roomId).socketsLeave(payload.roomId);
    } catch (error) {
      socket.emit("room:error", error instanceof Error ? error.message : "Unable to delete room");
    }
  };

  io.on("connection", (socket) => {
    socket.on("room:join", (payload: JoinPayload) => {
      try {
        const snapshot = roomStore.connectParticipant(payload.roomId, payload.userId, socket.id);
        scheduleIdleStatus(payload.roomId, payload.userId);
        socket.join(payload.roomId);
        socketRoomBindings.set(socket.id, payload);
        socket.emit("room:snapshot", snapshot);
        io.to(payload.roomId).emit("room:participants", snapshot.participants);
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to join socket room");
      }
    });

    socket.on("editor:update", (payload: EditorPayload) => {
      try {
        const result = roomStore.updateCode(payload.roomId, payload.userId, payload.code);
        markParticipantActive(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("editor:sync", {
          code: result.room.code,
          language: result.room.language,
          version: result.room.version,
          updatedBy: result.updatedBy.userId
        });
        if (result.historyEntry) {
          io.to(payload.roomId).emit("history:update", result.room.history);
        }
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to sync code");
      }
    });

    socket.on("editor:cursor", (payload: CursorPayload) => {
      try {
        const participant = roomStore.updateCursor(payload.roomId, payload.userId, payload.cursor);
        scheduleIdleStatus(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("presence:update", participant);
        socket.to(payload.roomId).emit("cursor-update", {
          userId: participant.userId,
          username: participant.username,
          lineNumber: participant.cursor.lineNumber,
          column: participant.cursor.column
        } satisfies CursorUpdatePayload);
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to update cursor");
      }
    });

    socket.on("editor:typing", (payload: TypingPayload) => {
      try {
        if (payload.isTyping) {
          markParticipantActive(payload.roomId, payload.userId);
        }
        emitTyping("editor:typing", payload.roomId, payload.userId, payload.isTyping);
        if (payload.isTyping) {
          scheduleTypingReset(editorTypingTimers, EDITOR_TYPING_TIMEOUT_MS, "editor:typing", payload.roomId, payload.userId);
        } else {
          clearTypingTimer(editorTypingTimers, payload.roomId, payload.userId);
        }
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to update editor typing state");
      }
    });

    socket.on("room:language", (payload: LanguagePayload) => {
      if (!isSupportedLanguage(payload.language)) {
        socket.emit("room:error", "Unsupported language");
        return;
      }

      try {
        const result = roomStore.updateLanguage(payload.roomId, payload.userId, payload.language, payload.resetCode);
        markParticipantActive(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("editor:sync", {
          code: result.room.code,
          language: result.room.language,
          version: result.room.version,
          updatedBy: payload.userId
        });
        io.to(payload.roomId).emit("history:update", result.room.history);
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to change language");
      }
    });

    socket.on("chat:send", (payload: ChatPayload) => {
      try {
        clearTypingTimer(chatTypingTimers, payload.roomId, payload.userId);
        emitTyping("chat:typing", payload.roomId, payload.userId, false);
        const message = roomStore.addChatMessage(payload.roomId, payload.userId, payload.message.trim());
        const participant = roomStore.getParticipant(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("presence:update", participant);
        scheduleIdleStatus(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("chat:new", message);
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to send chat message");
      }
    });

    socket.on("chat:typing", (payload: TypingPayload) => {
      try {
        if (payload.isTyping) {
          markParticipantActive(payload.roomId, payload.userId);
        }
        emitTyping("chat:typing", payload.roomId, payload.userId, payload.isTyping);
        if (payload.isTyping) {
          scheduleTypingReset(chatTypingTimers, CHAT_TYPING_TIMEOUT_MS, "chat:typing", payload.roomId, payload.userId);
        } else {
          clearTypingTimer(chatTypingTimers, payload.roomId, payload.userId);
        }
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to update chat typing state");
      }
    });

    socket.on("room:role", (payload: RolePayload) => {
      try {
        const snapshot = roomStore.updateRole(payload.roomId, payload.actingUserId, payload.targetUserId, payload.role);
        io.to(payload.roomId).emit("room:participants", snapshot.participants);
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to update role");
      }
    });

    socket.on("room:pause", (payload: PausePayload) => {
      handlePauseRoom(payload, socket);
    });

    socket.on("room:restart", (payload: RestartPayload) => {
      handleRestartRoom(payload, socket);
    });

    socket.on("room:delete", (payload: DeletePayload) => {
      handleDeleteRoom(payload, socket);
    });

    socket.on("disconnect", () => {
      const binding = socketRoomBindings.get(socket.id);
      if (!binding) {
        return;
      }

      socketRoomBindings.delete(socket.id);
      clearPresenceTimer(binding.roomId, binding.userId);
      clearTypingTimer(chatTypingTimers, binding.roomId, binding.userId);
      clearTypingTimer(editorTypingTimers, binding.roomId, binding.userId);
      const snapshot = roomStore.disconnectParticipant(binding.roomId, binding.userId);
      if (snapshot) {
        const participant = snapshot.participants.find((entry) => entry.userId === binding.userId);
        io.to(binding.roomId).emit("chat:typing", {
          userId: binding.userId,
          username: "",
          isTyping: false
        });
        io.to(binding.roomId).emit("editor:typing", {
          userId: binding.userId,
          username: "",
          isTyping: false
        });
        if (participant) {
          io.to(binding.roomId).emit("presence:update", participant);
        }
        io.to(binding.roomId).emit("room:participants", snapshot.participants);
      }
    });
  });
};
