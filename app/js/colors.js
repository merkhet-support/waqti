// Habit colours: picked in the editor, or chosen from the category when left on "Auto".
// Mid-tone shades so they read on both the light and dark themes.

export const HABIT_COLORS = ["#14a394", "#3b82f6", "#8b5cf6", "#ec4899", "#ef6a4c", "#f59e0b", "#84cc16", "#06b6d4", "#a16207", "#64748b"];

const BY_CATEGORY = {
  "Daily Rhythm": "#14a394", Sleep: "#8b5cf6", Fitness: "#ef6a4c", Nutrition: "#84cc16", Health: "#ec4899",
  Grooming: "#06b6d4", Faith: "#f59e0b", Growth: "#3b82f6", Family: "#ec4899", Home: "#a16207",
  Money: "#14a394", Social: "#06b6d4", Work: "#64748b"
};

// Text/check colour that stays readable on top of a habit colour (WCAG contrast ≥ 4.5 where possible).
const DARK_INK = "#0b1a18";
function luminance(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function inkOn(hex) {
  const L = luminance(hex), Ld = luminance(DARK_INK);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / (Ld + 0.05)) ? "#ffffff" : DARK_INK;
}

export function colorOf(h) {
  if (h.color) return h.color;
  return BY_CATEGORY[h.category] || HABIT_COLORS[[...(h.category || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % HABIT_COLORS.length];
}
