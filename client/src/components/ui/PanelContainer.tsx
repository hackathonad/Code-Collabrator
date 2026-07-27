import type { HTMLAttributes, PropsWithChildren } from "react";

interface PanelContainerProps extends HTMLAttributes<HTMLElement> {
  variant?: "glass" | "solid";
  padding?: "sm" | "md";
}

export const PanelContainer = ({
  variant = "glass",
  className = "",
  padding = "md",
  children,
  ...rest
}: PropsWithChildren<PanelContainerProps>) => {
  const base = variant === "glass" ? "theme-panel" : "theme-panel-solid";
  const pad = padding === "sm" ? "p-3" : "p-4";

  return (
    <section className={`${base} rounded-2xl border ${pad} ${className}`.trim()} {...rest}>
      {children}
    </section>
  );
};
