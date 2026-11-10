import { markAgentProposalsStale } from "../agent/agentEvents";
import { agentStatePersistence } from "../../services/agentStatePersistence";
import { roomPersistence } from "../../services/roomPersistence";
import { roomStore } from "./roomStore";

const inflight = new Map<string, Promise<boolean>>();

/**
 * Makes sure a room is resident in memory, hydrating it from persistence when
 * needed. This is the single loader for REST routes and sockets.
 *
 * Concurrent callers share one load, and a room that became resident while the
 * database read was in flight is never overwritten by the older stored copy.
 */
export const loadRoomIfNeeded = (roomId: string): Promise<boolean> => {
  if (roomStore.hasRoom(roomId)) return Promise.resolve(true);
  const pending = inflight.get(roomId);
  if (pending) return pending;

  const load = (async () => {
    try {
      const persisted = await roomPersistence.loadRoom(roomId);
      if (roomStore.hasRoom(roomId)) return true;
      if (!persisted) return false;
      // Bring back the room's AI tasks, proposals and memory BEFORE the room becomes
      // visible, so no request sees a half-restored room. This never throws and never
      // overwrites live state; a failure only means the room starts without AI history.
      await agentStatePersistence.hydrate(roomId);
      if (roomStore.hasRoom(roomId)) return true;
      roomStore.upsertRoomSnapshot(persisted);
      // A proposal whose base version is older than the room can no longer apply. The
      // stale marking may not have been written before the last shutdown, so redo it.
      markAgentProposalsStale(roomId, persisted.version);
      return true;
    } finally {
      inflight.delete(roomId);
    }
  })();
  inflight.set(roomId, load);
  return load;
};
