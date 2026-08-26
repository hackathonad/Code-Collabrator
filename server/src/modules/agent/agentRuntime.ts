import { aiService as defaultAIService } from "../ai/aiService";
import {
  AICancelledError,
  AIProviderRequestError,
  type AIChatMessage,
  type AICompletionResult,
  type AIRequestInput,
  type AIService
} from "../ai/aiTypes";
import { AI_CONTEXT_BUDGETS, buildAIContext } from "../ai/contextEngine";
import { gitService } from "../git/gitService";
import type { RoomSnapshot } from "../rooms/roomTypes";
import { createAgentSystemPrompt, createAgentUserMessage } from "./agentPrompt";
import { createAgentToolRegistry } from "./agentToolRegistry";
import type {
  AgentEvent,
  AgentMode,
  AgentRequest,
  AgentResult,
  AgentRuntimeDependencies,
  AgentToolContext,
  AgentToolName
} from "./agentTypes";

export const AGENT_MAX_ITERATIONS = 8;
export const AGENT_MAX_TOOL_CALLS = 20;
export const AGENT_TIMEOUT_MS = 90_000;
const MAX_FINAL_TEXT = 12_000;
const MAX_INTERNAL_RESULT = 24_000;

export class AgentRuntimeError extends Error {
  constructor(public readonly code: "TIMEOUT" | "CANCELLED" | "INVALID_MODEL_OUTPUT", message: string) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

const clip = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 32))}\n[…agent output truncated…]`;
const modeAction: Record<AgentMode, AIRequestInput["action"]> = { ASK: "explain", EDIT: "generate", DEBUG: "fix", EXPLAIN: "explain" };

export interface ParsedAgentAction {
  type: "tool_call" | "plan" | "final";
  tool?: AgentToolName;
  arguments?: Record<string, unknown>;
  steps?: string[];
  text?: string;
}

const toolNameSet = new Set<AgentToolName>([
  "READ_FILE", "LIST_FILES", "SEARCH_CODE", "GET_CURRENT_FILE", "GET_SELECTION",
  "GET_WORKSPACE_SUMMARY", "GET_DIAGNOSTICS", "APPLY_PATCH", "RUN_VALIDATION"
]);

export const parseAgentAction = (content: string): ParsedAgentAction | null => {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed;
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
  if (first < 0 || last <= first) return { type: "final", text: trimmed };
  try {
    const value = JSON.parse(fenced.slice(first, last + 1)) as Record<string, unknown>;
    if (value.type === "plan" && Array.isArray(value.steps)) {
      const steps = value.steps.filter((step): step is string => typeof step === "string").map((step) => step.trim().slice(0, 240)).filter(Boolean).slice(0, 12);
      return steps.length ? { type: "plan", steps } : { type: "final", text: trimmed };
    }
    if (value.type === "tool_call" && typeof value.tool === "string" && toolNameSet.has(value.tool as AgentToolName)) {
      return { type: "tool_call", tool: value.tool as AgentToolName, arguments: value.arguments && typeof value.arguments === "object" && !Array.isArray(value.arguments) ? value.arguments as Record<string, unknown> : {} };
    }
    if (value.type === "final" && typeof value.text === "string") return { type: "final", text: value.text };
  } catch {
    return { type: "final", text: trimmed };
  }
  return { type: "final", text: trimmed };
};

const actionSummary = (tool: AgentToolName, args: Record<string, unknown>) => {
  const details = Object.entries(args).filter(([key]) => ["path", "query", "category", "language"].includes(key)).map(([key, value]) => `${key}=${String(value).slice(0, 80)}`).join(", ");
  return details ? `${tool} (${details})` : tool;
};

const resultForModel = (result: { ok: boolean; summary: string; data?: unknown; patch?: unknown; validation?: unknown }) =>
  clip(JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data, patch: result.patch, validation: result.validation }), MAX_INTERNAL_RESULT);

const createContextInput = (request: AgentRequest): AIRequestInput => ({
  action: modeAction[request.mode],
  prompt: request.userInstruction,
  currentFileId: request.currentFileId,
  selectedCode: request.selection?.code,
  selectedCodeFileId: request.selection?.fileId,
  conversation: request.conversation,
  settings: request.settings,
  execution: request.execution
});

const collectCompletion = async (service: AIService, request: AgentRequest, signal: AbortSignal): Promise<AICompletionResult> => {
  const provider = service.getProviders().find((entry) => entry.id === request.settings.provider);
  if (request.settings.streaming && provider?.supportsStreaming) {
    let content = "";
    let complete: AICompletionResult | undefined;
    for await (const event of service.stream(request.settings.provider, { messages: request.conversation, settings: request.settings, metadata: { workspaceId: request.workspaceId, action: modeAction[request.mode], language: request.language }, signal })) {
      if (signal.aborted) throw new AgentRuntimeError("CANCELLED", "Agent generation was cancelled");
      if (event.type === "delta" && event.content) content += event.content;
      if (event.type === "complete" && event.result) complete = event.result;
      if (event.type === "error") throw new AIProviderRequestError(event.message ?? "The AI provider returned a stream error", event.code ?? "STREAM_ERROR");
    }
    if (complete) return complete;
    return { content, provider: request.settings.provider, model: request.settings.model };
  }
  return service.complete(request.settings.provider, { messages: request.conversation, settings: request.settings, metadata: { workspaceId: request.workspaceId, action: modeAction[request.mode], language: request.language }, signal });
};

const baseResult = (request: AgentRequest, events: AgentEvent[], patches: AgentResult["patches"], iterations: number, toolCalls: number, stoppedReason: AgentResult["stoppedReason"], usage?: AgentResult["usage"]): AgentResult => ({
  finalText: "",
  events,
  patches,
  provider: request.settings.provider,
  model: request.settings.model,
  iterations,
  toolCalls,
  stoppedReason,
  usage
});

export const executeAgent = async (
  request: AgentRequest,
  room: RoomSnapshot,
  onEvent?: (event: AgentEvent) => void,
  dependencies: AgentRuntimeDependencies = {},
  signal?: AbortSignal
): Promise<AgentResult> => {
  const service = dependencies.aiService ?? defaultAIService;
  const events: AgentEvent[] = [];
  const patches: AgentResult["patches"] = [];
  const emit = (event: AgentEvent) => { events.push(event); onEvent?.(event); };
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const deadline = Date.now() + AGENT_TIMEOUT_MS;
  const runWithinDeadline = async <T>(operation: () => Promise<T>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      timedOut = true;
      controller.abort();
      throw new AgentRuntimeError("TIMEOUT", "Agent generation timed out");
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => { if (settled) return; settled = true; clearTimeout(timer); controller.signal.removeEventListener("abort", abort); callback(); };
      const timer = setTimeout(() => { timedOut = true; finish(() => reject(new AgentRuntimeError("TIMEOUT", "Agent generation timed out"))); controller.abort(); }, remaining);
      const abort = () => finish(() => reject(new AgentRuntimeError("CANCELLED", "Agent generation was cancelled")));
      controller.signal.addEventListener("abort", abort, { once: true });
      operation().then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    });
  };
  const emitStatus = (message: string) => emit({ type: "status", message });
  try {
    if (signal?.aborted) throw new AgentRuntimeError("CANCELLED", "Agent generation was cancelled");
    const repository = dependencies.repository === undefined ? await runWithinDeadline(() => gitService.getSummary(room.workspace).catch(() => null)) : dependencies.repository;
    const context = buildAIContext(room, createContextInput(request), repository ?? null);
    if (context.characterCount > request.contextBudget || context.characterCount > AI_CONTEXT_BUDGETS[request.settings.workspaceContextSize]) {
      throw new AIProviderRequestError("The selected workspace context is too large. Choose a smaller context setting and try again.", "CONTEXT_TOO_LARGE");
    }
    emitStatus(`Preparing ${request.mode.toLowerCase()} mode for ${context.currentFile?.name ?? "the workspace"}`);
    const toolContext: AgentToolContext = {
      room,
      request,
      allowPatchApplication: false,
      signal: controller.signal,
      onWorkspaceChanged: undefined
    };
    const tools = (dependencies.createTools ?? createAgentToolRegistry)(toolContext);
    const messages: AIChatMessage[] = [
      { role: "system", content: createAgentSystemPrompt(request.mode) },
      ...request.conversation.slice(-8),
      createAgentUserMessage(request, context)
    ];
    let usage: AgentResult["usage"];
    let toolCalls = 0;
    for (let iteration = 1; iteration <= AGENT_MAX_ITERATIONS; iteration += 1) {
      if (controller.signal.aborted) throw new AgentRuntimeError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut ? "Agent generation timed out" : "Agent generation was cancelled");
      if (toolCalls >= AGENT_MAX_TOOL_CALLS) {
        emit({ type: "error", code: "TOOL_LIMIT", message: "The agent stopped after reaching the safe tool-call limit." });
        return baseResult(request, events, patches, iteration - 1, toolCalls, "tool-limit", usage);
      }
      emitStatus(`Working on step ${iteration} of ${AGENT_MAX_ITERATIONS}`);
      const completion = await runWithinDeadline(() => collectCompletion(service, { ...request, conversation: messages }, controller.signal));
      if (controller.signal.aborted) throw new AgentRuntimeError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut ? "Agent generation timed out" : "Agent generation was cancelled");
      usage = completion.usage ?? usage;
      const action = parseAgentAction(completion.content);
      if (!action) {
        const text = "I could not produce a response from the selected provider.";
        emit({ type: "final", text });
        return { ...baseResult(request, events, patches, iteration, toolCalls, "completed", usage), finalText: text };
      }
      messages.push({ role: "assistant", content: clip(completion.content, MAX_INTERNAL_RESULT) });
      if (action.type === "plan") {
        emit({ type: "plan", steps: action.steps ?? [] });
        messages.push({ role: "user", content: "The plan is recorded. Continue with the next safe tool call or provide the final answer." });
        continue;
      }
      if (action.type === "final") {
        const text = clip(action.text ?? completion.content, MAX_FINAL_TEXT).trim();
        emit({ type: "final", text });
        return { ...baseResult(request, events, patches, iteration, toolCalls, "completed", usage), finalText: text };
      }
      const args = action.arguments ?? {};
      toolCalls += 1;
      emit({ type: "tool_call", tool: action.tool!, summary: actionSummary(action.tool!, args) });
      const result = await runWithinDeadline(() => tools.run(action.tool!, args));
      if (result.patch) {
        patches.push(result.patch);
        emit({ type: "patch_proposal", patch: result.patch });
      }
      if (result.validation) {
        emit({ type: "validation", ...result.validation });
        emit({ type: "execution", ...result.validation });
      }
      emit({ type: "tool_result", tool: action.tool!, ok: result.ok, summary: result.summary });
      messages.push({ role: "user", content: `<tool-result source='untrusted'>\n${resultForModel(result)}\n</tool-result>\nContinue with one allowed JSON object.` });
    }
    const text = "I stopped after reaching the safe agent iteration limit. Review any proposed changes before applying them.";
    emit({ type: "final", text });
    return { ...baseResult(request, events, patches, AGENT_MAX_ITERATIONS, toolCalls, "iteration-limit", usage), finalText: text };
  } catch (error) {
    if (error instanceof AgentRuntimeError && (error.code === "CANCELLED" || error.code === "TIMEOUT")) {
      const cancelled = error.code === "CANCELLED";
      emit({ type: "error", code: error.code, message: error.message });
      return { ...baseResult(request, events, patches, events.filter((event) => event.type === "status").length, 0, cancelled ? "cancelled" : "timeout"), finalText: cancelled ? "Agent generation was cancelled." : "Agent generation timed out." };
    }
    if (error instanceof AICancelledError) {
      emit({ type: "error", code: "CANCELLED", message: error.message });
      return { ...baseResult(request, events, patches, 0, 0, "cancelled"), finalText: error.message };
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
  }
};
