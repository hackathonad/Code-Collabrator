import type { AIProviderId, AISettings } from "./ai";

export type AgentMode = "ASK" | "EDIT" | "DEBUG" | "EXPLAIN";
export type AgentToolName = "READ_FILE" | "LIST_FILES" | "SEARCH_CODE" | "GET_CURRENT_FILE" | "GET_SELECTION" | "GET_WORKSPACE_SUMMARY" | "GET_DIAGNOSTICS" | "APPLY_PATCH" | "RUN_VALIDATION";
export type ValidationCategory = "typecheck" | "lint" | "tests" | "build";
export type AgentProposalStatus = "pending" | "approved" | "rejected" | "stale" | "applied";

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
  | { type: "plan"; steps: string[] }
  | { type: "tool_call"; tool: AgentToolName; summary: string }
  | { type: "tool_result"; tool: AgentToolName; ok: boolean; summary: string }
  | { type: "patch_proposal"; patch: AgentPatch }
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
}
