import { randomBytes, randomUUID } from "node:crypto";
import { LANGUAGE_CONFIG, type SupportedLanguage } from "../../constants/languages";
import type {
  ChatMessage,
  CursorState,
  HistoryEntry,
  HistoryReason,
  Participant,
  ParticipantAccent,
  ParticipantSnapshot,
  PresenceStatus,
  RoomRole,
  RoomSnapshot,
  RoomState
} from "./roomTypes";

const rooms = new Map<string, RoomState>();
const accentPalette: ParticipantAccent[] = ["blue", "emerald", "amber", "rose", "violet", "cyan"];
const MAX_HISTORY_ENTRIES = 30;
const AUTO_SAVE_INTERVAL_MS = 20_000;

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

const serializeParticipant = (participant: Participant): ParticipantSnapshot => ({
  userId: participant.userId,
  username: participant.username,
  role: participant.role,
  accent: participant.accent,
  joinedAt: participant.joinedAt,
  isOnline: participant.isOnline,
  status: participant.status,
  lastActiveAt: participant.lastActiveAt,
  cursor: participant.cursor,
  editsCount: participant.editsCount,
  timeSpentMs:
    participant.timeSpentMs +
    (participant.isOnline && participant.activeSessionStartedAt ? Date.now() - participant.activeSessionStartedAt : 0)
});

const serializeRoom = (room: RoomState): RoomSnapshot => ({
  roomId: room.roomId,
  ownerId: room.ownerId,
  language: room.language,
  code: room.code,
  isPaused: room.isPaused,
  version: room.version,
  createdAt: room.createdAt,
  updatedAt: room.updatedAt,
  participants: sortParticipants(room.participants).map(serializeParticipant),
  chat: [...room.chat].sort((left, right) => left.timestamp - right.timestamp),
  history: [...room.history].sort((left, right) => right.createdAt - left.createdAt)
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

const touchParticipantActivity = (participant: Participant, room: RoomState) => {
  participant.status = "active";
  participant.isOnline = true;
  participant.lastActiveAt = Date.now();
  room.updatedAt = participant.lastActiveAt;
};

const finalizeSessionTime = (participant: Participant, timestamp = Date.now()) => {
  if (!participant.activeSessionStartedAt) {
    return;
  }

  participant.timeSpentMs += Math.max(0, timestamp - participant.activeSessionStartedAt);
  participant.activeSessionStartedAt = undefined;
};

const addHistoryEntry = (
  room: RoomState,
  participant: Pick<Participant, "userId" | "username">,
  reason: HistoryReason,
  options?: {
    code?: string;
    language?: SupportedLanguage;
    roomVersion?: number;
    createdAt?: number;
  }
) => {
  const createdAt = options?.createdAt ?? Date.now();
  const entry: HistoryEntry = {
    id: randomUUID(),
    roomVersion: options?.roomVersion ?? room.version,
    language: options?.language ?? room.language,
    code: options?.code ?? room.code,
    createdAt,
    createdByUserId: participant.userId,
    createdByUsername: participant.username,
    reason
  };

  room.history = [entry, ...room.history].slice(0, MAX_HISTORY_ENTRIES);
  return entry;
};

const maybeAddAutosaveEntry = (room: RoomState, participant: Pick<Participant, "userId" | "username">) => {
  const latest = room.history[0];
  if (latest) {
    const sameState = latest.code === room.code && latest.language === room.language;
    const recentlySaved = Date.now() - latest.createdAt < AUTO_SAVE_INTERVAL_MS;
    if (sameState || recentlySaved) {
      return null;
    }
  }

  return addHistoryEntry(room, participant, "autosave");
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
      status: "offline",
      lastActiveAt: now,
      cursor: defaultCursor(),
      editsCount: 0,
      timeSpentMs: 0
    };

    const room: RoomState = {
      roomId,
      ownerId: userId,
      language,
      code: LANGUAGE_CONFIG[language].starter,
      isPaused: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
      participants: {
        [userId]: owner
      },
      chat: [],
      history: []
    };

    addHistoryEntry(room, owner, "initial", {
      roomVersion: room.version,
      createdAt: now
    });

    rooms.set(roomId, room);
    return {
      room: serializeRoom(room),
      participant: owner
    };
  },

  joinRoom(roomId: string, username: string, existingUserId?: string) {
    const room = ensureRoom(roomId);
    const now = Date.now();

    const existingParticipant = existingUserId ? room.participants[existingUserId] : undefined;
    if (existingParticipant) {
      finalizeSessionTime(existingParticipant, now);
      existingParticipant.username = username;
      existingParticipant.isOnline = false;
      existingParticipant.status = "offline";
      room.updatedAt = now;
      return {
        room: serializeRoom(room),
        participant: existingParticipant
      };
    }

    const userId = createUserId();
    const participant: Participant = {
      userId,
      username,
      role: "editor",
      accent: nextAccent(room.participants),
      joinedAt: now,
      isOnline: false,
      status: "offline",
      lastActiveAt: now,
      cursor: defaultCursor(),
      editsCount: 0,
      timeSpentMs: 0
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
    participant.status = "idle";
    participant.socketId = socketId;
    participant.lastActiveAt = Date.now();
    participant.activeSessionStartedAt ??= participant.lastActiveAt;
    room.updatedAt = participant.lastActiveAt;
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

    finalizeSessionTime(participant);
    participant.isOnline = false;
    participant.status = "offline";
    participant.socketId = undefined;
    room.updatedAt = Date.now();
    transferOwnershipIfNeeded(room);

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
    if (room.isPaused) {
      throw new Error("Room editing is paused");
    }

    room.code = code;
    room.version += 1;
    participant.editsCount += 1;
    touchParticipantActivity(participant, room);
    const historyEntry = maybeAddAutosaveEntry(room, participant);
    return {
      room: serializeRoom(room),
      updatedBy: serializeParticipant(participant),
      historyEntry
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
    if (room.isPaused) {
      throw new Error("Room editing is paused");
    }

    room.language = language;
    if (resetCode) {
      room.code = LANGUAGE_CONFIG[language].starter;
    }
    room.version += 1;
    touchParticipantActivity(participant, room);
    const historyEntry = addHistoryEntry(room, participant, "language-change");
    return {
      room: serializeRoom(room),
      historyEntry
    };
  },

  updateCursor(roomId: string, userId: string, cursor: CursorState) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }

    participant.cursor = cursor;
    touchParticipantActivity(participant, room);
    return serializeParticipant(participant);
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
    touchParticipantActivity(participant, room);
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

  setPauseState(roomId: string, actingUserId: string, isPaused: boolean) {
    const room = ensureRoom(roomId);
    if (room.ownerId !== actingUserId) {
      throw new Error("Only the owner can pause the room");
    }

    room.isPaused = isPaused;
    room.updatedAt = Date.now();

    for (const participant of Object.values(room.participants)) {
      participant.status = participant.isOnline ? "idle" : "offline";
    }

    return serializeRoom(room);
  },

  restartRoom(roomId: string, actingUserId: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[actingUserId];
    if (room.ownerId !== actingUserId || !participant) {
      throw new Error("Only the owner can restart the room");
    }

    const latest = room.history[0];
    if (!latest || latest.code !== room.code || latest.language !== room.language) {
      addHistoryEntry(room, participant, "checkpoint");
    }

    room.code = "";
    room.version += 1;
    room.updatedAt = Date.now();

    for (const participant of Object.values(room.participants)) {
      participant.cursor = defaultCursor();
      participant.status = participant.isOnline ? "idle" : "offline";
      participant.lastActiveAt = room.updatedAt;
    }

    const historyEntry = addHistoryEntry(room, participant, "restart");
    return {
      room: serializeRoom(room),
      historyEntry
    };
  },

  restoreHistoryEntry(roomId: string, actingUserId: string, historyId: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[actingUserId];
    if (!participant) {
      throw new Error("Participant not found");
    }
    if (participant.role === "viewer") {
      throw new Error("Permission denied");
    }
    if (room.isPaused) {
      throw new Error("Room editing is paused");
    }

    const entry = room.history.find((historyEntry) => historyEntry.id === historyId);
    if (!entry) {
      throw new Error("History entry not found");
    }

    const latest = room.history[0];
    if (!latest || latest.code !== room.code || latest.language !== room.language) {
      addHistoryEntry(room, participant, "checkpoint");
    }

    room.code = entry.code;
    room.language = entry.language;
    room.version += 1;
    touchParticipantActivity(participant, room);
    const historyEntry = addHistoryEntry(room, participant, "restore");

    return {
      room: serializeRoom(room),
      restoredEntry: entry,
      historyEntry
    };
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

  setParticipantStatus(roomId: string, userId: string, status: PresenceStatus) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }

    participant.status = status;
    participant.isOnline = status !== "offline";
    if (status === "offline") {
      finalizeSessionTime(participant);
    } else {
      participant.activeSessionStartedAt ??= Date.now();
      if (status === "active") {
        participant.lastActiveAt = Date.now();
        room.updatedAt = participant.lastActiveAt;
      }
    }

    return serializeParticipant(participant);
  },

  recordParticipantActivity(roomId: string, userId: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }

    touchParticipantActivity(participant, room);
    return serializeParticipant(participant);
  },

  getParticipant(roomId: string, userId: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }

    return participant;
  },

  hasRoom(roomId: string) {
    return rooms.has(roomId);
  }
};
