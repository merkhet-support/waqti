// Error reporting: keeps the last 20 errors on the device (shown in Settings →
// Report a problem) and, if CONFIG.sentryDsn is set, sends them to Sentry.

import { CONFIG } from "./config.js";

const KEY = "rafeeq_errors";
let sentry = null;

function remember(entry) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    list.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
  } catch (e) { /* storage blocked */ }
}

export function recentErrors() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
}
export function clearErrors() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

export function report(err, where) {
  const msg = (err && (err.message || err.reason && err.reason.message)) || String(err);
  remember({ at: new Date().toISOString(), where: where || "", msg: msg.slice(0, 300), stack: String((err && err.stack) || "").slice(0, 800), v: CONFIG.version });
  if (sentry) sentry.captureException(err instanceof Error ? err : new Error(msg));
}

export function initErrors() {
  window.addEventListener("error", e => report(e.error || e.message, "window"));
  window.addEventListener("unhandledrejection", e => report(e.reason || "Unhandled rejection", "promise"));
  if (CONFIG.sentryDsn) {
    // Third-party code is never downloaded at run time: a changed or hijacked remote file would run
    // with full access to the app's data (and the Content Security Policy blocks remote scripts anyway).
    // To use Sentry, download its bundle once, check it, and save it as www/vendor/sentry.min.js.
    const s = document.createElement("script");
    s.src = "vendor/sentry.min.js";
    s.onload = () => {
      if (!window.Sentry) return;
      window.Sentry.init({ dsn: CONFIG.sentryDsn, release: "waqti@" + CONFIG.version, sendDefaultPii: false, tracesSampleRate: 0 });
      sentry = window.Sentry;
    };
    document.head.appendChild(s);
  }
}

export function diagnostics() {
  return [
    "Waqti " + CONFIG.version,
    "Platform: " + ((window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || "web"),
    "Agent: " + navigator.userAgent,
    "Time zone: " + Intl.DateTimeFormat().resolvedOptions().timeZone,
    "",
    "Recent errors:",
    ...recentErrors().map(e => e.at + " [" + e.where + "] " + e.msg)
  ].join("\n");
}
