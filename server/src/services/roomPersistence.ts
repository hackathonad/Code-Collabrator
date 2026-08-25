import { supabaseAdmin } from "../lib/supabase";
import type { RoomSnapshot, WorkspaceState } from "../modules/rooms/roomTypes";

const toIso = (timestamp: number | undefined) => (timestamp ? new Date(timestamp).toISOString() : null);
const fromIso = (value: string | null | undefined) => (value ? new Date(value).getTime() : Date.now());

interface RoomRow {
  id: string;
  owner_id: string;
  language: RoomSnapshot["language"];
  code: string;
  is_paused: boolean;
  version: number;
  settings: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  last_activity_at: string | null;
  deleted_at: string | null;
  participants: RoomSnapshot["participants"] | null;
  chat: RoomSnapshot["chat"] | null;
  history: RoomSnapshot["history"] | null;
  workspace: WorkspaceState | null;
}

const rowToSnapshot = (row: RoomRow): RoomSnapshot => ({
  roomId: row.id,
  ownerId: row.owner_id,
  language: row.language,
  code: row.code ?? "",
  isPaused: Boolean(row.is_paused),
  version: row.version ?? 1,
  createdAt: fromIso(row.created_at),
  updatedAt: fromIso(row.updated_at ?? row.last_activity_at),
  participants: row.participants ?? [],
  chat: row.chat ?? [],
  history: row.history ?? [],
  workspace: row.workspace as WorkspaceState,
  deletedAt: row.deleted_at ? fromIso(row.deleted_at) : undefined
});

const durableParticipants = (participants: RoomSnapshot["participants"]) => participants.map((participant) => ({
  ...participant,
  // Presence, cursors, and typing are socket-owned state. Keep membership
  // metadata, but never restore a persisted participant as online.
  isOnline: false,
  status: "offline" as const,
  cursor: { lineNumber: 1, column: 1 }
}));

const persistenceQueues = new Map<string, Promise<void>>();
const lastPersisted = new Map<string, { version: number; updatedAt: number }>();
const deletedRooms = new Set<string>();

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "unknown persistence error";

const logPersistenceFailure = (operation: string, roomId: string, error: unknown) => {
  console.warn(`[persistence] ${operation} unavailable for room ${roomId}: ${errorMessage(error)}`);
};

const isOlderSnapshot = (roomId: string, snapshot: RoomSnapshot) => {
  const previous = lastPersisted.get(roomId);
  return Boolean(previous && (snapshot.version < previous.version || (snapshot.version === previous.version && snapshot.updatedAt < previous.updatedAt)));
};

const writeRoom = async (snapshot: RoomSnapshot) => {
  const client = supabaseAdmin;
  if (!client || deletedRooms.has(snapshot.roomId) || isOlderSnapshot(snapshot.roomId, snapshot)) return;

  const participants = durableParticipants(snapshot.participants);
  const roomWrite = await client.from("rooms").upsert(
    {
      id: snapshot.roomId,
      owner_id: snapshot.ownerId,
      language: snapshot.language,
      code: snapshot.code,
      is_paused: snapshot.isPaused,
      version: snapshot.version,
      participants,
      chat: snapshot.chat,
      history: snapshot.history,
      workspace: snapshot.workspace,
      created_at: toIso(snapshot.createdAt),
      updated_at: toIso(snapshot.updatedAt),
      last_activity_at: toIso(snapshot.updatedAt),
      deleted_at: toIso(snapshot.deletedAt),
      settings: {}
    },
    { onConflict: "id" }
  );
  if (roomWrite.error) throw roomWrite.error;

  const memberWrites = await Promise.all(
    participants.map((participant) => client.from("room_members").upsert(
      {
        room_id: snapshot.roomId,
        user_id: participant.userId,
        role: participant.role,
        identity_kind: participant.identityKind,
        username: participant.username,
        display_name: participant.displayName,
        avatar_url: participant.avatarUrl,
        joined_at: toIso(participant.joinedAt),
        last_seen_at: toIso(participant.lastActiveAt),
        is_online: false
      },
      { onConflict: "room_id,user_id" }
    ))
  );
  const memberFailure = memberWrites.find((result) => result.error)?.error;
  if (memberFailure) throw memberFailure;

  const historyDelete = await client.from("room_history").delete().eq("room_id", snapshot.roomId);
  if (historyDelete.error) throw historyDelete.error;
  if (snapshot.history.length > 0) {
    const historyInsert = await client.from("room_history").insert(
      snapshot.history.map((entry) => ({
        id: entry.id,
        room_id: snapshot.roomId,
        room_version: entry.roomVersion,
        language: entry.language,
        code: entry.code,
        reason: entry.reason,
        created_by: entry.createdByUserId,
        created_by_username: entry.createdByUsername,
        created_at: toIso(entry.createdAt)
      }))
    );
    if (historyInsert.error) throw historyInsert.error;
  }

  lastPersisted.set(snapshot.roomId, { version: snapshot.version, updatedAt: snapshot.updatedAt });
};

const enqueueRoomWrite = (snapshot: RoomSnapshot) => {
  if (!supabaseAdmin || deletedRooms.has(snapshot.roomId)) return Promise.resolve();
  const previous = persistenceQueues.get(snapshot.roomId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writeRoom(snapshot))
    .catch((error) => {
      logPersistenceFailure("room write", snapshot.roomId, error);
    });
  persistenceQueues.set(snapshot.roomId, next);
  void next.finally(() => {
    if (persistenceQueues.get(snapshot.roomId) === next) persistenceQueues.delete(snapshot.roomId);
  });
  return next;
};

export const roomPersistence = {
  async loadRoom(roomId: string) {
    if (!supabaseAdmin) {
      return null;
    }

    try {
      const { data, error } = await supabaseAdmin
        .from("rooms")
        .select("id, owner_id, language, code, is_paused, version, settings, created_at, updated_at, last_activity_at, deleted_at, participants, chat, history, workspace")
        .eq("id", roomId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        logPersistenceFailure("room read", roomId, error);
        return null;
      }
      if (!data) return null;
      return rowToSnapshot(data as RoomRow);
    } catch (error) {
      logPersistenceFailure("room read", roomId, error);
      return null;
    }
  },

  async saveRoom(snapshot: RoomSnapshot) {
    return enqueueRoomWrite(snapshot);
  },

  async deleteRoom(roomId: string) {
    const client = supabaseAdmin;
    deletedRooms.add(roomId);
    const pending = persistenceQueues.get(roomId);
    if (pending) await pending;
    if (!client) return true;
    try {
      const tombstone = await client.from("rooms").update({ deleted_at: new Date().toISOString() }).eq("id", roomId);
      if (tombstone.error) throw tombstone.error;
      const cleanup = await Promise.all([
        client.from("room_history").delete().eq("room_id", roomId),
        client.from("room_members").delete().eq("room_id", roomId),
        client.from("recent_rooms").delete().eq("room_id", roomId)
      ]);
      const cleanupFailure = cleanup.find((result) => result.error)?.error;
      if (cleanupFailure) logPersistenceFailure("room cleanup", roomId, cleanupFailure);
      lastPersisted.delete(roomId);
      return true;
    } catch (error) {
      deletedRooms.delete(roomId);
      logPersistenceFailure("room delete", roomId, error);
      return false;
    }
  },

  async flush() {
    await Promise.all([...persistenceQueues.values()]);
  }
};
