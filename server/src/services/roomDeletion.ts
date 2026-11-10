import { agentStatePersistence } from "./agentStatePersistence";
import { roomPersistence } from "./roomPersistence";

/**
 * Removes a deleted room's durable data: the room snapshot and its AI state.
 * Call it right after `roomStore.deleteRoom`; the AI state is tombstoned
 * synchronously so writes that were already queued cannot bring it back.
 * Resolves false when the database could not be fully updated.
 */
export const deleteRoomDurably = async (roomId: string) => {
  const [room, agentState] = await Promise.all([roomPersistence.deleteRoom(roomId), agentStatePersistence.deleteRoom(roomId)]);
  return room && agentState;
};
