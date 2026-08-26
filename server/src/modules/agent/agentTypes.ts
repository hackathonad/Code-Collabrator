import type { SupportedLanguage } from "../../constants/languages";
import type { RoomSnapshot, WorkspaceFile } from "../rooms/roomTypes";
import type {
  AIChatMessage,
  AICompletionResult,
  AIContextPayload,
  AIExecutionContext,
  AIProviderId,
  AISettings,
  AIService
} from "../ai/aiTypes";

export type AgentMode = "ASK" | "EDIT" | "DEBUG" | "EXPLAIN";
export type AgentToolName =
  | "READ_FILE"
  | "LIST_FILES"
  | "SEARCH_CODE"
  | "GET_CURRENT_FILE"
  | "GET_SELECTION"
  | "GET_WORKSPACE_SUMMARY"
  | "GET_DIAGNOSTICS"
  | "APPLY_PATCH"
  | "RUN_VALIDATION";
export type ValidationCategory = "typecheck" | "lint" | "tests" | "build";

export interface AgentSelection {
  fileId: string;
  code: string;
  startOffset: number;
  endOffset: number;
}

export interface AgentRequest {
  roomId: string;
  userId: string;
  workspaceId: string;
  currentFileId: string;
  selection?: AgentSelection;
  userInstruction: string;
  relevantFiles?: string[];
  conversation: AIChatMessage[];
  execution?: AIExecutionContext;
  mode: AgentMode;
  language: SupportedLanguage;
  settings: AISettings;
  contextBudget: number;
}

export interface AgentPatch {
  patchId: string;
  roomId: string;
  workspaceId: string;
  fileId: string;
  path: string;
  expectedContent: string;
  replacement: string;
  additions: number;
  deletions: number;
  preview: string;
  applied: boolean;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "plan"; steps: string[] }
  | { type: "tool_call"; tool: AgentToolName; summary: string }
  | { type: "tool_result"; tool: AgentToolName; ok: boolean; summary: string }
  | { type: "patch_proposal"; patch: AgentPatch }
  | { type: "validation"; category: ValidationCategory; ok: boolean; summary: string; output?: string }
  | { type: "execution"; category: ValidationCategory; ok: boolean; summary: string; output?: string }
  | { type: "final"; text: string }
  | { type: "error"; code: string; message: string };

export interface AgentResult {
  finalText: string;
  events: AgentEvent[];
  patches: AgentPatch[];
  provider: AIProviderId;
  model: string;
  iterations: number;
  toolCalls: number;
  stoppedReason?: "completed" | "iteration-limit" | "tool-limit" | "cancelled" | "timeout";
  usage?: AICompletionResult["usage"];
}

export interface AgentToolContext {
  room: RoomSnapshot;
  request: AgentRequest;
  allowPatchApplication: boolean;
  signal?: AbortSignal;
  onWorkspaceChanged?: (snapshot: RoomSnapshot, file: WorkspaceFile, patch: AgentPatch) => void;
  validationRunner?: ValidationRunner;
}

export interface AgentToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  patch?: AgentPatch;
  validation?: { category: ValidationCategory; ok: boolean; summary: string; output?: string };
}

export interface AgentToolRegistry {
  list(): AgentToolName[];
  run(name: string, args: unknown): Promise<AgentToolResult>;
}

export interface ValidationRunResult {
  category: ValidationCategory;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  summary: string;
}

export type ValidationRunner = (category: ValidationCategory, signal?: AbortSignal) => Promise<ValidationRunResult>;

export interface AgentRuntimeDependencies {
  aiService?: AIService;
  repository?: import("../git/gitTypes").RepositorySummary | null;
  createTools?: (context: AgentToolContext) => AgentToolRegistry;
  now?: () => number;
}

export interface BuiltAgentContext {
  payload: AIContextPayload;
  request: AgentRequest;
}
