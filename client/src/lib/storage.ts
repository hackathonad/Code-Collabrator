import type { UserSession } from "../types/collaboration";

const STORAGE_KEY = "code-sphere-sessions";

const readSessions = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserSession>) : {};
  } catch {
    return {};
  }
};

export const storage = {
  getSession(roomId: string) {
    return readSessions()[roomId];
  },

  saveSession(session: UserSession) {
    const nextSessions = {
      ...readSessions(),
      [session.roomId]: session
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions));
  },

  removeSession(roomId: string) {
    const nextSessions = readSessions();
    delete nextSessions[roomId];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions));
  }
};

