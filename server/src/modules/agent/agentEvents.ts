import type { RoomSnapshot } from "../rooms/roomTypes";
import type { AgentPatch, AgentProposalEvent } from "./agentTypes";
import { updateAgentTask } from "./agentTaskHistory";

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

export const clearAgentProposals = (roomId: string) => {
  for (const [patchId, stored] of proposals) if (stored.patch.roomId === roomId) proposals.delete(patchId);
};

export const updateAgentProposal = (patchId: string, type: Exclude<AgentProposalEvent["type"], "proposal_created">, currentVersion?: number) => {
  const stored = proposals.get(patchId);
  if (!stored) return null;
  if (stored.status === type) return null;
  stored.status = type;
  const event = proposalEvent(type, stored, currentVersion);
  emitAgentProposal(event);
  return event;
};

export const markAgentProposalsStale = (roomId: string, currentVersion: number) => {
  const events: AgentProposalEvent[] = [];
  for (const stored of proposals.values()) {
    if (stored.patch.roomId !== roomId || stored.status !== "proposal_created" || stored.patch.baseVersion >= currentVersion) continue;
    stored.status = "proposal_stale";
    if (stored.patch.taskId) updateAgentTask(stored.patch.taskId, { status: "conflict", patchStatus: "stale" });
    const event = proposalEvent("proposal_stale", stored, currentVersion);
    events.push(event);
    emitAgentProposal(event);
  }
  return events;
};
