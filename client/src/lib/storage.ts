import type { RecentRoom, UserSession } from "../types/collaboration";

const STORAGE_KEY = "code-sphere-sessions";
const RECENT_ROOMS_KEY = "code-sphere-recent-rooms";
const THEME_ID_KEY = "code-sphere-theme-id";
const LEGACY_THEME_KEY = "code-sphere-theme";

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

const writeRecentRooms = (rooms: RecentRoom[]) => {
  window.localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms));
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
    return readRecentRooms().sort((left, right) => right.lastVisitedAt - left.lastVisitedAt);
  },

  saveRecentRoom(room: RecentRoom) {
    const nextRooms = [
      room,
      ...readRecentRooms().filter((entry) => entry.roomId !== room.roomId)
    ].slice(0, 8);

    writeRecentRooms(nextRooms);
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
