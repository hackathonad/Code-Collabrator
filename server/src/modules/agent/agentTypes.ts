import type { SupportedLanguage } from "../../constants/languages";
import type { RoomSnapshot, WorkspaceFile } from "../rooms/roomTypes";
import type {
  AIAction,
  AIChatMessage,
  AICompletionResult,
  AIContextPayload,
  AIExecutionContext,
  AIProviderId,
  AISettings,
  AIService
} from "../ai/aiTypes";

export type AgentMode = "ASK" | "EDIT" | "DEBUG" | "EXPLAIN";
export type AgentProposalStatus = "pending" | "approved" | "rejected" | "stale" | "applied";
export type AgentTaskStatus = "queued" | "planning" | "running" | "waiting_for_approval" | "applying" | "validating" | "completed" | "cancelled" | "failed" | "timed_out" | "conflict";
export type AgentValidationStatus = "not-run" | "running" | "passed" | "failed" | "skipped" | "unavailable";
export type AgentToolName =
  | "READ_FILE"
  | "LIST_FILES"
  | "SEARCH_CODE"
  | "GET_CURRENT_FILE"
  | "GET_SELECTION"
  | "GET_WORKSPACE_SUMMARY"
  | "GET_PROJECT_INDEX"
  | "GET_TASK_HISTORY"
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

export interface AgentDiagnostic {
  fileId?: string;
  path?: string;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
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
  diagnostics?: AgentDiagnostic[];
  intent?: AIAction;
  taskId?: string;
  conversationId?: string;
  continuitySummary?: string;
  mode: AgentMode;
  language: SupportedLanguage;
  settings: AISettings;
  contextBudget: number;
}

export interface AgentPatch {
  patchId: string;
  taskId?: string;
  roomId: string;
  workspaceId: string;
  fileId: string;
  path: string;
  baseVersion: number;
  expectedContent: string;
  replacement: string;
  additions: number;
  deletions: number;
  preview: string;
  applied: boolean;
  status: AgentProposalStatus;
  files?: AgentPatchFile[];
  review?: AgentReviewFinding[];
  validation?: AgentValidationSummary;
}

export interface AgentPatchFile {
  fileId: string;
  path: string;
  expectedContent: string;
  replacement: string;
  additions: number;
  deletions: number;
  preview: string;
}

export type AgentReviewSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface AgentReviewFinding {
  severity: AgentReviewSeverity;
  file?: string;
  line?: number;
  column?: number;
  title: string;
  explanation: string;
  suggestion?: string;
}

export interface AgentValidationSummary {
  category: ValidationCategory;
  status: AgentValidationStatus;
  summary: string;
  output?: string;
  durationMs?: number;
}

export interface AgentTaskPublic {
  taskId: string;
  roomId: string;
  conversationId?: string;
  mode: AgentMode;
  intent: AIAction;
  summary: string;
  status: AgentTaskStatus;
  patchStatus: "none" | "proposed" | "applied" | "stale" | "rejected";
  validationStatus: AgentValidationStatus;
  validationSummary?: string;
  patchCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentProposalEvent {
  type: "proposal_created" | "proposal_approved" | "proposal_rejected" | "proposal_stale" | "proposal_applied";
  roomId: string;
  userId: string;
  patchId: string;
  fileId: string;
  path: string;
  baseVersion: number;
  currentVersion?: number;
  additions: number;
  deletions: number;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "context"; files: Array<{ path: string; reason: string }>; projectSummary: string; recommendation?: { providerId: string; model: string; reason: string; selected: boolean } }
  | { type: "plan"; steps: string[] }
  | { type: "tool_call"; tool: AgentToolName; summary: string }
  | { type: "tool_result"; tool: AgentToolName; ok: boolean; summary: string }
  | { type: "patch_proposal"; patch: AgentPatch }
  | { type: "patch_review"; patchId: string; findings: AgentReviewFinding[] }
  | { type: "review"; findings: AgentReviewFinding[] }
  | { type: "validation"; category: ValidationCategory; ok: boolean; status?: AgentValidationStatus; summary: string; output?: string }
  | { type: "execution"; category: ValidationCategory; ok: boolean; status?: AgentValidationStatus; summary: string; output?: string }
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
  taskId?: string;
  review?: AgentReviewFinding[];
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
  validation?: { category: ValidationCategory; ok: boolean; status: AgentValidationStatus; summary: string; output?: string };
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
  cancelled?: boolean;
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
