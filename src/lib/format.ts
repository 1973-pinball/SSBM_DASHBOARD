export const pct = (x: number | null, digits = 1): string =>
  x === null ? "—" : `${(x * 100).toFixed(digits)}%`;

export const num = (x: number | null, digits = 1): string =>
  x === null ? "—" : x.toFixed(digits);

export const int = (x: number | null): string => (x === null ? "—" : Math.round(x).toLocaleString());

/**
 * Hours played, formatted one way everywhere it appears — the Overview KPI and
 * the player card show the same figure side by side, so two rounding rules read
 * as a bug even when the underlying number is identical. A decimal only below
 * 10, where it's the difference between "9h" and "9.4h".
 */
export const hoursLabel = (h: number): string => (h >= 10 ? int(h) : num(h, 1));

export const duration = (seconds: number | null): string => {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const shortDate = (d: Date | string | null): string => {
  if (!d) return "—";
  // Date-only strings ("YYYY-MM-DD") would parse as UTC midnight and render as
  // the previous day west of Greenwich — pin them to local noon instead.
  const date = typeof d === "string" ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d) : d;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
};

/** Map a win rate in [0,1] to a loss→win color, with null as neutral. */
export function winRateColor(rate: number | null, alpha = 1): string {
  if (rate === null) return `rgba(74, 68, 105, ${0.35 * alpha})`;
  const t = Math.max(0, Math.min(1, rate));
  // loss red (240,86,79) → mid slate (110,102,150) → win green (63,207,142)
  const mix = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);
  const [r, g, b] =
    t < 0.5
      ? [mix(240, 110, t * 2), mix(86, 102, t * 2), mix(79, 150, t * 2)]
      : [mix(110, 63, (t - 0.5) * 2), mix(102, 207, (t - 0.5) * 2), mix(150, 142, (t - 0.5) * 2)];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
