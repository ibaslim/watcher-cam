/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Verkada aliases (used by NavBar, CameraTile, Login, Dashboard, EventLog)
        verkada: {
          canvas:  "var(--canvas)",
          surface: "var(--surface)",
          card:    "var(--card)",
          hover:   "var(--hover)",
          border:  "var(--border)",
        },
        // Dark theme (default)
        dark: {
          canvas:  "#0B0E14",
          surface: "#121721",
          card:    "#18202E",
          hover:   "#1F2A3E",
          border:  "#242F42",
          text:    "#e2e8f0",
          muted:   "#94a3b8",
          dim:     "#64748b",
        },
        // Light theme
        light: {
          canvas:  "#f0f4f8",
          surface: "#ffffff",
          card:    "#f8fafc",
          hover:   "#e2e8f0",
          border:  "#cbd5e1",
          text:    "#0f172a",
          muted:   "#475569",
          dim:     "#64748b",
        },
        // Semantic / brand
        brand: {
          DEFAULT: "#3b82f6",
          hover:   "#2563eb",
          muted:   "rgba(59,130,246,0.12)",
          border:  "rgba(59,130,246,0.25)",
        },
        ok:     { DEFAULT: "#22c55e", muted: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.25)"  },
        warn:   { DEFAULT: "#f59e0b", muted: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)" },
        danger: { DEFAULT: "#ef4444", muted: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.25)"  },
        info:   { DEFAULT: "#06b6d4", muted: "rgba(6,182,212,0.12)",  border: "rgba(6,182,212,0.25)"  },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card:  "0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
        modal: "0 20px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4)",
        glow:  "0 0 0 3px rgba(59,130,246,0.3)",
      },
      animation: {
        "fade-in":    "fadeIn 0.15s ease-out",
        "slide-up":   "slideUp 0.2s ease-out",
        "spin-slow":  "spin 2s linear infinite",
      },
      keyframes: {
        fadeIn:  { from: { opacity: "0" },                    to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
}
