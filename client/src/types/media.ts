import type { Track } from "livekit-client";

export type MediaConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
export type MediaPermissionState = "unknown" | "granted" | "denied" | "unavailable" | "unsupported";
export type MediaDeviceKind = "audioinput" | "videoinput" | "audiooutput";

export interface MediaDevice {
  id: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface MediaParticipant {
  identity: string;
  displayName: string;
  isLocal: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  isSpeaking: boolean;
  connectionQuality: "excellent" | "good" | "poor" | "lost" | "unknown";
  cameraTrack: Track | null;
  screenTrack: Track | null;
  audioTrack: Track | null;
}

export interface MediaSessionResponse {
  provider: "livekit";
  serverUrl: string;
  token: string;
  expiresAt: number;
}

export interface MediaStateSnapshot {
  connectionState: MediaConnectionState;
  participants: MediaParticipant[];
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  audioPlaybackBlocked: boolean;
  devices: MediaDevice[];
  selectedDevices: Partial<Record<MediaDeviceKind, string>>;
  permissions: { microphone: MediaPermissionState; camera: MediaPermissionState; screenShare: MediaPermissionState };
}

export interface MediaParticipantStatus {
  inCall: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  isSpeaking: boolean;
}
