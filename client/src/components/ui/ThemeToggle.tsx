import { Palette } from "lucide-react";
import { THEME_LABELS, useTheme } from "../../context/ThemeContext";

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle = ({ className = "" }: ThemeToggleProps) => {
  const { themeId, cycleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={`theme-button-neutral group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${className}`.trim()}
      title={`Theme: ${THEME_LABELS[themeId]} — click to cycle`}
    >
      <Palette className="h-4 w-4 text-[var(--accent)] transition-transform duration-200 group-hover:rotate-12" />
      <span className="hidden sm:inline">{THEME_LABELS[themeId]}</span>
    </button>
  );
};
