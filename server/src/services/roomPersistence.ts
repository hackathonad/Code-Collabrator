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

export const roomPersistence = {
  async loadRoom(roomId: string) {
    if (!supabaseAdmin) {
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from("rooms")
      .select("id, owner_id, language, code, is_paused, version, settings, created_at, updated_at, last_activity_at, deleted_at, participants, chat, history, workspace")
      .eq("id", roomId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return rowToSnapshot(data as RoomRow);
  },

  async saveRoom(snapshot: RoomSnapshot) {
    const client = supabaseAdmin;
    if (!client) {
      return;
    }

    await client.from("rooms").upsert(
      {
        id: snapshot.roomId,
        owner_id: snapshot.ownerId,
        language: snapshot.language,
        code: snapshot.code,
        is_paused: snapshot.isPaused,
        version: snapshot.version,
        participants: snapshot.participants,
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

    await Promise.all(
      snapshot.participants.map((participant) =>
        client.from("room_members").upsert(
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
            is_online: participant.isOnline
          },
          { onConflict: "room_id,user_id" }
        )
      )
    );

    await client.from("room_history").delete().eq("room_id", snapshot.roomId);
    if (snapshot.history.length > 0) {
      await client.from("room_history").insert(
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
    }
  },

  async deleteRoom(roomId: string) {
    const client = supabaseAdmin;
    if (!client) return;
    await Promise.all([
      client.from("rooms").update({ deleted_at: new Date().toISOString() }).eq("id", roomId),
      client.from("room_history").delete().eq("room_id", roomId),
      client.from("room_members").delete().eq("room_id", roomId),
      client.from("recent_rooms").delete().eq("room_id", roomId)
    ]);
  }
};
