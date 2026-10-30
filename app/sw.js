// Service worker: offline app shell + notification actions (Done / Snooze).
const CACHE = "waqti-v2.12.3";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/styles.css", "fonts/fonts.css", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "sounds/waqti_chime.wav", "sounds/church_bell.wav",
  "js/app.js", "js/config.js", "js/i18n.js", "js/i18n-ar.js", "js/backup.js", "js/errors.js", "js/util.js", "js/dates.js", "js/store.js", "js/routine.js", "js/prayer.js", "js/hijri.js", "js/faith.js",
  "js/schedule.js", "js/reminders.js", "js/notify.js", "js/tasks.js", "js/ics.js", "js/calendars.js", "js/msgraph.js", "js/health.js", "js/templates.js", "js/emoji-data.js",
  "js/colors.js", "js/lists.js", "js/pro.js", "js/qibla.js", "js/rate.js", "js/requests.js", "js/review.js", "js/sounds.js", "js/widgets.js", "js/seasons.js", "js/hebrew.js", "js/lunar.js", "js/fasting.js", "js/quits.js", "js/sleep.js", "js/ui/plan.js", "js/ui/me.js", "js/ui/share.js", "js/lock.js", "js/demo.js", "js/occasions.js", "js/cycle.js", "js/ui/life.js",
  "js/ui/core.js", "js/ui/components.js", "js/ui/emoji-picker.js", "js/ui/editor.js", "js/ui/routine-form.js", "js/ui/faith-form.js",
  "js/ui/onboarding.js", "js/ui/today.js", "js/ui/habit-detail.js", "js/ui/quit.js", "js/ui/habits.js", "js/ui/insights.js",
  "js/ui/faith-view.js", "js/ui/settings.js", "js/ui/tasks-ui.js", "js/ui/calendar.js", "js/ui/connections.js",
  "js/ui/celebrate.js", "js/ui/lists.js", "js/ui/prayer-extras.js", "js/ui/requests.js", "js/ui/review.js", "js/ui/whats-new.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first for the app files (so updates land), cache as offline fallback.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => hit)));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("index.html"))));
});

self.addEventListener("notificationclick", e => {
  const n = e.notification;
  const data = n.data || {};
  const action = e.action; // "done" | "snooze" | "plus" (count habits) | "" (body tap)
  n.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = all[0];
    if (data.habitId && (action === "done" || action === "snooze" || action === "plus")) {
      if (client) { client.postMessage({ type: "notification-action", action, habitId: data.habitId, day: data.day }); return; }
      const url = "./?action=" + action + "&habit=" + encodeURIComponent(data.habitId) + "&day=" + encodeURIComponent(data.day || "");
      await self.clients.openWindow(url);
      return;
    }
    if (client) { await client.focus(); return; }
    await self.clients.openWindow("./");
  })());
});
