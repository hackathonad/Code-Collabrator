import type { RecentRoom, RoomSnapshot, UserSession } from "../types/collaboration";

const STORAGE_KEY = "code-sphere-sessions";
const RECENT_ROOMS_KEY = "code-sphere-recent-rooms";
const THEME_ID_KEY = "code-sphere-theme-id";
const LEGACY_THEME_KEY = "code-sphere-theme";
const ROOM_CACHE_KEY = "code-sphere-room-cache";

const readSessions = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserSession>) : {};
  } catch {
    return {};
  }
};

const readRecentRooms = () => {
  try {
    const raw = window.localStorage.getItem(RECENT_ROOMS_KEY);
    return raw ? (JSON.parse(raw) as RecentRoom[]) : [];
  } catch {
    return [];
  }
};

const readRoomCache = () => {
  try {
    const raw = window.localStorage.getItem(ROOM_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, RoomSnapshot>) : {};
  } catch {
    return {};
  }
};

const isWorkspaceSnapshot = (snapshot: RoomSnapshot | null): snapshot is RoomSnapshot => Boolean(
  snapshot && snapshot.workspace && snapshot.workspace.files && snapshot.workspace.folders && snapshot.workspace.activeFileId
);

const writeRecentRooms = (rooms: RecentRoom[]) => {
  window.localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms));
};

const writeRoomCache = (rooms: Record<string, RoomSnapshot>) => {
  window.localStorage.setItem(ROOM_CACHE_KEY, JSON.stringify(rooms));
};

export type StoredThemeId = "mono" | "blue" | "green" | "shades";

export const storage = {
  getThemeId(): StoredThemeId {
    try {
      const raw = window.localStorage.getItem(THEME_ID_KEY);
      if (raw === "mono" || raw === "blue" || raw === "green" || raw === "shades") {
        return raw;
      }

      const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
      if (legacy === "light") {
        return "shades";
      }

      return "mono";
    } catch {
      return "mono";
    }
  },

  saveThemeId(themeId: StoredThemeId) {
    window.localStorage.setItem(THEME_ID_KEY, themeId);
  },

  getSession(roomId: string) {
    return readSessions()[roomId];
  },

  saveSession(session: UserSession) {
    const nextSessions = {
      ...readSessions(),
      [session.roomId]: session
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions));
    storage.saveRecentRoom({
      roomId: session.roomId,
      label: `Room ${session.roomId}`,
      username: session.username,
      lastVisitedAt: Date.now()
    });
  },

  removeSession(roomId: string) {
    const nextSessions = readSessions();
    delete nextSessions[roomId];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions));
  },

  getRecentRooms() {
    const uniqueRooms = new Map<string, RecentRoom>();
    for (const room of readRecentRooms()) {
      if (!/^[a-f0-9]{8}$/i.test(room.roomId) || !room.username.trim() || !Number.isFinite(room.lastVisitedAt)) continue;
      const existing = uniqueRooms.get(room.roomId);
      if (!existing || room.lastVisitedAt > existing.lastVisitedAt) uniqueRooms.set(room.roomId, room);
    }
    const rooms = [...uniqueRooms.values()].sort((left, right) => right.lastVisitedAt - left.lastVisitedAt).slice(0, 5);
    writeRecentRooms(rooms);
    return rooms;
  },

  saveRecentRoom(room: RecentRoom) {
    const nextRooms = [
      room,
      ...readRecentRooms().filter((entry) => entry.roomId !== room.roomId)
    ].slice(0, 5);

    writeRecentRooms(nextRooms);
  },

  getRoomSnapshot(roomId: string) {
    const snapshot = readRoomCache()[roomId] ?? null;
    if (isWorkspaceSnapshot(snapshot)) return snapshot;
    if (snapshot) storage.removeRoomSnapshot(roomId);
    return null;
  },

  saveRoomSnapshot(room: RoomSnapshot) {
    const nextRooms = {
      ...readRoomCache(),
      [room.roomId]: room
    };

    writeRoomCache(nextRooms);
  },

  removeRoomSnapshot(roomId: string) {
    const nextRooms = readRoomCache();
    delete nextRooms[roomId];
    writeRoomCache(nextRooms);
  },

  removeRoom(roomId: string) {
    storage.removeSession(roomId);
    storage.removeRoomSnapshot(roomId);
    writeRecentRooms(readRecentRooms().filter((room) => room.roomId !== roomId));
  },

  touchRecentRoom(roomId: string, username: string) {
    storage.saveRecentRoom({
      roomId,
      label: `Room ${roomId}`,
      username,
      lastVisitedAt: Date.now()
    });
  }
};
