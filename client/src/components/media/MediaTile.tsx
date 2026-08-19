import { Mic, MicOff, MonitorUp, Signal, VideoOff } from "lucide-react";
import type { MediaParticipant } from "../../types/media";
import { MediaTrackView } from "./MediaTrackView";

const initialsFor = (name: string) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";

export const MediaTile = ({ participant, featured = false }: { participant: MediaParticipant; featured?: boolean }) => {
  const videoTrack = participant.screenTrack ?? participant.cameraTrack;
  return <article className={`relative overflow-hidden rounded-xl border bg-[var(--surface-bg)] ${participant.isSpeaking ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent-glow)]" : "border-[var(--border)]"} ${featured ? "min-h-52" : "min-h-32"}`}>
    {videoTrack ? <MediaTrackView track={videoTrack} muted={participant.isLocal} className={`absolute inset-0 h-full w-full object-cover ${participant.cameraTrack === videoTrack && participant.isLocal ? "-scale-x-100" : ""}`} /> : <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-secondary)]"><div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--badge-bg)] text-sm font-semibold text-[var(--text-primary)]">{initialsFor(participant.displayName)}</div><span className="mt-2 text-[10px] text-[var(--text-faint)]"><VideoOff className="mr-1 inline h-3 w-3" />Camera off</span></div>}
    {participant.audioTrack && !participant.isLocal ? <MediaTrackView track={participant.audioTrack} audio /> : null}
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/55 px-2.5 py-2 text-xs text-white backdrop-blur-sm"><span className="truncate font-medium">{participant.displayName}{participant.isLocal ? " · You" : ""}</span><span className="flex shrink-0 items-center gap-1.5">{participant.screenShareEnabled ? <MonitorUp className="h-3.5 w-3.5" aria-label="Screen sharing" /> : null}{participant.microphoneEnabled ? <Mic className="h-3.5 w-3.5" aria-label="Microphone on" /> : <MicOff className="h-3.5 w-3.5" aria-label="Microphone off" />}{participant.isSpeaking ? <Signal className="h-3.5 w-3.5 text-emerald-300" aria-label="Speaking" /> : null}</span></div>
  </article>;
};
