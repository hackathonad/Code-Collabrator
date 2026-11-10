import type { RoomSnapshot } from "../rooms/roomTypes";
import type { AgentPatch, AgentPatchFile, AgentProposalEvent, AgentProposalPublic, AgentReviewFinding } from "./agentTypes";
import { updateAgentTask } from "./agentTaskHistory";
import { logSafeEvent } from "../../utils/safeLogger";
import { recordAgentMemory } from "./agentMemory";
import { containsSensitiveContent } from "./agentSecurity";

export interface AgentWorkspaceChange {
  roomId: string;
  userId: string;
  fileId: string;
  snapshot: RoomSnapshot;
  patch: AgentPatch;
}

export interface StoredProposal {
  patch: AgentPatch;
  userId: string;
  status: AgentProposalEvent["type"];
}

const listeners = new Set<(change: AgentWorkspaceChange) => void>();
const proposalListeners = new Set<(event: AgentProposalEvent) => void>();
const proposals = new Map<string, StoredProposal>();
const proposalTransitions: Record<StoredProposal["status"], StoredProposal["status"][]> = {
  proposal_created: ["proposal_approved", "proposal_rejected", "proposal_stale"],
  proposal_approved: ["proposal_applied", "proposal_stale"],
  proposal_rejected: [],
  proposal_stale: [],
  proposal_applied: []
};

const proposalEvent = (type: AgentProposalEvent["type"], stored: StoredProposal, currentVersion?: number, changedBy?: string): AgentProposalEvent => ({
  type,
  roomId: stored.patch.roomId,
  userId: stored.userId,
  patchId: stored.patch.patchId,
  fileId: stored.patch.fileId,
  path: stored.patch.path,
  baseVersion: stored.patch.baseVersion,
  ...(currentVersion === undefined ? {} : { currentVersion }),
  ...(changedBy ? { changedBy: changedBy.slice(0, 128) } : {}),
  additions: stored.patch.additions,
  deletions: stored.patch.deletions
});

export const subscribeAgentWorkspaceChange = (listener: (change: AgentWorkspaceChange) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const emitAgentWorkspaceChange = (change: AgentWorkspaceChange) => {
  for (const listener of listeners) listener(change);
};

export const subscribeAgentProposal = (listener: (event: AgentProposalEvent) => void) => {
  proposalListeners.add(listener);
  return () => proposalListeners.delete(listener);
};

export const emitAgentProposal = (event: AgentProposalEvent) => {
  for (const listener of proposalListeners) listener(event);
};

export const registerAgentProposal = (patch: AgentPatch, userId: string) => {
  if (proposals.has(patch.patchId)) return false;
  proposals.set(patch.patchId, { patch, userId, status: "proposal_created" });
  logSafeEvent("agent", "patch_proposal", { roomId: patch.roomId, patchId: patch.patchId, path: patch.path, status: "proposal_created" });
  emitAgentProposal(proposalEvent("proposal_created", proposals.get(patch.patchId)!));
  if (proposals.size > 2_000) {
    const oldest = proposals.keys().next().value;
    if (oldest) proposals.delete(oldest);
  }
  return true;
};

export const getAgentProposal = (patchId: string) => proposals.get(patchId) ?? null;

export const getPublicAgentProposalHistory = (roomId: string, limit = 40) => [...proposals.values()]
  .filter((stored) => stored.patch.roomId === roomId)
  .slice(-Math.min(40, Math.max(1, limit)))
  .map((stored) => proposalEvent(stored.status, stored));

const publicProposal = (stored: StoredProposal): AgentProposalPublic => ({
  patchId: stored.patch.patchId,
  ...(stored.patch.taskId ? { taskId: stored.patch.taskId } : {}),
  roomId: stored.patch.roomId,
  workspaceId: stored.patch.workspaceId,
  fileId: stored.patch.fileId,
  path: stored.patch.path,
  baseVersion: stored.patch.baseVersion,
  additions: stored.patch.additions,
  deletions: stored.patch.deletions,
  preview: containsSensitiveContent(stored.patch.preview) ? "[redacted sensitive preview]" : stored.patch.preview.slice(0, 8_000),
  applied: stored.status === "proposal_applied",
  status: stored.status === "proposal_created" ? "pending" : stored.status === "proposal_approved" ? "approved" : stored.status === "proposal_rejected" ? "rejected" : stored.status === "proposal_stale" ? "stale" : "applied",
  files: (stored.patch.files ?? [{ fileId: stored.patch.fileId, path: stored.patch.path, additions: stored.patch.additions, deletions: stored.patch.deletions }]).map((file) => ({ fileId: file.fileId, path: file.path, additions: file.additions, deletions: file.deletions })),
  ...(stored.patch.review?.length ? { review: stored.patch.review } : {})
});

export const getPublicAgentProposalState = (roomId: string, limit = 20) => [...proposals.values()]
  .filter((stored) => stored.patch.roomId === roomId)
  .slice(-Math.min(20, Math.max(1, limit)))
  .map(publicProposal);

export const clearAgentProposals = (roomId: string) => {
  for (const [patchId, stored] of proposals) if (stored.patch.roomId === roomId) proposals.delete(patchId);
};

export const updateAgentProposal = (patchId: string, type: Exclude<AgentProposalEvent["type"], "proposal_created">, currentVersion?: number, changedBy?: string) => {
  const stored = proposals.get(patchId);
  if (!stored) return null;
  if (stored.status === type) return null;
  if (!proposalTransitions[stored.status].includes(type)) return null;
  stored.status = type;
  recordAgentMemory(stored.patch.roomId, "patchDecisions", `Patch ${type.replace("proposal_", "")}: ${stored.patch.path}`, stored.patch.taskId);
  logSafeEvent("agent", type, { roomId: stored.patch.roomId, patchId, path: stored.patch.path, currentVersion });
  const event = proposalEvent(type, stored, currentVersion, changedBy);
  emitAgentProposal(event);
  return event;
};

export const markAgentProposalsStale = (roomId: string, currentVersion: number) => {
  const events: AgentProposalEvent[] = [];
  for (const stored of proposals.values()) {
    if (stored.patch.roomId !== roomId || stored.status !== "proposal_created" || stored.patch.baseVersion >= currentVersion) continue;
    stored.status = "proposal_stale";
    recordAgentMemory(roomId, "patchDecisions", `Patch stale: ${stored.patch.path}`, stored.patch.taskId);
    logSafeEvent("agent", "proposal_stale", { roomId, patchId: stored.patch.patchId, path: stored.patch.path, currentVersion });
    if (stored.patch.taskId) updateAgentTask(stored.patch.taskId, { status: "conflict", patchStatus: "stale" });
    const event = proposalEvent("proposal_stale", stored, currentVersion);
    events.push(event);
    emitAgentProposal(event);
  }
  return events;
};

const PROPOSAL_STATUSES = new Set<StoredProposal["status"]>(["proposal_created", "proposal_approved", "proposal_rejected", "proposal_stale", "proposal_applied"]);
const text = (value: unknown, limit: number) => (typeof value === "string" && value.length <= limit ? value : null);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

const parsePatchFile = (value: unknown): AgentPatchFile | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const fileId = text(raw.fileId, 128); const path = text(raw.path, 260); const expectedContent = text(raw.expectedContent, 500_000); const replacement = text(raw.replacement, 500_000);
  if (!fileId || !path || expectedContent === null || replacement === null) return null;
  return { fileId, path, expectedContent, replacement, additions: count(raw.additions), deletions: count(raw.deletions), preview: text(raw.preview, 12_000) ?? "" };
};

const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
const parseFinding = (value: unknown): AgentReviewFinding | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title, 240); const explanation = text(raw.explanation, 1_000);
  if (!title || !explanation || !SEVERITIES.has(raw.severity as string)) return null;
  return { severity: raw.severity as AgentReviewFinding["severity"], title, explanation, ...(text(raw.file, 260) ? { file: raw.file as string } : {}), ...(Number.isInteger(raw.line) ? { line: raw.line as number } : {}), ...(Number.isInteger(raw.column) ? { column: raw.column as number } : {}), ...(text(raw.suggestion, 800) ? { suggestion: raw.suggestion as string } : {}) };
};

const parseStoredProposal = (value: unknown, roomId: string): StoredProposal | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as Record<string, unknown>;
  const raw = outer.patch && typeof outer.patch === "object" && !Array.isArray(outer.patch) ? outer.patch as Record<string, unknown> : null;
  if (!raw || raw.roomId !== roomId || typeof outer.userId !== "string" || !PROPOSAL_STATUSES.has(outer.status as StoredProposal["status"])) return null;
  const patchId = text(raw.patchId, 64); const workspaceId = text(raw.workspaceId, 128); const fileId = text(raw.fileId, 128); const path = text(raw.path, 260);
  const expectedContent = text(raw.expectedContent, 500_000); const replacement = text(raw.replacement, 500_000);
  if (!patchId || !workspaceId || !fileId || !path || expectedContent === null || replacement === null || !Number.isInteger(raw.baseVersion) || (raw.baseVersion as number) < 1) return null;
  const files = Array.isArray(raw.files) ? raw.files.slice(0, 10).flatMap((file) => { const parsed = parsePatchFile(file); return parsed ? [parsed] : []; }) : [];
  const review = Array.isArray(raw.review) ? raw.review.slice(0, 30).flatMap((finding) => { const parsed = parseFinding(finding); return parsed ? [parsed] : []; }) : [];
  const patch: AgentPatch = {
    patchId, ...(text(raw.taskId, 128) ? { taskId: raw.taskId as string } : {}), roomId, workspaceId, fileId, path, baseVersion: raw.baseVersion as number, expectedContent, replacement,
    additions: count(raw.additions), deletions: count(raw.deletions), preview: text(raw.preview, 12_000) ?? "", applied: outer.status === "proposal_applied", status: raw.status as AgentPatch["status"] ?? "pending",
    ...(files.length ? { files } : {}), ...(review.length ? { review } : {})
  };
  return { patch, userId: outer.userId.slice(0, 128), status: outer.status as StoredProposal["status"] };
};

/**
 * Restores proposals loaded from durable storage (oldest first) without
 * emitting events. A proposal that was approved but never reported as applied
 * is marked stale, because the server cannot know whether the apply finished.
 * Live in-memory proposals for the room are never overwritten.
 */
export const hydrateAgentProposals = (roomId: string, raw: unknown[]): number => {
  for (const stored of proposals.values()) if (stored.patch.roomId === roomId) return 0;
  let restored = 0;
  for (const entry of raw) {
    const stored = parseStoredProposal(entry, roomId);
    if (!stored || proposals.has(stored.patch.patchId)) continue;
    if (stored.status === "proposal_approved") stored.status = "proposal_stale";
    proposals.set(stored.patch.patchId, stored);
    restored += 1;
  }
  return restored;
};
