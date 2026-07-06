import { Minus, Square, X, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/lib/theme";
import type Database from "@/lib/db";

const THEME_CYCLE: Record<string, "light" | "dark" | "system"> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

/** Custom frameless titlebar: a drag region (via `-webkit-app-region: drag`, Electron's
 * equivalent of Tauri's `data-tauri-drag-region`) plus window controls routed through
 * `window.api.window.*`, replacing the doubled OS-decoration + gray-strip chrome. */
export function TitleBar({ db }: { db: Database | null }) {
  const { theme, setTheme } = useTheme(db);
  const ThemeIcon = THEME_ICON[theme];

  return (
    <div
      className="glass-surface flex items-center justify-between h-9 shrink-0 border-x-0 border-t-0 select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <span className="font-display text-sm pl-3 text-foreground/90 tracking-wide">Dispatch</span>
      <div className="flex items-center gap-1 pr-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={() => setTheme(THEME_CYCLE[theme])}
          title={`Theme: ${theme}`}
          className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ThemeIcon className="size-3.5" />
        </button>
        <button onClick={() => window.api.window.minimize()} className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent">
          <Minus className="size-3.5" />
        </button>
        <button onClick={() => window.api.window.maximizeToggle()} className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent">
          <Square className="size-3" />
        </button>
        <button onClick={() => window.api.window.close()} className="p-1.5 rounded-sm text-muted-foreground hover:text-white hover:bg-destructive">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
