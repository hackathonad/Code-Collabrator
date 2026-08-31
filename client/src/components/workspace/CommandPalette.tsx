import { Command, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface WorkspaceCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: WorkspaceCommand[];
  onClose: () => void;
}

export const CommandPalette = ({ open, commands, onClose }: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filtered = useMemo(() => { const value = query.trim().toLocaleLowerCase(); return commands.filter((command) => !value || `${command.label} ${command.hint ?? ""}`.toLocaleLowerCase().includes(value)).slice(0, 30); }, [commands, query]);
  useEffect(() => { if (!open) return; setQuery(""); setActiveIndex(0); window.setTimeout(() => inputRef.current?.focus(), 0); }, [open]);
  useEffect(() => { setActiveIndex((index) => Math.min(index, Math.max(filtered.length - 1, 0))); }, [filtered.length]);
  if (!open) return null;
  const execute = (command: WorkspaceCommand | undefined) => { if (!command) return; command.run(); onClose(); };
  return <div className="fixed inset-0 z-[80] bg-black/55 px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="theme-panel-solid mx-auto w-full max-w-xl overflow-hidden rounded-2xl border shadow-2xl"><div className="flex items-center gap-2 border-b border-[var(--border)] px-3"><Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); } if (event.key === "Enter") { event.preventDefault(); execute(filtered[activeIndex]); } }} placeholder="Search commands…" className="theme-input min-w-0 flex-1 border-0 bg-transparent px-1 py-3 text-sm outline-none" /><kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] sm:inline">Esc</kbd><button type="button" onClick={onClose} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--badge-bg)]" aria-label="Close command palette"><X className="h-4 w-4" /></button></div><div className="max-h-[min(60vh,28rem)] overflow-auto p-2">{filtered.map((command, index) => <button key={command.id} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => execute(command)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${index === activeIndex ? "bg-[var(--badge-bg)]" : "hover:bg-[var(--badge-bg)]"}`}><Command className="h-4 w-4 shrink-0 text-[var(--accent)]" /><span className="min-w-0 flex-1"><span className="block text-xs text-[var(--text-primary)]">{command.label}</span>{command.hint ? <span className="block truncate text-[10px] text-[var(--text-faint)]">{command.hint}</span> : null}</span><span className="text-[10px] text-[var(--text-faint)]">↵</span></button>)}{!filtered.length ? <p className="px-3 py-6 text-center text-xs text-[var(--text-faint)]">No commands match “{query}”.</p> : null}</div><div className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--text-faint)]">↑ ↓ navigate · Enter run · Esc close</div></div></div>;
};
