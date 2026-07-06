import { useCallback, useEffect, useState } from "react";
import type Database from "./db";
import { getSetting, setSetting } from "./settings";

export type ThemeSource = "system" | "light" | "dark";

function applyTheme(source: ThemeSource) {
  const isDark = source === "dark" || (source === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

/** Persists theme via the same `settings` table used elsewhere, toggles `.dark` on
 * `<html>`, and mirrors it to `nativeTheme.themeSource` over IPC so window chrome/Mica
 * track it too — this is the actual fix for dark mode being dead code: the token CSS
 * already existed, nothing ever flipped the class or had a toggle. */
export function useTheme(db: Database | null) {
  const [theme, setThemeState] = useState<ThemeSource>("system");

  useEffect(() => {
    if (!db) return;
    getSetting(db, "theme").then((saved) => {
      const source = (saved as ThemeSource) ?? "system";
      setThemeState(source);
      applyTheme(source);
      window.api.theme.set(source);
    });
  }, [db]);

  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback(
    async (source: ThemeSource) => {
      setThemeState(source);
      applyTheme(source);
      await window.api.theme.set(source);
      if (db) await setSetting(db, "theme", source);
    },
    [db],
  );

  return { theme, setTheme };
}
