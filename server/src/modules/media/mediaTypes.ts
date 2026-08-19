import type { RoomRole } from "../rooms/roomTypes";

export type MediaProviderId = "livekit";

export interface MediaProviderStatus {
  provider: MediaProviderId;
  configured: boolean;
  publicUrl: string | null;
}

export interface MediaTokenRequest {
  roomId: string;
  participant: { userId: string; username: string; role: RoomRole; identityKind: "guest" | "member" };
}

export interface MediaTokenSession {
  provider: MediaProviderId;
  serverUrl: string;
  token: string;
  expiresAt: number;
}

export interface MediaService {
  getStatus(): MediaProviderStatus;
  issueToken(request: MediaTokenRequest): Promise<MediaTokenSession>;
}

export class MediaUnavailableError extends Error {
  constructor(message = "Voice and video are not configured on this server.") {
    super(message);
    this.name = "MediaUnavailableError";
  }
}
