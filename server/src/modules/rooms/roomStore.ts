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

const rooms = new Map<string, RoomState>();
const accentPalette: ParticipantAccent[] = ["blue", "emerald", "amber", "rose", "violet", "cyan"];
const MAX_HISTORY_ENTRIES = 30;
const MAX_CHAT_MESSAGES = 100;
const AUTO_SAVE_INTERVAL_MS = 20_000;

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
  history: [...room.history].sort((left, right) => right.createdAt - left.createdAt),
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
      workspace: createWorkspace(owner.userId, roomId, language, LANGUAGE_CONFIG[language].starter, `Room ${roomId}`),
      appliedWorkspaceOperationIds: []
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
      return {
        room: serializeRoom(room),
        participant: existingParticipant
      };
    }

    const identityKind = options?.identityKind ?? "guest";
    const participant = createParticipant(username, identityKind === "guest" ? "guest" : "member", nextAccent(room.participants), options);
    room.participants[participant.userId] = participant;
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
    rooms.set(snapshot.roomId, { ...snapshot, workspace, participants, appliedWorkspaceOperationIds: [] });

    return serializeRoom(ensureRoom(snapshot.roomId));
  }
};
