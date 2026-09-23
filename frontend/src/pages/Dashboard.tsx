import { Link, useSearchParams } from "react-router-dom";
import { Camera, EventRow, Site } from "../lib/api";
import { CameraTile } from "../components/CameraTile";

type Props = { cameras: Camera[]; events: EventRow[]; sites: Site[]; isAdmin: boolean; hidden?: boolean };

export function Dashboard({ cameras, events, sites, isAdmin, hidden = false }: Props) {
  const [params] = useSearchParams();
  const selected = params.get("site");
  const groups = sites.map(site => ({ ...site, cameras: cameras.filter(camera => camera.site_id === site.id) }));
  const unassigned = cameras.filter(camera => !camera.site_id || !sites.some(site => site.id === camera.site_id));
  if (unassigned.length) groups.push({ id: "unassigned", name: "Other cameras", starred: false, cameras: unassigned });
  const visible = selected ? groups.filter(site => site.id === selected) : groups;
  return <main className="page" style={hidden ? { display: "none" } : undefined}>
    <div className="page-inner">
      <div className="site-heading">
        <div><p className="text-xs text-theme-muted uppercase tracking-wider mb-2">Live monitoring</p><h2 className="page-title">{selected ? visible[0]?.name || "Location unavailable" : "All sites"}</h2><p className="page-sub">{visible.length} locations · {visible.reduce((count, site) => count + site.cameras.length, 0)} cameras</p></div>
        {isAdmin && <Link className="btn primary" to={selected && selected !== "unassigned" ? `/cameras?site=${encodeURIComponent(selected)}` : "/cameras"}>{selected ? "Manage cameras" : "+ Add location"}</Link>}
      </div>
      {!groups.length && <div className="empty">No locations yet. {isAdmin ? "Add a location, then connect your cameras." : "Your administrator can add locations and cameras."}</div>}
      {selected && !visible.length && <div className="empty">This location is unavailable. <Link to="/">View all sites</Link></div>}
      <div className={`site-camera-groups ${selected ? "single-site" : ""}`}>
        {groups.map(site => <section key={site.id} className="site-camera-group" style={selected && selected !== site.id ? { display: "none" } : undefined}>
          <div className="site-heading mb-3"><Link className="site-title" to={`/?site=${encodeURIComponent(site.id)}`}>{site.starred && <span className="text-amber-400">★ </span>}{site.name} <small>{site.cameras.length}</small></Link>
            {isAdmin && site.id !== "unassigned" && <Link className="btn" aria-label={`Manage ${site.name}`} to={`/cameras?site=${encodeURIComponent(site.id)}`}>Manage</Link>}
          </div>
          <div className="site-camera-grid">{site.cameras.map(camera => <CameraTile key={camera.id} camera={camera} events={events} />)}</div>
          {!site.cameras.length && <div className="empty">No cameras at this location.{isAdmin && <Link className="btn mt-3" to={`/cameras?site=${encodeURIComponent(site.id)}`}>+ Add cameras</Link>}</div>}
        </section>)}
      </div>
    </div>
  </main>;
}
