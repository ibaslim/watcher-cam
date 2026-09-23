import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Camera, Site } from "../lib/api";

type IconName = "grid" | "events" | "pin" | "users" | "play" | "report" | "location" | "search" | "star" | "chevron" | "plus";
const paths: Record<IconName, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  events: "M3 12h4l3-8 4 16 3-8h4",
  pin: "M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6z M12 15v7",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87",
  play: "M4 4h16v16H4z M10 8l6 4-6 4z",
  report: "M14 2H6v20h12V6z M14 2v5h5 M9 12h6 M9 16h6",
  location: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  chevron: "m14 7-5 5 5 5",
  plus: "M12 5v14 M5 12h14",
};
function Icon({ name }: { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Sidebar({ sites, cameras, isAdmin }: { sites: Site[]; cameras: Camera[]; isAdmin: boolean }) {
  const location = useLocation();
  const selected = location.pathname === "/" ? new URLSearchParams(location.search).get("site") : null;
  const [filter, setFilter] = useState("");
  const [pinned, setPinned] = useState(() => localStorage.getItem("sidebar-pinned") === "true");
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const sidebar = useRef<HTMLElement>(null);
  const expanded = pinned || open;
  const clearClose = () => { clearTimeout(closeTimer.current); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  const setPin = (value: boolean) => { setPinned(value); localStorage.setItem("sidebar-pinned", String(value)); };
  const matches = sites.filter(site => site.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const nav = (to: string, label: string, icon: IconName) => <NavLink to={to} end={to === "/"} title={!expanded ? label : undefined} aria-label={label} className={({ isActive }) => `side-nav-link ${isActive ? "is-active" : ""}`}><Icon name={icon} /><span className="side-label">{label}</span></NavLink>;
  const siteRow = (site: Site) => <Link to={`/?site=${encodeURIComponent(site.id)}`} key={site.id} className={`side-site-link ${selected === site.id ? "is-active" : ""}`} title={site.name}><span className="site-bullet" /><span>{site.name}</span><small>{cameras.filter(camera => camera.site_id === site.id).length}</small></Link>;
  return <aside ref={sidebar} className={`site-sidebar refined-sidebar ${expanded ? "is-expanded" : ""} ${pinned ? "is-pinned" : ""}`} aria-label="Main sidebar"
    onMouseEnter={() => { if (window.matchMedia("(hover: hover)").matches) { clearClose(); setOpen(true); } }}
    onMouseLeave={() => { clearClose(); closeTimer.current = setTimeout(() => { if (!sidebar.current?.contains(document.activeElement)) setOpen(false); }, 220); }}
    onFocus={event => { clearClose(); if (!(event.target as HTMLElement).closest(".side-toggle")) setOpen(true); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape") { setPin(false); setOpen(false); sidebar.current?.querySelector<HTMLButtonElement>(".side-toggle")?.focus(); } }}>
    <div className="side-brand"><span className="side-brand-mark"><Icon name="grid" /></span><div className="side-label"><strong>Sentinel</strong><small>VISION WORKSPACE</small></div></div>
    <button type="button" className="side-toggle" aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={expanded} onClick={() => { clearClose(); if (expanded) { setPin(false); setOpen(false); } else setOpen(true); }}><Icon name="chevron" /></button>
    <nav className="side-main-nav" aria-label="Primary navigation">
      <p className="side-section-label">Workspace</p>
      {nav("/", "Overview", "grid")}{nav("/events", "Events", "events")}{nav("/recordings", "Recordings", "play")}{nav("/reports", "Reports", "report")}
      {isAdmin && <><div className="side-divider" /><p className="side-section-label">Manage</p>{nav("/cameras", "Locations", "location")}{nav("/users", "Team", "users")}</>}
    </nav>
    <div className="side-sites" hidden={!expanded}>
      <div className="side-sites-title"><strong>Sites</strong><span>{sites.length}</span></div>
      <label className="side-search"><Icon name="search" /><input aria-label="Filter sites" placeholder="Find a location…" value={filter} onChange={event => setFilter(event.target.value)} />{filter && <button aria-label="Clear site filter" onClick={() => setFilter("")}>×</button>}</label>
      <nav className="side-sites-scroll" aria-label="Sites">
        <h3><Icon name="star" />Starred</h3>
        {matches.filter(site => site.starred).map(siteRow)}
        {!matches.some(site => site.starred) && <p className="side-empty">{filter ? "No matching starred sites" : "Star locations for quick access."}</p>}
        <Link to="/" className={`side-all-sites ${!selected && location.pathname === "/" ? "is-active" : ""}`}><Icon name="location" />All sites<span>{sites.length}</span></Link>
        {matches.map(siteRow)}
        {!matches.length && <p className="side-empty">{filter ? "No locations match your search." : "Add a location to get started."}</p>}
      </nav>
      {isAdmin && <Link className="side-add" to="/cameras"><Icon name="plus" />Manage locations</Link>}
    </div>
    <button className={`side-pin ${pinned ? "is-pinned" : ""}`} aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"} aria-pressed={pinned} title={pinned ? "Unpin sidebar" : "Pin sidebar open"} onClick={() => { setPin(!pinned); setOpen(false); }}><Icon name="pin" /><span className="side-label">{pinned ? "Sidebar pinned" : "Pin sidebar open"}</span></button>
  </aside>;
}
