// A short confetti burst for finishing a day, a streak milestone or the setup commitment.
// Skipped when the person asked their system for reduced motion.

const COLORS = ["#0f8f83", "#e0a526", "#e8604c", "#5b7cfa", "#9b5de5", "#2bb673"];

export function celebrate(opts) {
  const o = Object.assign({ x: 0.5, y: 0.35, count: 36 }, opts || {});
  try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { /* ignore */ }
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.className = "confetti";
  box.setAttribute("aria-hidden", "true");
  for (let i = 0; i < o.count; i++) {
    const p = document.createElement("i");
    const a = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 160;
    p.style.left = (o.x * 100) + "%";
    p.style.top = (o.y * 100) + "%";
    p.style.background = COLORS[i % COLORS.length];
    p.style.setProperty("--dx", Math.round(Math.cos(a) * dist) + "px");
    p.style.setProperty("--dy", Math.round(Math.sin(a) * dist * 0.7 + 140) + "px");
    p.style.setProperty("--r", Math.round(Math.random() * 720 - 360) + "deg");
    p.style.animationDelay = Math.round(Math.random() * 90) + "ms";
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1700);
}
