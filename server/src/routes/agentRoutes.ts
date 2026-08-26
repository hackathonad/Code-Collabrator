import { Router, type Response } from "express";
import { guestSession, verifyGuestSessionToken, type GuestRequest } from "../middleware/guestSession";
import { aiService } from "../modules/ai/aiService";
import { AIProviderRequestError, AIProviderUnavailableError, type AIChatMessage, type AIProviderId, type AISettings } from "../modules/ai/aiTypes";
import { AI_CONTEXT_BUDGETS } from "../modules/ai/contextEngine";
import { emitAgentWorkspaceChange, getAgentProposal, registerAgentProposal, updateAgentProposal } from "../modules/agent/agentEvents";
import { AgentRuntimeError, executeAgent } from "../modules/agent/agentRuntime";
import { createAgentToolRegistry } from "../modules/agent/agentToolRegistry";
import type { AgentDiagnostic, AgentMode, AgentPatch, AgentRequest } from "../modules/agent/agentTypes";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { sanitizeRoomId } from "../utils/validation";

const router = Router();
const requestWindows = new Map<string, { startedAt: number; count: number }>();
const REQUEST_WINDOW_MS = 60_000;
const REQUEST_LIMIT = 12;
const modes = new Set<AgentMode>(["ASK", "EDIT", "DEBUG", "EXPLAIN"]);
const providers = new Set<AIProviderId>(["gemini", "groq", "openrouter", "ollama", "openai", "anthropic", "custom"]);
const clip = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

class AgentRouteError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "INVALID_REQUEST") { super(message); }
}

const rateLimit = (key: string) => {
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt > REQUEST_WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (requestWindows.size > 5_000) for (const [entryKey, entry] of requestWindows) if (now - entry.startedAt > REQUEST_WINDOW_MS) requestWindows.delete(entryKey);
  return current.count <= REQUEST_LIMIT;
};

const parseSettings = (value: unknown): AISettings | null => {
  if (!isRecord(value)) return null;
  const provider = typeof value.provider === "string" && providers.has(value.provider as AIProviderId) ? value.provider as AIProviderId : null;
  const model = clip(value.model, 160);
  if (!provider || !model || !aiService.getProviders().some((entry) => entry.id === provider)) return null;
  const temperature = typeof value.temperature === "number" && Number.isFinite(value.temperature) ? Math.min(2, Math.max(0, value.temperature)) : 0.2;
  const maxTokens = typeof value.maxTokens === "number" && Number.isFinite(value.maxTokens) ? Math.min(16_000, Math.max(64, Math.round(value.maxTokens))) : 2_000;
  const workspaceContextSize = value.workspaceContextSize === "minimal" || value.workspaceContextSize === "extended" ? value.workspaceContextSize : "standard";
  return { provider, model, temperature, maxTokens, streaming: Boolean(value.streaming), systemPrompt: clip(value.systemPrompt, 2_000) || undefined, workspaceContextSize };
};

const parseConversation = (value: unknown): AIChatMessage[] => !Array.isArray(value) ? [] : value.slice(-8).flatMap((entry) => {
  if (!isRecord(entry) || (entry.role !== "user" && entry.role !== "assistant")) return [];
  const content = clip(entry.content, 4_000);
  return content ? [{ role: entry.role, content }] : [];
});

const parseDiagnostics = (value: unknown): AgentDiagnostic[] => !Array.isArray(value) ? [] : value.slice(0, 50).flatMap((entry) => {
  if (!isRecord(entry) || typeof entry.message !== "string" || !entry.message.trim()) return [];
  const severity = entry.severity === "error" || entry.severity === "warning" || entry.severity === "info" || entry.severity === "hint" ? entry.severity : "info";
  const numberValue = (key: string) => typeof entry[key] === "number" && Number.isInteger(entry[key]) ? Math.max(1, Math.min(1_000_000, entry[key] as number)) : undefined;
  return [{
    ...(typeof entry.fileId === "string" ? { fileId: entry.fileId.slice(0, 128) } : {}),
    ...(typeof entry.path === "string" ? { path: entry.path.slice(0, 260) } : {}),
    message: entry.message.trim().slice(0, 600),
    severity,
    ...(numberValue("startLine") === undefined ? {} : { startLine: numberValue("startLine") }),
    ...(numberValue("startColumn") === undefined ? {} : { startColumn: numberValue("startColumn") }),
    ...(numberValue("endLine") === undefined ? {} : { endLine: numberValue("endLine") }),
    ...(numberValue("endColumn") === undefined ? {} : { endColumn: numberValue("endColumn") })
  }];
});

const loadRoomIfNeeded = async (roomId: string) => {
  if (roomStore.hasRoom(roomId)) return true;
  const persisted = await roomPersistence.loadRoom(roomId);
  if (!persisted) return false;
  roomStore.upsertRoomSnapshot(persisted);
  return true;
};

const prepareRequest = async (request: GuestRequest): Promise<{ agent: AgentRequest; room: ReturnType<typeof roomStore.getRoomSnapshot> }> => {
  const roomId = sanitizeRoomId(request.params.roomId);
  const body = isRecord(request.body) ? request.body : {};
  if (!roomId) throw new AgentRouteError(400, "A valid room ID is required");
  const userId = verifyGuestSessionToken(roomId, typeof body.guestToken === "string" ? body.guestToken : undefined);
  if (!userId) throw new AgentRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
  if (!rateLimit(`${roomId}:${userId}`)) throw new AgentRouteError(429, "Agent request limit reached. Please wait a moment.", "RATE_LIMITED");
  if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
  try { roomStore.getParticipant(roomId, userId); } catch { throw new AgentRouteError(403, "You are not a participant in this room", "ROOM_SESSION_INVALID"); }
  const room = roomStore.getRoomSnapshot(roomId);
  const settings = parseSettings(body.settings);
  const mode = typeof body.mode === "string" && modes.has(body.mode as AgentMode) ? body.mode as AgentMode : "ASK";
  if (!settings) throw new AgentRouteError(400, "A valid AI provider, model, and settings are required");
  const currentFileId = typeof body.currentFileId === "string" && room.workspace.files[body.currentFileId] ? body.currentFileId : room.workspace.activeFileId;
  const selectedCode = typeof body.selectedCode === "string" ? body.selectedCode.slice(0, 12_000) : "";
  const selectedCodeFileId = typeof body.selectedCodeFileId === "string" ? body.selectedCodeFileId.slice(0, 128) : currentFileId;
  const selectionStart = typeof body.selectionStartOffset === "number" && Number.isInteger(body.selectionStartOffset) ? body.selectionStartOffset : undefined;
  const selectionEnd = typeof body.selectionEndOffset === "number" && Number.isInteger(body.selectionEndOffset) ? body.selectionEndOffset : undefined;
  const selection = selectedCode && selectionStart !== undefined && selectionEnd !== undefined ? { fileId: selectedCodeFileId, code: selectedCode, startOffset: selectionStart, endOffset: selectionEnd } : undefined;
  const executionRaw = isRecord(body.execution) ? body.execution : undefined;
  const execution = executionRaw && clip(executionRaw.output, 6_000) ? { output: clip(executionRaw.output, 6_000), failed: Boolean(executionRaw.failed) } : undefined;
  const activeFile = room.workspace.files[currentFileId] ?? room.workspace.files[room.workspace.activeFileId];
  const agent: AgentRequest = {
    roomId,
    userId,
    workspaceId: room.workspace.id,
    currentFileId: activeFile?.id ?? room.workspace.activeFileId,
    selection,
    userInstruction: clip(body.prompt, 4_000),
    relevantFiles: Array.isArray(body.relevantFiles) ? body.relevantFiles.filter((path): path is string => typeof path === "string").slice(0, 20).map((path) => path.slice(0, 260)) : [],
    conversation: parseConversation(body.conversation),
    execution,
    diagnostics: parseDiagnostics(body.diagnostics),
    mode,
    language: activeFile?.language ?? room.language,
    settings,
    contextBudget: AI_CONTEXT_BUDGETS[settings.workspaceContextSize]
  };
  return { agent, room };
};

const sendError = (response: Response, error: unknown) => {
  if (error instanceof AgentRouteError) { response.status(error.status).json({ ok: false, message: error.message, code: error.code }); return; }
  if (error instanceof AgentRuntimeError) { response.status(error.code === "TIMEOUT" ? 504 : error.code === "UNAUTHORIZED_CONTEXT" ? 403 : 499).json({ ok: false, message: error.message, code: error.code }); return; }
  if (error instanceof AIProviderUnavailableError) { response.status(503).json({ ok: false, message: error.message, code: error.code }); return; }
  if (error instanceof AIProviderRequestError) { response.status(error.code === "CONTEXT_TOO_LARGE" ? 413 : error.code === "RATE_LIMITED" ? 429 : 502).json({ ok: false, message: error.message, code: error.code }); return; }
  response.status(500).json({ ok: false, message: "Unable to complete the coding-agent request", code: "AGENT_ERROR" });
};

const approvedPatchFromBody = (body: Record<string, unknown>): AgentPatch & { suppliedPatchId?: string } => {
  const raw = isRecord(body.patch) ? body.patch : body;
  const patch = {
    patchId: clip(raw.patchId, 64),
    roomId: clip(raw.roomId, 32),
    workspaceId: clip(raw.workspaceId, 128),
    fileId: clip(raw.fileId, 128),
    path: clip(raw.path, 260),
    baseVersion: typeof raw.baseVersion === "number" && Number.isInteger(raw.baseVersion) ? raw.baseVersion : -1,
    expectedContent: typeof raw.expectedContent === "string" ? raw.expectedContent : typeof raw.expectedOldContent === "string" ? raw.expectedOldContent : "",
    replacement: typeof raw.replacement === "string" ? raw.replacement : "",
    additions: 0,
    deletions: 0,
    preview: "",
    applied: false,
    status: "pending" as const
  };
  if (!patch.patchId || !patch.path || patch.baseVersion < 1 || patch.expectedContent === "" || typeof raw.replacement !== "string") throw new AgentRouteError(400, "An approved patch requires patchId, baseVersion, path, expectedContent, and replacement");
  return { ...patch, suppliedPatchId: patch.patchId || undefined };
};

const proposalMatches = (stored: AgentPatch, supplied: AgentPatch) => stored.roomId === supplied.roomId
  && stored.workspaceId === supplied.workspaceId
  && stored.fileId === supplied.fileId
  && stored.path === supplied.path
  && stored.baseVersion === supplied.baseVersion
  && stored.expectedContent === supplied.expectedContent
  && stored.replacement === supplied.replacement;

const publishProposals = (userId: string, patches: AgentPatch[]) => {
  patches.forEach((patch) => registerAgentProposal(patch, userId));
};

const patchAgentRequest = (room: ReturnType<typeof roomStore.getRoomSnapshot>, userId: string): AgentRequest => ({
  roomId: room.roomId,
  userId,
  workspaceId: room.workspace.id,
  currentFileId: room.workspace.activeFileId,
  userInstruction: "Apply an approved patch",
  conversation: [],
  mode: "EDIT",
  language: room.language,
  settings: { provider: "ollama", model: "unused", temperature: 0, maxTokens: 64, streaming: false, workspaceContextSize: "minimal" },
  contextBudget: AI_CONTEXT_BUDGETS.minimal
});

router.post("/rooms/:roomId/agent", guestSession, async (request, response) => {
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  request.once("close", abortRequest);
  try {
    const prepared = await prepareRequest(request as GuestRequest);
    const result = await executeAgent(prepared.agent, prepared.room, undefined, {}, controller.signal);
    publishProposals(prepared.agent.userId, result.patches);
    response.json({ ok: true, result });
  } catch (error) { if (!controller.signal.aborted && !response.writableEnded) sendError(response, error); }
  finally { request.off("close", abortRequest); }
});

router.post("/rooms/:roomId/agent/stream", guestSession, async (request, response) => {
  let prepared: Awaited<ReturnType<typeof prepareRequest>>;
  try { prepared = await prepareRequest(request as GuestRequest); } catch (error) { sendError(response, error); return; }
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  const controller = new AbortController();
  const abortIfDisconnected = () => { if (!response.writableEnded) controller.abort(); };
  response.once("close", abortIfDisconnected);
  try {
    await executeAgent(prepared.agent, prepared.room, (event) => {
      if (event.type === "patch_proposal") registerAgentProposal(event.patch, prepared.agent.userId);
      if (!controller.signal.aborted && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
    }, {}, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted && !response.writableEnded) response.write(`data: ${JSON.stringify({ type: "error", code: error instanceof AIProviderRequestError || error instanceof AIProviderUnavailableError ? error.code : "AGENT_ERROR", message: error instanceof Error ? error.message : "Unable to stream the coding-agent response" })}\n\n`);
  } finally {
    response.off("close", abortIfDisconnected);
    response.end();
  }
});

router.post("/rooms/:roomId/agent/patch", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const body = isRecord(request.body) ? request.body : {};
    const userId = verifyGuestSessionToken(roomId, typeof body.guestToken === "string" ? body.guestToken : undefined);
    if (!roomId || !userId) throw new AgentRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
    if (!rateLimit(`${roomId}:${userId}:patch`)) throw new AgentRouteError(429, "Patch approval limit reached. Please wait a moment.", "RATE_LIMITED");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    const room = roomStore.getRoomSnapshot(roomId);
    roomStore.getParticipant(roomId, userId);
    const patch = approvedPatchFromBody(body);
    if (patch.roomId && patch.roomId !== roomId) throw new AgentRouteError(409, "The patch belongs to another room", "PATCH_CONFLICT");
    if (patch.workspaceId && patch.workspaceId !== room.workspace.id) throw new AgentRouteError(409, "The patch belongs to another workspace", "PATCH_CONFLICT");
    const stored = getAgentProposal(patch.patchId);
    if (!stored || stored.userId !== userId || stored.patch.roomId !== roomId || !proposalMatches(stored.patch, patch)) throw new AgentRouteError(409, "The proposal is no longer available for this room session", "PATCH_CONFLICT");
    if (stored.status === "proposal_stale" || patch.baseVersion !== room.version) {
      updateAgentProposal(patch.patchId, "proposal_stale", room.version);
      throw new AgentRouteError(409, "This proposal is stale because the room changed. Generate a new proposal.", "PATCH_STALE");
    }
    if (stored.status !== "proposal_created") throw new AgentRouteError(409, "The proposal is no longer pending", "PATCH_CONFLICT");
    const common = { room, request: patchAgentRequest(room, userId), allowPatchApplication: false as const };
    const previewResult = await createAgentToolRegistry(common).run("APPLY_PATCH", patch);
    if (!previewResult.ok || !previewResult.patch) throw new AgentRouteError(409, previewResult.summary, "PATCH_CONFLICT");
    if (patch.suppliedPatchId !== previewResult.patch.patchId || patch.baseVersion !== previewResult.patch.baseVersion) throw new AgentRouteError(409, "The patch identity does not match the current file", "PATCH_CONFLICT");
    if (patch.fileId && patch.fileId !== previewResult.patch.fileId) throw new AgentRouteError(409, "The patch file does not match its path", "PATCH_CONFLICT");
    updateAgentProposal(patch.patchId, "proposal_approved", room.version);
    const appliedResult = await createAgentToolRegistry({
      room,
      request: patchAgentRequest(room, userId),
      allowPatchApplication: true,
      onWorkspaceChanged: (snapshot, file, applied) => emitAgentWorkspaceChange({ roomId, userId, fileId: file.id, snapshot, patch: applied })
    }).run("APPLY_PATCH", patch);
    if (!appliedResult.ok || !appliedResult.patch) {
      const currentVersion = roomStore.getRoomSnapshot(roomId).version;
      if (currentVersion !== patch.baseVersion) updateAgentProposal(patch.patchId, "proposal_stale", currentVersion);
      throw new AgentRouteError(409, appliedResult.summary, currentVersion !== patch.baseVersion ? "PATCH_STALE" : "PATCH_CONFLICT");
    }
    await roomPersistence.saveRoom(roomStore.getRoomSnapshot(roomId));
    updateAgentProposal(patch.patchId, "proposal_applied", appliedResult.patch.baseVersion + 1);
    response.json({ ok: true, patch: appliedResult.patch, room: roomStore.getRoomSnapshot(roomId) });
  } catch (error) { sendError(response, error); }
});

router.post("/rooms/:roomId/agent/proposal", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const body = isRecord(request.body) ? request.body : {};
    const userId = verifyGuestSessionToken(roomId, typeof body.guestToken === "string" ? body.guestToken : undefined);
    const patchId = clip(body.patchId, 64);
    if (!roomId || !userId || body.action !== "reject" || !patchId) throw new AgentRouteError(400, "A valid room session, patch ID, and reject action are required");
    if (!rateLimit(`${roomId}:${userId}:proposal`)) throw new AgentRouteError(429, "Proposal update limit reached. Please wait a moment.", "RATE_LIMITED");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    roomStore.getParticipant(roomId, userId);
    const stored = getAgentProposal(patchId);
    if (!stored || stored.patch.roomId !== roomId || stored.userId !== userId) throw new AgentRouteError(409, "The proposal is not available for this room session", "PATCH_CONFLICT");
    if (stored.status === "proposal_rejected") {
      response.json({ ok: true, status: "rejected", patchId });
      return;
    }
    if (stored.status !== "proposal_created") throw new AgentRouteError(409, "The proposal is no longer pending", "PATCH_CONFLICT");
    updateAgentProposal(patchId, "proposal_rejected");
    response.json({ ok: true, status: "rejected", patchId });
  } catch (error) { sendError(response, error); }
});

export default router;
