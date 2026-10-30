// Quit trackers: the time of day urges and slips cluster, so a heads-up can come just before it.

// The 2-hour window holding most urges and slips over the last 60 days, if it's a clear one
// (at least 3 events and 40% of them). { from, to } in minutes after midnight, plus counts.
export function riskyWindow(q, now) {
  const since = (now || Date.now()) - 60 * 86400e3;
  const ev = (q.urges || []).map(u => u.at).concat((q.slips || []).map(s => s.at)).concat((q.uses || []).map(u => u.at)).filter(t => t && t >= since);
  if (ev.length < 4) return null;
  const bins = Array(12).fill(0);
  ev.forEach(t => bins[Math.floor(new Date(t).getHours() / 2)]++);
  const best = bins.indexOf(Math.max(...bins));
  return bins[best] >= 3 && bins[best] / ev.length >= 0.4 ? { from: best * 120, to: best * 120 + 120, n: bins[best], of: ev.length } : null;
}
