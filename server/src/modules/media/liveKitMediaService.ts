import { AccessToken, TrackSource, type VideoGrant } from "livekit-server-sdk";
import { env } from "../../config/env";
import { MediaUnavailableError, type MediaService, type MediaTokenRequest, type MediaTokenSession, type MediaProviderStatus } from "./mediaTypes";

const TOKEN_TTL_SECONDS = 15 * 60;
const roomNameFor = (roomId: string) => `code-collaborator-${roomId}`;

export class LiveKitMediaService implements MediaService {
  constructor(private readonly config = { url: env.livekitUrl, apiKey: env.livekitApiKey, apiSecret: env.livekitApiSecret }) {}

  getStatus(): MediaProviderStatus {
    return { provider: "livekit", configured: Boolean(this.config.url && this.config.apiKey && this.config.apiSecret), publicUrl: this.config.url || null };
  }

  async issueToken(request: MediaTokenRequest): Promise<MediaTokenSession> {
    const status = this.getStatus();
    if (!status.configured || !status.publicUrl) throw new MediaUnavailableError();
    const token = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: request.participant.userId,
      name: request.participant.username,
      metadata: JSON.stringify({ roomId: request.roomId, role: request.participant.role, identityKind: request.participant.identityKind }),
      ttl: TOKEN_TTL_SECONDS
    });
    const grant: VideoGrant = {
      room: roomNameFor(request.roomId),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
    };
    token.addGrant(grant);
    return { provider: "livekit", serverUrl: status.publicUrl, token: await token.toJwt(), expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1_000 };
  }
}

export const mediaService = new LiveKitMediaService();
