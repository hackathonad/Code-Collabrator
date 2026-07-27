import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { storage } from "../lib/storage";

export type ThemeId = "mono" | "blue" | "green" | "shades";

export const THEME_ORDER: ThemeId[] = ["mono", "blue", "green", "shades"];

export const THEME_LABELS: Record<ThemeId, string> = {
  mono: "Black & White",
  blue: "Blue",
  green: "Green",
  shades: "Shades"
};

interface ThemeContextValue {
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  cycleTheme: () => void;
  /** Monaco editor brightness */
  editorColorMode: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const getEditorColorMode = (id: ThemeId): "light" | "dark" => (id === "shades" ? "light" : "dark");

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => storage.getThemeId());

  const editorColorMode = useMemo(() => getEditorColorMode(themeId), [themeId]);

  useEffect(() => {
    document.documentElement.dataset.themeId = themeId;
    document.documentElement.style.colorScheme = editorColorMode;
    storage.saveThemeId(themeId);
  }, [themeId, editorColorMode]);

  const setThemeId = (id: ThemeId) => {
    setThemeIdState(id);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      setThemeId,
      cycleTheme: () => {
        setThemeIdState((current) => {
          const index = THEME_ORDER.indexOf(current);
          const next = THEME_ORDER[(index + 1) % THEME_ORDER.length];
          return next;
        });
      },
      editorColorMode
    }),
    [themeId, editorColorMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
};
