import { supabaseAdmin } from "../lib/supabase";
import type { RequestIdentity } from "../middleware/auth";
import { sanitizeAccountUsername } from "../utils/validation";

const profileFields = "id, username, display_name, avatar_url, bio, email, created_at, last_seen_at, status, theme, preferences, profile_settings, last_room_id";

export const profileService = {
  async ensureProfile(identity: RequestIdentity, username?: string, roomId?: string) {
    if (!supabaseAdmin || identity.kind !== "member") return null;
    try {
      const existing = await this.getProfile(identity.userId);
      if (existing) return existing;
      const displayName = (username || identity.displayName).trim().slice(0, 80) || "Member";
      const values = { id: identity.userId, username: sanitizeAccountUsername(displayName) || null, display_name: displayName, avatar_url: identity.avatarUrl, email: identity.email, last_seen_at: new Date().toISOString(), status: "active", last_room_id: roomId ?? null };
      let result = await supabaseAdmin.from("profiles").insert(values).select(profileFields).maybeSingle();
      // Display names are not unique account usernames. A collision must not
      // make an otherwise valid authenticated account unusable.
      if (result.error && values.username) result = await supabaseAdmin.from("profiles").insert({ ...values, username: null }).select(profileFields).maybeSingle();
      return result.error ? null : result.data;
    } catch { return null; }
  },

  async getProfile(userId: string) {
    if (!supabaseAdmin) return null;
    const { data, error } = await supabaseAdmin.from("profiles").select(profileFields).eq("id", userId).maybeSingle();
    return error ? null : data;
  },

  async updateProfile(userId: string, values: { username?: string; display_name?: string; avatar_url?: string | null; bio?: string | null; theme?: string; preferences?: unknown; profile_settings?: unknown }) {
    if (!supabaseAdmin) return null;
    const { data, error } = await supabaseAdmin.from("profiles").update({ ...values, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }).eq("id", userId).select(profileFields).maybeSingle();
    if (error) throw error;
    return data;
  },

  async listRecentRooms(userId: string) {
    if (!supabaseAdmin) return [];
    const { data } = await supabaseAdmin.from("recent_rooms").select("room_id, label, last_visited_at, rooms(language, is_paused, updated_at)").eq("user_id", userId).order("last_visited_at", { ascending: false }).limit(20);
    return data ?? [];
  },

  async removeRoomReferences(roomId: string) {
    if (!supabaseAdmin) return;
    await Promise.all([supabaseAdmin.from("recent_rooms").delete().eq("room_id", roomId), supabaseAdmin.from("profiles").update({ last_room_id: null }).eq("last_room_id", roomId)]);
  },

  async touchRecentRoom(identity: RequestIdentity, roomId: string, label: string) {
    if (!supabaseAdmin || identity.kind !== "member") return;
    await supabaseAdmin.from("recent_rooms").upsert({ user_id: identity.userId, room_id: roomId, label, last_visited_at: new Date().toISOString() }, { onConflict: "user_id,room_id" });
  }
};
