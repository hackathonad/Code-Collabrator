import type { RoomSnapshot, SupportedLanguage, UserSession } from "../types/collaboration";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

interface RoomResponse {
  room: RoomSnapshot;
  participant: {
    userId: string;
    username: string;
  };
}

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Request failed");
  }

  return (await response.json()) as T;
};

export const api = {
  async createRoom(username: string, language: SupportedLanguage) {
    const response = await fetch(`${API_URL}/api/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        language
      })
    });

    const payload = await readJson<RoomResponse>(response);
    const session: UserSession = {
      roomId: payload.room.roomId,
      userId: payload.participant.userId,
      username: payload.participant.username
    };

    return {
      room: payload.room,
      session
    };
  },

  async joinRoom(roomId: string, username: string, userId?: string) {
    const response = await fetch(`${API_URL}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        userId
      })
    });

    const payload = await readJson<RoomResponse>(response);
    const session: UserSession = {
      roomId: payload.room.roomId,
      userId: payload.participant.userId,
      username: payload.participant.username
    };

    return {
      room: payload.room,
      session
    };
  }
};
