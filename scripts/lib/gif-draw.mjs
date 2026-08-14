// Frame painters for the shareable animations. Written against the plain
// Canvas2D API so the same code runs in the browser (the Share button) and in
// Node under @napi-rs/canvas (the monthly asset render).
//
// Fonts are generic stacks on purpose: CI has no Chakra Petch / IBM Plex Mono,
// and a missing family would silently fall back per-glyph and wreck the
// metrics. The dashboard's palette is mirrored here as literals — these files
// can't import src/index.css.

export const CANVAS = { w: 900, h: 600 };

const BG = "#181430";
const PANEL = "#201c38";
const LINE = "#34305a";
const TEXT = "#ece9f8";
const MUTED = "#9a93bd";
const FAINT = "#6b6490";
const ACCENT = "#8f7ff7";
const GOLD = "#e8b54d";

const SANS = "system-ui, -apple-system, 'Segoe UI', 'DejaVu Sans', sans-serif";
const MONO = "ui-monospace, Menlo, 'DejaVu Sans Mono', monospace";

const ROWS = 12;
const OTHER_COLOR = "#6b6490";
const CHAR_COLORS = {
  Falco: "#3987e5",
  Fox: "#d95926",
  Marth: "#199e70",
  Peach: "#c98500",
  Jigglypuff: "#d55181",
  Sheik: "#008300",
  "Captain Falcon": "#9085e9",
};

const roundRect = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w, h / 2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.max(0, w - rr), y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + Math.max(0, w - rr), y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
};

const ellipsize = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Shared panel chrome: title, source line, corner caption, footer. */
function chrome(ctx, { title, subtitle, cornerTop, cornerBottom }) {
  const { w, h } = CANVAS;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PANEL;
  ctx.fillRect(24, 84, w - 48, h - 128);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(24.5, 84.5, w - 49, h - 129);

  ctx.textAlign = "left";
  ctx.fillStyle = TEXT;
  ctx.font = `600 26px ${SANS}`;
  ctx.fillText(title, 28, 42);
  ctx.fillStyle = FAINT;
  ctx.font = `13px ${MONO}`;
  ctx.fillText(subtitle, 28, 64);

  ctx.textAlign = "right";
  ctx.fillStyle = ACCENT;
  ctx.font = `600 16px ${MONO}`;
  ctx.fillText(cornerTop, w - 28, 42);
  ctx.fillStyle = MUTED;
  ctx.font = `12px ${MONO}`;
  ctx.fillText(ellipsize(cornerBottom, 46), w - 28, 62);
  ctx.textAlign = "left";

  ctx.fillStyle = FAINT;
  ctx.font = `12px ${MONO}`;
  ctx.fillText("ssbm-dashboard.vercel.app · data: Liquipedia", 28, h - 18);
}

/**
 * One frame of the major-titles race.
 * `frame` is {name, year, winner, standings:[{player,count}]}; `icons` maps a
 * player tag to a loaded stock image (any Canvas-drawable), and may be empty.
 */
export function drawRaceFrame(ctx, frame, { max, icons = {} }) {
  const { w, h } = CANVAS;
  chrome(ctx, {
    title: "Melee majors won — all time",
    subtitle: "Every major since 2003, one step per tournament",
    cornerTop: String(frame.year),
    cornerBottom: frame.name,
  });

  const top = 104;
  const rowH = 38;
  const barX = 250;
  const barMax = w - 48 - barX - 78;

  frame.standings.slice(0, ROWS).forEach((s, i) => {
    const y = top + i * rowH;
    const isWinner = s.player === frame.winner;

    ctx.fillStyle = FAINT;
    ctx.font = `12px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(String(i + 1), 66, y + 21);
    ctx.textAlign = "left";

    const icon = icons[s.player];
    if (icon) ctx.drawImage(icon, 78, y + 4, 22, 22);

    ctx.fillStyle = isWinner ? GOLD : TEXT;
    ctx.font = `13px ${MONO}`;
    ctx.fillText(ellipsize(s.player, 15), 108, y + 21);

    const barW = Math.max(3, (s.count / max) * barMax);
    ctx.fillStyle = isWinner ? GOLD : ACCENT;
    roundRect(ctx, barX, y + 5, barW, 20, 4);

    ctx.fillStyle = TEXT;
    ctx.font = `600 14px ${MONO}`;
    ctx.fillText(String(s.count), barX + barW + 10, y + 21);
  });
  void h;
}

/**
 * One frame of the top-100 character breakdown.
 * `frame` is {title, total, chars:[{char,count,topPlayer,topRank,isNew}]}.
 */
export function drawCharFrame(ctx, frame, { max, icons = {} }) {
  const { w } = CANVAS;
  chrome(ctx, {
    title: "Melee top 100 by main",
    subtitle: "Players counted by primary main, per ranking edition",
    cornerTop: String(frame.year),
    cornerBottom: `${frame.title} · ${frame.total} ranked`,
  });

  const rows = frame.chars.slice(0, 14);
  const top = 104;
  const rowH = Math.min(34, Math.floor((600 - 128 - 24) / Math.max(rows.length, 1)));
  const barX = 210;
  const barMax = w - 48 - barX - 200;

  rows.forEach((c, i) => {
    const y = top + i * rowH;
    const icon = icons[c.char];
    if (icon) ctx.drawImage(icon, 44, y + Math.max(0, rowH / 2 - 13), 22, 22);

    ctx.fillStyle = TEXT;
    ctx.font = `13px ${MONO}`;
    ctx.fillText(ellipsize(c.char, 16), 76, y + rowH / 2 + 4);

    const barW = Math.max(3, (c.count / max) * barMax);
    ctx.fillStyle = CHAR_COLORS[c.char] ?? OTHER_COLOR;
    roundRect(ctx, barX, y + rowH / 2 - 9, barW, 18, 4);

    ctx.fillStyle = TEXT;
    ctx.font = `600 14px ${MONO}`;
    ctx.fillText(String(c.count), barX + barW + 10, y + rowH / 2 + 5);

    let noteX = barX + barW + 40;
    if (c.isNew) {
      ctx.fillStyle = GOLD;
      ctx.font = `700 10px ${MONO}`;
      ctx.fillText("NEW", noteX, y + rowH / 2 + 4);
      noteX += 34;
    }
    if (c.topPlayer) {
      ctx.fillStyle = MUTED;
      ctx.font = `11px ${MONO}`;
      ctx.fillText(ellipsize(`${c.topPlayer} #${c.topRank}`, 22), noteX, y + rowH / 2 + 4);
    }
  });
}
