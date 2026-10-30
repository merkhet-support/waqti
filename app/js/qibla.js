// Qibla: great-circle bearing and distance from the prayer location to the Kaaba.

export const KAABA = { lat: 21.422487, lng: 39.826206 };
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

// Degrees clockwise from true north.
export function qiblaBearing(lat, lng) {
  const p1 = rad(lat), p2 = rad(KAABA.lat), dl = rad(KAABA.lng - lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function distanceKm(lat, lng) {
  const p1 = rad(lat), p2 = rad(KAABA.lat), dp = p2 - p1, dl = rad(KAABA.lng - lng);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compassPoint = b => POINTS[Math.round(b / 45) % 8];
