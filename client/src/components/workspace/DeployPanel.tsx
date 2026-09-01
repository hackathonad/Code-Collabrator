import { CheckCircle2, Download, Link2, Rocket, ShieldCheck } from "lucide-react";

export const DeployPanel = ({ onCopyRoomLink, onDownloadFile, onNotify }: { onCopyRoomLink: () => void; onDownloadFile: () => void; onNotify: (message: string) => void }) => {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--glass)] py-3 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]"><Rocket className="h-5 w-5" /></div>
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Workspace</p><h2 className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">Deploy</h2></div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pt-4">
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><div><p className="text-xs font-semibold text-[var(--text-primary)]">Provider connection required</p><p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">This room does not have an automatic hosting provider connected yet. Your source stays in the guest workspace until you explicitly export or connect it.</p></div></div>
        </div>

        <div className="mt-3 grid gap-2">
          <button type="button" onClick={() => onNotify("No hosting provider is connected yet. Connect a repository or export the source to deploy.")} className="theme-button-primary inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"><Rocket className="h-3.5 w-3.5" />Deploy this workspace</button>
          <button type="button" onClick={onCopyRoomLink} className="theme-button-primary inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"><Link2 className="h-3.5 w-3.5" />Copy workspace link</button>
          <button type="button" onClick={onDownloadFile} className="theme-button-neutral inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium"><Download className="h-3.5 w-3.5" />Download current source</button>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--badge-bg)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">Ready-to-deploy checklist</p>
          <ul className="mt-2 space-y-2 text-[11px] text-[var(--text-muted)]"><li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />Review the shared source and run validation.</li><li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />Connect a repository or export the source.</li><li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />Deploy through your chosen hosting provider.</li></ul>
        </div>
      </div>
    </div>
  );
};
