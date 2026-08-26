import type { AIAction, AIProviderId, AISettings } from "./ai";

export type AgentMode = "ASK" | "EDIT" | "DEBUG" | "EXPLAIN";
export type AgentToolName = "READ_FILE" | "LIST_FILES" | "SEARCH_CODE" | "GET_CURRENT_FILE" | "GET_SELECTION" | "GET_WORKSPACE_SUMMARY" | "GET_PROJECT_INDEX" | "GET_TASK_HISTORY" | "GET_DIAGNOSTICS" | "APPLY_PATCH" | "RUN_VALIDATION";
export type ValidationCategory = "typecheck" | "lint" | "tests" | "build";
export type AgentProposalStatus = "pending" | "approved" | "rejected" | "stale" | "applied";
export type AgentTaskStatus = "started" | "running" | "completed" | "failed" | "cancelled" | "timeout";
export type AgentValidationStatus = "not-run" | "running" | "passed" | "failed" | "unavailable";

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
  mode: AgentMode;
  intent: AIAction;
  summary: string;
  status: AgentTaskStatus;
  patchStatus: "none" | "proposed" | "applied" | "stale" | "rejected";
  validationStatus: AgentValidationStatus;
  patchCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTaskEvent {
  type: "task_started" | "task_updated";
  task: AgentTaskPublic;
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
  | { type: "validation"; category: ValidationCategory; ok: boolean; summary: string; output?: string }
  | { type: "execution"; category: ValidationCategory; ok: boolean; summary: string; output?: string }
  | { type: "final"; text: string }
  | { type: "error"; code: string; message: string };

export interface AgentRequestPayload {
  roomId: string;
  guestToken?: string;
  workspaceId: string;
  mode: AgentMode;
  prompt: string;
  currentFileId: string;
  selectedCode?: string;
  selectedCodeFileId?: string;
  selectionStartOffset?: number;
  selectionEndOffset?: number;
  relevantFiles?: string[];
  diagnostics?: AgentDiagnostic[];
  intent?: AIAction;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  settings: AISettings;
  execution?: { output: string; failed: boolean };
}

export interface AgentCompletionResult {
  finalText: string;
  events: AgentEvent[];
  patches: AgentPatch[];
  provider: AIProviderId;
  model: string;
  iterations: number;
  toolCalls: number;
  stoppedReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  taskId?: string;
  review?: AgentReviewFinding[];
}
