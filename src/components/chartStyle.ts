import { shortDate } from "../lib/format";

/** Shared recharts styling — one definition instead of a copy per view. */
export const axisStyle = { fill: "var(--faint)", fontSize: 11, fontFamily: "var(--font-data)" };

export const tooltipStyle = {
  contentStyle: {
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontFamily: "var(--font-data)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted)" },
};

/** Faint horizontal guide lines: spread `<CartesianGrid {...gridStyle} />`. */
export const gridStyle = {
  stroke: "var(--line)",
  strokeOpacity: 0.45,
  strokeDasharray: "3 6",
  vertical: false,
};

/**
 * The "Opponents" comparison series everywhere. Deliberately NOT red: red is
 * the reserved loss/danger color, and opponents are a neutral baseline, not a
 * bad outcome. Dashed + muted keeps the overlay recessive under "my" line.
 */
export const OPP_SERIES_COLOR = "var(--muted)";

/** Axis tick / tooltip label for "YYYY-MM-DD" day strings ("" for missing). */
export const dayTick = (d: string | null | undefined): string => (d ? shortDate(d) : "");
