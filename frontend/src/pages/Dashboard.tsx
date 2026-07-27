import { Camera, EventRow } from "../lib/api";
import { CameraTile } from "../components/CameraTile";

type Props = { cameras: Camera[]; events: EventRow[]; hidden?: boolean };

export function Dashboard({ cameras, events, hidden = false }: Props) {
  // Stay mounted when hidden so WebRTC tiles keep streaming between routes.
  return (
    <main className="flex-1 overflow-auto p-4 md:p-6 bg-verkada-canvas" style={hidden ? { display: "none" } : undefined}>
      <section className="flex items-end justify-between gap-4 mb-3 max-w-7xl mx-auto">
        <div>
          <p className="text-xs font-medium text-blue-400 uppercase tracking-wider mb-1">Live monitoring</p>
          <h2 className="text-3xl font-bold text-theme m-0">Camera Dashboard</h2>
        </div>

        <div className="grid grid-cols-3 gap-2" aria-label="Camera status summary">
          <div className="bg-verkada-card border border-verkada-border rounded-lg p-3.5 flex flex-col justify-between shadow-sm">
            <strong className="text-xl font-bold font-mono text-theme">{cameras.length}</strong>
            <span className="text-xs font-medium text-theme-muted uppercase tracking-wider">Total cameras</span>
          </div>
          <div className="bg-verkada-card border border-verkada-border rounded-lg p-3.5 flex flex-col justify-between shadow-sm">
            <strong className="text-xl font-bold font-mono text-theme">{cameras.filter((c) => c.detect).length}</strong>
            <span className="text-xs font-medium text-theme-muted uppercase tracking-wider">AI enabled</span>
          </div>
          <div className="bg-verkada-card border border-verkada-border rounded-lg p-3.5 flex flex-col justify-between shadow-sm">
            <strong className="text-xl font-bold font-mono text-theme">{cameras.filter((c) => c.recording_enabled).length}</strong>
            <span className="text-xs font-medium text-theme-muted uppercase tracking-wider">Recording</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-w-7xl mx-auto">
        {cameras.length === 0 ? (
          <div className="col-span-full text-center py-12 text-theme-muted">No cameras configured. Add cameras from the Cameras page.</div>
        ) : (
          cameras.map((camera) => <CameraTile key={camera.id} camera={camera} events={events} />)
        )}
      </div>
    </main>
  );
}
