import { createContext, useContext, useState, useCallback, useMemo } from "react";

export type ThemeMode = "light" | "dark";

interface ThemeModeContextValue {
  mode: ThemeMode;
  toggleMode: () => void;
}

const STORAGE_KEY = "turboea-theme-mode";

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage unavailable
  }
  return "light";
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: "light",
  toggleMode: () => {},
});

export function useThemeModeState(): ThemeModeContextValue {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);
}

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext);
}
