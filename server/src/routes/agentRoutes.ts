import { Router, type Response } from "express";
import { guestSession, verifyGuestSessionToken, type GuestRequest } from "../middleware/guestSession";
import { aiService } from "../modules/ai/aiService";
import { AIProviderRequestError, AIProviderUnavailableError, type AIChatMessage, type AIProviderId, type AISettings } from "../modules/ai/aiTypes";
import { AI_CONTEXT_BUDGETS } from "../modules/ai/contextEngine";
import { emitAgentWorkspaceChange, getAgentProposal, getPublicAgentProposalState, registerAgentProposal, updateAgentProposal } from "../modules/agent/agentEvents";
import { AgentRuntimeError, executeAgent } from "../modules/agent/agentRuntime";
import { createAgentToolRegistry } from "../modules/agent/agentToolRegistry";
import { cancelAgentTask, getAgentTask, getPublicAgentTaskHistory, recordTaskPatches, recordTaskValidation, registerAgentTaskController, startAgentTask, taskStatusForResult, unregisterAgentTaskController, updateAgentTask } from "../modules/agent/agentTaskHistory";
import { createValidationRunner } from "../modules/agent/validationRunner";
import type { AgentDiagnostic, AgentEvent, AgentMode, AgentPatch, AgentRequest, AgentPatchFile, AgentValidationSummary, ValidationCategory } from "../modules/agent/agentTypes";
import { roomStore } from "../modules/rooms/roomStore";
import { roomPersistence } from "../services/roomPersistence";
import { sanitizeRoomId } from "../utils/validation";
import { env } from "../config/env";
import { logSafeEvent } from "../utils/safeLogger";

const router = Router();
const requestWindows = new Map<string, { startedAt: number; count: number }>();
const REQUEST_WINDOW_MS = 60_000;
const REQUEST_LIMIT = env.agentRequestRateLimit;
const modes = new Set<AgentMode>(["ASK", "EDIT", "DEBUG", "EXPLAIN"]);
const intents = new Set(["explain", "generate", "fix", "optimize", "refactor", "test", "document", "summarize", "review", "error", "custom"]);
const validationCategories = new Set<ValidationCategory>(["typecheck", "lint", "tests", "build"]);
const providers = new Set<AIProviderId>(["gemini", "groq", "openrouter", "ollama", "openai", "anthropic", "custom"]);
const activeAgentControllers = new Map<string, AbortController>();
const MAX_AGENT_REQUEST_BYTES = 300_000;
const clip = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

class AgentRouteError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "INVALID_REQUEST") { super(message); }
}

const rateLimit = (key: string, limit = REQUEST_LIMIT) => {
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt > REQUEST_WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (requestWindows.size > 5_000) for (const [entryKey, entry] of requestWindows) if (now - entry.startedAt > REQUEST_WINDOW_MS) requestWindows.delete(entryKey);
  return current.count <= limit;
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
  if (JSON.stringify(body).length > MAX_AGENT_REQUEST_BYTES) throw new AgentRouteError(413, "This agent request is too large", "REQUEST_TOO_LARGE");
  if (!roomId) throw new AgentRouteError(400, "A valid room ID is required");
  const userId = verifyGuestSessionToken(roomId, typeof body.guestToken === "string" ? body.guestToken : undefined);
  if (!userId) throw new AgentRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
  if (!rateLimit(`${roomId}:${userId}`)) throw new AgentRouteError(429, "Agent request limit reached. Please wait a moment.", "RATE_LIMITED");
  if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
  let participant: ReturnType<typeof roomStore.getParticipant>;
  try { participant = roomStore.getParticipant(roomId, userId); } catch { throw new AgentRouteError(403, "You are not a participant in this room", "ROOM_SESSION_INVALID"); }
  const room = roomStore.getRoomSnapshot(roomId);
  const settings = parseSettings(body.settings);
  const mode = typeof body.mode === "string" && modes.has(body.mode as AgentMode) ? body.mode as AgentMode : "ASK";
  const intent = typeof body.intent === "string" && intents.has(body.intent) ? body.intent as AgentRequest["intent"] : undefined;
  if (!settings) throw new AgentRouteError(400, "A valid AI provider, model, and settings are required");
  const currentFileId = typeof body.currentFileId === "string" && room.workspace.files[body.currentFileId] ? body.currentFileId : room.workspace.activeFileId;
  const selectedCode = typeof body.selectedCode === "string" ? body.selectedCode.slice(0, 12_000) : "";
  const selectedCodeFileId = typeof body.selectedCodeFileId === "string" ? body.selectedCodeFileId.slice(0, 128) : currentFileId;
  const selectionStart = typeof body.selectionStartOffset === "number" && Number.isInteger(body.selectionStartOffset) ? body.selectionStartOffset : undefined;
  const selectionEnd = typeof body.selectionEndOffset === "number" && Number.isInteger(body.selectionEndOffset) ? body.selectionEndOffset : undefined;
  const selection = selectedCode && selectionStart !== undefined && selectionEnd !== undefined ? { fileId: selectedCodeFileId, code: selectedCode, startOffset: selectionStart, endOffset: selectionEnd } : undefined;
  const executionRaw = isRecord(body.execution) ? body.execution : undefined;
  const execution = executionRaw && clip(executionRaw.output, 6_000) ? { output: clip(executionRaw.output, 6_000), failed: Boolean(executionRaw.failed) } : undefined;
  const taskId = typeof body.taskId === "string" ? body.taskId.trim().slice(0, 128) : undefined;
  const continuationTaskId = typeof body.continuationTaskId === "string" ? body.continuationTaskId.trim().slice(0, 128) : undefined;
  const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim().slice(0, 128) : undefined;
  const suppliedContinuity = typeof body.continuitySummary === "string" ? body.continuitySummary.slice(0, 4_000) : "";
  const previousTask = continuationTaskId ? getAgentTask(continuationTaskId, roomId) : null;
  if (continuationTaskId && (!previousTask || previousTask.roomId !== roomId)) throw new AgentRouteError(409, "The previous agent task is not available in this room", "TASK_NOT_FOUND");
  const continuitySummary = [
    previousTask ? `Previous task summary: ${previousTask.summary}\nPrevious status: ${previousTask.status}${previousTask.validationSummary ? `\nPrevious validation: ${previousTask.validationSummary}` : ""}` : "",
    suppliedContinuity
  ].filter(Boolean).join("\n").slice(0, 4_000) || undefined;
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
    intent,
    taskId,
    continuationTaskId,
    conversationId,
    continuitySummary,
    initiatorLabel: participant.displayName,
    mode,
    language: activeFile?.language ?? room.language,
    settings,
    contextBudget: AI_CONTEXT_BUDGETS[settings.workspaceContextSize]
  };
  if (!agent.userInstruction && !agent.selection) throw new AgentRouteError(400, "A prompt or verified selection is required");
  return { agent, room };
};

const sendError = (response: Response, error: unknown) => {
  if (error instanceof AgentRouteError) { response.status(error.status).json({ ok: false, message: error.message, code: error.code }); return; }
  if (error instanceof AgentRuntimeError) { response.status(error.code === "TIMEOUT" ? 504 : error.code === "UNAUTHORIZED_CONTEXT" ? 403 : 499).json({ ok: false, message: error.message, code: error.code }); return; }
  if (error instanceof AIProviderUnavailableError) { response.status(503).json({ ok: false, message: error.message, code: error.code }); return; }
  if (error instanceof AIProviderRequestError) { response.status(error.code === "CONTEXT_TOO_LARGE" ? 413 : error.code === "RATE_LIMITED" ? 429 : 502).json({ ok: false, message: error.message, code: error.code }); return; }
  response.status(500).json({ ok: false, message: "Unable to complete the coding-agent request", code: "AGENT_ERROR" });
};

const updateTaskFromResult = (taskId: string, result: Awaited<ReturnType<typeof executeAgent>>) => {
  const validation = [...result.events].reverse().find((event): event is Extract<AgentEvent, { type: "validation" }> => event.type === "validation");
  if (validation) recordTaskValidation(taskId, validation.status ?? (validation.ok ? "passed" : "failed"), validation.summary);
  recordTaskPatches(taskId, result.patches);
  const terminal = taskStatusForResult(result.stoppedReason);
  const waitingForApproval = result.patches.length > 0 && terminal === "completed";
  updateAgentTask(taskId, { status: waitingForApproval ? "waiting_for_approval" : terminal });
};

const updateTaskFromError = (taskId: string, error: unknown) => {
  const status = error instanceof AgentRuntimeError && error.code === "CANCELLED"
    ? "cancelled"
    : error instanceof AgentRuntimeError && error.code === "TIMEOUT"
      ? "timed_out"
      : "failed";
  const code = error instanceof AgentRuntimeError || error instanceof AIProviderRequestError || error instanceof AIProviderUnavailableError ? error.code : "AGENT_ERROR";
  const event = status === "cancelled" ? "cancelled" : status === "timed_out" ? "timeout" : error instanceof AIProviderRequestError || error instanceof AIProviderUnavailableError ? "provider_failure" : "task_failure";
  logSafeEvent("agent", event, { taskId, code });
  updateAgentTask(taskId, { status });
};

const approvedPatchFromBody = (body: Record<string, unknown>): AgentPatch & { suppliedPatchId?: string } => {
  const raw = isRecord(body.patch) ? body.patch : body;
  const rawFiles = Array.isArray(raw.files) ? raw.files.slice(0, 10).flatMap((entry): AgentPatchFile[] => {
    if (!isRecord(entry) || typeof entry.fileId !== "string" || typeof entry.path !== "string" || typeof entry.expectedContent !== "string" || typeof entry.replacement !== "string") return [];
    return [{ fileId: entry.fileId.slice(0, 128), path: entry.path.slice(0, 260), expectedContent: entry.expectedContent, replacement: entry.replacement, additions: typeof entry.additions === "number" ? entry.additions : 0, deletions: typeof entry.deletions === "number" ? entry.deletions : 0, preview: typeof entry.preview === "string" ? entry.preview.slice(0, 8_000) : "" }];
  }) : undefined;
  const primary = rawFiles?.[0];
  const patch = {
    patchId: clip(raw.patchId, 64),
    ...(typeof raw.taskId === "string" ? { taskId: raw.taskId.slice(0, 64) } : {}),
    roomId: clip(raw.roomId, 32),
    workspaceId: clip(raw.workspaceId, 128),
    fileId: clip(raw.fileId ?? primary?.fileId, 128),
    path: clip(raw.path ?? primary?.path, 260),
    baseVersion: typeof raw.baseVersion === "number" && Number.isInteger(raw.baseVersion) ? raw.baseVersion : -1,
    expectedContent: typeof raw.expectedContent === "string" ? raw.expectedContent : primary?.expectedContent ?? "",
    replacement: typeof raw.replacement === "string" ? raw.replacement : primary?.replacement ?? "",
    additions: 0,
    deletions: 0,
    preview: "",
    applied: false,
    status: "pending" as const,
    ...(rawFiles?.length ? { files: rawFiles } : {})
  };
  if (!patch.patchId || !patch.path || patch.baseVersion < 1 || patch.expectedContent === "" || (typeof raw.replacement !== "string" && !primary)) throw new AgentRouteError(400, "An approved patch requires patchId, baseVersion, path, expectedContent, and replacement");
  return { ...patch, suppliedPatchId: patch.patchId || undefined };
};

const proposalMatches = (stored: AgentPatch, supplied: AgentPatch) => stored.roomId === supplied.roomId
  && stored.workspaceId === supplied.workspaceId
  && stored.fileId === supplied.fileId
  && stored.path === supplied.path
  && stored.baseVersion === supplied.baseVersion
  && stored.expectedContent === supplied.expectedContent
  && stored.replacement === supplied.replacement
  && stored.taskId === supplied.taskId
  && (stored.files?.length ?? 0) === (supplied.files?.length ?? 0)
  && (stored.files ?? []).every((file, index) => {
    const other = supplied.files?.[index];
    if (!other) return false;
    return file.fileId === other.fileId && file.path === other.path && file.expectedContent === other.expectedContent && file.replacement === other.replacement;
  });

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
  let taskId: string | undefined;
  try {
    const prepared = await prepareRequest(request as GuestRequest);
    if (prepared.agent.taskId && getAgentTask(prepared.agent.taskId, prepared.agent.roomId, prepared.agent.userId)) throw new AgentRouteError(409, "This agent request was already started. Use its task history or start a new request.", "DUPLICATE_TASK");
    const task = startAgentTask(prepared.agent);
    if (!task) throw new AgentRouteError(409, "This agent request was already started. Use its task history or start a new request.", "DUPLICATE_TASK");
    taskId = task.taskId;
    activeAgentControllers.set(taskId, controller);
    registerAgentTaskController(taskId, controller);
    updateAgentTask(taskId, { status: "planning" });
    updateAgentTask(taskId, { status: "running" });
    const result = await executeAgent({ ...prepared.agent, taskId }, prepared.room, undefined, {}, controller.signal);
    if (!roomStore.hasRoom(prepared.agent.roomId)) throw new AgentRuntimeError("UNAUTHORIZED_CONTEXT", "The room was deleted while the task was running");
    publishProposals(prepared.agent.userId, result.patches);
    updateTaskFromResult(taskId, result);
    response.json({ ok: true, result });
  } catch (error) { if (taskId) updateTaskFromError(taskId, error); if (!controller.signal.aborted && !response.writableEnded) sendError(response, error); }
  finally { activeAgentControllers.delete(taskId ?? ""); if (taskId) unregisterAgentTaskController(taskId, controller); request.off("close", abortRequest); }
});

router.post("/rooms/:roomId/agent/stream", guestSession, async (request, response) => {
  let prepared: Awaited<ReturnType<typeof prepareRequest>>;
  try { prepared = await prepareRequest(request as GuestRequest); } catch (error) { sendError(response, error); return; }
  if (prepared.agent.taskId && getAgentTask(prepared.agent.taskId, prepared.agent.roomId, prepared.agent.userId)) {
    response.status(409).json({ ok: false, message: "This agent request was already started. Use its task history or start a new request.", code: "DUPLICATE_TASK" });
    return;
  }
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  const controller = new AbortController();
  const task = startAgentTask(prepared.agent);
  if (!task) {
    response.status(409).json({ ok: false, message: "This agent request was already started. Use its task history or start a new request.", code: "DUPLICATE_TASK" });
    return;
  }
  const taskId = task.taskId;
  activeAgentControllers.set(taskId, controller);
  registerAgentTaskController(taskId, controller);
  updateAgentTask(taskId, { status: "planning" });
  updateAgentTask(taskId, { status: "running" });
  const abortIfDisconnected = () => { if (!response.writableEnded) controller.abort(); };
  response.once("close", abortIfDisconnected);
  try {
    const result = await executeAgent({ ...prepared.agent, taskId }, prepared.room, (event) => {
      if (event.type === "patch_proposal" && roomStore.hasRoom(prepared.agent.roomId)) registerAgentProposal(event.patch, prepared.agent.userId);
      if (!controller.signal.aborted && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
    }, {}, controller.signal);
    if (!roomStore.hasRoom(prepared.agent.roomId)) throw new AgentRuntimeError("UNAUTHORIZED_CONTEXT", "The room was deleted while the task was running");
    updateTaskFromResult(taskId, result);
  } catch (error) {
    updateTaskFromError(taskId, error);
    if (!controller.signal.aborted && !response.writableEnded) response.write(`data: ${JSON.stringify({ type: "error", code: error instanceof AIProviderRequestError || error instanceof AIProviderUnavailableError ? error.code : "AGENT_ERROR", message: error instanceof Error ? error.message : "Unable to stream the coding-agent response" })}\n\n`);
  } finally {
    activeAgentControllers.delete(taskId);
    unregisterAgentTaskController(taskId, controller);
    response.off("close", abortIfDisconnected);
    response.end();
  }
});

router.post("/rooms/:roomId/agent/:taskId/cancel", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const body = isRecord(request.body) ? request.body : {};
    const userId = verifyGuestSessionToken(roomId, typeof body.guestToken === "string" ? body.guestToken : undefined);
    const taskId = typeof request.params.taskId === "string" ? request.params.taskId.slice(0, 128) : "";
    if (!roomId || !userId || !taskId) throw new AgentRouteError(400, "A valid room session and task ID are required");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    roomStore.getParticipant(roomId, userId);
    const task = getAgentTask(taskId, roomId, userId);
    if (!task) throw new AgentRouteError(404, "Agent task not found", "TASK_NOT_FOUND");
    const cancellable = ["queued", "planning", "running", "waiting_for_approval", "validating", "applying"].includes(task.status);
    if (cancellable) {
      cancelAgentTask(taskId, roomId, userId);
      activeAgentControllers.delete(taskId);
      logSafeEvent("agent", "task_cancelled", { taskId, roomId });
    }
    response.json({ ok: true, taskId, status: cancellable ? "cancelled" : task.status });
  } catch (error) { sendError(response, error); }
});

router.get("/rooms/:roomId/agent/history", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const guestToken = typeof request.query.guestToken === "string" ? request.query.guestToken : undefined;
    const userId = verifyGuestSessionToken(roomId, guestToken);
    if (!roomId || !userId) throw new AgentRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    roomStore.getParticipant(roomId, userId);
    response.json({ ok: true, tasks: getPublicAgentTaskHistory(roomId) });
  } catch (error) { sendError(response, error); }
});

router.get("/rooms/:roomId/agent/proposals", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const guestToken = typeof request.query.guestToken === "string" ? request.query.guestToken : undefined;
    const userId = verifyGuestSessionToken(roomId, guestToken);
    if (!roomId || !userId) throw new AgentRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    roomStore.getParticipant(roomId, userId);
    response.json({ ok: true, proposals: getPublicAgentProposalState(roomId) });
  } catch (error) { sendError(response, error); }
});

router.get("/rooms/:roomId/agent/proposals/:patchId", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const guestToken = typeof request.query.guestToken === "string" ? request.query.guestToken : undefined;
    const userId = verifyGuestSessionToken(roomId, guestToken);
    const patchId = typeof request.params.patchId === "string" ? request.params.patchId.slice(0, 64) : "";
    if (!roomId || !userId || !patchId) throw new AgentRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    roomStore.getParticipant(roomId, userId);
    const stored = getAgentProposal(patchId);
    if (!stored || stored.patch.roomId !== roomId) throw new AgentRouteError(404, "Proposal not found", "PATCH_NOT_FOUND");
    response.json({ ok: true, patch: stored.patch, status: stored.status });
  } catch (error) { sendError(response, error); }
});

router.post("/rooms/:roomId/agent/validate", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const body = isRecord(request.body) ? request.body : {};
    const userId = verifyGuestSessionToken(roomId, typeof body.guestToken === "string" ? body.guestToken : undefined);
    const category = typeof body.category === "string" && validationCategories.has(body.category as ValidationCategory) ? body.category as ValidationCategory : null;
    if (!roomId || !userId || !category) throw new AgentRouteError(400, "A valid room session and validation category are required");
    if (!rateLimit(`${roomId}:${userId}:validate`, env.agentValidationRateLimit)) throw new AgentRouteError(429, "Validation limit reached. Please wait a moment.", "RATE_LIMITED");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    roomStore.getParticipant(roomId, userId);
    const taskId = typeof body.taskId === "string" ? body.taskId.slice(0, 64) : "";
    const taskRecord = taskId ? getAgentTask(taskId, roomId, userId) : null;
    const task = taskRecord?.taskId;
    const validationController = new AbortController();
    if (task) registerAgentTaskController(task, validationController);
    if (task && taskRecord?.status === "waiting_for_approval") updateAgentTask(task, { status: "validating" });
    if (task) recordTaskValidation(task, "running", "Validation is running");
    let validation: AgentValidationSummary;
    try {
      const result = await createValidationRunner()(category, validationController.signal);
      validation = { category, status: result.cancelled ? "cancelled" : result.timedOut ? "unavailable" : result.ok ? "passed" : "failed", summary: result.summary, output: [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 12_000), durationMs: result.durationMs };
    } catch (error) {
      validation = { category, status: "unavailable", summary: error instanceof Error ? error.message : "Validation was unavailable" };
    }
    if (task) {
      recordTaskValidation(task, validation.status, validation.summary);
      const currentTask = getAgentTask(task, roomId, userId);
      if (currentTask?.status === "validating") updateAgentTask(task, { status: validation.status === "cancelled" ? "cancelled" : currentTask.patchStatus === "proposed" ? "waiting_for_approval" : "completed" });
    }
    if (task) unregisterAgentTaskController(task, validationController);
    response.status(validation.status === "passed" ? 200 : 422).json({ ok: validation.status === "passed", validation, taskId: task });
  } catch (error) { sendError(response, error); }
});

router.post("/rooms/:roomId/agent/patch", guestSession, async (request, response) => {
  try {
    const roomId = sanitizeRoomId(request.params.roomId);
    const body = isRecord(request.body) ? request.body : {};
    const userId = verifyGuestSessionToken(roomId, typeof body.guestToken === "string" ? body.guestToken : undefined);
    if (!roomId || !userId) throw new AgentRouteError(401, "A valid room session is required", "ROOM_SESSION_INVALID");
    if (!rateLimit(`${roomId}:${userId}:patch`, env.agentPatchRateLimit)) throw new AgentRouteError(429, "Patch approval limit reached. Please wait a moment.", "RATE_LIMITED");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    const room = roomStore.getRoomSnapshot(roomId);
    roomStore.getParticipant(roomId, userId);
    const patch = approvedPatchFromBody(body);
    if (patch.roomId && patch.roomId !== roomId) throw new AgentRouteError(409, "The patch belongs to another room", "PATCH_CONFLICT");
    if (patch.workspaceId && patch.workspaceId !== room.workspace.id) throw new AgentRouteError(409, "The patch belongs to another workspace", "PATCH_CONFLICT");
    const stored = getAgentProposal(patch.patchId);
    if (!stored || stored.patch.roomId !== roomId || !proposalMatches(stored.patch, patch)) throw new AgentRouteError(409, "The proposal is no longer available for this room session", "PATCH_CONFLICT");
    if (stored.status === "proposal_stale" || patch.baseVersion !== room.version) {
      updateAgentProposal(patch.patchId, "proposal_stale", room.version);
      if (stored.patch.taskId) updateAgentTask(stored.patch.taskId, { status: "conflict", patchStatus: "stale" });
      throw new AgentRouteError(409, "This proposal is stale because the room changed. Generate a new proposal.", "PATCH_STALE");
    }
    if (stored.status !== "proposal_created") throw new AgentRouteError(409, "The proposal is no longer pending", "PATCH_CONFLICT");
    if (stored.patch.review?.some((finding) => finding.severity === "critical")) throw new AgentRouteError(422, "This proposal is blocked by a critical security finding", "SECURITY_BLOCKED");
    const common = { room, request: patchAgentRequest(room, userId), allowPatchApplication: false as const };
    const previewResult = await createAgentToolRegistry(common).run("APPLY_PATCH", patch);
    if (!previewResult.ok || !previewResult.patch) throw new AgentRouteError(409, previewResult.summary, "PATCH_CONFLICT");
    if (patch.suppliedPatchId !== previewResult.patch.patchId || patch.baseVersion !== previewResult.patch.baseVersion) throw new AgentRouteError(409, "The patch identity does not match the current file", "PATCH_CONFLICT");
    if (patch.fileId && patch.fileId !== previewResult.patch.fileId) throw new AgentRouteError(409, "The patch file does not match its path", "PATCH_CONFLICT");
    updateAgentProposal(patch.patchId, "proposal_approved", room.version);
    logSafeEvent("agent", "patch_approval", { roomId, patchId: patch.patchId, userId });
    if (stored.patch.taskId) updateAgentTask(stored.patch.taskId, { status: "applying" });
    const appliedResult = await createAgentToolRegistry({
      room,
      request: patchAgentRequest(room, userId),
      allowPatchApplication: true,
      onWorkspaceChanged: (snapshot, file, applied) => emitAgentWorkspaceChange({ roomId, userId, fileId: file.id, snapshot, patch: applied })
    }).run("APPLY_PATCH", patch);
    if (!appliedResult.ok || !appliedResult.patch) {
      const currentVersion = roomStore.getRoomSnapshot(roomId).version;
      if (currentVersion !== patch.baseVersion) {
        updateAgentProposal(patch.patchId, "proposal_stale", currentVersion);
        if (stored.patch.taskId) updateAgentTask(stored.patch.taskId, { status: "conflict", patchStatus: "stale" });
      }
      throw new AgentRouteError(409, appliedResult.summary, currentVersion !== patch.baseVersion ? "PATCH_STALE" : "PATCH_CONFLICT");
    }
    await roomPersistence.saveRoom(roomStore.getRoomSnapshot(roomId));
    updateAgentProposal(patch.patchId, "proposal_applied", appliedResult.patch.baseVersion + 1);
    logSafeEvent("agent", "patch_application", { roomId, patchId: patch.patchId, userId, files: appliedResult.patch.files?.length ?? 1 });
    if (stored.patch.taskId) {
      updateAgentTask(stored.patch.taskId, { status: "validating", patchStatus: "applied" });
      recordTaskValidation(stored.patch.taskId, "skipped", "Automatic validation was skipped because room files are virtual; run an explicit fixed validation check from the panel.");
      updateAgentTask(stored.patch.taskId, { status: "completed" });
    }
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
    if (!rateLimit(`${roomId}:${userId}:proposal`, env.agentPatchRateLimit)) throw new AgentRouteError(429, "Proposal update limit reached. Please wait a moment.", "RATE_LIMITED");
    if (!(await loadRoomIfNeeded(roomId))) throw new AgentRouteError(404, "Room not found", "ROOM_NOT_FOUND");
    roomStore.getParticipant(roomId, userId);
    const stored = getAgentProposal(patchId);
    if (!stored || stored.patch.roomId !== roomId) throw new AgentRouteError(409, "The proposal is not available for this room session", "PATCH_CONFLICT");
    if (stored.status === "proposal_rejected") {
      response.json({ ok: true, status: "rejected", patchId });
      return;
    }
    if (stored.status !== "proposal_created") throw new AgentRouteError(409, "The proposal is no longer pending", "PATCH_CONFLICT");
    updateAgentProposal(patchId, "proposal_rejected");
    logSafeEvent("agent", "patch_rejection", { roomId, patchId, userId });
    if (stored.patch.taskId) updateAgentTask(stored.patch.taskId, { status: "completed", patchStatus: "rejected" });
    response.json({ ok: true, status: "rejected", patchId });
  } catch (error) { sendError(response, error); }
});

export default router;
