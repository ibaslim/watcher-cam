// Theme management: dark/light mode with localStorage persistence
// The theme is applied by toggling the "dark" class on <html>

const THEME_KEY = "sv-theme";

export type Theme = "dark" | "light";

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return "dark"; // default to dark
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

export function toggleTheme(): Theme {
  const current = getStoredTheme();
  const next: Theme = current === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent<Theme>("sv-theme-changed", { detail: theme }));
}

// Apply theme immediately on module load (before React renders)
applyTheme(getStoredTheme());
