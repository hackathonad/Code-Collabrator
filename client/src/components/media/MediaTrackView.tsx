import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";

interface MediaTrackViewProps { track: Track; muted?: boolean; className?: string; audio?: boolean; }

export const MediaTrackView = ({ track, muted = false, className = "", audio = false }: MediaTrackViewProps) => {
  const ref = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  return audio
    ? <audio ref={ref} autoPlay playsInline className="hidden" />
    : <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
};
