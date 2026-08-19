import type { RoomSnapshot, SupportedLanguage, UserSession } from "../types/collaboration";
import type { RepositorySummary } from "../types/git";
import type { AIAction, AICompletionResult, AIProviderDescriptor, AISettings, AIStreamEvent } from "../types/ai";
import type { MediaSessionResponse } from "../types/media";
import { storage } from "./storage";
import { getAccessToken } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/+$/, "") ?? "";

class ApiNetworkError extends Error {
  constructor(message = "Cannot reach the Code Collaborator server. Make sure the backend is running and try again.") {
    super(message);
    this.name = "ApiNetworkError";
  }
}

const isVercelWithoutBackend = () => !API_URL
  && typeof window !== "undefined"
  && window.location.hostname.endsWith(".vercel.app");

const buildApiUrl = (path: string) => {
  if (API_URL) {
    return `${API_URL}${path}`;
  }

  if (isVercelWithoutBackend()) {
    throw new ApiNetworkError("Code Collaborator's backend is not configured for this Vercel deployment. Set VITE_API_URL and VITE_SOCKET_URL to a deployed realtime backend.");
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${path}`;
  }

  return path;
};

const fetchApi = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiNetworkError();
    }
    throw error;
  }
};

interface RoomResponse {
  room: RoomSnapshot;
  participant: {
    userId: string;
    username: string;
    identityKind: "guest" | "member";
    guestToken?: string;
  };
}

interface AIRequestPayload {
  roomId: string;
  guestToken?: string;
  action: AIAction;
  prompt: string;
  currentFileId: string;
  selectedCode?: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  settings: AISettings;
  execution?: { output: string; failed: boolean };
}

export interface AnalyticsDashboardResponse {
  range: "7d" | "30d" | "90d" | "all";
  overview: { roomsCreated: number; roomsJoined: number; activeWorkspaces: number; executions: number; aiRequests: number; gitActions: number; collaborationSessions: number };
  dailyActivity: Array<{ date: string; count: number }>;
  languages: Array<{ name: string; count: number }>;
  ai: { requests: number; successful: number; providers: Array<{ name: string; count: number }>; actions: Array<{ name: string; count: number }> };
  execution: { total: number; successful: number; failed: number; successRate: number };
  git: { total: number; commits: number; pushes: number; pulls: number; repositoryImports: number };
  collaboration: { rooms: number; sessions: number; mediaCalls: number; screenShares: number };
  recentActivity: Array<{ type: string; createdAt: string; roomId: string | null; workspaceId: string | null; language?: string }>;
}

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const jsonHeaders = async (): Promise<Record<string, string>> => ({
  "Content-Type": "application/json",
  ...(await authHeaders())
});

const roomSessionQuery = (session?: UserSession | null) =>
  session?.identityKind === "guest" && session.guestToken ? `?guestToken=${encodeURIComponent(session.guestToken)}` : "";

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Request failed");
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("The Code Collaborator server returned an invalid response.");
  }
};

const toSession = (payload: RoomResponse): UserSession => ({
  roomId: payload.room.roomId,
  userId: payload.participant.userId,
  username: payload.participant.username,
  identityKind: payload.participant.identityKind,
  guestToken: payload.participant.guestToken
});

export const api = {
  async createRoom(username: string, language: SupportedLanguage) {
    const response = await fetchApi(buildApiUrl("/api/rooms"), {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify({ username, language })
    });

    const payload = await readJson<RoomResponse>(response);
    const session = toSession(payload);

    storage.saveRoomSnapshot(payload.room);
    storage.saveSession(session);

    return { room: payload.room, session };
  },

  async joinRoom(roomId: string, username: string, existingSession?: UserSession) {
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/join`), {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify({
        username,
        userId: existingSession?.userId,
        guestToken: existingSession?.guestToken
      })
    });

    const payload = await readJson<RoomResponse>(response);
    const session = toSession(payload);

    storage.saveRoomSnapshot(payload.room);
    storage.saveSession(session);

    return { room: payload.room, session };
  },

  async getRoom(roomId: string, session?: UserSession | null) {
    try {
      const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}${roomSessionQuery(session ?? storage.getSession(roomId))}`), { method: "GET", headers: await authHeaders() });
      return await readJson<RoomSnapshot>(response);
    } catch (error) {
      const cachedRoom = storage.getRoomSnapshot(roomId);
      if (cachedRoom && error instanceof ApiNetworkError) return cachedRoom;
      throw error;
    }
  },

  async getProfile() {
    const response = await fetchApi(buildApiUrl("/api/profile"), {
      headers: await authHeaders()
    });
    return await readJson<{ ok: true; profile: unknown }>(response);
  },

  async updateProfile(body: unknown) {
    const response = await fetchApi(buildApiUrl("/api/profile"), {
      method: "PATCH",
      headers: await jsonHeaders(),
      body: JSON.stringify(body)
    });
    return await readJson<{ ok: true; profile: unknown }>(response);
  },

  async listRecentRooms() {
    const response = await fetchApi(buildApiUrl("/api/recent-rooms"), {
      headers: await authHeaders()
    });
    return await readJson<{ ok: true; rooms: unknown[] }>(response);
  },

  async getAnalyticsDashboard(range: "7d" | "30d" | "90d" | "all") {
    const response = await fetchApi(buildApiUrl(`/api/analytics/me?range=${range}`), {
      headers: await authHeaders()
    });
    return await readJson<{ ok: true; dashboard: AnalyticsDashboardResponse }>(response);
  },

  async getGitHubStatus() {
    const response = await fetchApi(buildApiUrl("/api/github/status"), { headers: await authHeaders() });
    return await readJson<{ ok: true; configured: boolean; connection: { connected: boolean; login?: string; avatarUrl?: string | null; connectedAt?: string } }>(response);
  },

  async beginGitHubConnection(returnPath = "/settings") {
    const response = await fetchApi(buildApiUrl("/api/github/connect"), { method: "POST", headers: await jsonHeaders(), body: JSON.stringify({ returnPath }) });
    return await readJson<{ ok: true; authorizeUrl: string }>(response);
  },

  async disconnectGitHub() {
    const response = await fetchApi(buildApiUrl("/api/github/connection"), { method: "DELETE", headers: await authHeaders() });
    if (!response.ok && response.status !== 204) await readJson(response);
  },

  async listGitHubRepositories(query = "") {
    const response = await fetchApi(buildApiUrl(`/api/github/repositories?q=${encodeURIComponent(query)}`), { headers: await authHeaders() });
    return await readJson<{ ok: true; repositories: Array<{ id: string; name: string; fullName: string; owner: string; private: boolean; description: string | null; defaultBranch: string; language: string | null; updatedAt: string }> }>(response);
  },

  async getRepository(roomId: string, session?: UserSession | null) {
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/repository${roomSessionQuery(session ?? storage.getSession(roomId))}`), {
      headers: await authHeaders()
    });
    const payload = await readJson<{ ok: true; repository: RepositorySummary }>(response);
    return payload.repository;
  },

  async refreshRepository(roomId: string, session?: UserSession | null) {
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/repository/refresh`), {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify({ guestToken: session?.guestToken ?? storage.getSession(roomId)?.guestToken })
    });
    const payload = await readJson<{ ok: true; repository: RepositorySummary }>(response);
    return payload.repository;
  },

  async getAIProviders() {
    const response = await fetchApi(buildApiUrl("/api/ai/providers"), { headers: await authHeaders() });
    const payload = await readJson<{ ok: true; providers: AIProviderDescriptor[] }>(response);
    return payload.providers;
  },

  async getMediaStatus() {
    const response = await fetchApi(buildApiUrl("/api/media/status"), { headers: await authHeaders() });
    return await readJson<{ ok: true; provider: "livekit"; configured: boolean }>(response);
  },

  async createMediaSession(roomId: string, guestToken?: string) {
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/media/token`), {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify({ guestToken })
    });
    const payload = await readJson<{ ok: true; session: MediaSessionResponse }>(response);
    return payload.session;
  },

  async completeAI(body: AIRequestPayload, signal?: AbortSignal) {
    const response = await fetchApi(buildApiUrl("/api/ai/rooms/" + body.roomId + "/complete"), {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify(body),
      signal
    });
    const payload = await readJson<{ ok: true; result: AICompletionResult }>(response);
    return payload.result;
  },

  async streamAI(body: AIRequestPayload, onEvent: (event: AIStreamEvent) => void, signal?: AbortSignal) {
    const response = await fetchApi(buildApiUrl("/api/ai/rooms/" + body.roomId + "/stream"), {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(payload.message ?? "AI streaming request failed");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("AI provider did not return a streaming response");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as AIStreamEvent;
        onEvent(event);
        if (event.type === "error") throw new Error(event.message ?? "AI streaming request failed");
      }
    }
  }
};
