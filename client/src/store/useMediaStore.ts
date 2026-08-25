import { create } from "zustand";
import { api } from "../lib/api";
import { emptyMediaState, mediaStatusFor } from "../lib/media/mediaState";
import type { LiveKitMediaClient } from "../lib/media/liveKitMediaClient";
import type { MediaDeviceKind, MediaParticipantStatus, MediaStateSnapshot } from "../types/media";
import type { UserSession } from "../types/collaboration";

let updateStore: ((snapshot: MediaStateSnapshot, error?: string | null) => void) | null = null;
let client: LiveKitMediaClient | null = null;
const getClient = async () => {
  if (!client) {
    const { LiveKitMediaClient } = await import("../lib/media/liveKitMediaClient");
    client = new LiveKitMediaClient((snapshot, error) => updateStore?.(snapshot, error));
  }
  return client;
};

interface MediaStoreState extends MediaStateSnapshot {
  configured: boolean | null;
  loadingConfiguration: boolean;
  error: string | null;
  refreshConfiguration: () => Promise<void>;
  join: (roomId: string, session: UserSession) => Promise<void>;
  leave: () => Promise<void>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  setScreenShareEnabled: (enabled: boolean) => Promise<void>;
  selectDevice: (kind: MediaDeviceKind, id: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
  enableAudio: () => Promise<void>;
  participantStatus: (identity: string) => MediaParticipantStatus | null;
}

const applySnapshot = (set: (state: Partial<MediaStoreState>) => void, snapshot: MediaStateSnapshot, error?: string | null) => set({ ...snapshot, error: error ?? null });

export const useMediaStore = create<MediaStoreState>((set, get) => {
  updateStore = (snapshot, error) => applySnapshot(set, snapshot, error);
  const run = async (operation: () => Promise<void>) => { try { await operation(); } catch { /* Provider callbacks retain a safe user-facing error. */ } };
  return {
    ...emptyMediaState(), configured: null, loadingConfiguration: false, error: null,
    refreshConfiguration: async () => {
      set({ loadingConfiguration: true });
      try { const status = await api.getMediaStatus(); set({ configured: status.configured, loadingConfiguration: false }); }
      catch { set({ configured: false, loadingConfiguration: false, error: "Voice and video setup is unavailable. Coding collaboration still works." }); }
    },
    join: async (roomId, session) => {
      if (get().connectionState === "connecting" || get().connectionState === "connected" || get().connectionState === "reconnecting") return;
      set({ connectionState: "connecting", error: null });
      try { const mediaSession = await api.createMediaSession(roomId, session); await (await getClient()).connect(mediaSession); }
      catch (error) { set({ ...emptyMediaState(), connectionState: "failed", error: error instanceof Error ? error.message : "Unable to join the call." }); }
    },
    leave: async () => { if (client) await client.disconnect(); else set(emptyMediaState()); },
    setMicrophoneEnabled: async (enabled) => run(async () => (await getClient()).setMicrophoneEnabled(enabled)),
    setCameraEnabled: async (enabled) => run(async () => (await getClient()).setCameraEnabled(enabled)),
    setScreenShareEnabled: async (enabled) => run(async () => (await getClient()).setScreenShareEnabled(enabled)),
    selectDevice: async (kind, id) => run(async () => (await getClient()).selectDevice(kind, id)),
    refreshDevices: async () => run(async () => { if (client) await client.refreshDevices(); }),
    enableAudio: async () => run(async () => (await getClient()).enableAudio()),
    participantStatus: (identity) => {
      return mediaStatusFor(get().participants, identity);
    }
  };
});
