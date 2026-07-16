interface Props {
  label: string;
  value: string;
  delta?: string | null;
  deltaDir?: "up" | "down" | "flat";
  accent?: "gold";
}

export function Kpi({ label, value, delta, deltaDir, accent }: Props) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${accent ?? ""}`}>{value}</div>
      {delta ? <div className={`delta ${deltaDir === "up" ? "up" : deltaDir === "down" ? "down" : ""}`}>{delta}</div> : null}
    </div>
  );
}
