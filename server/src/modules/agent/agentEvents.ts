import type { RoomSnapshot } from "../rooms/roomTypes";
import type { AgentPatch, AgentProposalEvent, AgentProposalPublic } from "./agentTypes";
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

interface StoredProposal {
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

const proposalEvent = (type: AgentProposalEvent["type"], stored: StoredProposal, currentVersion?: number): AgentProposalEvent => ({
  type,
  roomId: stored.patch.roomId,
  userId: stored.userId,
  patchId: stored.patch.patchId,
  fileId: stored.patch.fileId,
  path: stored.patch.path,
  baseVersion: stored.patch.baseVersion,
  ...(currentVersion === undefined ? {} : { currentVersion }),
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

export const updateAgentProposal = (patchId: string, type: Exclude<AgentProposalEvent["type"], "proposal_created">, currentVersion?: number) => {
  const stored = proposals.get(patchId);
  if (!stored) return null;
  if (stored.status === type) return null;
  if (!proposalTransitions[stored.status].includes(type)) return null;
  stored.status = type;
  recordAgentMemory(stored.patch.roomId, "patchDecisions", `Patch ${type.replace("proposal_", "")}: ${stored.patch.path}`, stored.patch.taskId);
  logSafeEvent("agent", type, { roomId: stored.patch.roomId, patchId, path: stored.patch.path, currentVersion });
  const event = proposalEvent(type, stored, currentVersion);
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
