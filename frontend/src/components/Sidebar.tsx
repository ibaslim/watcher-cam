import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Camera, Site } from "../lib/api";

type IconName = "grid" | "events" | "pin" | "users" | "play" | "report" | "location" | "search" | "star" | "chevron" | "plus" | "camera" | "logout";
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
  camera: "M4 7h3l1.5-2h7L17 7h3v12H4z M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
};
function Icon({ name }: { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Sidebar({ sites, cameras, isAdmin }: { sites: Site[]; cameras: Camera[]; isAdmin: boolean }) {
  const location = useLocation();
  const selected = location.pathname === "/" ? new URLSearchParams(location.search).get("site") : null;
  const [filter, setFilter] = useState("");
  const matches = sites.filter(site => site.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const nav = (to: string, label: string, icon: IconName) => (
    <NavLink to={to} end={to === "/"} title={label} aria-label={label} className={({ isActive }) => `rail-nav-link ${isActive ? "is-active" : ""}`}>
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
  const siteRow = (site: Site) => (
    <Link to={`/?site=${encodeURIComponent(site.id)}`} key={site.id} className={`camera-site-link ${selected === site.id ? "is-active" : ""}`} title={site.name}>
      <span className="site-bullet" />
      <span>{site.name}</span>
      <small>{cameras.filter(camera => camera.site_id === site.id).length}</small>
    </Link>
  );

  return <>
    <aside className="global-nav-rail" aria-label="Global navigation">
      <Link to="/" className="rail-brand" aria-label="Watcher-Cam overview" title="Watcher-Cam">
        <Icon name="camera" />
      </Link>
      <nav className="rail-nav" aria-label="Primary navigation">
        {nav("/", "Overview", "grid")}
        {nav("/events", "Events", "events")}
        {nav("/recordings", "Recordings", "play")}
        {nav("/reports", "Reports", "report")}
        {isAdmin && nav("/cameras", "Locations", "location")}
        {isAdmin && nav("/users", "Team", "users")}
      </nav>
    </aside>

    <aside className="camera-sidebar" aria-label="Camera and site navigation">
      <div className="camera-sidebar-head">
        <div>
          <p>Watcher-Cam</p>
          <h2>Cameras</h2>
        </div>
        <Link to="/" className="camera-sidebar-icon" title="All camera locations" aria-label="All camera locations"><Icon name="pin" /></Link>
      </div>

      <label className="camera-site-filter">
        <Icon name="search" />
        <input aria-label="Filter sites" placeholder="Filter sites" value={filter} onChange={event => setFilter(event.target.value)} />
        {filter && <button type="button" aria-label="Clear site filter" onClick={() => setFilter("")}>×</button>}
      </label>

      <nav className="camera-sites-scroll" aria-label="Sites">
        <div className="camera-sidebar-section">
          <h3><Icon name="star" />Starred</h3>
          {matches.filter(site => site.starred).map(siteRow)}
          {!matches.some(site => site.starred) && <p className="side-empty">{filter ? "No matching starred sites" : "Star sites for quick access."}</p>}
        </div>

        <div className="camera-sidebar-section">
          <h3><Icon name="location" />All Sites</h3>
          <Link to="/" className={`camera-site-link all-sites ${!selected && location.pathname === "/" ? "is-active" : ""}`}>
            <span className="site-bullet" />
            <span>All sites</span>
            <small>{sites.length}</small>
          </Link>
          {matches.map(siteRow)}
          {!matches.length && <p className="side-empty">{filter ? "No locations match your search." : "Add a location to get started."}</p>}
        </div>
      </nav>

      {isAdmin && <Link className="camera-sidebar-manage" to="/cameras"><Icon name="plus" />Manage locations</Link>}
    </aside>
  </>;
}
