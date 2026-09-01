import type { Server, Socket } from "socket.io";
import { roomStore } from "../modules/rooms/roomStore";
import { subscribeRoomActivity } from "../modules/rooms/roomStore";
import type { RoomRole, WorkspaceOperation, WorkspaceOperationType } from "../modules/rooms/roomTypes";
import { verifyGuestSessionToken } from "../middleware/guestSession";
import { roomPersistence } from "../services/roomPersistence";
import { getPublicAgentProposalHistory, getPublicAgentProposalState, subscribeAgentProposal, subscribeAgentWorkspaceChange } from "../modules/agent/agentEvents";
import { getPublicAgentTaskHistory, subscribeAgentTasks } from "../modules/agent/agentTaskHistory";
import { subscribeGitState } from "../modules/git/gitEvents";
import { executionService } from "../modules/execution/executionService";
import { subscribeExecution } from "../modules/execution/executionEvents";
import { projectService } from "../modules/git/projectService";
import {
  isEditableRole,
  isRecord,
  isSupportedLanguage,
  sanitizeBoolean,
  sanitizeCode,
  sanitizeCursor,
  sanitizeMessage,
  sanitizeRoomId,
  sanitizeUserId
} from "../utils/validation";

interface JoinPayload {
  roomId: string;
  userId: string;
}

interface EditorPayload extends JoinPayload {
  code: string;
  fileId?: string;
}

interface WorkspacePayload extends JoinPayload {
  operation: WorkspaceOperation;
}

interface CursorPayload extends JoinPayload {
  cursor: NonNullable<ReturnType<typeof sanitizeCursor>>;
}

interface LanguagePayload extends JoinPayload {
  language: Parameters<typeof roomStore.updateLanguage>[2];
  resetCode: boolean;
}

interface ChatPayload extends JoinPayload {
  message: string;
  messageId?: string;
}

interface TypingPayload extends JoinPayload {
  isTyping: boolean;
}

interface RolePayload {
  roomId: string;
  actingUserId: string;
  targetUserId: string;
  role: Exclude<RoomRole, "owner">;
}

interface OwnerActionPayload {
  roomId: string;
  actingUserId: string;
}

interface PausePayload extends OwnerActionPayload {
  isPaused: boolean;
}

const socketRoomBindings = new Map<string, JoinPayload>();
const presenceTimers = new Map<string, NodeJS.Timeout>();
const chatTypingTimers = new Map<string, NodeJS.Timeout>();
const editorTypingTimers = new Map<string, NodeJS.Timeout>();
const rateLimitWindows = new Map<string, { startedAt: number; count: number }>();
const persistenceTimers = new Map<string, NodeJS.Timeout>();
const pendingPersistenceSnapshots = new Map<string, ReturnType<typeof roomStore.getRoomSnapshot>>();
const IDLE_TIMEOUT_MS = 20_000;
const CHAT_TYPING_TIMEOUT_MS = 2_500;
const EDITOR_TYPING_TIMEOUT_MS = 1_800;
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_EVENTS = 80;
const EDITOR_PERSIST_DEBOUNCE_MS = 1_500;
const agentSocketSubscriptions = new Set<() => boolean>();
const registeredServers = new WeakSet<object>();

/** Clears server-owned timers during a controlled process shutdown. */
export const clearCollaborationRuntime = async () => {
  for (const timer of presenceTimers.values()) clearTimeout(timer);
  for (const timer of chatTypingTimers.values()) clearTimeout(timer);
  for (const timer of editorTypingTimers.values()) clearTimeout(timer);
  for (const timer of persistenceTimers.values()) clearTimeout(timer);
  presenceTimers.clear();
  chatTypingTimers.clear();
  editorTypingTimers.clear();
  const pendingSnapshots = [...pendingPersistenceSnapshots.values()];
  persistenceTimers.clear();
  pendingPersistenceSnapshots.clear();
  rateLimitWindows.clear();
  for (const unsubscribe of agentSocketSubscriptions) unsubscribe();
  agentSocketSubscriptions.clear();
  executionService.shutdown();
  socketRoomBindings.clear();
  await Promise.all(pendingSnapshots.map((snapshot) => roomPersistence.saveRoom(snapshot)));
  await roomPersistence.flush();
};

const participantKey = (roomId: string, userId: string) => `${roomId}:${userId}`;

const parseJoinPayload = (payload: unknown): JoinPayload | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const roomId = sanitizeRoomId(payload.roomId);
  const userId = sanitizeUserId(payload.userId);
  return roomId && userId ? { roomId, userId } : null;
};

const parseEditorPayload = (payload: unknown): EditorPayload | null => {
  const base = parseJoinPayload(payload);
  if (!base || !isRecord(payload)) {
    return null;
  }

  const code = sanitizeCode(payload.code);
  const fileId = typeof payload.fileId === "string" && payload.fileId.length <= 128 ? payload.fileId : undefined;
  return code === null ? null : { ...base, code, fileId };
};


const workspaceOperationTypes = new Set<WorkspaceOperationType>([
  "create-file", "create-folder", "rename", "delete", "duplicate-file", "move", "copy", "paste", "restore-file", "set-active-file", "set-open-files", "set-file-language"
]);

const parseWorkspacePayload = (payload: unknown): WorkspacePayload | null => {
  const base = parseJoinPayload(payload);
  if (!base || !isRecord(payload) || !isRecord(payload.operation)) return null;
  const raw = payload.operation;
  const type = typeof raw.type === "string" && workspaceOperationTypes.has(raw.type as WorkspaceOperationType) ? (raw.type as WorkspaceOperationType) : null;
  const id = typeof raw.id === "string" && raw.id.length >= 8 && raw.id.length <= 128 ? raw.id : "";
  if (!type || !id) return null;
  const text = (value: unknown) => (typeof value === "string" && value.length <= 128 ? value : undefined);
  const fileIds = Array.isArray(raw.fileIds) && raw.fileIds.every((value) => typeof value === "string" && value.length <= 128) ? raw.fileIds : undefined;
  const language = isSupportedLanguage(raw.language) ? raw.language : undefined;
  return { ...base, operation: { id, type, nodeId: text(raw.nodeId), parentId: text(raw.parentId), name: typeof raw.name === "string" ? raw.name.slice(0, 121) : undefined, sourceId: text(raw.sourceId), targetParentId: text(raw.targetParentId), fileIds, language } };
};

const parseCursorPayload = (payload: unknown): CursorPayload | null => {
  const base = parseJoinPayload(payload);
  if (!base || !isRecord(payload)) {
    return null;
  }

  const cursor = sanitizeCursor(payload.cursor);
  return cursor ? { ...base, cursor } : null;
};

const parseLanguagePayload = (payload: unknown): LanguagePayload | null => {
  const base = parseJoinPayload(payload);
  if (!base || !isRecord(payload) || !isSupportedLanguage(payload.language)) {
    return null;
  }

  return {
    ...base,
    language: payload.language,
    resetCode: sanitizeBoolean(payload.resetCode)
  };
};

const parseChatPayload = (payload: unknown): ChatPayload | null => {
  const base = parseJoinPayload(payload);
  if (!base || !isRecord(payload)) {
    return null;
  }

  const message = sanitizeMessage(payload.message);
  const messageId = typeof payload.messageId === "string" && payload.messageId.length <= 128 ? payload.messageId : undefined;
  return message ? { ...base, message, messageId } : null;
};

const parseTypingPayload = (payload: unknown): TypingPayload | null => {
  const base = parseJoinPayload(payload);
  if (!base || !isRecord(payload)) {
    return null;
  }

  return {
    ...base,
    isTyping: sanitizeBoolean(payload.isTyping)
  };
};

const parseOwnerActionPayload = (payload: unknown): OwnerActionPayload | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const roomId = sanitizeRoomId(payload.roomId);
  const actingUserId = sanitizeUserId(payload.actingUserId);
  return roomId && actingUserId ? { roomId, actingUserId } : null;
};

const parsePausePayload = (payload: unknown): PausePayload | null => {
  const base = parseOwnerActionPayload(payload);
  if (!base || !isRecord(payload)) {
    return null;
  }

  return {
    ...base,
    isPaused: sanitizeBoolean(payload.isPaused)
  };
};

const parseRolePayload = (payload: unknown): RolePayload | null => {
  const base = parseOwnerActionPayload(payload);
  if (!base || !isRecord(payload) || !isEditableRole(payload.role)) {
    return null;
  }

  const targetUserId = sanitizeUserId(payload.targetUserId);
  return targetUserId
    ? {
        ...base,
        targetUserId,
        role: payload.role
      }
    : null;
};

const isCurrentBinding = (socket: Socket, roomId: string, userId: string) => {
  const binding = socketRoomBindings.get(socket.id);
  if (!binding || binding.roomId !== roomId || binding.userId !== userId) return false;
  try {
    return roomStore.getParticipant(roomId, userId).socketId === socket.id;
  } catch {
    return false;
  }
};

const loadRoomIfNeeded = async (roomId: string) => {
  if (roomStore.hasRoom(roomId)) {
    return true;
  }

  const persisted = await roomPersistence.loadRoom(roomId);
  if (!persisted) {
    return false;
  }

  roomStore.upsertRoomSnapshot(persisted);
  return true;
};

const resolveSocketUserId = async (socket: Socket, roomId: string) => {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  const guestToken = typeof auth?.guestToken === "string" ? auth.guestToken : "";
  return verifyGuestSessionToken(roomId, guestToken);
};

export const registerCollaborationSocket = (io: Server) => {
  if (registeredServers.has(io)) return;
  registeredServers.add(io);
  const reject = (socket: Socket, message = "Invalid room event payload") => {
    socket.emit("room:error", message);
  };

  const scheduleRoomPersistence = (snapshot: ReturnType<typeof roomStore.getRoomSnapshot>) => {
    const timer = persistenceTimers.get(snapshot.roomId);
    if (timer) clearTimeout(timer);
    pendingPersistenceSnapshots.set(snapshot.roomId, snapshot);
    persistenceTimers.set(snapshot.roomId, setTimeout(() => {
      persistenceTimers.delete(snapshot.roomId);
      pendingPersistenceSnapshots.delete(snapshot.roomId);
      void roomPersistence.saveRoom(snapshot);
    }, EDITOR_PERSIST_DEBOUNCE_MS));
  };

  const unsubscribeAgentWorkspace = subscribeAgentWorkspaceChange((change) => {
    io.to(change.roomId).emit("editor:sync", {
      code: change.snapshot.code,
      language: change.snapshot.language,
      version: change.snapshot.version,
      updatedBy: change.userId,
      fileId: change.fileId
    });
    io.to(change.roomId).emit("workspace:sync", {
      workspace: change.snapshot.workspace,
      code: change.snapshot.code,
      language: change.snapshot.language,
      version: change.snapshot.version,
      history: change.snapshot.history,
      updatedBy: change.userId
    });
  });
  agentSocketSubscriptions.add(unsubscribeAgentWorkspace);

  const unsubscribeAgentProposal = subscribeAgentProposal((event) => {
    io.to(event.roomId).emit("agent:proposal", event);
    try {
      const actorId = event.type === "proposal_created" ? "ai" : event.changedBy ?? event.userId;
      const actorName = event.type === "proposal_created" ? "AI teammate" : undefined;
      const action = event.type === "proposal_created" ? `prepared a patch for ${event.path}` : `${event.type.replace("proposal_", "")} the patch for ${event.path}`;
      roomStore.recordActivity(event.roomId, actorId, "patch", action, { actorName, taskId: undefined, fileId: event.fileId });
    } catch { /* The room may have been deleted before the proposal event arrived. */ }
  });
  agentSocketSubscriptions.add(unsubscribeAgentProposal);
  const unsubscribeAgentTasks = subscribeAgentTasks((event) => {
    io.to(event.task.roomId).emit("agent:task", event);
    try {
      const statusLabel: Record<string, string> = { queued: "queued", planning: "planning", running: "investigating", waiting_for_approval: "waiting for approval", applying: "applying a patch", validating: "running validation", completed: "completed", cancelled: "cancelled", failed: "failed", timed_out: "timed out", conflict: "hit a conflict" };
      const message = event.type === "task_started" ? `started “${event.task.summary}”` : `${statusLabel[event.task.status] ?? event.task.status} “${event.task.summary}”`;
      roomStore.recordActivity(event.task.roomId, "ai", "agent", `AI teammate ${message}`, { actorName: "AI teammate", taskId: event.task.taskId });
    } catch { /* The room may have been deleted before the task event arrived. */ }
  });
  agentSocketSubscriptions.add(unsubscribeAgentTasks);
  const unsubscribeGitState = subscribeGitState((event) => {
    io.to(event.roomId).emit("git:state", event);
    try { roomStore.recordActivity(event.roomId, "git", "git", `${event.operation} shared Git state`, { actorName: "Shared Git" }); } catch { /* Git activity is best effort. */ }
  });
  agentSocketSubscriptions.add(unsubscribeGitState);
  const unsubscribeExecution = subscribeExecution((event) => {
    io.to(event.record.roomId).emit("execution:state", event);
    try {
      const state = event.record.status === "queued" ? "queued" : event.record.status === "running" ? "started" : event.record.status;
      roomStore.recordActivity(event.record.roomId, event.record.ownerId, "validation", `${event.record.action} ${state}`, { fileId: undefined });
    } catch { /* Validation activity is best effort. */ }
  });
  agentSocketSubscriptions.add(unsubscribeExecution);
  const unsubscribeRoomActivity = subscribeRoomActivity((entry) => {
    io.to(entry.roomId).emit("room:activity", entry);
    try { void roomPersistence.saveRoom(roomStore.getRoomSnapshot(entry.roomId)); } catch { /* The room may have been deleted between the event and persistence. */ }
  });
  agentSocketSubscriptions.add(unsubscribeRoomActivity);


  const checkRateLimit = (socket: Socket) => {
    const now = Date.now();
    const current = rateLimitWindows.get(socket.id);
    if (!current || now - current.startedAt > RATE_LIMIT_WINDOW_MS) {
      rateLimitWindows.set(socket.id, { startedAt: now, count: 1 });
      return true;
    }

    current.count += 1;
    return current.count <= RATE_LIMIT_MAX_EVENTS;
  };

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
    const persistenceTimer = persistenceTimers.get(roomId);
    if (persistenceTimer) { clearTimeout(persistenceTimer); persistenceTimers.delete(roomId); }
    pendingPersistenceSnapshots.delete(roomId);
    for (const [socketId, binding] of socketRoomBindings.entries()) {
      if (binding.roomId === roomId) {
        clearPresenceTimer(binding.roomId, binding.userId);
        clearTypingTimer(chatTypingTimers, binding.roomId, binding.userId);
        clearTypingTimer(editorTypingTimers, binding.roomId, binding.userId);
        socketRoomBindings.delete(socketId);
        rateLimitWindows.delete(socketId);
      }
    }
  };

  const handlePauseRoom = (payload: PausePayload, socket: Socket) => {
    try {
      if (!isCurrentBinding(socket, payload.roomId, payload.actingUserId)) {
        reject(socket);
        return;
      }
      const snapshot = roomStore.setPauseState(payload.roomId, payload.actingUserId, payload.isPaused);
      io.to(payload.roomId).emit("room:snapshot", snapshot);
      void roomPersistence.saveRoom(snapshot);
    } catch (error) {
      reject(socket, error instanceof Error ? error.message : "Unable to update room state");
    }
  };

  const handleRestartRoom = (payload: OwnerActionPayload, socket: Socket, acknowledge?: (reply: { ok: boolean; room?: ReturnType<typeof roomStore.getRoomSnapshot>; message?: string }) => void) => {
    try {
      if (!isCurrentBinding(socket, payload.roomId, payload.actingUserId)) {
        const message = "Invalid room event payload";
        reject(socket, message);
        acknowledge?.({ ok: false, message });
        return;
      }
      const result = roomStore.restartRoom(payload.roomId, payload.actingUserId);
      io.to(payload.roomId).emit("room:snapshot", result.room);
      io.to(payload.roomId).emit("history:update", result.room.history);
      void roomPersistence.saveRoom(result.room);
      acknowledge?.({ ok: true, room: result.room });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restart room";
      reject(socket, message);
      acknowledge?.({ ok: false, message });
    }
  };

  const handleDeleteRoom = async (payload: OwnerActionPayload, socket: Socket, acknowledge?: (reply: { ok: boolean; message?: string }) => void) => {
    try {
      if (!isCurrentBinding(socket, payload.roomId, payload.actingUserId)) {
        const message = "Invalid room event payload";
        reject(socket, message);
        acknowledge?.({ ok: false, message });
        return;
      }
      if (roomStore.getRoomSnapshot(payload.roomId).ownerId !== payload.actingUserId) {
        const message = "Only the owner can delete the room";
        reject(socket, message);
        acknowledge?.({ ok: false, message });
        return;
      }
      // Invalidate the authoritative live room and notify clients before the
      // optional persistence operation. A database outage must not preserve a
      // usable room in memory.
      roomStore.deleteRoom(payload.roomId, payload.actingUserId);
      io.to(payload.roomId).emit("room:deleted");
      clearRoomTracking(payload.roomId);
      io.in(payload.roomId).socketsLeave(payload.roomId);

      const persisted = await roomPersistence.deleteRoom(payload.roomId);
      if (!persisted) {
        const message = "The room was deleted from active memory, but durable persistence could not be updated.";
        reject(socket, message);
        acknowledge?.({ ok: false, message });
        return;
      }
      acknowledge?.({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete room";
      reject(socket, message);
      acknowledge?.({ ok: false, message });
    }
  };

  io.on("connection", (socket) => {
    socket.use((_event, next) => {
      if (!checkRateLimit(socket)) {
        reject(socket, "Too many realtime events. Please slow down.");
        return;
      }
      next();
    });

    socket.on("room:join", async (rawPayload: unknown) => {
      const payload = parseJoinPayload(rawPayload);
      if (!payload) {
        reject(socket);
        return;
      }

      try {
        const resolvedUserId = await resolveSocketUserId(socket, payload.roomId);
        if (!resolvedUserId) {
          reject(socket, "A valid room session is required");
          return;
        }
        const exists = await loadRoomIfNeeded(payload.roomId);
        if (!exists) {
          reject(socket, "Room not found");
          return;
        }
        payload.userId = resolvedUserId;

        const existingParticipant = roomStore.getParticipant(payload.roomId, payload.userId);
        if (existingParticipant.socketId && existingParticipant.socketId !== socket.id) {
          io.sockets.sockets.get(existingParticipant.socketId)?.disconnect(true);
        }

        const previousBinding = socketRoomBindings.get(socket.id);
        if (previousBinding && previousBinding.roomId !== payload.roomId) {
          socket.leave(previousBinding.roomId);
        }

        const snapshot = roomStore.connectParticipant(payload.roomId, payload.userId, socket.id);
        scheduleIdleStatus(payload.roomId, payload.userId);
        socket.join(payload.roomId);
        socketRoomBindings.set(socket.id, payload);
        socket.emit("room:snapshot", snapshot);
        socket.emit("room:activity_history", snapshot.activity);
        socket.emit("agent:task_history", getPublicAgentTaskHistory(payload.roomId));
        socket.emit("agent:proposal_history", getPublicAgentProposalHistory(payload.roomId));
        socket.emit("agent:proposal_state", getPublicAgentProposalState(payload.roomId));
        socket.emit("execution:history", executionService.list(payload.roomId, snapshot.workspace.id));
        const gitSummary = projectService.getSummary(snapshot.workspace);
        if (gitSummary) socket.emit("git:state", { roomId: payload.roomId, workspace: snapshot.workspace, summary: { ...gitSummary, diff: undefined }, version: snapshot.version, code: snapshot.code, language: snapshot.language, history: snapshot.history, operation: "status" });
        io.to(payload.roomId).emit("room:participants", snapshot.participants);
        void roomPersistence.saveRoom(snapshot);
      } catch (error) {
        reject(socket, error instanceof Error ? error.message : "Unable to join socket room");
      }
    });

    socket.on("editor:update", (rawPayload: unknown) => {
      const payload = parseEditorPayload(rawPayload);
      if (!payload || !isCurrentBinding(socket, payload.roomId, payload.userId)) {
        reject(socket);
        return;
      }

      try {
        const result = roomStore.updateCode(payload.roomId, payload.userId, payload.code, payload.fileId);
        markParticipantActive(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("editor:sync", {
          code: result.room.code,
          language: result.room.language,
          version: result.room.version,
          updatedBy: result.updatedBy.userId,
          fileId: result.room.workspace.activeFileId
        });
        if (result.historyEntry) {
          io.to(payload.roomId).emit("history:update", result.room.history);
        }
        scheduleRoomPersistence(result.room);
      } catch (error) {
        reject(socket, error instanceof Error ? error.message : "Unable to sync code");
      }
    });


    socket.on("workspace:operation", (rawPayload: unknown) => {
      const payload = parseWorkspacePayload(rawPayload);
      if (!payload || !isCurrentBinding(socket, payload.roomId, payload.userId)) {
        reject(socket, "Invalid workspace operation");
        return;
      }
      try {
        const result = roomStore.applyWorkspaceOperation(payload.roomId, payload.userId, payload.operation);
        if (!result.duplicate) {
          markParticipantActive(payload.roomId, payload.userId);
          io.to(payload.roomId).emit("workspace:sync", {
            workspace: result.room.workspace,
            code: result.room.code,
            language: result.room.language,
            version: result.room.version,
            history: result.room.history,
            updatedBy: payload.userId
          });
          void roomPersistence.saveRoom(result.room);
        }
      } catch (error) {
        reject(socket, error instanceof Error ? error.message : "Unable to update workspace");
      }
    });

    socket.on("editor:cursor", (rawPayload: unknown) => {
      const payload = parseCursorPayload(rawPayload);
      if (!payload || !isCurrentBinding(socket, payload.roomId, payload.userId)) {
        reject(socket);
        return;
      }

      try {
        const participant = roomStore.updateCursor(payload.roomId, payload.userId, payload.cursor);
        scheduleIdleStatus(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("presence:update", participant);
        socket.to(payload.roomId).emit("cursor-update", {
          userId: participant.userId,
          username: participant.username,
          lineNumber: participant.cursor.lineNumber,
          column: participant.cursor.column
        });
      } catch (error) {
        reject(socket, error instanceof Error ? error.message : "Unable to update cursor");
      }
    });

    socket.on("editor:typing", (rawPayload: unknown) => {
      const payload = parseTypingPayload(rawPayload);
      if (!payload || !isCurrentBinding(socket, payload.roomId, payload.userId)) {
        reject(socket);
        return;
      }

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
        reject(socket, error instanceof Error ? error.message : "Unable to update editor typing state");
      }
    });

    socket.on("room:language", (rawPayload: unknown) => {
      const payload = parseLanguagePayload(rawPayload);
      if (!payload || !isCurrentBinding(socket, payload.roomId, payload.userId)) {
        reject(socket, payload ? "Invalid room event payload" : "Unsupported language");
        return;
      }

      try {
        const result = roomStore.updateLanguage(payload.roomId, payload.userId, payload.language, payload.resetCode);
        markParticipantActive(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("editor:sync", {
          code: result.room.code,
          language: result.room.language,
          version: result.room.version,
          updatedBy: payload.userId,
          fileId: result.room.workspace.activeFileId
        });
        io.to(payload.roomId).emit("history:update", result.room.history);
        void roomPersistence.saveRoom(result.room);
      } catch (error) {
        reject(socket, error instanceof Error ? error.message : "Unable to change language");
      }
    });

    socket.on("chat:send", (rawPayload: unknown) => {
      const payload = parseChatPayload(rawPayload);
      if (!payload || !isCurrentBinding(socket, payload.roomId, payload.userId)) {
        reject(socket);
        return;
      }

      try {
        clearTypingTimer(chatTypingTimers, payload.roomId, payload.userId);
        emitTyping("chat:typing", payload.roomId, payload.userId, false);
        const message = roomStore.addChatMessage(payload.roomId, payload.userId, payload.message, payload.messageId);
        const participant = roomStore.getParticipant(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("presence:update", participant);
        scheduleIdleStatus(payload.roomId, payload.userId);
        io.to(payload.roomId).emit("chat:new", message);
        void roomPersistence.saveRoom(roomStore.getRoomSnapshot(payload.roomId));
      } catch (error) {
        reject(socket, error instanceof Error ? error.message : "Unable to send chat message");
      }
    });

    socket.on("chat:typing", (rawPayload: unknown) => {
      const payload = parseTypingPayload(rawPayload);
      if (!payload || !isCurrentBinding(socket, payload.roomId, payload.userId)) {
        reject(socket);
        return;
      }

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
        reject(socket, error instanceof Error ? error.message : "Unable to update chat typing state");
      }
    });

    socket.on("room:role", (rawPayload: unknown) => {
      const payload = parseRolePayload(rawPayload);
      if (!payload) {
        reject(socket);
        return;
      }

      try {
        if (!isCurrentBinding(socket, payload.roomId, payload.actingUserId)) {
          reject(socket);
          return;
        }
        const snapshot = roomStore.updateRole(payload.roomId, payload.actingUserId, payload.targetUserId, payload.role);
        io.to(payload.roomId).emit("room:participants", snapshot.participants);
        void roomPersistence.saveRoom(snapshot);
      } catch (error) {
        reject(socket, error instanceof Error ? error.message : "Unable to update role");
      }
    });

    socket.on("room:pause", (rawPayload: unknown) => {
      const payload = parsePausePayload(rawPayload);
      if (!payload) {
        reject(socket);
        return;
      }

      handlePauseRoom(payload, socket);
    });

    socket.on("room:restart", (rawPayload: unknown, acknowledge?: (reply: { ok: boolean; room?: ReturnType<typeof roomStore.getRoomSnapshot>; message?: string }) => void) => {
      const payload = parseOwnerActionPayload(rawPayload);
      if (!payload) {
        const message = "Invalid room event payload";
        reject(socket, message);
        acknowledge?.({ ok: false, message });
        return;
      }
      handleRestartRoom(payload, socket, acknowledge);
    });

    socket.on("room:delete", (rawPayload: unknown, acknowledge?: (reply: { ok: boolean; message?: string }) => void) => {
      const payload = parseOwnerActionPayload(rawPayload);
      if (!payload) {
        reject(socket);
        acknowledge?.({ ok: false, message: "Invalid room event payload" });
        return;
      }

      void handleDeleteRoom(payload, socket, acknowledge);
    });

    socket.on("disconnect", () => {
      rateLimitWindows.delete(socket.id);
      const binding = socketRoomBindings.get(socket.id);
      if (!binding) {
        return;
      }

      socketRoomBindings.delete(socket.id);
      clearPresenceTimer(binding.roomId, binding.userId);
      clearTypingTimer(chatTypingTimers, binding.roomId, binding.userId);
      clearTypingTimer(editorTypingTimers, binding.roomId, binding.userId);
      const snapshot = roomStore.disconnectParticipant(binding.roomId, binding.userId, socket.id);
      if (snapshot) {
        const participant = snapshot.participants.find((entry) => entry.userId === binding.userId);
        io.to(binding.roomId).emit("chat:typing", {
          userId: binding.userId,
          username: participant?.username ?? "",
          isTyping: false
        });
        io.to(binding.roomId).emit("editor:typing", {
          userId: binding.userId,
          username: participant?.username ?? "",
          isTyping: false
        });
        if (participant) {
          io.to(binding.roomId).emit("presence:update", participant);
        }
        io.to(binding.roomId).emit("room:participants", snapshot.participants);
        void roomPersistence.saveRoom(snapshot);
      }
    });
  });
};
