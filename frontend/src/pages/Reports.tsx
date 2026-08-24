import { useEffect, useState } from "react";
import {
    API_URL,
    Camera,
    EventRow,
    ReportFilters,
    ReportSummary,
    deleteEventsBulk,
    downloadEventsCsv,
    fetchCameras,
    fetchReportEvents,
    fetchReportSummary,
} from "../lib/api";
import { formatPortalDateTime, PORTAL_TIME_ZONE_LABEL } from "../lib/time";

const REPORT_PAGE_SIZE = 500;

export function Reports() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useState<ReportFilters>({
    camera_id: "",
    event_type: "",
    source: "",
    date_from: "",
    date_to: "",
  });

  useEffect(() => {
    fetchCameras().then(setCameras).catch(() => setCameras([]));
  }, []);

  const set = (key: keyof ReportFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const generate = async () => {
    setLoading(true);
    setErr(null);

    try {
      const [eventRows, summaryData] = await Promise.all([
        fetchReportEvents(filters, REPORT_PAGE_SIZE, 0),
        fetchReportSummary(filters),
      ]);

      setEvents(eventRows);
      setSummary(summaryData);
      setPage(1);
      setSelectedIds([]);
    } catch (e) {
      setErr((e as Error).message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil((summary?.total_events || 0) / REPORT_PAGE_SIZE));

  const goToPage = async (nextPage: number) => {
    if (nextPage < 1 || nextPage > pageCount || nextPage === page) return;

    setLoading(true);
    setErr(null);

    try {
      const eventRows = await fetchReportEvents(
        filters,
        REPORT_PAGE_SIZE,
        (nextPage - 1) * REPORT_PAGE_SIZE,
      );
      setEvents(eventRows);
      setPage(nextPage);
      setSelectedIds([]);
    } catch (e) {
      setErr((e as Error).message || "Failed to load report page");
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    try {
      await downloadEventsCsv(filters);
    } catch (e) {
      setErr((e as Error).message || "CSV export failed");
    }
  };

  const allVisibleSelected =
    events.length > 0 && events.every((e) => selectedIds.includes(e.id));

  const toggleEvent = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(events.map((e) => e.id));
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;

    const ok = window.confirm(
      `Are you sure you want to delete ${selectedIds.length} selected event(s) and their snapshot image(s)? This cannot be undone.`,
    );

    if (!ok) return;

    setDeleting(true);
    setErr(null);

    try {
      await deleteEventsBulk(selectedIds);
      await generate();
    } catch (e) {
      setErr((e as Error).message || "Failed to delete selected events");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="page">
      <div className="page-inner">
        <h2 className="page-title">Reports</h2>
        <p className="page-sub">
          Generate AI reports for detected objects and camera-wise activity.
        </p>

        {/* Filters card */}
        <div className="report-card">
          <div className="report-filters">
            <label>
              From
              <input
                className="input"
                type="datetime-local"
                value={filters.date_from || ""}
                onChange={(e) => set("date_from", e.target.value)}
              />
            </label>

            <label>
              To
              <input
                className="input"
                type="datetime-local"
                value={filters.date_to || ""}
                onChange={(e) => set("date_to", e.target.value)}
              />
            </label>

            <label>
              Camera
              <select
                className="input"
                value={filters.camera_id || ""}
                onChange={(e) => set("camera_id", e.target.value)}
              >
                <option value="">All cameras</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Event Type
              <select
                className="input"
                value={filters.event_type || ""}
                onChange={(e) => set("event_type", e.target.value)}
              >
                <option value="">All events</option>
                <option value="person_detected">Person Detected</option>
                <option value="vehicle_detected">Vehicle Detected</option>
                <option value="animal_detected">Animal Detected</option>
              </select>
            </label>

            <label>
              Source
              <select
                className="input"
                value={filters.source || ""}
                onChange={(e) => set("source", e.target.value)}
              >
                <option value="">All sources</option>
                <option value="hikvision">Hikvision</option>
                <option value="yolo">YOLO</option>
              </select>
            </label>
          </div>

          <div className="flex gap-2 mt-4">
            <button className="btn primary" onClick={generate} disabled={loading}>
              {loading ? "Generating…" : "Generate Report"}
            </button>

            <button className="btn" onClick={exportCsv}>
              Export CSV
            </button>
          </div>

          {err && (
            <div className="alert alert-error mt-3">
              {err}
            </div>
          )}
        </div>

        {/* Summary boxes */}
        {summary && (
          <div className="report-summary">
            <div className="summary-box">
              <span>Total Events</span>
              <strong>{summary.total_events}</strong>
            </div>
          </div>
        )}

        {/* Camera breakdown */}
        {summary && summary.camera_breakdown.length > 0 && (
          <>
            <h3 className="mt-6 mb-3 text-base font-semibold text-theme">Camera-wise Summary</h3>

            <div className="report-table-wrap mb-5">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Camera</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.camera_breakdown.map((c) => (
                    <tr key={c.camera_id}>
                      <td>{c.camera_name}</td>
                      <td>{c.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Event details header */}
        <div className="flex items-center justify-between gap-3 mt-6 mb-3">
          <h3 className="text-base font-semibold text-theme m-0">Event Details</h3>

          <div className="flex gap-2 items-center flex-wrap">
            {summary && summary.total_events > 0 && (
              <span className="text-theme-muted text-sm">
                Page {page} of {pageCount} ({summary.total_events} events)
              </span>
            )}
            <button
              className="btn btn-secondary"
              onClick={toggleAllVisible}
              disabled={events.length === 0 || deleting}
            >
              {allVisibleSelected ? "Unselect All" : "Select All Visible"}
            </button>

            <button
              className="btn btn-danger"
              onClick={deleteSelected}
              disabled={selectedIds.length === 0 || deleting}
            >
              {deleting ? "Deleting…" : `Delete Selected (${selectedIds.length})`}
            </button>
          </div>
        </div>

        {/* Events table */}
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Time</th>
                <th>Camera</th>
                <th>Event</th>
                <th>Source</th>
                <th>Confidence</th>
                <th>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-theme-muted">No report data generated yet.</td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(e.id)}
                        onChange={() => toggleEvent(e.id)}
                      />
                    </td>
                    <td className="font-mono text-xs">{formatPortalDateTime(e.created_at)} {PORTAL_TIME_ZONE_LABEL}</td>
                    <td>{e.camera_id}</td>
                    <td>
                      <span className={`badge ${
                        e.event_type === "person_detected" ? "badge-danger" :
                        "badge-muted"
                      }`}>
                        {e.event_type}
                      </span>
                    </td>
                    <td>{e.source}</td>
                    <td>
                      {e.confidence != null
                          ? `${(e.confidence * 100).toFixed(1)}%`
                          : "—"}
                    </td>
                    <td>
                      {e.snapshot_url ? (
                        <a href={`${API_URL}${e.snapshot_url}`} target="_blank" rel="noreferrer">
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {summary && summary.total_events > REPORT_PAGE_SIZE && (
          <div className="flex justify-center items-center gap-3 mt-4">
            <button
              className="btn"
              onClick={() => goToPage(page - 1)}
              disabled={page === 1 || loading}
            >
              Previous
            </button>
            <span className="text-theme-muted text-sm">Page {page} of {pageCount}</span>
            <button
              className="btn"
              onClick={() => goToPage(page + 1)}
              disabled={page === pageCount || loading}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
