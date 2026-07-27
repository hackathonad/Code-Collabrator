import type { SupportedLanguage, TypingParticipant } from "../../types/collaboration";
import { DEFAULT_EXTERNAL_COMPILER } from "../../lib/externalRunners";

interface EditorToolbarProps {
  language: SupportedLanguage;
  canEdit: boolean;
  isPaused: boolean;
  editorTypingUsers: TypingParticipant[];
  onChangeLanguage: (language: SupportedLanguage) => void;
}

export const EditorToolbar = ({
  language,
  canEdit,
  isPaused,
  editorTypingUsers,
  onChangeLanguage
}: EditorToolbarProps) => {
  const typingMessage =
    editorTypingUsers.length === 0
      ? "Nobody typing"
      : editorTypingUsers.length === 1
        ? `${editorTypingUsers[0].username} typing`
        : `${editorTypingUsers[0].username} +${editorTypingUsers.length - 1} typing`;

  const statusMessage = isPaused ? "Paused" : canEdit ? typingMessage : "View only";

  return (
    <div className="theme-divider flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="room-language">
          Language
        </label>
        <select
          id="room-language"
          value={language}
          onChange={(event) => onChangeLanguage(event.target.value as SupportedLanguage)}
          disabled={!canEdit}
          className="theme-input max-w-[11rem] rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="javascript">JavaScript</option>
          <option value="cpp">C++</option>
          <option value="python">Python</option>
        </select>
        <span className="hidden rounded-md border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] sm:inline">
          {DEFAULT_EXTERNAL_COMPILER}
        </span>
      </div>
      <p className="max-w-full truncate text-right text-xs text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text-secondary)]">{statusMessage}</span>
      </p>
    </div>
  );
};
