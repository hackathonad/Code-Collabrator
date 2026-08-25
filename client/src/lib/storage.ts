import type { RecentRoom, RoomSnapshot, UserSession } from "../types/collaboration";

const STORAGE_KEY = "code-sphere-sessions";
const RECENT_ROOMS_KEY = "code-sphere-recent-rooms";
const THEME_ID_KEY = "code-sphere-theme-id";
const LEGACY_THEME_KEY = "code-sphere-theme";
const ROOM_CACHE_KEY = "code-sphere-room-cache";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

const isStoredSession = (value: unknown): value is UserSession => {
  if (!isRecord(value)) return false;
  return typeof value.roomId === "string" && /^[a-f0-9]{8}$/i.test(value.roomId)
    && typeof value.userId === "string" && typeof value.username === "string" && value.identityKind === "guest";
};

const isRecentRoom = (value: unknown): value is RecentRoom => {
  if (!isRecord(value)) return false;
  return typeof value.roomId === "string" && /^[a-f0-9]{8}$/i.test(value.roomId)
    && typeof value.label === "string" && typeof value.username === "string" && Number.isFinite(value.lastVisitedAt);
};

const readSessions = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isStoredSession(value))) as Record<string, UserSession>;
  } catch {
    return {};
  }
};

const readRecentRooms = () => {
  try {
    const raw = window.localStorage.getItem(RECENT_ROOMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecentRoom) : [];
  } catch {
    return [];
  }
};

const readRoomCache = () => {
  try {
    const raw = window.localStorage.getItem(ROOM_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return isRecord(parsed) ? parsed as Record<string, RoomSnapshot> : {};
  } catch {
    return {};
  }
};

const isWorkspaceSnapshot = (snapshot: unknown): snapshot is RoomSnapshot => Boolean(
  isRecord(snapshot) && isRecord(snapshot.workspace) && isRecord(snapshot.workspace.files) && isRecord(snapshot.workspace.folders) && typeof snapshot.workspace.activeFileId === "string"
);

const writeRecentRooms = (rooms: RecentRoom[]) => {
  try { window.localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms)); } catch { /* Storage can be disabled or full. */ }
};

const writeRoomCache = (rooms: Record<string, RoomSnapshot>) => {
  try { window.localStorage.setItem(ROOM_CACHE_KEY, JSON.stringify(rooms)); } catch { /* Storage can be disabled or full. */ }
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
    try { window.localStorage.setItem(THEME_ID_KEY, themeId); } catch { /* Storage is optional. */ }
  },

  getSession(roomId: string) {
    return readSessions()[roomId];
  },

  saveSession(session: UserSession) {
    const nextSessions = { ...readSessions(), [session.roomId]: session };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions)); } catch { /* Storage is optional. */ }
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
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions)); } catch { /* Storage is optional. */ }
  },

  getRecentRooms() {
    const uniqueRooms = new Map<string, RecentRoom>();
    for (const room of readRecentRooms()) {
      if (!room.username.trim()) continue;
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
    const cachedRoom: RoomSnapshot = {
      ...room,
      participants: room.participants.map((participant) => ({
        ...participant,
        isOnline: false,
        status: "offline" as const,
        cursor: { lineNumber: 1, column: 1 }
      }))
    };
    const nextRooms = {
      ...readRoomCache(),
      [room.roomId]: cachedRoom
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
