import {
  ClipboardCopy,
  Home,
  MessageSquare,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Sparkles,
  Zap
} from "lucide-react";
import type { MouseEvent } from "react";
import { THEME_LABELS, useTheme } from "../../context/ThemeContext";
import { AppLogo } from "../ui/AppLogo";
import { ToolbarButton } from "../ui/ToolbarButton";
import { MediaCallButton } from "../media/MediaCallButton";
import type { UserSession } from "../../types/collaboration";

interface RoomToolbarProps {
  roomId: string;
  connectionStatus: string;
  isPaused: boolean;
  isOwner: boolean;
  activeParticipants: number;
  chatOpen: boolean;
  aiOpen: boolean;
  session: UserSession;
  onOpenMedia: () => void;
  onToggleChat: () => void;
  onToggleAI: () => void;
  onCopyCode: () => void;
  onRun: () => void;
  onPauseToggle: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onHome: () => void;
}

export const RoomToolbar = ({
  roomId,
  connectionStatus,
  isPaused,
  isOwner,
  activeParticipants,
  chatOpen,
  aiOpen,
  session,
  onOpenMedia,
  onToggleChat,
  onToggleAI,
  onCopyCode,
  onRun,
  onPauseToggle,
  onRestart,
  onOpenSettings,
  onHome
}: RoomToolbarProps) => {
  const { themeId, cycleTheme } = useTheme();

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
    <header className="theme-panel-solid flex h-14 w-full shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 shadow-[var(--shadow-soft)] backdrop-blur-xl sm:gap-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <AppLogo size={26} className="opacity-95" />
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-medium uppercase tracking-tight text-[var(--text-muted)]">Room</p>
            <p className="truncate font-mono text-sm font-semibold text-[var(--text-primary)]">{roomId}</p>
          </div>
        </div>
        <span className="hidden h-6 w-px shrink-0 bg-[var(--border)] sm:block" aria-hidden />
        <div className="hidden items-center gap-2 sm:flex">
          <span className="rounded-md border border-[var(--border)] bg-[var(--badge-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
            {activeParticipants} online
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              isPaused ? "bg-amber-500/15 text-amber-200" : "bg-emerald-500/12 text-emerald-200"
            }`}
          >
            {isPaused ? "Paused" : "Live"}
          </span>
          <span className="max-w-[7rem] truncate text-[11px] text-[var(--text-faint)]" title={connectionStatus}>
            {connectionStatus}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">
        <ToolbarButton label="Copy code" icon={<ClipboardCopy />} onClick={onCopyCode} />
        <ToolbarButton label="Run code" accent icon={<Zap />} onClick={onRun} />
        <ToolbarButton
          label={isPaused ? "Resume" : "Pause"}
          icon={isPaused ? <Play /> : <Pause />}
          onClick={onPauseToggle}
          disabled={!isOwner}
          title={!isOwner ? "Only the room owner can pause" : undefined}
        />
        <ToolbarButton
          label="Reset code"
          icon={<RotateCcw />}
          onClick={onRestart}
          disabled={!isOwner}
          title={!isOwner ? "Only the room owner can reset code" : "Restore the selected language boilerplate"}
        />
        <span className="hidden h-6 w-px shrink-0 bg-[var(--border)] md:block" aria-hidden />
        <ToolbarButton
          label={`Theme: ${THEME_LABELS[themeId]}`}
          icon={<Palette />}
          onClick={handlePaletteClick}
          onAuxClick={handlePaletteAuxClick}
          title="Cycle theme · middle-click opens settings"
        />
        <ToolbarButton label="Settings" icon={<Settings />} onClick={onOpenSettings} />
        <MediaCallButton roomId={roomId} session={session} onOpenPanel={onOpenMedia} />
        <ToolbarButton
          label={aiOpen ? "Hide AI" : "AI Assistant"}
          icon={<Sparkles />}
          onClick={onToggleAI}
          accent={aiOpen}
        />
        <ToolbarButton
          label={chatOpen ? "Hide chat" : "Chat"}
          icon={<MessageSquare />}
          onClick={onToggleChat}
          accent={chatOpen}
        />
        <ToolbarButton label="Home" icon={<Home />} onClick={onHome} />
      </div>
    </header>
  );
};
