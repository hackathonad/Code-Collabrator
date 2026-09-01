import { AlertCircle, Camera, CameraOff, ChevronDown, Headphones, LoaderCircle, Mic, MicOff, MonitorUp, Phone, PhoneOff, RefreshCw, Settings2, Signal, Users, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UserSession } from "../../types/collaboration";
import { useMediaStore } from "../../store/useMediaStore";
import type { MediaDeviceKind } from "../../types/media";
import { MediaTile } from "./MediaTile";

const initialsFor = (name: string) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";

const DevicePicker = ({ kind, label }: { kind: MediaDeviceKind; label: string }) => {
  const devices = useMediaStore((state) => state.devices.filter((device) => device.kind === kind));
  const selected = useMediaStore((state) => state.selectedDevices[kind] ?? "");
  const selectDevice = useMediaStore((state) => state.selectDevice);
  if (!devices.length) return null;
  return <label className="block text-xs text-[var(--text-muted)]">{label}<select value={selected} onChange={(event) => void selectDevice(kind, event.target.value)} className="theme-input mt-1 w-full rounded-lg border px-2 py-1.5 text-xs"><option value="">System default</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>;
};

export const MediaCallPanel = ({ roomId, session, onClose }: { roomId: string; session: UserSession; onClose: () => void }) => {
  const state = useMediaStore();
  const refreshConfiguration = useMediaStore((mediaState) => mediaState.refreshConfiguration);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusedShare, setFocusedShare] = useState<string | null>(null);
  const connected = state.connectionState === "connected" || state.connectionState === "reconnecting";
  const connecting = state.connectionState === "connecting";
  const screenShares = state.participants.filter((participant) => participant.screenShareEnabled && participant.screenTrack);
  const featured = screenShares.find((participant) => participant.identity === focusedShare) ?? screenShares[0] ?? null;
  const tiles = useMemo(() => state.participants.filter((participant) => participant.identity !== featured?.identity), [state.participants, featured?.identity]);

  useEffect(() => { void refreshConfiguration(); }, [refreshConfiguration, roomId]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const join = () => void state.join(roomId, session);

  return (
    <aside className="theme-panel-solid flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--glass)] backdrop-blur-xl" aria-label="Voice and video call">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]"><Phone className="h-4 w-4" /></div><div className="min-w-0"><p className="font-display text-sm font-semibold text-[var(--text-primary)]">Room call</p><p className="truncate text-[11px] text-[var(--text-faint)]">Audio and video for this workspace</p></div></div>
        <button type="button" onClick={onClose} className="theme-button-neutral rounded-lg border p-2" aria-label="Close call panel" title="Close call panel"><X className="h-4 w-4" /></button>
      </header>

      {!connected ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/12 text-[var(--accent)]"><Phone className="h-7 w-7" /></div>
          <p className="mt-4 font-display text-base font-semibold text-[var(--text-primary)]">{state.configured === false ? "Call service is not configured" : connecting ? "Connecting to the call…" : state.connectionState === "failed" ? "Call disconnected" : "Join the room call"}</p>
          <p className="mt-1 max-w-xs text-xs leading-5 text-[var(--text-muted)]">Join when you’re ready. Your microphone and camera stay off until you enable them.</p>
          {state.error ? <p role="status" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{state.error}</p> : null}
          <button type="button" disabled={connecting || state.configured === false || state.loadingConfiguration} onClick={join} className="theme-button-primary mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-45">{connecting || state.loadingConfiguration ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}{connecting ? "Connecting…" : state.connectionState === "failed" ? "Rejoin call" : "Join call"}</button>
          {state.configured === false ? <button type="button" onClick={() => void state.refreshConfiguration()} className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"><RefreshCw className="h-3.5 w-3.5" />Check setup again</button> : null}
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--badge-bg)] p-3">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]"><Users className="h-3.5 w-3.5 text-[var(--accent)]" />Participants</div><span className="text-[10px] text-[var(--text-faint)]">{state.participants.length} in call</span></div>
              <div className="mt-3 flex flex-wrap gap-2">{state.participants.slice(0, 8).map((participant) => <div key={participant.identity} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-bg)] px-2 py-1.5" title={participant.displayName}><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${participant.isSpeaking ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/60" : "bg-[var(--accent)]/12 text-[var(--text-primary)]"}`}>{initialsFor(participant.displayName)}</div><div className="min-w-0"><p className="max-w-24 truncate text-[11px] font-medium text-[var(--text-secondary)]">{participant.displayName}{participant.isLocal ? " · You" : ""}</p><p className="flex items-center gap-1 text-[10px] text-[var(--text-faint)]">{participant.isSpeaking ? <Signal className="h-3 w-3 text-emerald-300" /> : null}{participant.microphoneEnabled ? "Mic on" : "Muted"}</p></div></div>)}{state.participants.length > 8 ? <span className="self-center text-[10px] text-[var(--text-faint)]">+{state.participants.length - 8} more</span> : null}</div>
            </div>

            <div className="mb-3 flex items-center justify-between gap-2"><span role="status" className={`text-xs ${state.connectionState === "reconnecting" ? "text-amber-300" : "text-emerald-400"}`}>{state.connectionState === "reconnecting" ? "Reconnecting…" : "Connected"}</span>{state.screenShareEnabled ? <span className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-[10px] font-semibold text-sky-100">You are sharing</span> : null}</div>
            {state.error ? <p role="status" className="mb-3 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"><AlertCircle className="h-4 w-4 shrink-0" />{state.error}</p> : null}
            {state.audioPlaybackBlocked ? <button type="button" onClick={() => void state.enableAudio()} className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--badge-bg)] px-3 py-2 text-xs text-[var(--text-primary)]"><Volume2 className="h-4 w-4" />Enable remote audio</button> : null}
            {featured ? <div className="mb-3"><MediaTile participant={featured} featured /><div className="mt-2 flex flex-wrap gap-1">{screenShares.map((share) => <button key={share.identity} type="button" onClick={() => setFocusedShare(share.identity)} className={`rounded-md border px-2 py-1 text-[10px] ${share.identity === featured.identity ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>{share.displayName}'s screen</button>)}</div></div> : null}
            <div className="grid grid-cols-2 gap-2">{tiles.map((participant) => <MediaTile key={participant.identity} participant={participant} />)}</div>
          </div>

          <footer className="shrink-0 border-t border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" disabled={state.connectionState === "reconnecting"} onClick={() => void state.setMicrophoneEnabled(!state.microphoneEnabled)} className={`inline-flex min-w-20 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium disabled:opacity-45 ${state.microphoneEnabled ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100" : "theme-button-neutral"}`} title={state.microphoneEnabled ? "Mute microphone" : "Enable microphone"} aria-label={state.microphoneEnabled ? "Mute microphone" : "Enable microphone"}>{state.microphoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}{state.microphoneEnabled ? "Mic on" : "Mic off"}</button>
              <button type="button" disabled={state.connectionState === "reconnecting"} onClick={() => void state.setCameraEnabled(!state.cameraEnabled)} className={`inline-flex min-w-20 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium disabled:opacity-45 ${state.cameraEnabled ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100" : "theme-button-neutral"}`} title={state.cameraEnabled ? "Disable camera" : "Enable camera"} aria-label={state.cameraEnabled ? "Disable camera" : "Enable camera"}>{state.cameraEnabled ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}{state.cameraEnabled ? "Cam on" : "Cam off"}</button>
              <button type="button" disabled={state.connectionState === "reconnecting"} onClick={() => void state.setScreenShareEnabled(!state.screenShareEnabled)} className={`inline-flex min-w-20 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium disabled:opacity-45 ${state.screenShareEnabled ? "border-sky-400/35 bg-sky-400/10 text-sky-100" : "theme-button-neutral"}`} title={state.screenShareEnabled ? "Stop screen sharing" : "Share screen"} aria-label={state.screenShareEnabled ? "Stop screen sharing" : "Share screen"}><MonitorUp className="h-4 w-4" />{state.screenShareEnabled ? "Sharing" : "Share"}</button>
              <button type="button" onClick={() => setSettingsOpen((open) => !open)} className="theme-button-neutral inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium" aria-expanded={settingsOpen} title="Media device settings"><Settings2 className="h-4 w-4" />Devices<ChevronDown className={`h-3.5 w-3.5 transition ${settingsOpen ? "rotate-180" : ""}`} /></button>
              <button type="button" onClick={() => void state.leave()} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-xs font-medium text-rose-100" title="Leave call and stay in the coding room"><PhoneOff className="h-4 w-4" />Leave call</button>
            </div>
            {settingsOpen ? <div className="mt-3 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--badge-bg)] p-2.5"><DevicePicker kind="audioinput" label="Microphone" /><DevicePicker kind="videoinput" label="Camera" /><DevicePicker kind="audiooutput" label="Speaker" /><button type="button" onClick={() => void state.refreshDevices()} className="inline-flex items-center gap-1 text-left text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"><Headphones className="h-3.5 w-3.5" />Refresh devices</button></div> : null}
          </footer>
        </>
      )}
    </aside>
  );
};
