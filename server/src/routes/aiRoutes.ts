import { Router, type Response } from "express";
import { guestSession, verifyGuestSessionToken, type GuestRequest } from "../middleware/guestSession";
import { aiService } from "../modules/ai/aiService";
import {
  AICancelledError,
  AIProviderRequestError,
  AIProviderUnavailableError,
  type AIAction,
  type AIChatMessage,
  type AICompletionRequest,
  type AIProviderId,
  type AIRequestInput,
  type AISettings
} from "../modules/ai/aiTypes";
import { buildAIContext } from "../modules/ai/contextEngine";
import { createPromptMessages } from "../modules/ai/promptLibrary";
import { gitService } from "../modules/git/gitService";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { sanitizeRoomId } from "../utils/validation";

const router = Router();
const REQUEST_WINDOW_MS = 60_000;
const REQUEST_LIMIT = 20;
const requestWindows = new Map<string, { startedAt: number; count: number }>();
const actions = new Set<AIAction>(["explain", "generate", "fix", "optimize", "refactor", "test", "document", "summarize", "review", "error", "custom"]);
const clip = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";

class AIRequestRouteError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: "INVALID_REQUEST" | "ROOM_SESSION_INVALID" | "RATE_LIMITED" = "INVALID_REQUEST") { super(message); }
}

interface PreparedAIRequest {
  input: AIRequestInput;
  request: AICompletionRequest;
  context: ReturnType<typeof buildAIContext>;
  roomId: string;
}

const sendError = (response: Response, status: number, message: string, code = "UNKNOWN_PROVIDER_ERROR") => response.status(status).json({ ok: false, message, code });
const loadRoomIfNeeded = async (roomId: string) => {
  if (roomStore.hasRoom(roomId)) return true;
  const persisted = await roomPersistence.loadRoom(roomId);
  if (!persisted) return false;
  roomStore.upsertRoomSnapshot(persisted);
  return true;
};
const rateLimit = (key: string) => {
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt > REQUEST_WINDOW_MS) { requestWindows.set(key, { startedAt: now, count: 1 }); return true; }
  current.count += 1;
  if (requestWindows.size > 5_000) for (const [rateKey, entry] of requestWindows) if (now - entry.startedAt > REQUEST_WINDOW_MS) requestWindows.delete(rateKey);
  return current.count <= REQUEST_LIMIT;
};

const parseSettings = (value: unknown): AISettings | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const provider = typeof raw.provider === "string" ? raw.provider as AIProviderId : null;
  const knownProvider = provider && aiService.getProviders().some((entry) => entry.id === provider);
  const model = clip(raw.model, 160);
  const temperature = typeof raw.temperature === "number" && Number.isFinite(raw.temperature) ? Math.min(2, Math.max(0, raw.temperature)) : 0.2;
  const maxTokens = typeof raw.maxTokens === "number" && Number.isFinite(raw.maxTokens) ? Math.min(16_000, Math.max(64, Math.round(raw.maxTokens))) : 2_000;
  const workspaceContextSize = raw.workspaceContextSize === "minimal" || raw.workspaceContextSize === "extended" ? raw.workspaceContextSize : "standard";
  return provider && knownProvider && model ? { provider, model, temperature, maxTokens, streaming: Boolean(raw.streaming), systemPrompt: clip(raw.systemPrompt, 2_000) || undefined, workspaceContextSize } : null;
};

const parseConversation = (value: unknown): AIChatMessage[] => !Array.isArray(value) ? [] : value.slice(-8).flatMap((entry) => {
  if (!entry || typeof entry !== "object") return [];
  const raw = entry as Record<string, unknown>;
  const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
  const content = clip(raw.content, 4_000);
  return role && content ? [{ role, content }] : [];
});

const parseInput = (body: unknown): AIRequestInput | null => {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const action = typeof raw.action === "string" && actions.has(raw.action as AIAction) ? raw.action as AIAction : "custom";
  const settings = parseSettings(raw.settings);
  if (!settings) return null;
  const executionRaw = raw.execution && typeof raw.execution === "object" ? raw.execution as Record<string, unknown> : null;
  const execution = executionRaw && clip(executionRaw.output, 6_000) ? { output: clip(executionRaw.output, 6_000), failed: Boolean(executionRaw.failed) } : undefined;
  return { action, prompt: clip(raw.prompt, 4_000), currentFileId: clip(raw.currentFileId, 128) || undefined, selectedCode: clip(raw.selectedCode, 12_000) || undefined, selectedCodeFileId: clip(raw.selectedCodeFileId, 128) || undefined, conversation: parseConversation(raw.conversation), settings, execution };
};

const prepareAIRequest = async (request: GuestRequest): Promise<PreparedAIRequest> => {
  const roomId = sanitizeRoomId(request.params.roomId);
  const input = parseInput(request.body);
  if (!roomId || !input) throw new AIRequestRouteError(400, "A valid AI request is required");
  const userId = verifyGuestSessionToken(roomId, typeof request.body?.guestToken === "string" ? request.body.guestToken : undefined);
  if (!userId) throw new AIRequestRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
  if (!rateLimit(roomId + ":" + userId)) throw new AIRequestRouteError(429, "AI request limit reached. Please wait a moment.", "RATE_LIMITED");
  if (!(await loadRoomIfNeeded(roomId))) throw new AIRequestRouteError(404, "Room not found");
  try {
    roomStore.getParticipant(roomId, userId);
  } catch {
    throw new AIRequestRouteError(403, "You are not a participant in this room", "ROOM_SESSION_INVALID");
  }
  const room = roomStore.getRoomSnapshot(roomId);
  const repository = await gitService.getSummary(room.workspace).catch(() => null);
  const context = buildAIContext(room, input, repository);
  return {
    input,
    context,
    request: {
      messages: createPromptMessages(input, context),
      settings: input.settings,
      metadata: { workspaceId: room.workspace.id, action: input.action, language: context.language }
    },
    roomId
  };
};

const respondToAIError = (response: Response, error: unknown) => {
  if (error instanceof AIRequestRouteError) { sendError(response, error.status, error.message, error.code); return; }
  if (error instanceof AIProviderUnavailableError) { sendError(response, 503, error.message, error.code); return; }
  if (error instanceof AIProviderRequestError) { sendError(response, error.code === "RATE_LIMITED" ? 429 : 502, error.message, error.code); return; }
  if (error instanceof AICancelledError) { sendError(response, 499, error.message, "CANCELLED"); return; }
  sendError(response, 500, "Unable to complete the AI request", "UNKNOWN_PROVIDER_ERROR");
};

router.get("/providers", async (_request, response) => {
  response.json({ ok: true, providers: await aiService.refreshProviders() });
});

router.post("/rooms/:roomId/complete", guestSession, async (request, response) => {
  let prepared: PreparedAIRequest | undefined;
  try {
    prepared = await prepareAIRequest(request as GuestRequest);
    const result = await aiService.complete(prepared.input.settings.provider, prepared.request);
    response.json({ ok: true, result, context: { characterCount: prepared.context.characterCount, currentFileId: prepared.context.currentFile?.id ?? null, includedOpenFiles: prepared.context.openFiles.length } });
  } catch (error) {
    respondToAIError(response, error);
  }
});

router.post("/rooms/:roomId/stream", guestSession, async (request, response) => {
  let prepared: PreparedAIRequest;
  try {
    prepared = await prepareAIRequest(request as GuestRequest);
  } catch (error) {
    respondToAIError(response, error);
    return;
  }
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  const abortController = new AbortController();
  const abortIfDisconnected = () => {
    if (!response.writableEnded) abortController.abort();
  };
  response.once("close", abortIfDisconnected);
  try {
    prepared.request.signal = abortController.signal;
    for await (const event of aiService.stream(prepared.input.settings.provider, prepared.request)) {
      if (abortController.signal.aborted || response.writableEnded) break;
      response.write("data: " + JSON.stringify(event) + "\n\n");
    }
  } catch (error) {
    const message = error instanceof AICancelledError
      ? "AI generation was cancelled."
      : error instanceof AIProviderUnavailableError || error instanceof AIProviderRequestError
      ? error.message
      : "Unable to stream the AI response";
    response.write("data: " + JSON.stringify({ type: "error", message }) + "\n\n");
  } finally {
    response.off("close", abortIfDisconnected);
    response.end();
  }
});

export default router;
