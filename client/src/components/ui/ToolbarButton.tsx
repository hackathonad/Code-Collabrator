import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  accent?: boolean;
}

export const ToolbarButton = ({ label, icon, accent = false, className = "", disabled, ...rest }: ToolbarButtonProps) => (
  <button
    type="button"
    disabled={disabled}
    title={label}
    aria-label={label}
    className={`ui-focus-ring group inline-flex h-10 min-w-[2.5rem] shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition duration-200 ${
      accent ? "theme-button-primary border-transparent" : "theme-button-neutral"
    } disabled:pointer-events-none disabled:opacity-45 ${className}`.trim()}
    {...rest}
  >
    <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
    <span className="hidden 2xl:inline">{label}</span>
  </button>
);
