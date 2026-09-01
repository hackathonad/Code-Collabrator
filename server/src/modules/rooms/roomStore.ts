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
  RoomActivityEntry,
  RoomActivityKind,
  RoomRole,
  RoomSnapshot,
  RoomState,
  WorkspaceOperation,
  UserIdentityKind
} from "./roomTypes";
import { activeWorkspaceFile, applyWorkspaceOperation, createWorkspace, createWorkspaceFromProjectFiles, MAX_WORKSPACE_CONTENT_LENGTH, updateWorkspaceFileContent } from "./workspaceService";
import { clearAgentProposals, markAgentProposalsStale } from "../agent/agentEvents";
import { invalidateProjectIndexCache } from "../agent/agentIntelligence";
import { cancelAgentTasksForRoom, clearAgentTasks } from "../agent/agentTaskHistory";
import { clearAgentMemory } from "../agent/agentMemory";
import { projectService } from "../git/projectService";
import { gitService } from "../git/gitService";
import { executionService } from "../execution/executionService";

const rooms = new Map<string, RoomState>();
const accentPalette: ParticipantAccent[] = ["blue", "emerald", "amber", "rose", "violet", "cyan"];
const MAX_HISTORY_ENTRIES = 30;
const MAX_CHAT_MESSAGES = 100;
const MAX_ACTIVITY_ENTRIES = 60;
const AUTO_SAVE_INTERVAL_MS = 20_000;
const activityListeners = new Set<(entry: RoomActivityEntry) => void>();

interface ParticipantOptions {
  userId?: string;
  identityKind?: UserIdentityKind;
  avatarUrl?: string | null;
}

const createRoomId = () => {
  for (;;) {
    const roomId = randomBytes(4).toString("hex");
    if (!rooms.has(roomId)) {
      return roomId;
    }
  }
};

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
  displayName: participant.displayName ?? participant.username,
  avatarUrl: participant.avatarUrl ?? null,
  identityKind: participant.identityKind ?? "guest",
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
    (participant.isOnline && participant.activeSessionStartedAt ? Date.now() - participant.activeSessionStartedAt : 0),
  ...(participant.activeFileId ? { activeFileId: participant.activeFileId } : {}),
  ...(participant.activeFileName ? { activeFileName: participant.activeFileName } : {}),
  ...(participant.activity ? { activity: participant.activity } : {})
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
  history: [...room.history].sort((left, right) => right.createdAt - left.createdAt),
  activity: [...room.activity].sort((left, right) => right.createdAt - left.createdAt).slice(0, MAX_ACTIVITY_ENTRIES),
  workspace: room.workspace,
  deletedAt: room.deletedAt
});

const syncLegacyEditorProjection = (room: RoomState) => {
  const file = activeWorkspaceFile(room.workspace);
  if (!file) return;
  room.code = file.content;
  room.language = file.language;
  room.workspace.language = file.language;
};

const ensureRoom = (roomId: string) => {
  const room = rooms.get(roomId);
  if (!room || room.deletedAt) {
    throw new Error("Room not found");
  }
  return room;
};

const canEditCode = (role: RoomRole) => role === "owner" || role === "moderator" || role === "member" || role === "guest";
const canManageContent = (role: RoomRole) => role === "owner" || role === "moderator" || role === "member" || role === "guest";

const transferOwnershipIfNeeded = (room: RoomState) => {
  for (const participant of Object.values(room.participants)) {
    if (participant.userId !== room.ownerId && participant.role === "owner") {
      participant.role = "member";
    }
  }

  const owner = room.participants[room.ownerId];
  if (owner?.isOnline) {
    owner.role = "owner";
    return;
  }

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
    workspaceOperation?: WorkspaceOperation["type"];
    fileId?: string;
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
    reason,
    workspaceOperation: options?.workspaceOperation,
    fileId: options?.fileId
  };

  room.history = [entry, ...room.history].slice(0, MAX_HISTORY_ENTRIES);
  return entry;
};

const safeActivityText = (value: string) => value
  .replace(/(api[_-]?key|secret|password|token|authorization|cookie)\s*([:=])\s*[^\s,;]+/gi, "$1$2 [REDACTED]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 220);

export const subscribeRoomActivity = (listener: (entry: RoomActivityEntry) => void) => {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
};

export const clearRoomActivitySubscribers = () => activityListeners.clear();

const recordRoomActivity = (
  room: RoomState,
  actorId: string,
  kind: RoomActivityKind,
  message: string,
  details?: { actorName?: string; taskId?: string; fileId?: string }
) => {
  const cleanMessage = safeActivityText(message);
  if (!cleanMessage) return null;
  const participant = room.participants[actorId];
  const actorName = safeActivityText(details?.actorName ?? participant?.displayName ?? (actorId === "ai" ? "AI teammate" : "Room collaborator")) || "Room collaborator";
  const latest = room.activity[0];
  const now = Date.now();
  if (latest && latest.actorId === actorId && latest.kind === kind && latest.message === cleanMessage && now - latest.createdAt < 5_000) return latest;
  const entry: RoomActivityEntry = {
    id: randomUUID(),
    roomId: room.roomId,
    ...(actorId ? { actorId } : {}),
    actorName,
    kind,
    message: cleanMessage,
    createdAt: now,
    ...(details?.taskId ? { taskId: details.taskId.slice(0, 128) } : {}),
    ...(details?.fileId ? { fileId: details.fileId.slice(0, 128) } : {})
  };
  room.activity = [entry, ...room.activity].slice(0, MAX_ACTIVITY_ENTRIES);
  room.updatedAt = now;
  for (const listener of activityListeners) {
    try { listener(entry); } catch { /* Activity is observational and must not break room state. */ }
  }
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

const createParticipant = (username: string, role: RoomRole, accent: ParticipantAccent, options?: ParticipantOptions): Participant => {
  const now = Date.now();
  return {
    userId: options?.userId ?? createUserId(),
    username,
    displayName: username,
    avatarUrl: options?.avatarUrl ?? null,
    identityKind: options?.identityKind ?? "guest",
    role,
    accent,
    joinedAt: now,
    isOnline: false,
    status: "offline",
    lastActiveAt: now,
    cursor: defaultCursor(),
    editsCount: 0,
    timeSpentMs: 0
  };
};

export const roomStore = {
  recordActivity(roomId: string, actorId: string, kind: RoomActivityKind, message: string, details?: { actorName?: string; taskId?: string; fileId?: string }) {
    return recordRoomActivity(ensureRoom(roomId), actorId, kind, message, details);
  },

  createRoom(username: string, language: SupportedLanguage = "javascript", options?: ParticipantOptions) {
    const roomId = createRoomId();
    const owner = createParticipant(username, "owner", accentPalette[0], options);
    const now = owner.joinedAt;
    const room: RoomState = {
      roomId,
      ownerId: owner.userId,
      language,
      code: LANGUAGE_CONFIG[language].starter,
      isPaused: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
      participants: {
        [owner.userId]: owner
      },
      chat: [],
      history: [],
      activity: [],
      workspace: createWorkspace(owner.userId, roomId, language, LANGUAGE_CONFIG[language].starter, `Room ${roomId}`),
      appliedWorkspaceOperationIds: []
    };

    addHistoryEntry(room, owner, "initial", {
      roomVersion: room.version,
      createdAt: now
    });

    rooms.set(roomId, room);
    recordRoomActivity(room, owner.userId, "room", "created the room");
    return {
      room: serializeRoom(room),
      participant: owner
    };
  },

  joinRoom(roomId: string, username: string, existingUserId?: string, options?: ParticipantOptions) {
    const room = ensureRoom(roomId);
    const now = Date.now();
    const requestedUserId = options?.userId ?? existingUserId;
    const existingParticipant = requestedUserId ? room.participants[requestedUserId] : undefined;

    if (existingParticipant) {
      finalizeSessionTime(existingParticipant, now);
      existingParticipant.username = username;
      existingParticipant.displayName = username;
      existingParticipant.avatarUrl = options?.avatarUrl ?? existingParticipant.avatarUrl;
      existingParticipant.identityKind = options?.identityKind ?? existingParticipant.identityKind;
      existingParticipant.isOnline = false;
      existingParticipant.status = "offline";
      room.updatedAt = now;
      recordRoomActivity(room, existingParticipant.userId, "presence", "rejoined the room");
      return {
        room: serializeRoom(room),
        participant: existingParticipant
      };
    }

    const identityKind = options?.identityKind ?? "guest";
    const participant = createParticipant(username, identityKind === "guest" ? "guest" : "member", nextAccent(room.participants), options);
    room.participants[participant.userId] = participant;
    room.updatedAt = now;
    recordRoomActivity(room, participant.userId, "presence", "joined the room");

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
    for (const otherParticipant of Object.values(room.participants)) {
      if (otherParticipant.userId !== userId && otherParticipant.socketId === socketId) {
        otherParticipant.socketId = undefined;
      }
    }

    participant.socketId = socketId;
    participant.lastActiveAt = Date.now();
    participant.activeSessionStartedAt ??= participant.lastActiveAt;
    room.updatedAt = participant.lastActiveAt;
    return serializeRoom(room);
  },

  disconnectParticipant(roomId: string, userId: string, socketId?: string) {
    const room = rooms.get(roomId);
    if (!room || room.deletedAt) {
      return null;
    }

    const participant = room.participants[userId];
    if (!participant) {
      return serializeRoom(room);
    }

    if (socketId && participant.socketId && participant.socketId !== socketId) {
      return serializeRoom(room);
    }

    finalizeSessionTime(participant);
    participant.isOnline = false;
    participant.status = "offline";
    participant.socketId = undefined;
    room.updatedAt = Date.now();
    transferOwnershipIfNeeded(room);
    recordRoomActivity(room, userId, "presence", "left the room");

    return serializeRoom(room);
  },

  updateCode(roomId: string, userId: string, code: string, fileId?: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }
    if (!canEditCode(participant.role)) {
      throw new Error("Permission denied");
    }
    if (room.isPaused) {
      throw new Error("Room editing is paused");
    }

    const file = updateWorkspaceFileContent(room.workspace, fileId, code, userId);
    room.workspace.activeFileId = file.id;
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    gitService.invalidate(room.workspace.id);
    syncLegacyEditorProjection(room);
    room.version += 1;
    markAgentProposalsStale(room.roomId, room.version);
    participant.editsCount += 1;
    touchParticipantActivity(participant, room);
    participant.activeFileId = file.id;
    participant.activeFileName = file.name;
    participant.activity = `Editing ${file.name}`.slice(0, 120);
    recordRoomActivity(room, userId, "file", `edited ${file.name}`, { fileId: file.id });
    const historyEntry = maybeAddAutosaveEntry(room, participant);
    return {
      room: serializeRoom(room),
      updatedBy: serializeParticipant(participant),
      historyEntry
    };
  },

  applyAgentPatchBatch(roomId: string, userId: string, changes: Array<{ fileId: string; content: string }>) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) throw new Error("Participant not found");
    if (!canEditCode(participant.role)) throw new Error("Permission denied");
    if (room.isPaused) throw new Error("Room editing is paused");
    if (!changes.length || changes.length > 10) throw new Error("A patch must contain between one and ten files");
    const fileIds = new Set<string>();
    let totalDelta = 0;
    for (const change of changes) {
      if (fileIds.has(change.fileId)) throw new Error("A multi-file patch cannot contain duplicate files");
      fileIds.add(change.fileId);
      const file = room.workspace.files[change.fileId];
      if (!file) throw new Error("Patch file was not found");
      if (typeof change.content !== "string") throw new Error("Patch content is invalid");
      totalDelta += change.content.length - file.content.length;
    }
    const currentLength = Object.values(room.workspace.files).reduce((total, file) => total + file.content.length, 0);
    if (currentLength + totalDelta > MAX_WORKSPACE_CONTENT_LENGTH) throw new Error("Workspace content limit reached");
    // All validation and the final aggregate size check happen before any
    // mutation. Applying the already-validated values directly prevents a
    // positive change in one file from failing halfway through a multi-file
    // patch while a later file would have reduced the total size.
    const updatedAt = Date.now();
    for (const change of changes) {
      const file = room.workspace.files[change.fileId];
      file.content = change.content;
      file.updatedAt = updatedAt;
      file.updatedByUserId = userId;
    }
    room.workspace.updatedAt = updatedAt;
    room.workspace.ai.contextVersion += changes.length;
    room.workspace.activeFileId = changes[0].fileId;
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    gitService.invalidate(room.workspace.id);
    syncLegacyEditorProjection(room);
    room.version += 1;
    markAgentProposalsStale(room.roomId, room.version);
    participant.editsCount += changes.length;
    touchParticipantActivity(participant, room);
    const activeFile = room.workspace.files[room.workspace.activeFileId];
    if (activeFile) {
      participant.activeFileId = activeFile.id;
      participant.activeFileName = activeFile.name;
      participant.activity = `Editing ${activeFile.name}`.slice(0, 120);
      recordRoomActivity(room, userId, "file", `edited ${changes.length} shared file${changes.length === 1 ? "" : "s"}`, { fileId: activeFile.id });
    }
    const historyEntry = maybeAddAutosaveEntry(room, participant);
    return { room: serializeRoom(room), updatedBy: serializeParticipant(participant), historyEntry };
  },

  updateLanguage(roomId: string, userId: string, language: SupportedLanguage, resetCode: boolean) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }
    if (!canManageContent(participant.role)) {
      throw new Error("Permission denied");
    }
    if (room.isPaused) {
      throw new Error("Room editing is paused");
    }

    const activeFile = activeWorkspaceFile(room.workspace);
    if (!activeFile) throw new Error("Workspace has no active file");
    activeFile.language = language;
    if (resetCode) activeFile.content = LANGUAGE_CONFIG[language].starter;
    activeFile.updatedAt = Date.now();
    activeFile.updatedByUserId = userId;
    room.workspace.updatedAt = activeFile.updatedAt;
    room.workspace.ai.contextVersion += 1;
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    gitService.invalidate(room.workspace.id);
    syncLegacyEditorProjection(room);
    room.version += 1;
    markAgentProposalsStale(room.roomId, room.version);
    touchParticipantActivity(participant, room);
    participant.activeFileId = activeFile.id;
    participant.activeFileName = activeFile.name;
    participant.activity = `Changed language in ${activeFile.name}`.slice(0, 120);
    recordRoomActivity(room, userId, "file", `changed the language in ${activeFile.name}`, { fileId: activeFile.id });
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

  addChatMessage(roomId: string, userId: string, message: string, messageId?: string) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant) {
      throw new Error("Participant not found");
    }
    if (!message.trim()) {
      throw new Error("Message cannot be empty");
    }

    if (messageId) {
      const existingMessage = room.chat.find((entry) => entry.id === messageId);
      if (existingMessage) return existingMessage;
    }

    const chatMessage: ChatMessage = {
      id: messageId ?? randomUUID(),
      userId,
      username: participant.username,
      message,
      timestamp: Date.now()
    };

    room.chat = [...room.chat, chatMessage].slice(-MAX_CHAT_MESSAGES);
    touchParticipantActivity(participant, room);
    recordRoomActivity(room, userId, "chat", "sent a message");
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

    if (target.userId === room.ownerId) {
      throw new Error("Owner role cannot be changed");
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

    const activeFile = activeWorkspaceFile(room.workspace);
    if (activeFile) {
      activeFile.content = LANGUAGE_CONFIG[activeFile.language].starter;
      activeFile.updatedAt = Date.now();
      activeFile.updatedByUserId = actingUserId;
      room.workspace.updatedAt = activeFile.updatedAt;
      room.workspace.ai.contextVersion += 1;
    }
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    gitService.invalidate(room.workspace.id);
    syncLegacyEditorProjection(room);
    room.version += 1;
    markAgentProposalsStale(room.roomId, room.version);
    room.updatedAt = Date.now();

    for (const participant of Object.values(room.participants)) {
      participant.cursor = defaultCursor();
      participant.status = participant.isOnline ? "idle" : "offline";
      participant.lastActiveAt = room.updatedAt;
    }

    const historyEntry = addHistoryEntry(room, participant, "restart");
    participant.activity = "Reset the shared starter code";
    recordRoomActivity(room, actingUserId, "file", "reset the shared starter code");
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
    if (!canManageContent(participant.role)) {
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

    const activeFile = activeWorkspaceFile(room.workspace);
    if (activeFile) {
      activeFile.content = entry.code;
      activeFile.language = entry.language;
      activeFile.updatedAt = Date.now();
      activeFile.updatedByUserId = actingUserId;
      room.workspace.updatedAt = activeFile.updatedAt;
      room.workspace.ai.contextVersion += 1;
    }
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    gitService.invalidate(room.workspace.id);
    syncLegacyEditorProjection(room);
    room.version += 1;
    markAgentProposalsStale(room.roomId, room.version);
    touchParticipantActivity(participant, room);
    const restoredFile = room.workspace.files[room.workspace.activeFileId];
    if (restoredFile) {
      participant.activeFileId = restoredFile.id;
      participant.activeFileName = restoredFile.name;
      participant.activity = `Restored ${restoredFile.name}`.slice(0, 120);
      recordRoomActivity(room, actingUserId, "file", `restored ${restoredFile.name}`, { fileId: restoredFile.id });
    }
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

    room.deletedAt = Date.now();
    executionService.clearRoom(roomId);
    cancelAgentTasksForRoom(roomId);
    rooms.delete(roomId);
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    clearAgentProposals(roomId);
    clearAgentTasks(roomId);
    clearAgentMemory(roomId);
    projectService.clearRoom(roomId);
  },

  getRoomSnapshot(roomId: string) {
    return serializeRoom(ensureRoom(roomId));
  },

  applyWorkspaceOperation(roomId: string, userId: string, operation: WorkspaceOperation) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant || !canManageContent(participant.role)) throw new Error("Permission denied");
    if (room.isPaused) throw new Error("Room editing is paused");
    if (room.appliedWorkspaceOperationIds.includes(operation.id)) return { room: serializeRoom(room), duplicate: true };
    const activeFile = applyWorkspaceOperation(room.workspace, operation, userId);
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    gitService.invalidate(room.workspace.id);
    syncLegacyEditorProjection(room);
    room.version += 1;
    markAgentProposalsStale(room.roomId, room.version);
    touchParticipantActivity(participant, room);
    if (activeFile) {
      participant.activeFileId = activeFile.id;
      participant.activeFileName = activeFile.name;
      participant.activity = operation.type === "set-active-file" ? `Viewing ${activeFile.name}` : `${operation.type.replaceAll("-", " ")} · ${activeFile.name}`.slice(0, 120);
    }
    recordRoomActivity(room, userId, "file", operation.type === "set-active-file" ? `opened ${activeFile?.name ?? "a file"}` : `${operation.type.replaceAll("-", " ")} workspace`, activeFile ? { fileId: activeFile.id } : undefined);
    room.appliedWorkspaceOperationIds = [...room.appliedWorkspaceOperationIds, operation.id].slice(-250);
    addHistoryEntry(room, participant, "checkpoint", { workspaceOperation: operation.type, fileId: activeFile?.id, code: room.code, language: room.language });
    return { room: serializeRoom(room), duplicate: false };
  },

  replaceWorkspaceFromProject(roomId: string, userId: string, files: Array<{ path: string; content: string }>, project: { name: string; repositoryId: string; branch: string; provider: "github" }) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant || !canManageContent(participant.role)) throw new Error("Permission denied");
    if (room.isPaused) throw new Error("Room editing is paused");
    const workspace = createWorkspaceFromProjectFiles(room.workspace, files, userId, project.name);
    workspace.git = { repositoryId: project.repositoryId, branch: project.branch, provider: project.provider, repositoryRootId: workspace.rootFolderId };
    room.workspace = workspace;
    syncLegacyEditorProjection(room);
    room.version += 1;
    markAgentProposalsStale(room.roomId, room.version);
    touchParticipantActivity(participant, room);
    addHistoryEntry(room, participant, "checkpoint", { code: room.code, language: room.language, fileId: room.workspace.activeFileId });
    recordRoomActivity(room, userId, "file", `imported ${project.name} into the workspace`);
    invalidateProjectIndexCache(room.roomId, room.workspace.id);
    gitService.invalidate(room.workspace.id);
    return { room: serializeRoom(room) };
  },

  updateGitReference(roomId: string, userId: string, reference: { repositoryId: string; branch: string; provider: "github" }) {
    const room = ensureRoom(roomId);
    const participant = room.participants[userId];
    if (!participant || !canManageContent(participant.role)) throw new Error("Permission denied");
    room.workspace.git = { ...room.workspace.git, repositoryId: reference.repositoryId, branch: reference.branch, provider: reference.provider, repositoryRootId: room.workspace.git.repositoryRootId ?? room.workspace.rootFolderId };
    room.workspace.updatedAt = Date.now();
    room.version += 1;
    touchParticipantActivity(participant, room);
    recordRoomActivity(room, userId, "git", `linked the shared repository on ${reference.branch}`);
    return { room: serializeRoom(room) };
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
  },

  upsertRoomSnapshot(snapshot: RoomSnapshot) {
    const participants = Object.fromEntries(
      snapshot.participants.map((participant) => [
        participant.userId,
        {
          ...participant,
          displayName: participant.displayName ?? participant.username,
          avatarUrl: participant.avatarUrl ?? null,
          identityKind: participant.identityKind ?? "guest",
          isOnline: false,
          status: "offline" as const,
          socketId: undefined,
          activeSessionStartedAt: undefined
        }
      ])
    );

    const workspace = snapshot.workspace ?? createWorkspace(snapshot.ownerId, snapshot.roomId, snapshot.language, snapshot.code, `Room ${snapshot.roomId}`);
    rooms.set(snapshot.roomId, { ...snapshot, workspace, activity: snapshot.activity ?? [], participants, appliedWorkspaceOperationIds: [] });

    return serializeRoom(ensureRoom(snapshot.roomId));
  }
};
