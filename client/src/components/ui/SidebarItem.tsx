import type { HTMLAttributes, PropsWithChildren, ReactNode } from "react";

interface SidebarItemProps extends HTMLAttributes<HTMLDivElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  active?: boolean;
}

export const SidebarItem = ({
  leading,
  trailing,
  active = false,
  className = "",
  children,
  ...rest
}: PropsWithChildren<SidebarItemProps>) => (
  <div
    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition duration-200 ${
      active
        ? "border-[var(--border-strong)] bg-[var(--surface-hover)] shadow-[var(--shadow-glow)]"
        : "border-transparent bg-transparent hover:border-[var(--border)] hover:bg-[var(--surface-bg)]"
    } ${className}`.trim()}
    {...rest}
  >
    {leading ? <span className="flex shrink-0 items-center justify-center text-[var(--text-muted)]">{leading}</span> : null}
    <div className="min-w-0 flex-1">{children}</div>
    {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
  </div>
);
