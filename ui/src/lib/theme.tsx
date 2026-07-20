import { useEffect, type ReactNode } from "react";
import { usePreferences } from "@/hooks/useSettings";

// ThemeProvider applies the user's theme preference to the document root.
// "system" follows the OS setting and keeps following it while it changes.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: prefs } = usePreferences();
  const theme = prefs?.theme ?? "system";

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      root.classList.toggle("dark", dark);
      root.classList.toggle("light", !dark);
      root.dataset.theme = dark ? "dark" : "light";
    };

    apply();
    if (theme === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [theme]);

  return <>{children}</>;
}
