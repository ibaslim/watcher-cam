import { Link, useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { Camera, EventRow, Site } from "../lib/api";
import { CameraTile } from "../components/CameraTile";

type Props = { cameras: Camera[]; events: EventRow[]; sites: Site[]; isAdmin: boolean; hidden?: boolean };

export function Dashboard({ cameras, events, sites, isAdmin, hidden = false }: Props) {
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const selected = params.get("site");
  const groups = useMemo(() => {
    const nextGroups = sites.map(site => ({ ...site, cameras: cameras.filter(camera => camera.site_id === site.id) }));
    const unassigned = cameras.filter(camera => !camera.site_id || !sites.some(site => site.id === camera.site_id));
    if (unassigned.length) nextGroups.push({ id: "unassigned", name: "Other cameras", starred: false, cameras: unassigned });
    return nextGroups;
  }, [cameras, sites]);
  const visible = useMemo(() => {
    const selectedGroups = selected ? groups.filter(site => site.id === selected) : groups;
    const needle = query.trim().toLowerCase();
    if (!needle) return selectedGroups;
    return selectedGroups
      .map(site => ({
        ...site,
        cameras: site.name.toLowerCase().includes(needle)
          ? site.cameras
          : site.cameras.filter(camera => camera.name.toLowerCase().includes(needle) || camera.id.toLowerCase().includes(needle)),
      }))
      .filter(site => site.name.toLowerCase().includes(needle) || site.cameras.length > 0);
  }, [groups, query, selected]);
  const visibleCameraCount = visible.reduce((count, site) => count + site.cameras.length, 0);

  return <main className="page" style={hidden ? { display: "none" } : undefined}>
    <div className="dashboard-workspace">
      <div className="dashboard-search-row">
        <label className="dashboard-search">
          <span aria-hidden>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            aria-label="Search sites and cameras"
          />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
        </label>
      </div>

      <div className="dashboard-heading">
        <div>
          <p>Live monitoring</p>
          <h1>{selected ? groups.find(site => site.id === selected)?.name || "Location unavailable" : "All sites"}</h1>
          <span>{visible.length} locations · {visibleCameraCount} cameras</span>
        </div>
        {isAdmin && <Link className="dashboard-action" to={selected && selected !== "unassigned" ? `/cameras?site=${encodeURIComponent(selected)}` : "/cameras"}>{selected ? "Manage cameras" : "Add location"}</Link>}
      </div>
      {!groups.length && <div className="empty">No locations yet. {isAdmin ? "Add a location, then connect your cameras." : "Your administrator can add locations and cameras."}</div>}
      {selected && !groups.some(site => site.id === selected) && <div className="empty">This location is unavailable. <Link to="/">View all sites</Link></div>}
      {groups.length > 0 && !visible.length && <div className="empty">No cameras or sites match your search.</div>}
      <div className={`site-camera-groups ${selected ? "single-site" : ""}`}>
        {visible.map(site => <section key={site.id} className="site-camera-group">
          <div className="site-group-header">
            <Link className="site-title" to={`/?site=${encodeURIComponent(site.id)}`}>{site.starred && <span className="site-star">★</span>}{site.name}</Link>
            <span className="site-count">{site.cameras.length}</span>
            <span className="site-header-spacer" />
            {isAdmin && site.id !== "unassigned" && <Link className="site-menu-button" aria-label={`Manage ${site.name}`} to={`/cameras?site=${encodeURIComponent(site.id)}`}>Manage</Link>}
            <button className="site-more-button" type="button" aria-label={`${site.name} actions`}>...</button>
          </div>
          <div className="site-camera-grid">{site.cameras.map(camera => <CameraTile key={camera.id} camera={camera} events={events} />)}</div>
          {!site.cameras.length && <div className="empty">No cameras at this location.{isAdmin && <Link className="btn mt-3" to={`/cameras?site=${encodeURIComponent(site.id)}`}>+ Add cameras</Link>}</div>}
        </section>)}
      </div>
    </div>
  </main>;
}
