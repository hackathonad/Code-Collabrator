import type { AgentEvent, AgentPatch, AgentPatchFile, AgentReviewFinding } from "../types/agent";

const toolNames = new Set([
  "READ_FILE", "LIST_FILES", "SEARCH_CODE", "GET_CURRENT_FILE", "GET_SELECTION",
  "GET_WORKSPACE_SUMMARY", "GET_PROJECT_INDEX", "GET_RELATED_FILES", "GET_PACKAGE_INFO", "GET_TASK_HISTORY", "GET_DIAGNOSTICS", "APPLY_PATCH", "RUN_VALIDATION"
]);
const patchStatuses = new Set(["pending", "approved", "rejected", "stale", "applied"]);
const validationStatuses = new Set(["not-run", "running", "passed", "failed", "skipped", "unavailable", "cancelled"]);
const validationCategories = new Set(["typecheck", "lint", "tests", "build"]);
const reviewSeverities = new Set(["critical", "high", "medium", "low", "info"]);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const boundedNonEmptyString = (value: unknown, max: number): value is string => boundedString(value, max) && Boolean(value.trim());
const boundedInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const isReviewFinding = (value: unknown): value is AgentReviewFinding => isRecord(value)
  && reviewSeverities.has(String(value.severity))
  && boundedNonEmptyString(value.title, 240)
  && boundedNonEmptyString(value.explanation, 1_000)
  && (value.file === undefined || boundedString(value.file, 260))
  && (value.line === undefined || (boundedInteger(value.line) && value.line >= 1))
  && (value.column === undefined || (boundedInteger(value.column) && value.column >= 1))
  && (value.suggestion === undefined || boundedString(value.suggestion, 800));

const isReviewList = (value: unknown): value is AgentReviewFinding[] => Array.isArray(value) && value.length <= 30 && value.every(isReviewFinding);

const isPatchFile = (value: unknown): value is AgentPatchFile => isRecord(value)
  && boundedNonEmptyString(value.fileId, 128)
  && boundedNonEmptyString(value.path, 260)
  && boundedNonEmptyString(value.expectedContent, 30_000)
  && boundedString(value.replacement, 30_000)
  && boundedInteger(value.additions)
  && boundedInteger(value.deletions)
  && boundedString(value.preview, 8_000);

const isPatch = (value: unknown): value is AgentPatch => isRecord(value)
  && boundedNonEmptyString(value.patchId, 64)
  && boundedNonEmptyString(value.roomId, 64)
  && boundedNonEmptyString(value.workspaceId, 128)
  && boundedNonEmptyString(value.fileId, 128)
  && boundedNonEmptyString(value.path, 260)
  && boundedInteger(value.baseVersion)
  && value.baseVersion >= 1
  && boundedNonEmptyString(value.expectedContent, 30_000)
  && boundedString(value.replacement, 30_000)
  && boundedInteger(value.additions)
  && boundedInteger(value.deletions)
  && boundedString(value.preview, 12_000)
  && typeof value.applied === "boolean"
  && patchStatuses.has(String(value.status))
  && (value.files === undefined || (Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 10 && value.files.every(isPatchFile)))
  && (value.review === undefined || isReviewList(value.review));

const isDiagnosisList = (value: unknown) => Array.isArray(value) && value.length <= 8 && value.every((entry) => isRecord(entry)
  && ["confirmed", "likely", "possible"].includes(String(entry.confidence))
  && boundedNonEmptyString(entry.title, 240)
  && boundedNonEmptyString(entry.explanation, 1_000)
  && Array.isArray(entry.evidence) && entry.evidence.length <= 5 && entry.evidence.every((item) => boundedString(item, 320))
  && (entry.recommendation === undefined || boundedString(entry.recommendation, 800)));

export const parseAgentEvent = (value: unknown): AgentEvent | null => {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "status": return boundedNonEmptyString(value.message, 1_000) ? value as AgentEvent : null;
    case "context": return Array.isArray(value.files) && value.files.length <= 12 && value.files.every((file) => isRecord(file) && boundedNonEmptyString(file.path, 260) && boundedNonEmptyString(file.reason, 500)) && boundedString(value.projectSummary, 1_200) ? value as AgentEvent : null;
    case "plan": return Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 12 && value.steps.every((step) => boundedNonEmptyString(step, 240)) ? value as AgentEvent : null;
    case "diagnosis": return isDiagnosisList(value.hypotheses) ? value as AgentEvent : null;
    case "tool_call": return toolNames.has(String(value.tool)) && boundedNonEmptyString(value.summary, 600) ? value as AgentEvent : null;
    case "tool_result": return toolNames.has(String(value.tool)) && typeof value.ok === "boolean" && boundedNonEmptyString(value.summary, 1_000) ? value as AgentEvent : null;
    case "patch_proposal": return isPatch(value.patch) ? value as AgentEvent : null;
    case "patch_review": return boundedNonEmptyString(value.patchId, 64) && isReviewList(value.findings) ? value as AgentEvent : null;
    case "review": return isReviewList(value.findings) ? value as AgentEvent : null;
    case "validation":
    case "execution": return validationCategories.has(String(value.category)) && typeof value.ok === "boolean" && boundedNonEmptyString(value.summary, 1_000) && (value.status === undefined || validationStatuses.has(String(value.status))) && (value.output === undefined || boundedString(value.output, 12_000)) ? value as AgentEvent : null;
    case "final": return boundedNonEmptyString(value.text, 12_000) ? value as AgentEvent : null;
    case "error": return boundedNonEmptyString(value.code, 120) && boundedNonEmptyString(value.message, 2_000) ? value as AgentEvent : null;
    default: return null;
  }
};
