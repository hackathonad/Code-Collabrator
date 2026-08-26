import type { RoomSnapshot } from "../rooms/roomTypes";
import type { AgentPatch } from "./agentTypes";

export interface AgentWorkspaceChange {
  roomId: string;
  userId: string;
  fileId: string;
  snapshot: RoomSnapshot;
  patch: AgentPatch;
}

const listeners = new Set<(change: AgentWorkspaceChange) => void>();

export const subscribeAgentWorkspaceChange = (listener: (change: AgentWorkspaceChange) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const emitAgentWorkspaceChange = (change: AgentWorkspaceChange) => {
  for (const listener of listeners) listener(change);
};
