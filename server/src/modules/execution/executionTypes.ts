export type ExecutionAction = "run" | "tests" | "targeted-tests" | "build" | "typecheck" | "lint" | "diagnostics";
export type ExecutionStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out" | "unavailable";

export interface ExecutionRecord {
  executionId: string;
  requestId?: string;
  roomId: string;
  workspaceId: string;
  ownerId: string;
  action: ExecutionAction;
  target?: string;
  command: string;
  status: ExecutionStatus;
  exitCode: number | null;
  durationMs: number | null;
  output: string;
  errorSummary: string | null;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ExecutionEvent {
  type: "execution:started" | "execution:updated";
  record: ExecutionRecord;
}

export interface ExecutionCapabilities {
  available: boolean;
  scope: "server-project";
  message: string;
  actions: Array<{ action: ExecutionAction; label: string; available: boolean; description: string }>;
}
