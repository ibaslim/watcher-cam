import { useState } from "react";
import { login, setToken } from "../lib/api";
import { getStoredTheme, setTheme, Theme } from "../lib/theme";

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [theme, updateTheme] = useState<Theme>(getStoredTheme);

  const switchTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    updateTheme(nextTheme);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      const { token } = await login(username, password);
      setToken(token);
      onAuthed();
    } catch (error) {
      setErr(
        error instanceof Error && error.message.startsWith("cannot reach")
          ? "Cannot reach the backend. Check that the API is running and accessible."
          : "Invalid username or password.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-verkada-canvas text-theme selection:bg-blue-500 selection:text-white">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-[440px] shrink-0 border-r border-verkada-border bg-verkada-surface p-8">
        <div className="flex items-center gap-3">
          <img
            src="/logo.svg"
            alt="Sentinel Vision"
            width={36}
            height={36}
            className="w-9 h-9 rounded-lg bg-blue-600/20 p-1 border border-blue-500/30 shrink-0"
          />
          <span className="text-theme font-semibold text-base tracking-tight">
            Sentinel Vision 2
          </span>
        </div>

        <div className="my-auto py-6">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-5 text-blue-400">
            <svg
              width={24}
              height={24}
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-theme mb-2">
            AI-Powered Camera Monitoring
          </h2>
          <p className="text-theme-muted text-sm mb-6 leading-relaxed">
            Real-time surveillance with intelligent face recognition, object
            detection and automated camera monitoring.
          </p>

          <div className="space-y-3">
            {[
              "Face recognition & unknown person alerts",
              "Live RTSP stream monitoring",
              "Real-time person, vehicle, and animal detection",
            ].map((text) => (
              <div
                key={text}
                className="flex items-center gap-2.5 text-xs text-theme-muted"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-theme-muted text-xs">© 2026 Sentinel Vision</p>
      </div>

      {/* Right login form panel */}
      <div className="relative flex-1 flex flex-col items-center justify-center p-6 bg-verkada-canvas">
        <button
          type="button"
          className="theme-toggle absolute top-6 right-6"
          onClick={switchTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
          <span>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>

        <div className="w-full max-w-[360px] mx-auto">
          {/* Logo (mobile only) */}
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <img
              src="/logo.svg"
              alt="Sentinel Vision"
              width={32}
              height={32}
              className="w-8 h-8 rounded-lg bg-blue-600/20 p-1 border border-blue-500/30 shrink-0"
            />
            <span className="text-theme font-bold text-base">
              Sentinel Vision
            </span>
          </div>

          <div className="mb-6">
            <h1 className="text-xl font-bold text-theme mb-1">Welcome back</h1>
            <p className="text-xs text-theme-muted">
              Sign in to your account to continue
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-theme-muted mb-1 tracking-wider uppercase">
                Username
              </label>
              <input
                type="text"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="input"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-theme-muted mb-1 tracking-wider uppercase">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
              />
            </div>

            {err && (
              <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !username || !password}
              className="btn-primary w-full py-2.5"
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-6 p-3 rounded-md bg-verkada-card border border-verkada-border text-xs text-theme-muted">
            Default credentials:{" "}
            <code className="text-theme bg-verkada-hover px-1 py-0.5 rounded font-mono">
              admin
            </code>{" "}
            /{" "}
            <code className="text-theme bg-verkada-hover px-1 py-0.5 rounded font-mono">
              Admin@12345
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
