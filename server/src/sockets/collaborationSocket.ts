import type { Server } from "socket.io";
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

interface RolePayload {
  roomId: string;
  actingUserId: string;
  targetUserId: string;
  role: Exclude<RoomRole, "owner">;
}

interface DeletePayload {
  roomId: string;
  userId: string;
}

const socketRoomBindings = new Map<string, JoinPayload>();

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

export const registerCollaborationSocket = (io: Server) => {
  io.on("connection", (socket) => {
    socket.on("room:join", (payload: JoinPayload) => {
      try {
        const snapshot = roomStore.connectParticipant(payload.roomId, payload.userId, socket.id);
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
        io.to(payload.roomId).emit("editor:sync", {
          code: result.room.code,
          language: result.room.language,
          version: result.room.version,
          updatedBy: result.updatedBy.userId
        });
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to sync code");
      }
    });

    socket.on("editor:cursor", (payload: CursorPayload) => {
      try {
        const participant = roomStore.updateCursor(payload.roomId, payload.userId, payload.cursor);
        socket.to(payload.roomId).emit("presence:update", participant);
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to update cursor");
      }
    });

    socket.on("room:language", (payload: LanguagePayload) => {
      if (!isSupportedLanguage(payload.language)) {
        socket.emit("room:error", "Unsupported language");
        return;
      }

      try {
        const snapshot = roomStore.updateLanguage(payload.roomId, payload.userId, payload.language, payload.resetCode);
        io.to(payload.roomId).emit("editor:sync", {
          code: snapshot.code,
          language: snapshot.language,
          version: snapshot.version,
          updatedBy: payload.userId
        });
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to change language");
      }
    });

    socket.on("chat:send", (payload: ChatPayload) => {
      try {
        const message = roomStore.addChatMessage(payload.roomId, payload.userId, payload.message.trim());
        io.to(payload.roomId).emit("chat:new", message);
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to send chat message");
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

    socket.on("room:delete", (payload: DeletePayload) => {
      try {
        roomStore.deleteRoom(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("room:deleted");
      } catch (error) {
        socket.emit("room:error", error instanceof Error ? error.message : "Unable to delete room");
      }
    });

    socket.on("disconnect", () => {
      const binding = socketRoomBindings.get(socket.id);
      if (!binding) {
        return;
      }

      socketRoomBindings.delete(socket.id);
      const snapshot = roomStore.disconnectParticipant(binding.roomId, binding.userId);
      if (snapshot) {
        io.to(binding.roomId).emit("room:participants", snapshot.participants);
      }
    });
  });
};

