import { useCallback, useEffect, useState } from "react";
import {
  API_URL,
  Camera,
  fetchPersonAppearances,
  fetchPersons,
  PersonAppearanceRow,
  PersonIdentityRow,
} from "../lib/api";
import { formatPortalDateTime, PORTAL_TIME_ZONE_LABEL } from "../lib/time";

type Props = { cameras: Camera[] };

export function Persons({ cameras }: Props) {
  const [cameraId, setCameraId] = useState("");
  const [persons, setPersons] = useState<PersonIdentityRow[]>([]);
  const [selected, setSelected] = useState<PersonIdentityRow | null>(null);
  const [album, setAlbum] = useState<PersonAppearanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [albumLoading, setAlbumLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPersons(await fetchPersons(cameraId || undefined));
    } finally {
      setLoading(false);
    }
  }, [cameraId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openAlbum = async (person: PersonIdentityRow) => {
    setSelected(person);
    setAlbumLoading(true);
    try {
      setAlbum(await fetchPersonAppearances(person.entity_id, cameraId || undefined));
    } finally {
      setAlbumLoading(false);
    }
  };

  return (
    <main className="page">
      <div className="page-inner !max-w-[1400px]">
        <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Face identity gallery</p>
            <h2 className="page-title">Persons</h2>
            <p className="page-sub !mb-0">Each clear, unique face receives a persistent code and a private album of its appearances.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input min-w-48" value={cameraId} onChange={(event) => setCameraId(event.target.value)}>
              <option value="">All cameras</option>
              {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
            </select>
            <button className="btn" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </section>

        {loading ? (
          <Empty text="Loading identity gallery…" />
        ) : (
          persons.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {persons.map((person) => {
              const src = person.image_url ? `${API_URL}${person.image_url}` : null;
              return <article key={person.entity_id} className="overflow-hidden rounded-[24px] border border-verkada-border bg-verkada-surface shadow-sm">
                {src ? <img src={src} alt={person.entity_id} className="h-52 w-full object-cover" /> : <ImagePlaceholder text="No representative image" />}
                <div className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div><p className="font-semibold text-theme">{person.display_name || "Unknown person"}</p><code className="text-xs text-blue-400">{person.entity_id}</code></div>
                    <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase text-amber-300">{person.status}</span>
                  </div>
                  <p className="text-xs text-theme-muted">{person.appearance_count} screenshot{person.appearance_count === 1 ? "" : "s"}</p>
                  <p className="mt-1 text-xs text-theme-muted">Last seen {formatPortalDateTime(person.last_seen)} {PORTAL_TIME_ZONE_LABEL}</p>
                  <button className="btn primary mt-4 w-full" onClick={() => void openAlbum(person)}>Open person album</button>
                </div>
              </article>;
            })}
          </div> : <Empty text="No clear faces have been assigned a person code yet." />
        )}
      </div>

      {selected ? <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/85 p-4 md:p-8" onClick={() => setSelected(null)}>
        <section className="mx-auto max-w-6xl overflow-hidden rounded-[28px] border border-verkada-border bg-verkada-canvas" onClick={(event) => event.stopPropagation()}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-verkada-border bg-verkada-surface p-5">
            <div><p className="eyebrow">Person album</p><h3 className="text-xl font-semibold text-theme">{selected.display_name || selected.entity_id}</h3><code className="text-xs text-blue-400">{selected.entity_id}</code></div>
            <button className="btn" onClick={() => setSelected(null)}>Close</button>
          </header>
          <div className="p-5">{albumLoading ? <Empty text="Loading album…" /> : album.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{album.map((appearance) => {
            const src = appearance.person_crop_url || appearance.snapshot_url;
            return <article key={appearance.id} className="overflow-hidden rounded-[20px] border border-verkada-border bg-verkada-surface">{src ? <img src={`${API_URL}${src}`} alt={selected.entity_id} className="h-56 w-full object-cover" /> : <ImagePlaceholder text="Screenshot unavailable" />}<div className="p-3 text-xs text-theme-muted"><p>{appearance.camera_id}</p><p>{formatPortalDateTime(appearance.created_at)} {PORTAL_TIME_ZONE_LABEL}</p>{appearance.match_score != null ? <p className="mt-1 text-emerald-300">Face match {(appearance.match_score * 100).toFixed(1)}%</p> : <p className="mt-1 text-blue-300">New clear face</p>}</div></article>;
          })}</div> : <Empty text="This person has no retained screenshots." />}</div>
        </section>
      </div> : null}
    </main>
  );
}

function Empty({ text }: { text: string }) { return <div className="rounded-[22px] border border-verkada-border bg-verkada-surface p-8 text-center text-sm text-theme-muted">{text}</div>; }
function ImagePlaceholder({ text }: { text: string }) { return <div className="flex h-52 items-center justify-center bg-verkada-hover text-sm text-theme-muted">{text}</div>; }
