import { Sidebar } from "./Sidebar";
import { Camera, Site, CurrentUser, logout } from "../lib/api";
import { TIMEOUT_MINUTES } from "./SessionTimeout";
import { useEffect, useState } from "react";
import { formatPortalClock, PORTAL_TIME_ZONE_LABEL } from "../lib/time";
import { getStoredTheme, setTheme, Theme } from "../lib/theme";

export function NavBar({
  online,
  user, sites, cameras,
}: {
  sites: Site[];
  cameras: Camera[];
  online: boolean;
  user: CurrentUser | null;
}) {
  const isAdmin = user?.role === "administrator";
  const remainingSec = useSessionRemaining();
  const portalClock = usePortalClock();
  const [theme, updateTheme] = useState<Theme>(getStoredTheme);
  const initials = (user?.username || "U").slice(0, 1).toUpperCase();

  const switchTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    updateTheme(nextTheme);
  };

  return (
    <>
    <Sidebar sites={sites} cameras={cameras} isAdmin={isAdmin} />
    <header className="app-header site-topbar bg-verkada-surface border-b border-verkada-border px-4 flex items-center justify-between sticky top-0 z-40">
      <strong className="text-sm">Sentinel Vision</strong>
      <div className="nav-meta flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          className="theme-toggle"
          onClick={switchTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
          <span>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>

        <div className="user-chip flex items-center gap-2 px-2 py-1 rounded-lg border border-verkada-border bg-verkada-card">
          <span className="user-avatar" aria-hidden>{initials}</span>
          <span className="user-chip-copy max-w-32 overflow-hidden text-ellipsis whitespace-nowrap">
            <strong>{user?.username}</strong>
            <small>{user?.role}</small>
          </span>
        </div>

        <span className={`text-xs font-mono text-theme-muted px-2 py-1 rounded border border-verkada-border bg-verkada-card ${remainingSec <= 5 * 60 ? "bg-orange-500/10 border-orange-500/20 text-orange-400" : ""}`}>
          Session {formatRemaining(remainingSec)}
        </span>

        <span className="text-xs font-mono text-theme-muted px-2 py-1 rounded border border-verkada-border bg-verkada-card">
          {portalClock} {PORTAL_TIME_ZONE_LABEL}
        </span>

        <div className={`connection-status ${online ? "is-online" : "is-offline"}`}>
          <span className="connection-dot" />
          <span>{online ? "Live" : "Offline"}</span>
        </div>

        <button className="logout-button" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
    </>
  );
}

function useSessionRemaining(): number {
  const [remainingSec, setRemainingSec] = useState(TIMEOUT_MINUTES * 60);

  useEffect(() => {
    const onRemaining = (event: Event) => {
      const value = (event as CustomEvent<number>).detail;
      if (typeof value === "number") setRemainingSec(value);
    };

    window.addEventListener("session-remaining", onRemaining);
    return () => window.removeEventListener("session-remaining", onRemaining);
  }, []);

  return remainingSec;
}

function usePortalClock(): string {
  const [clock, setClock] = useState(formatPortalClock());

  useEffect(() => {
    const interval = window.setInterval(() => setClock(formatPortalClock()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return clock;
}

function formatRemaining(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
