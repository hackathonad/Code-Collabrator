import { randomBytes, randomUUID } from "node:crypto";
import { LANGUAGE_CONFIG, type SupportedLanguage } from "../../constants/languages";
import type { ChatMessage, CursorState, Participant, ParticipantAccent, RoomRole, RoomSnapshot, RoomState } from "./roomTypes";

const rooms = new Map<string, RoomState>();
const accentPalette: ParticipantAccent[] = ["blue", "emerald", "amber", "rose", "violet", "cyan"];

const createRoomId = () => randomBytes(4).toString("hex");
const createUserId = () => randomUUID();

const defaultCursor = (): CursorState => ({
  lineNumber: 1,
  column: 1
});

const sortParticipants = (participants: Record<string, Participant>) =>
  Object.values(participants).sort((left, right) => left.joinedAt - right.joinedAt);

const nextAccent = (participants: Record<string, Participant>): ParticipantAccent => {
  const used = new Set(Object.values(participants).map((participant) => participant.accent));
  return accentPalette.find((accent) => !used.has(accent)) ?? accentPalette[Object.keys(participants).length % accentPalette.length];
};

const serializeRoom = (room: RoomState): RoomSnapshot => ({
  roomId: room.roomId,
  ownerId: room.ownerId,
  language: room.language,
  code: room.code,
  version: room.version,
  createdAt: room.createdAt,
  updatedAt: room.updatedAt,
  participants: sortParticipants(room.participants),
  chat: [...room.chat].sort((left, right) => left.timestamp - right.timestamp)
});

const ensureRoom = (roomId: string) => {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("Room not found");
  }
  return room;
};

const transferOwnershipIfNeeded = (room: RoomState) => {
  const owner = room.participants[room.ownerId];
  if (owner?.isOnline) {
    owner.role = "owner";
    return;
  }

  const nextOwner = sortParticipants(room.participants).find((participant) => participant.isOnline);
  if (!nextOwner) {
    return;
  }

  room.ownerId = nextOwner.userId;
  nextOwner.role = "owner";
};

export const roomStore = {
  createRoom(username: string, language: SupportedLanguage = "javascript") {
    const roomId = createRoomId();
    const userId = createUserId();
    const now = Date.now();
    const owner: Participant = {
      userId,
      username,
      role: "owner",
      accent: accentPalette[0],
      joinedAt: now,
      isOnline: false,
      cursor: defaultCursor()
    };

    const room: RoomState = {
      roomId,
      ownerId: userId,
      language,
      code: LANGUAGE_CONFIG[language].starter,
      version: 1,
      createdAt: now,
      updatedAt: now,
      participants: {
        [userId]: owner
      },
      chat: []
    };

    rooms.set(roomId, room);
    return {
      room: serializeRoom(room),
      participant: owner
    };
  },

  joinRoom(roomId: string, username: string, existingUserId?: string) {
    const room = ensureRoom(roomId);
    const now = Date.now();

    let participant = existingUserId ? room.participants[existingUserId] : undefined;
    if (participant) {
      participant.username = username;
      participant.isOnline = false;
      room.updatedAt = now;
      return {
        room: serializeRoom(room),
        participant
      };
    }

    const userId = createUserId();
    participant = {
      userId,
      username,
      role: "editor",
      accent: nextAccent(room.participants),
      joinedAt: now,
      isOnline: false,
      cursor: defaultCursor()
    };

    room.participants[userId] = participant;
    room.updatedAt = now;

    return {
      room: serializeRoom(room),
      participant
    };
  },

  connectParticipant(roomId: string, userId: string, socketId: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }

    participant.isOnline = true;
    participant.socketId = socketId;
    room.updatedAt = Date.now();
    return serializeRoom(room);
  },

  disconnectParticipant(roomId: string, userId: string) {
    const room = rooms.get(roomId);
    if (!room) {
      return null;
    }

    const participant = room.participants[userId];
    if (!participant) {
      return serializeRoom(room);
    }

    participant.isOnline = false;
    participant.socketId = undefined;
    room.updatedAt = Date.now();
    transferOwnershipIfNeeded(room);

    const stillOnline = Object.values(room.participants).some((entry) => entry.isOnline);
    if (!stillOnline) {
      return serializeRoom(room);
    }

    return serializeRoom(room);
  },

  updateCode(roomId: string, userId: string, code: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }
    if (participant.role === "viewer") {
      throw new Error("Permission denied");
    }

    room.code = code;
    room.version += 1;
    room.updatedAt = Date.now();
    return {
      room: serializeRoom(room),
      updatedBy: participant
    };
  },

  updateLanguage(roomId: string, userId: string, language: SupportedLanguage, resetCode: boolean) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }
    if (participant.role === "viewer") {
      throw new Error("Permission denied");
    }

    room.language = language;
    if (resetCode) {
      room.code = LANGUAGE_CONFIG[language].starter;
    }
    room.version += 1;
    room.updatedAt = Date.now();
    return serializeRoom(room);
  },

  updateCursor(roomId: string, userId: string, cursor: CursorState) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }

    participant.cursor = cursor;
    return participant;
  },

  addChatMessage(roomId: string, userId: string, message: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }
    if (!message.trim()) {
      throw new Error("Message cannot be empty");
    }

    const chatMessage: ChatMessage = {
      id: randomUUID(),
      userId,
      username: participant.username,
      message,
      timestamp: Date.now()
    };

    room.chat.push(chatMessage);
    room.updatedAt = Date.now();
    return chatMessage;
  },

  updateRole(roomId: string, actingUserId: string, targetUserId: string, role: Exclude<RoomRole, "owner">) {
    const room = ensureRoom(roomId);
    if (room.ownerId !== actingUserId) {
      throw new Error("Only the owner can change roles");
    }

    const target = room.participants[targetUserId];
    if (!target) {
      throw new Error("Participant not found");
    }

    target.role = role;
    room.updatedAt = Date.now();
    return serializeRoom(room);
  },

  deleteRoom(roomId: string, actingUserId: string) {
    const room = ensureRoom(roomId);
    if (room.ownerId !== actingUserId) {
      throw new Error("Only the owner can delete the room");
    }

    rooms.delete(roomId);
  },

  getRoomSnapshot(roomId: string) {
    return serializeRoom(ensureRoom(roomId));
  },

  hasRoom(roomId: string) {
    return rooms.has(roomId);
  }
};
