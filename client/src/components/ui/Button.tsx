import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonVariant = "primary" | "ghost" | "icon";

const variantClass: Record<ButtonVariant, string> = {
  primary: "theme-button-primary rounded-xl px-4 py-2.5 text-sm font-semibold",
  ghost: "theme-button-neutral rounded-xl border px-4 py-2.5 text-sm font-medium",
  icon: "theme-button-neutral inline-flex h-9 w-9 items-center justify-center rounded-xl border p-0 [&>svg]:h-4 [&>svg]:w-4"
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = ({
  variant = "ghost",
  className = "",
  children,
  type = "button",
  ...rest
}: PropsWithChildren<ButtonProps>) => (
  <button type={type} className={`ui-focus-ring transition-colors duration-200 ${variantClass[variant]} ${className}`.trim()} {...rest}>
    {children}
  </button>
);
