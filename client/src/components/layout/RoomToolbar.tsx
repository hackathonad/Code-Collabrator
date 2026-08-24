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
  roomName: string;
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
  aiOpen,
  session,
  onOpenMedia,
  onToggleChat,
  onToggleAI,
  onCopyCode,
  onCopyRoomLink,
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
    <header className="theme-panel-solid flex h-16 w-full shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 shadow-[var(--shadow-soft)] backdrop-blur-xl sm:gap-3 sm:px-4">
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <AppLogo size={26} className="opacity-95" />
          <p className="hidden font-display text-sm font-semibold text-[var(--text-primary)] xl:block">Code Collaborator</p>
        </div>
        <div className="hidden max-w-40 min-w-0 border-l border-[var(--border)] pl-3 md:block">
          <p className="truncate font-display text-sm font-semibold text-[var(--text-primary)]">{roomName}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-faint)]">Collaborative workspace</p>
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

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:justify-center sm:gap-2">
        <ToolbarButton label="Invite" accent className="theme-workspace-action" icon={<Link2 />} onClick={onCopyRoomLink} />
        <ToolbarButton label="Run" accent className="theme-workspace-action" icon={<Zap />} onClick={onRun} />
        <ToolbarButton label="Reset code" icon={<RotateCcw />} onClick={onRestart} disabled={!isOwner} title={!isOwner ? "Only the room owner can reset code" : "Restore the selected language boilerplate"} />
        <MediaCallButton roomId={roomId} session={session} onOpenPanel={onOpenMedia} />
        <ToolbarButton label={aiOpen ? "Hide AI" : "AI Assistant"} icon={<Sparkles />} onClick={onToggleAI} accent={aiOpen} />
        <ToolbarButton label={chatOpen ? "Hide chat" : "Chat"} icon={<MessageSquare />} onClick={onToggleChat} accent={chatOpen} />
      </div>

      <div className="hidden shrink-0 items-center gap-1 lg:flex">
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
      <div className="hidden shrink-0 items-center gap-2 xl:flex" title={connectionStatus}>
        <span className={`h-2 w-2 rounded-full ${connectionStatus === "connected" ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]" : connectionStatus === "connecting" ? "bg-amber-300" : "bg-rose-400"}`} />
        <span className="text-[11px] text-[var(--text-muted)]">{connectionStatus === "connected" ? "Connected" : connectionStatus}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--badge-bg)] text-[10px] font-semibold text-[var(--text-primary)]" title={session.username}>{session.username.slice(0, 2).toUpperCase()}</span>
      </div>
      <MoreHorizontal className="h-4 w-4 shrink-0 text-[var(--text-faint)] lg:hidden" aria-label="Additional room controls are available on larger screens" />
    </header>
  );
};
