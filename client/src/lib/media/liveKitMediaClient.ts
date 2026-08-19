import { ConnectionState, Room, RoomEvent, Track, type Participant } from "livekit-client";
import type { MediaConnectionState, MediaDevice, MediaDeviceKind, MediaParticipant, MediaSessionResponse, MediaStateSnapshot } from "../../types/media";
import { mediaErrorMessage, mediaPermissionForError } from "./mediaErrors";

type Update = (snapshot: MediaStateSnapshot, error?: string | null) => void;
const initialSnapshot = (): MediaStateSnapshot => ({ connectionState: "disconnected", participants: [], microphoneEnabled: false, cameraEnabled: false, screenShareEnabled: false, audioPlaybackBlocked: false, devices: [], selectedDevices: {}, permissions: { microphone: "unknown", camera: "unknown", screenShare: "unknown" } });

const connectionStateFor = (state: ConnectionState): MediaConnectionState => {
  if (state === ConnectionState.Connected) return "connected";
  if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) return "reconnecting";
  if (state === ConnectionState.Connecting) return "connecting";
  return "disconnected";
};

const trackFor = (participant: Participant, source: Track.Source) => participant.getTrackPublication(source)?.track ?? null;

export class LiveKitMediaClient {
  private room: Room | null = null;
  private snapshot = initialSnapshot();
  private leaving = false;
  private endedLocalSources = new Set<Track.Source>();

  constructor(private readonly onUpdate: Update) {}

  getSnapshot = () => this.snapshot;
  private publish(error?: string | null) { this.onUpdate(this.snapshot, error); }
  private mapParticipant(participant: Participant): MediaParticipant {
    const sourceIsActive = (source: Track.Source, enabled: boolean) => enabled && (!participant.isLocal || !this.endedLocalSources.has(source));
    return {
      identity: participant.identity,
      displayName: participant.name || participant.identity,
      isLocal: participant.isLocal,
      microphoneEnabled: sourceIsActive(Track.Source.Microphone, participant.isMicrophoneEnabled),
      cameraEnabled: sourceIsActive(Track.Source.Camera, participant.isCameraEnabled),
      screenShareEnabled: sourceIsActive(Track.Source.ScreenShare, participant.isScreenShareEnabled),
      isSpeaking: participant.isSpeaking,
      connectionQuality: participant.connectionQuality,
      cameraTrack: trackFor(participant, Track.Source.Camera),
      screenTrack: trackFor(participant, Track.Source.ScreenShare),
      audioTrack: trackFor(participant, Track.Source.Microphone)
    };
  }
  private sync = (error?: string | null) => {
    const room = this.room;
    if (!room) { this.snapshot = initialSnapshot(); this.publish(error); return; }
    const local = room.localParticipant;
    this.snapshot = {
      ...this.snapshot,
      connectionState: connectionStateFor(room.state),
      participants: [this.mapParticipant(local), ...Array.from(room.remoteParticipants.values()).map((participant) => this.mapParticipant(participant))],
      microphoneEnabled: this.mapParticipant(local).microphoneEnabled,
      cameraEnabled: this.mapParticipant(local).cameraEnabled,
      screenShareEnabled: this.mapParticipant(local).screenShareEnabled,
      audioPlaybackBlocked: !room.canPlaybackAudio
    };
    this.publish(error);
  };
  private bind(room: Room) {
    const update = () => this.sync();
    [RoomEvent.Connected, RoomEvent.Reconnected, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnpublished, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.ActiveDeviceChanged].forEach((event) => room.on(event, update));
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      this.endedLocalSources.delete(publication.source);
      publication.track?.mediaStreamTrack.addEventListener("ended", () => {
        if (this.room !== room) return;
        this.endedLocalSources.add(publication.source);
        this.sync();
      }, { once: true });
      this.sync();
    });
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      this.endedLocalSources.add(publication.source);
      this.sync();
    });
    room.on(RoomEvent.Reconnecting, () => { this.snapshot = { ...this.snapshot, connectionState: "reconnecting" }; this.publish(); });
    room.on(RoomEvent.SignalReconnecting, () => { this.snapshot = { ...this.snapshot, connectionState: "reconnecting" }; this.publish(); });
    room.on(RoomEvent.ConnectionStateChanged, update);
    room.on(RoomEvent.MediaDevicesChanged, () => { void this.refreshDevices(); });
    room.on(RoomEvent.AudioPlaybackStatusChanged, update);
    room.on(RoomEvent.MediaDevicesError, (error, kind) => {
      const key = kind === "videoinput" ? "camera" : kind === "audioinput" ? "microphone" : "media";
      this.snapshot = { ...this.snapshot, permissions: { ...this.snapshot.permissions, [key]: mediaPermissionForError(error) } };
      this.publish(mediaErrorMessage(error, key));
    });
    room.on(RoomEvent.Disconnected, () => {
      const message = this.leaving ? null : "Call disconnected. You can rejoin without leaving the coding room.";
      if (this.room !== room) return;
      room.removeAllListeners(); this.room = null; this.endedLocalSources.clear(); this.snapshot = { ...initialSnapshot(), connectionState: this.leaving ? "disconnected" : "failed" }; this.publish(message);
    });
  }
  async connect(session: MediaSessionResponse) {
    if (this.room && this.snapshot.connectionState !== "failed") return;
    this.leaving = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room; this.snapshot = { ...initialSnapshot(), connectionState: "connecting" }; this.bind(room); this.publish();
    try {
      await room.connect(session.serverUrl, session.token);
      await this.refreshDevices();
      this.sync();
    } catch (error) {
      room.removeAllListeners(); await room.disconnect(true).catch(() => undefined);
      if (this.room === room) { this.room = null; this.endedLocalSources.clear(); this.snapshot = { ...initialSnapshot(), connectionState: "failed" }; this.publish(mediaErrorMessage(error, "call")); }
      throw error;
    }
  }
  async disconnect() {
    const room = this.room; this.leaving = true;
    if (room) { room.removeAllListeners(); await room.disconnect(true).catch(() => undefined); }
    this.room = null; this.endedLocalSources.clear(); this.snapshot = initialSnapshot(); this.publish(); this.leaving = false;
  }
  private requireRoom() { if (!this.room || this.snapshot.connectionState !== "connected") throw new Error("Join the call before changing media devices."); return this.room; }
  async setMicrophoneEnabled(enabled: boolean) {
    const room = this.requireRoom();
    try { await room.localParticipant.setMicrophoneEnabled(enabled, this.snapshot.selectedDevices.audioinput ? { deviceId: this.snapshot.selectedDevices.audioinput } : undefined); this.snapshot = { ...this.snapshot, permissions: { ...this.snapshot.permissions, microphone: "granted" } }; this.sync(); }
    catch (error) { this.snapshot = { ...this.snapshot, permissions: { ...this.snapshot.permissions, microphone: mediaPermissionForError(error) } }; this.sync(mediaErrorMessage(error, "microphone")); throw error; }
  }
  async setCameraEnabled(enabled: boolean) {
    const room = this.requireRoom();
    try { await room.localParticipant.setCameraEnabled(enabled, this.snapshot.selectedDevices.videoinput ? { deviceId: this.snapshot.selectedDevices.videoinput } : undefined); this.snapshot = { ...this.snapshot, permissions: { ...this.snapshot.permissions, camera: "granted" } }; this.sync(); }
    catch (error) { this.snapshot = { ...this.snapshot, permissions: { ...this.snapshot.permissions, camera: mediaPermissionForError(error) } }; this.sync(mediaErrorMessage(error, "camera")); throw error; }
  }
  async setScreenShareEnabled(enabled: boolean) {
    const room = this.requireRoom();
    try {
      const publication = await room.localParticipant.setScreenShareEnabled(enabled);
      if (enabled && publication?.track) publication.track.mediaStreamTrack.addEventListener("ended", () => {
        if (this.room !== room) return;
        this.endedLocalSources.add(Track.Source.ScreenShare);
        this.sync();
      }, { once: true });
      if (enabled) this.snapshot = { ...this.snapshot, permissions: { ...this.snapshot.permissions, screenShare: "granted" } };
      this.sync();
    } catch (error) { this.snapshot = { ...this.snapshot, permissions: { ...this.snapshot.permissions, screenShare: mediaPermissionForError(error) } }; this.sync(mediaErrorMessage(error, "screen sharing")); throw error; }
  }
  async refreshDevices() {
    const devices = (await Promise.all((["audioinput", "videoinput", "audiooutput"] as MediaDeviceKind[]).map(async (kind) => {
      try { return await Room.getLocalDevices(kind, false); } catch { return []; }
    }))).flat().map((device, index): MediaDevice => ({ id: device.deviceId, kind: device.kind as MediaDeviceKind, label: device.label || `${device.kind === "videoinput" ? "Camera" : device.kind === "audiooutput" ? "Speaker" : "Microphone"} ${index + 1}` }));
    const room = this.room;
    const previous = this.snapshot.selectedDevices;
    const selectedDevices = room ? { audioinput: room.getActiveDevice("audioinput"), videoinput: room.getActiveDevice("videoinput"), audiooutput: room.getActiveDevice("audiooutput") } : previous;
    const unavailable = (Object.keys(previous) as MediaDeviceKind[]).find((kind) => previous[kind] && !devices.some((device) => device.kind === kind && device.id === previous[kind]));
    if (unavailable) selectedDevices[unavailable] = "";
    this.snapshot = { ...this.snapshot, devices, selectedDevices };
    this.publish(unavailable ? "Your selected device is no longer available. The system default will be used." : null);
  }
  async selectDevice(kind: MediaDeviceKind, deviceId: string) {
    const room = this.requireRoom();
    try {
      if (!(await room.switchActiveDevice(kind, deviceId, true))) throw new Error("Device switch was not accepted.");
      await this.refreshDevices(); this.sync();
    } catch (error) { this.publish(mediaErrorMessage(error, kind === "videoinput" ? "camera" : kind === "audioinput" ? "microphone" : "speaker")); throw error; }
  }
  async enableAudio() { const room = this.requireRoom(); await room.startAudio(); this.sync(); }
}
