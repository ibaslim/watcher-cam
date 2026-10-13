import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Site, saveSite, deleteSite } from "../lib/api";
import { CamerasAdmin } from "./CamerasAdmin";

export function SitesAdmin({ sites, onChanged }: { sites: Site[]; onChanged: () => void }) {
  const [params] = useSearchParams();
  const selected = sites.find(site => site.id === params.get("site"));
  const [editing, setEditing] = useState<{ id?: string; name: string; starred: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true); setError("");
    try { await saveSite({ name: editing.name.trim(), starred: editing.starred }, editing.id); onChanged(); setEditing(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(site: Site) {
    if (!confirm(`Delete site "${site.name}"? Only empty sites can be deleted.`)) return;
    setError("");
    try { await deleteSite(site.id); onChanged(); } catch (e) { setError((e as Error).message); }
  }
  return <>
    <main className="page">
      <div className="page-inner">
        <div className="site-heading">
          <div><h2 className="page-title">Locations</h2><p className="page-sub">Create a site, then add its cameras.</p></div>
          <button className="btn primary" onClick={() => { setError(""); setEditing({ name: "", starred: false }); }}>+ Add location</button>
        </div>
        {error && !editing && <div role="alert" className="alert alert-error">{error}</div>}
        {selected ? <div className="site-heading"><Link className="btn" to="/cameras">← All locations</Link><div className="flex gap-2"><button className="btn" onClick={() => setEditing(selected)}>Edit location</button><button className="btn btn-danger" onClick={() => remove(selected)}>Delete location</button></div></div> :
          <div className="site-cards">{sites.map(site => <article className="panel p-5" key={site.id}>
            <h3 className="text-lg font-semibold mb-4">{site.starred ? "★ " : ""}{site.name}</h3>
            <div className="flex gap-2 flex-wrap"><Link className="btn primary" to={`/cameras?site=${encodeURIComponent(site.id)}`}>Manage cameras</Link><button className="btn" onClick={() => { setError(""); setEditing(site); }}>Edit</button><button className="btn btn-danger" onClick={() => remove(site)}>Delete</button></div>
          </article>)}</div>}
        {!sites.length && <div className="empty">Add your first location, such as Wapda Town Office, to get started.</div>}
        {params.has("site") && !selected && <div className="empty">This location is unavailable. Select a location above.</div>}
      </div>
    </main>
    {selected && <CamerasAdmin key={selected.id} site={selected} sites={sites} onCamerasChanged={onChanged} />}
    {editing && <div className="modal-overlay"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="site-form-title" onSubmit={submit}>
      <h3 id="site-form-title">{editing.id ? "Edit location" : "Add location"}</h3>
      {error && <div role="alert" className="alert alert-error mb-3">{error}</div>}
      <label htmlFor="site-name">Location name</label>
      <input id="site-name" autoFocus required maxLength={128} className="input mt-2 mb-4 w-full" placeholder="e.g. Wapda Town Office" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
      <label className="check-row"><input type="checkbox" checked={editing.starred} onChange={e => setEditing({ ...editing, starred: e.target.checked })} /> Star this location</label>
      <div className="flex gap-2 justify-end mt-5"><button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy || !editing.name.trim()}>{busy ? "Saving…" : "Save location"}</button></div>
    </form></div>}
  </>;
}
