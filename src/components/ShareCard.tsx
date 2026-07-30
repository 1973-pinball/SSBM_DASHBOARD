import { useMemo, useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";
import type { ResolvedGame } from "../lib/types";
import { executionSummary, statCardData } from "../lib/stats";
import { int, num, pct, shortDate } from "../lib/format";
import { charName, stageName } from "../lib/melee";

/**
 * Shareable player card: a fun one-glance summary of who you play, who you
 * fight, where, and how much. Exported as a PNG entirely client-side
 * (html-to-image) — sharing is the user's choice, nothing is uploaded.
 */
export function ShareCard({ games }: { games: ResolvedGame[] }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const d = useMemo(() => statCardData(games), [games]);
  const hands = useMemo(() => executionSummary(games, 100), [games]);

  if (d.games === 0) return null;

  const fileName = `ssbm-card-${(d.code ?? "player").replace(/[^A-Za-z0-9#-]/g, "")}.png`;

  const download = async () => {
    if (!cardRef.current) return;
    const url = await toPng(cardRef.current, { pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  const copy = async () => {
    if (!cardRef.current) return;
    try {
      const blob = await toBlob(cardRef.current, { pixelRatio: 2 });
      if (!blob) throw new Error("render failed");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  // charIcon is a Melee external character ID → bundled stock-counter sprite.
  const cell = (label: string, value: string, sub?: string, charIcon?: number) => (
    <div className="sc-cell">
      <div className="sc-label">{label}</div>
      <div className="sc-value">
        {charIcon !== undefined && <img className="sc-stock" src={`/stock/${charIcon}.png`} alt="" />}
        {value}
      </div>
      {sub && <div className="sc-sub">{sub}</div>}
    </div>
  );

  return (
    <div className="panel">
      <div className="sc-wrap">
        <div className="share-card" ref={cardRef}>
          <div className="sc-head">
            <div>
              <div className="sc-tag">{d.name ?? d.code ?? "Melee player"}</div>
              {d.code && <div className="sc-code">{d.code}</div>}
            </div>
            <div className="sc-head-right">
              <div className="sc-title">PLAYER CARD</div>
              {d.firstDate && d.lastDate && (
                <div className="sc-range">{shortDate(d.firstDate)} — {shortDate(d.lastDate)}</div>
              )}
            </div>
          </div>

          <div className="sc-grid">
            {cell(
              "Main",
              d.mainChar ? charName(d.mainChar.id) : "—",
              d.mainChar ? `${int(d.mainChar.games)} games logged` : undefined,
              d.mainChar?.id,
            )}
            {cell(
              "Record",
              `${int(d.wins)}–${int(d.losses)}`,
              d.winRate !== null ? `${pct(d.winRate)} win rate` : undefined,
            )}
            {cell(
              "Hours on the sticks",
              `${num(d.hours, d.hours >= 100 ? 0 : 1)}h`,
              `${int(d.games)} games, zero regrets`,
            )}
            {cell(
              "Sworn rival",
              d.rival ? d.rival.code : "—",
              d.rival ? `${int(d.rival.games)} runbacks · ${d.rival.wins}–${d.rival.losses}` : undefined,
            )}
            {cell(
              "Most common foe",
              d.topOppChar ? charName(d.topOppChar.id) : "—",
              d.topOppChar ? `${int(d.topOppChar.games)} encounters` : undefined,
              d.topOppChar?.id,
            )}
            {cell(
              "Home turf",
              d.favStage ? stageName(d.favStage.id) : "—",
              d.favStage && d.favStage.winRate !== null
                ? `won ${pct(d.favStage.winRate, 0)} of ${int(d.favStage.games)} there`
                : undefined,
            )}
            {cell(
              "The hands (past 100 games)",
              hands.lCancel !== null ? `${num(hands.lCancel, 1)}% L-cancel` : "—",
              hands.ipm !== null ? `${int(hands.ipm)} inputs/min` : undefined,
            )}
            {cell(
              "Longest heater",
              d.bestWinStreak ? `${d.bestWinStreak} wins` : "—",
              d.bestWinStreak ? "in a row, no brakes" : undefined,
            )}
            {cell(
              "Busiest day",
              d.busiestDay ? shortDate(d.busiestDay.day) : "—",
              d.busiestDay ? `${d.busiestDay.games} games in one sitting` : undefined,
            )}
          </div>

          <div className="sc-foot">
            <span>{int(d.distinctOpponents)} opponents faced</span>
            <span className="sc-url">ssbm-dashboard.vercel.app</span>
          </div>
        </div>
      </div>

      <div className="sc-actions">
        <button className="primary" onClick={() => void download()}>Download PNG</button>
        <button onClick={() => void copy()}>
          {copied === "ok" ? "Copied!" : copied === "fail" ? "Copy failed" : "Copy image"}
        </button>
        <span className="hint" style={{ margin: 0 }}>Rendered in your browser — share it wherever you like.</span>
      </div>
    </div>
  );
}
