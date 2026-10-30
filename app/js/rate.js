// Store rating prompt (iOS / Android's own review sheet) at a happy moment: a streak milestone or a
// week with several perfect days. Never in the first 14 days, never in the two weeks after coming
// back from a break, at most once every 180 days (a year's test asked everyone 3 times — the
// stores' maximum; twice a year at most is gentler), and the phone itself may decide not to show it.
// No custom "do you like us?" screen — the stores don't allow gating.

import { state, save } from "./store.js";

const DAY = 86400e3;
export const MILESTONES = [7, 21, 30, 60, 100];

export function shouldAsk(now) {
  now = now || Date.now();
  if (!state || !state.meta) return false;
  if (state.meta.firstOpen && now - state.meta.firstOpen < 14 * DAY) return false;
  if (state.meta.askedRateAt && now - state.meta.askedRateAt < 180 * DAY) return false;
  if (state.meta.comeback || (state.meta.backAt && now - state.meta.backAt < 14 * DAY)) return false;
  return true;
}

export async function maybeAskForRating() {
  const c = window.Capacitor, plugin = c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins.InAppReview;
  if (!plugin || !shouldAsk()) return;
  state.meta.askedRateAt = Date.now(); save();
  setTimeout(() => { plugin.requestReview().catch(() => {}); }, 1800); // after the celebration
}
