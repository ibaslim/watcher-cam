import { Recordings } from "./pages/Recordings";
import { Users } from "./pages/Users";
import { Reports } from "./pages/Reports";
import { Events } from "./pages/Events";
import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import {
    Camera,
    CurrentUser,
    EventRow,
    fetchAuthStatus,
    fetchCameras,
    fetchEvents,
    fetchMe,
    getToken,
    setToken,
} from "./lib/api";
import { connectEvents, notify, requestDesktopNotifications, WsEvent } from "./lib/ws";
import { NavBar } from "./components/NavBar";
import { SessionTimeout } from "./components/SessionTimeout";
import { Dashboard } from "./pages/Dashboard";
import { CamerasAdmin } from "./pages/CamerasAdmin";
import { Login } from "./pages/Login";
import { CameraDetail } from "./pages/CameraDetail";
import { isPortalToday, portalTodayApiRange } from "./lib/time";

type AuthState = "checking" | "needed" | "ok";
export function App() {
    const [authState, setAuthState] = useState<AuthState>("checking");
    const [user, setUser] = useState<CurrentUser | null>(null);
    const [cameras, setCameras] = useState<Camera[]>([]);
    const [events, setEvents] = useState<EventRow[]>([]);
    const [online, setOnline] = useState(false);

    useEffect(() => {
        let cancelled = false;

        fetchAuthStatus()
            .then(({ auth_required }) => {
                if (cancelled) return;

                if (!auth_required) {
                    setToken("");
                    setAuthState("ok");
                    return;
                }

                if (getToken()) {
                    fetchMe()
                        .then((u) => {
                            if (cancelled) return;
                            setUser(u);
                            setAuthState("ok");
                        })
                        .catch(() => {
                            setToken("");
                            setUser(null);
                            setAuthState("needed");
                        });
                } else {
                    setAuthState("needed");
                }
            })
            .catch(() => setAuthState("needed"));

        return () => {
            cancelled = true;
        };
    }, []);

    const refreshCameras = () =>
        fetchCameras().then(setCameras).catch(() => setCameras([]));

    useEffect(() => {
        if (authState !== "ok") return;

        refreshCameras();
        fetchEvents(portalTodayApiRange()).then(setEvents).catch(() => setEvents([]));
        requestDesktopNotifications();

        const disconnect = connectEvents(
            (e: WsEvent) => {
                setEvents((prev) => {
                    const nextEvent = {
                        id: e.id,
                        camera_id: e.camera_id,
                        created_at: e.created_at,
                        source: e.source,
                        event_type: e.event_type,
                        label: e.label ?? null,
                        confidence: e.confidence ?? null,
                        snapshot_url: e.snapshot_path ? `/snapshots/${e.snapshot_path}` : null,
                    };

                    if (!isPortalToday(nextEvent.created_at)) {
                        return prev.filter((event) => isPortalToday(event.created_at));
                    }

                    return [
                        nextEvent,
                        ...prev.filter((event) => isPortalToday(event.created_at)),
                    ];
                });

                notify(
                    `${e.label || e.event_type} — ${e.camera_id}`,
                    `${e.source}${e.confidence ? ` · ${(e.confidence * 100).toFixed(0)}%` : ""}`,
                );
            },
            (status) => {
                setOnline(status === "open");
            },
        );

        return disconnect;
    }, [authState]);

    if (authState === "checking") return null;

    if (authState === "needed") {
        return (
            <Login
                onAuthed={async () => {
                    const u = await fetchMe();
                    setUser(u);
                    setAuthState("ok");
                }}
            />
        );
    }

    return (
        <BrowserRouter>
            <AppShell
                online={online}
                cameras={cameras}
                events={events}
                onCamerasChanged={refreshCameras}
                user={user}
            />
        </BrowserRouter>
    );
}

function AppShell({
    online,
    cameras,
    events,
    onCamerasChanged,
    user,
}: {
    online: boolean;
    cameras: Camera[];
    events: EventRow[];
    onCamerasChanged: () => void;
    user: CurrentUser | null;
}) {
    const location = useLocation();
    const isAdmin = user?.role === "administrator";

    return (
        <div className="min-h-screen bg-verkada-canvas text-theme font-sans flex flex-col">
            <NavBar online={online} user={user} />
            <SessionTimeout />

            <Dashboard cameras={cameras} events={events} hidden={location.pathname !== "/"} />

            <Routes>
                <Route path="/" element={null} />

                <Route
                    path="/cameras"
                    element={
                        isAdmin ? (
                            <CamerasAdmin onCamerasChanged={onCamerasChanged} />
                        ) : (
                            <Forbidden />
                        )
                    }
                />

                <Route path="/users" element={isAdmin ? <Users /> : <Forbidden />} />
                <Route path="/events" element={<Events events={events} cameras={cameras} />} />
                <Route path="/recordings" element={<Recordings />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/cameras/:cameraId" element={<CameraDetail cameras={cameras} />} />
            </Routes>
        </div>
    );
}

function Forbidden() {
    return (
        <main className="page">
            <div className="page-inner">
                <h2 className="page-title">Access denied</h2>
                <p className="page-sub">You do not have permission to access this page.</p>
            </div>
        </main>
    );
}
