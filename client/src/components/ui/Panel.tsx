import type { PropsWithChildren } from "react";

interface PanelProps extends PropsWithChildren {
  className?: string;
}

export const Panel = ({ className = "", children }: PanelProps) => (
  <section
    className={`rounded-3xl border border-white/10 bg-surface-800/80 p-4 shadow-panel backdrop-blur-xl ${className}`.trim()}
  >
    {children}
  </section>
);

