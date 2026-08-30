import type { RoomSnapshot, SupportedLanguage, UserSession } from "../types/collaboration";
import type { RepositorySummary } from "../types/git";
import type { AIAction, AICompletionResult, AIProviderDescriptor, AISettings, AIStreamEvent } from "../types/ai";
import type { AgentCompletionResult, AgentEvent, AgentPatch, AgentProposalPublic, AgentRequestPayload, AgentTaskPublic, AgentValidationSummary, ValidationCategory } from "../types/agent";
import type { MediaSessionResponse } from "../types/media";
import { storage } from "./storage";

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/+$/, "") ?? "";

export class ApiNetworkError extends Error {
  constructor(message = "Cannot reach the Code Collaborator server. Make sure the backend is running and try again.") {
    super(message);
    this.name = "ApiNetworkError";
  }
}

export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const isVercelWithoutBackend = () => !API_URL
  && typeof window !== "undefined"
  && (window.location.hostname.endsWith(".vercel.app") || import.meta.env.PROD);

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
    identityKind: "guest";
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
  selectedCodeFileId?: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  settings: AISettings;
  execution?: { output: string; failed: boolean };
}

const jsonHeaders = (): Record<string, string> => ({ "Content-Type": "application/json" });

const roomSessionQuery = (session?: UserSession | null) =>
  session?.identityKind === "guest" && session.guestToken ? `?guestToken=${encodeURIComponent(session.guestToken)}` : "";

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
    const fallback = response.status === 400
      ? "The request was invalid. Check the room ID and submitted values."
      : response.status === 401
        ? "This room session is no longer valid. Join the room again."
        : response.status === 403
          ? "You do not have permission to access this room."
          : response.status === 404
            ? "Room not found. It may have been deleted."
            : response.status === 429
              ? "Too many requests. Please wait a moment and try again."
              : "The server rejected the request. Try again shortly.";
    throw new ApiRequestError(response.status, payload.message ?? fallback, payload.code);
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
      body: JSON.stringify({
        username,
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
    const effectiveSession = session ?? storage.getSession(roomId);
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}${roomSessionQuery(effectiveSession)}`), { method: "GET" });
    return await readJson<RoomSnapshot>(response);
  },

  async getHistory(roomId: string, session?: UserSession | null) {
    const effectiveSession = session ?? storage.getSession(roomId);
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/history${roomSessionQuery(effectiveSession)}`));
    return await readJson<import("../types/collaboration").HistoryEntry[]>(response);
  },

  async restoreHistory(roomId: string, historyId: string, session: UserSession) {
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/history/${historyId}/restore`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ guestToken: session.guestToken })
    });
    return await readJson<{ ok: true; room: RoomSnapshot }>(response);
  },

  async deleteRoom(roomId: string, session: UserSession) {
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}`), {
      method: "DELETE",
      headers: jsonHeaders(),
      body: JSON.stringify({ guestToken: session.guestToken })
    });
    if (!response.ok && response.status !== 204) await readJson(response);
  },

  async getRepository(roomId: string, session?: UserSession | null) {
    const effectiveSession = session ?? storage.getSession(roomId);
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/repository${roomSessionQuery(effectiveSession)}`), {
      headers: {}
    });
    const payload = await readJson<{ ok: true; repository: RepositorySummary }>(response);
    return payload.repository;
  },

  async refreshRepository(roomId: string, session?: UserSession | null) {
    const effectiveSession = session ?? storage.getSession(roomId);
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/repository/refresh`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ guestToken: effectiveSession?.guestToken })
    });
    const payload = await readJson<{ ok: true; repository: RepositorySummary }>(response);
    return payload.repository;
  },

  async getAIProviders() {
    const response = await fetchApi(buildApiUrl("/api/ai/providers"));
    const payload = await readJson<{ ok: true; providers: AIProviderDescriptor[] }>(response);
    return payload.providers;
  },

  async getMediaStatus() {
    const response = await fetchApi(buildApiUrl("/api/media/status"));
    return await readJson<{ ok: true; provider: "livekit"; configured: boolean }>(response);
  },

  async createMediaSession(roomId: string, session: UserSession) {
    const response = await fetchApi(buildApiUrl(`/api/rooms/${roomId}/media/token`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ guestToken: session.guestToken })
    });
    const payload = await readJson<{ ok: true; session: MediaSessionResponse }>(response);
    return payload.session;
  },

  async completeAI(body: AIRequestPayload, signal?: AbortSignal) {
    const response = await fetchApi(buildApiUrl("/api/ai/rooms/" + body.roomId + "/complete"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
      signal
    });
    const payload = await readJson<{ ok: true; result: AICompletionResult }>(response);
    return payload.result;
  },

  async streamAI(body: AIRequestPayload, onEvent: (event: AIStreamEvent) => void, signal?: AbortSignal) {
    const response = await fetchApi(buildApiUrl("/api/ai/rooms/" + body.roomId + "/stream"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string; code?: string };
      throw new ApiRequestError(response.status, payload.message ?? "AI streaming request failed", payload.code);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("AI provider did not return a streaming response");
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line: string) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload) return;
      let event: AIStreamEvent;
      try { event = JSON.parse(payload) as AIStreamEvent; } catch { throw new Error("AI provider returned malformed streaming data."); }
      if (!event || !["delta", "complete", "error"].includes(event.type)) throw new Error("AI provider returned an invalid streaming event.");
      onEvent(event);
      if (event.type === "error") throw new ApiRequestError(502, event.message ?? "AI streaming request failed", event.code);
    };
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
      }
      buffer += decoder.decode();
      consume(buffer.trim());
    } finally {
      reader.releaseLock();
    }
  },

  async completeAgent(body: AgentRequestPayload, signal?: AbortSignal) {
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${body.roomId}/agent`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
      signal
    });
    const payload = await readJson<{ ok: true; result: AgentCompletionResult }>(response);
    return payload.result;
  },

  async streamAgent(body: AgentRequestPayload, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) {
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${body.roomId}/agent/stream`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string; code?: string };
      throw new ApiRequestError(response.status, payload.message ?? "Coding-agent streaming request failed", payload.code);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The coding agent did not return a streaming response");
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line: string) => {
      if (!line.startsWith("data:")) return;
      const value = line.slice(5).trim();
      if (!value) return;
      let event: AgentEvent;
      try { event = JSON.parse(value) as AgentEvent; } catch { throw new Error("The coding agent returned malformed streaming data."); }
      if (!event || !["status", "context", "plan", "diagnosis", "tool_call", "tool_result", "patch_proposal", "patch_review", "review", "validation", "execution", "final", "error"].includes(event.type)) throw new Error("The coding agent returned an invalid streaming event.");
      onEvent(event);
      if (event.type === "error") throw new ApiRequestError(event.code === "TIMEOUT" ? 504 : 502, event.message, event.code);
    };
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
      }
      buffer += decoder.decode();
      consume(buffer.trim());
    } finally {
      reader.releaseLock();
    }
  },

  async applyAgentPatch(roomId: string, guestToken: string | undefined, patch: AgentPatch) {
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${roomId}/agent/patch`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ guestToken, patch })
    });
    return await readJson<{ ok: true; patch: AgentPatch; room: RoomSnapshot }>(response);
  },

  async rejectAgentPatch(roomId: string, guestToken: string | undefined, patchId: string) {
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${roomId}/agent/proposal`), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ guestToken, action: "reject", patchId })
    });
    return await readJson<{ ok: true; patchId: string; status: "rejected" }>(response);
  },

  async getAgentTaskHistory(roomId: string, guestToken: string | undefined) {
    const query = new URLSearchParams(); if (guestToken) query.set("guestToken", guestToken);
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${roomId}/agent/history?${query.toString()}`));
    return (await readJson<{ ok: true; tasks: AgentTaskPublic[] }>(response)).tasks;
  },

  async getAgentProposals(roomId: string, guestToken: string | undefined) {
    const query = new URLSearchParams(); if (guestToken) query.set("guestToken", guestToken);
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${roomId}/agent/proposals?${query.toString()}`));
    return (await readJson<{ ok: true; proposals: AgentProposalPublic[] }>(response)).proposals;
  },

  async getAgentProposal(roomId: string, guestToken: string | undefined, patchId: string) {
    const query = new URLSearchParams(); if (guestToken) query.set("guestToken", guestToken);
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${roomId}/agent/proposals/${encodeURIComponent(patchId)}?${query.toString()}`));
    return await readJson<{ ok: true; patch: AgentPatch; status: string }>(response);
  },

  async cancelAgentTask(roomId: string, guestToken: string | undefined, taskId: string) {
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${roomId}/agent/${encodeURIComponent(taskId)}/cancel`), { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ guestToken }) });
    return await readJson<{ ok: true; taskId: string; status: "cancelled" }>(response);
  },

  async validateAgent(roomId: string, guestToken: string | undefined, category: ValidationCategory, taskId?: string) {
    const response = await fetchApi(buildApiUrl(`/api/ai/rooms/${roomId}/agent/validate`), { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ guestToken, category, taskId }) });
    if (response.status === 422) {
      const payload = await response.json().catch(() => null) as { ok?: boolean; validation?: AgentValidationSummary; taskId?: string } | null;
      if (payload?.validation) return payload as { ok: boolean; validation: AgentValidationSummary; taskId?: string };
    }
    return await readJson<{ ok: boolean; validation: AgentValidationSummary; taskId?: string }>(response);
  }
};
