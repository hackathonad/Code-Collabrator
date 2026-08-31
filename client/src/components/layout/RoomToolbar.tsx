import {
  ClipboardCopy,
  Home,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Zap
} from "lucide-react";
import { useState, type MouseEvent } from "react";
import { THEME_LABELS, useTheme } from "../../context/ThemeContext";
import { AppLogo } from "../ui/AppLogo";
import { ToolbarButton } from "../ui/ToolbarButton";
import { MediaCallButton } from "../media/MediaCallButton";
import type { UserSession } from "../../types/collaboration";

interface RoomToolbarProps {
  roomId: string;
  roomName: string;
  connectionStatus: string;
  isPaused: boolean;
  isOwner: boolean;
  activeParticipants: number;
  chatOpen: boolean;
  session: UserSession;
  onOpenMedia: () => void;
  onToggleChat: () => void;
  onCopyCode: () => void;
  onCopyRoomLink: () => void;
  onRun: () => void;
  onPauseToggle: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onHome: () => void;
}

export const RoomToolbar = ({
  roomId,
  roomName,
  connectionStatus,
  isPaused,
  isOwner,
  activeParticipants,
  chatOpen,
  session,
  onOpenMedia,
  onToggleChat,
  onCopyCode,
  onCopyRoomLink,
  onRun,
  onPauseToggle,
  onRestart,
  onOpenSettings,
  onHome
}: RoomToolbarProps) => {
  const { themeId, cycleTheme } = useTheme();
  const [secondaryOpen, setSecondaryOpen] = useState(false);

  const handlePaletteClick = () => {
    cycleTheme();
  };

  const handlePaletteAuxClick = (event: MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      onOpenSettings();
    }
  };

  return (
    <header className="theme-panel-solid relative flex min-h-16 w-full shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2 shadow-[var(--shadow-soft)] backdrop-blur-xl sm:gap-3 sm:px-4">
      <div className="flex min-w-0 max-w-[min(42vw,22rem)] shrink items-center gap-2 sm:gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <AppLogo size={26} className="opacity-95" />
          <p className="hidden font-display text-sm font-semibold text-[var(--text-primary)] xl:block">Code Collaborator</p>
        </div>
        <div className="hidden min-w-0 border-l border-[var(--border)] pl-3 md:block">
          <p className="truncate font-display text-sm font-semibold text-[var(--text-primary)]">{roomName}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Room ID · {roomId}</p>
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <span className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${isPaused ? "bg-amber-500/15 text-amber-200" : "bg-emerald-500/12 text-emerald-200"}`}>
            {isPaused ? "Paused" : "Live"}
          </span>
          <span className="rounded-md border border-[var(--border)] bg-[var(--badge-bg)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)]">
            {activeParticipants} online
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1 sm:gap-2">
        <MediaCallButton roomId={roomId} session={session} onOpenPanel={onOpenMedia} />
        <ToolbarButton label={chatOpen ? "Hide chat" : "Chat"} icon={<MessageSquare />} onClick={onToggleChat} accent={chatOpen} />
      </div>

      <div className="hidden">
        <ToolbarButton label="Copy code" icon={<ClipboardCopy />} onClick={onCopyCode} />
        <ToolbarButton
          label={isPaused ? "Resume" : "Pause"}
          icon={isPaused ? <Play /> : <Pause />}
          onClick={onPauseToggle}
          disabled={!isOwner}
          title={!isOwner ? "Only the room owner can pause" : undefined}
        />
        <ToolbarButton
          label={`Theme: ${THEME_LABELS[themeId]}`}
          icon={<Palette />}
          onClick={handlePaletteClick}
          onAuxClick={handlePaletteAuxClick}
          title="Cycle theme · middle-click opens settings"
        />
        <ToolbarButton label="Settings" icon={<Settings />} onClick={onOpenSettings} />
        <ToolbarButton label="Home" icon={<Home />} onClick={onHome} />
      </div>
      <button
        type="button"
        className="ui-focus-ring inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] px-2 text-[var(--text-muted)]"
        aria-label="More room controls"
        aria-expanded={secondaryOpen}
        title="More room controls"
        onClick={() => setSecondaryOpen((open) => !open)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="hidden shrink-0 items-center gap-2 sm:flex" title={connectionStatus}>
        <span className={`h-2 w-2 rounded-full ${connectionStatus === "connected" ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]" : connectionStatus === "connecting" ? "bg-amber-300" : "bg-rose-400"}`} />
        <span className="hidden text-[11px] text-[var(--text-muted)] 2xl:inline">{connectionStatus === "connected" ? "Connected" : connectionStatus}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--badge-bg)] text-[10px] font-semibold text-[var(--text-primary)]" title={session.username}>{session.username.slice(0, 2).toUpperCase()}</span>
      </div>
      {secondaryOpen ? (
        <div className="absolute right-3 top-[calc(100%-0.25rem)] z-50 flex min-w-48 max-w-[calc(100vw-1.5rem)] flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-bg)] p-2 shadow-xl">
          <ToolbarButton label="Invite" accent icon={<Link2 />} onClick={() => { onCopyRoomLink(); setSecondaryOpen(false); }} />
          <ToolbarButton label="Run & debug" accent icon={<Zap />} onClick={() => { onRun(); setSecondaryOpen(false); }} />
          <ToolbarButton label="Reset code" icon={<RotateCcw />} onClick={() => { onRestart(); setSecondaryOpen(false); }} disabled={!isOwner} title={!isOwner ? "Only the room owner can reset code" : "Restore the selected language boilerplate"} />
          <ToolbarButton label="Copy code" icon={<ClipboardCopy />} onClick={() => { onCopyCode(); setSecondaryOpen(false); }} />
          <ToolbarButton label={isPaused ? "Resume" : "Pause"} icon={isPaused ? <Play /> : <Pause />} onClick={() => { onPauseToggle(); setSecondaryOpen(false); }} disabled={!isOwner} />
          <ToolbarButton label={`Theme: ${THEME_LABELS[themeId]}`} icon={<Palette />} onClick={() => { handlePaletteClick(); setSecondaryOpen(false); }} />
          <ToolbarButton label="Settings" icon={<Settings />} onClick={() => { onOpenSettings(); setSecondaryOpen(false); }} />
          <ToolbarButton label="Home" icon={<Home />} onClick={() => { onHome(); setSecondaryOpen(false); }} />
        </div>
      ) : null}
    </header>
  );
};
