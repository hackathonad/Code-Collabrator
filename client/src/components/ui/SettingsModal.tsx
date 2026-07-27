import { X } from "lucide-react";
import type { ThemeId } from "../../context/ThemeContext";
import { THEME_LABELS, THEME_ORDER } from "../../context/ThemeContext";
import { Button } from "./Button";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  themeId: ThemeId;
  onSelectTheme: (id: ThemeId) => void;
}

const swatch: Record<ThemeId, string> = {
  mono: "linear-gradient(135deg,#0a0a0a 0%,#fafafa 100%)",
  blue: "linear-gradient(135deg,#020617 0%,#3b82f6 100%)",
  green: "linear-gradient(135deg,#022c16 0%,#4ade80 100%)",
  shades: "linear-gradient(135deg,#eef2ff 0%,#cbd5e1 100%)"
};

export const SettingsModal = ({ open, onClose, themeId, onSelectTheme }: SettingsModalProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close settings" />
      <div className="theme-panel relative z-[81] w-full max-w-md rounded-2xl border p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="settings-title" className="font-display text-xl font-semibold text-[var(--text-primary)]">
              Settings
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Appearance and future workspace options.</p>
          </div>
          <Button variant="icon" onClick={onClose} aria-label="Close" className="!h-9 !w-9 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Theme</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
            {THEME_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTheme(id)}
                className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition duration-200 ${
                  themeId === id
                    ? "border-[var(--border-strong)] bg-[var(--surface-hover)] shadow-[0_0_0_1px_var(--accent-glow)]"
                    : "border-[var(--border)] bg-[var(--surface-bg)] hover:border-[var(--border-strong)]"
                }`}
              >
                <span className="h-10 w-full rounded-lg border border-[var(--border)] shadow-inner" style={{ background: swatch[id] }} />
                <span className="text-sm font-medium text-[var(--text-primary)]">{THEME_LABELS[id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="theme-divider mt-8 border-t pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Coming soon</p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
            <li className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2">
              <span>Keyboard shortcuts</span>
              <span className="text-[var(--text-faint)]">—</span>
            </li>
            <li className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2">
              <span>Editor font size</span>
              <span className="text-[var(--text-faint)]">—</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
