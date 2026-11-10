import { env, featureAvailability } from "../config/env";
import { roomStore } from "../modules/rooms/roomStore";
import { logSafeEvent } from "../utils/safeLogger";
import { roomPersistence } from "./roomPersistence";

/** Idle time used when the server is at room capacity and must reclaim memory now. */
export const EMERGENCY_IDLE_TTL_MS = 60 * 60_000;

/**
 * Evicts rooms nobody is connected to from memory. The final snapshot is
 * persisted first, so with persistence configured an evicted room reloads on
 * the next visit; without it, eviction is the same loss a restart would be.
 */
export const sweepIdleRooms = async (options: { ttlMs?: number; now?: number } = {}) => {
  const ttlMs = options.ttlMs ?? env.roomIdleTtlMs;
  const now = options.now ?? Date.now();
  let evicted = 0;
  for (const roomId of roomStore.listIdleRoomIds(ttlMs, now)) {
    try {
      await roomPersistence.saveRoom(roomStore.getRoomSnapshot(roomId));
    } catch {
      continue;
    }
    // Someone may have joined while the snapshot was being written.
    if (!roomStore.isRoomIdle(roomId, ttlMs, now)) continue;
    if (roomStore.evictRoom(roomId)) evicted += 1;
  }
  if (evicted > 0) {
    logSafeEvent("rooms", "idle_evicted", { evicted, remaining: roomStore.roomCount(), persistence: featureAvailability().persistence });
  }
  return evicted;
};

export const startRoomSweeper = () => {
  const timer = setInterval(() => { void sweepIdleRooms(); }, env.roomSweepIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
};
