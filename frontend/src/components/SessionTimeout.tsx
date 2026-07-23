import { useEffect, useRef, useState } from "react";
import { setToken } from "../lib/api";

export const TIMEOUT_MINUTES = 30;
export const WARNING_MINUTES = 5;

export const TIMEOUT_MS = TIMEOUT_MINUTES * 60 * 1000;
export const WARNING_MS = WARNING_MINUTES * 60 * 1000;

function broadcastSessionRemaining(seconds: number): void {
  window.dispatchEvent(new CustomEvent("session-remaining", { detail: seconds }));
}

export function SessionTimeout() {
  const lastActivityRef = useRef(Date.now());
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSec, setRemainingSec] = useState(WARNING_MINUTES * 60);

  const logout = () => {
    setToken("");
    window.location.reload();
  };

  const continueSession = () => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    setRemainingSec(WARNING_MINUTES * 60);
    broadcastSessionRemaining(TIMEOUT_MINUTES * 60);
  };

  useEffect(() => {
    const markActivity = () => {
      if (!showWarning) {
        lastActivityRef.current = Date.now();
      }
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

    events.forEach((ev) => window.addEventListener(ev, markActivity));

    const timer = window.setInterval(() => {
      const inactiveMs = Date.now() - lastActivityRef.current;
      const remainingMs = TIMEOUT_MS - inactiveMs;
      const nextRemainingSec = Math.max(0, Math.ceil(remainingMs / 1000));

      broadcastSessionRemaining(nextRemainingSec);

      if (remainingMs <= 0) {
        logout();
        return;
      }

      if (remainingMs <= WARNING_MS) {
        setShowWarning(true);
        setRemainingSec(nextRemainingSec);
      }
    }, 1000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, markActivity));
      window.clearInterval(timer);
    };
  }, [showWarning]);

  if (!showWarning) return null;

  const min = Math.floor(remainingSec / 60);
  const sec = remainingSec % 60;

  return (
    <div className="session-timeout-overlay">
      <div className="session-timeout-modal">
        <h3>Session Expiring</h3>
        <p>Your session will expire due to inactivity.</p>

        <div className="session-countdown">
          {String(min).padStart(2, "0")}:{String(sec).padStart(2, "0")}
        </div>

        <div className="session-actions">
          <button className="btn btn-secondary" onClick={logout}>
            Logout
          </button>
          <button className="btn" onClick={continueSession}>
            Continue Session
          </button>
        </div>
      </div>
    </div>
  );
}
