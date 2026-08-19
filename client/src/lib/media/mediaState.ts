import type { MediaParticipant, MediaParticipantStatus, MediaStateSnapshot } from "../../types/media";

export const emptyMediaState = (): MediaStateSnapshot => ({ connectionState: "disconnected", participants: [], microphoneEnabled: false, cameraEnabled: false, screenShareEnabled: false, audioPlaybackBlocked: false, devices: [], selectedDevices: {}, permissions: { microphone: "unknown", camera: "unknown", screenShare: "unknown" } });

export const mediaStatusFor = (participants: MediaParticipant[], identity: string): MediaParticipantStatus | null => {
  const participant = participants.find((entry) => entry.identity === identity);
  return participant ? { inCall: true, microphoneEnabled: participant.microphoneEnabled, cameraEnabled: participant.cameraEnabled, screenShareEnabled: participant.screenShareEnabled, isSpeaking: participant.isSpeaking } : null;
};

export const canChangeMedia = (state: MediaStateSnapshot["connectionState"]) => state === "connected";
