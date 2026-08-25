import { ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Participant, SupportedLanguage, TypingParticipant } from "../../types/collaboration";
import { DEFAULT_EXTERNAL_COMPILER } from "../../lib/externalRunners";

interface EditorToolbarProps {
  language: SupportedLanguage;
  canEdit: boolean;
  isPaused: boolean;
  editorTypingUsers: TypingParticipant[];
  participants: Participant[];
  onChangeLanguage: (language: SupportedLanguage) => void;
}

export const EditorToolbar = ({ language, canEdit, isPaused, editorTypingUsers, participants, onChangeLanguage }: EditorToolbarProps) => {
  const [open, setOpen] = useState(false);
  const typingUsers = useMemo(() => {
    const participantById = new Map(participants.map((participant) => [participant.userId, participant]));
    return [...new Map(editorTypingUsers.map((entry) => [entry.userId, entry])).values()].map((entry) => ({ ...entry, participant: participantById.get(entry.userId) }));
  }, [editorTypingUsers, participants]);

  useEffect(() => { if (!typingUsers.length) setOpen(false); }, [typingUsers.length]);

  const typingLabel = typingUsers.length === 0
    ? "NOBODY IS TYPING"
    : typingUsers.length === 1
    ? "1 person typing…"
    : `${typingUsers.length} people typing…`;
  const statusMessage = isPaused ? "Paused" : canEdit ? "Ready" : "View only";

  return (
    <div className="theme-divider flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="room-language">Language</label>
        <select id="room-language" value={language} onChange={(event) => onChangeLanguage(event.target.value as SupportedLanguage)} disabled={!canEdit} className="theme-input max-w-[11rem] rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition disabled:cursor-not-allowed disabled:opacity-50">
          <option value="javascript">JavaScript</option><option value="cpp">C++</option><option value="python">Python</option>
        </select>
        <span className="hidden rounded-md border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] sm:inline">{DEFAULT_EXTERNAL_COMPILER}</span>
      </div>
      <div className="relative flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text-secondary)]">{statusMessage}</span>
        {typingUsers.length ? <>
          <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] transition hover:bg-[var(--badge-bg)]" aria-expanded={open} aria-haspopup="dialog">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />{typingLabel}<ChevronDown className="h-3 w-3" />
          </button>
          {open ? <div role="dialog" aria-label="People typing" className="theme-panel-solid absolute right-0 top-8 z-30 w-56 rounded-xl border p-2 shadow-xl">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">Typing now</p>
            <div className="mt-1 space-y-1">{typingUsers.map(({ userId, username, participant }) => <div key={userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)]">
              {participant?.avatarUrl ? <img src={participant.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--badge-bg)] text-[10px] font-semibold">{username.slice(0, 1).toUpperCase()}</span>}
              <span className="min-w-0 flex-1 truncate">{username}</span><LoaderCircle className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            </div>)}</div>
          </div> : null}
        </> : <span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--text-faint)]">{typingLabel}</span>}
      </div>
    </div>
  );
};
