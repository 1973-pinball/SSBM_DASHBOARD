#!/usr/bin/env node
// Render the Liquipedia tab's shareable assets from the bundled snapshot.
//
// Runs headlessly (@napi-rs/canvas) using the SAME painters and encoder as the
// in-app Share buttons, so a committed asset and a user-generated one are the
// same artwork. The monthly workflow runs this straight after the data
// refresh, which is what keeps the assets in step with the dataset.
//
// Output: public/share/*.gif (animated) and *.png (first-frame posters, handy
// for link previews). Both are committed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { encodeGif } from "./lib/gif-encode.mjs";
import { CANVAS, drawCharFrame, drawRaceFrame } from "./lib/gif-draw.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = resolve(ROOT, "src/lib/liquipedia/data.ts");
const OUT_DIR = resolve(ROOT, "public/share");
const STOCK_DIR = resolve(ROOT, "public/stock");

// Matches the app's playback defaults so a committed GIF plays at 1x speed.
const RACE_STEP_MS = 440;
const CHAR_STEP_MS = 750;
const FINAL_HOLD_MS = 3000;

const NAME_TO_ID = {
  "Captain Falcon": 0, "Donkey Kong": 1, Fox: 2, "Mr. Game & Watch": 3, Kirby: 4, Bowser: 5,
  Link: 6, Luigi: 7, Mario: 8, Marth: 9, Mewtwo: 10, Ness: 11, Peach: 12, Pikachu: 13,
  "Ice Climbers": 14, Jigglypuff: 15, Samus: 16, Yoshi: 17, Zelda: 18, Sheik: 19, Falco: 20,
  "Young Link": 21, "Dr. Mario": 22, Roy: 23, Pichu: 24, Ganondorf: 25,
};

// ---------------------------------------------------------------- dataset

const src = readFileSync(DATA_PATH, "utf8");
const block = (name) => {
  const m = src.match(new RegExp(`export const ${name}[^=]*= (\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\});\\n`));
  if (!m) throw new Error(`could not locate ${name} in ${DATA_PATH}`);
  return JSON.parse(m[1]);
};
const majors = block("MAJORS");
const editions = block("RANKING_EDITIONS");
const players = block("PLAYERS");
if (majors.length === 0 || editions.length === 0) throw new Error("dataset is empty — nothing to render");

// ---------------------------------------------------------------- frames

/** Cumulative standings after each major (mirrors raceFrames in select.ts). */
function raceFrames() {
  const ordered = [...majors].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name),
  );
  const counts = new Map();
  const reachedAt = new Map();
  return ordered.map((m, i) => {
    counts.set(m.winner, (counts.get(m.winner) ?? 0) + 1);
    reachedAt.set(m.winner, i);
    const standings = [...counts.entries()]
      .map(([player, count]) => ({ player, count }))
      .sort(
        (a, b) =>
          b.count - a.count || reachedAt.get(a.player) - reachedAt.get(b.player) || a.player.localeCompare(b.player),
      )
      .slice(0, 12);
    return { name: m.name, year: m.year, winner: m.winner, standings };
  });
}

/** Per-edition character breakdown (mirrors compositionByEdition). */
function charFrames() {
  return [...editions]
    .sort((a, b) => a.year - b.year)
    .map((edition, idx, all) => {
      const byChar = new Map();
      for (const e of edition.entries) {
        const main = e.chars[0];
        if (!main) continue;
        const stat = byChar.get(main) ?? { char: main, count: 0, reps: [] };
        stat.count++;
        stat.reps.push({ player: e.player, rank: e.rank });
        byChar.set(main, stat);
      }
      for (const s of byChar.values()) s.reps.sort((a, b) => a.rank - b.rank);
      const prev = idx > 0 ? all[idx - 1] : null;
      const prevChars = new Set(prev ? prev.entries.map((e) => e.chars[0]).filter(Boolean) : []);
      const chars = [...byChar.values()]
        .sort((a, b) => b.count - a.count || a.reps[0].rank - b.reps[0].rank)
        .map((s) => ({
          char: s.char,
          count: s.count,
          topPlayer: s.reps[0]?.player,
          topRank: s.reps[0]?.rank,
          isNew: prev !== null && !prevChars.has(s.char),
        }));
      return { title: edition.title, year: edition.year, total: edition.entries.length, chars };
    });
}

// ---------------------------------------------------------------- icons

async function loadIcons(pairs) {
  const byId = new Map();
  for (const [, id] of pairs) {
    if (byId.has(id)) continue;
    try {
      byId.set(id, await loadImage(resolve(STOCK_DIR, `${id}.png`)));
    } catch {
      byId.set(id, null); // a missing sprite just means no icon on that row
    }
  }
  const out = {};
  for (const [key, id] of pairs) {
    const img = byId.get(id);
    if (img) out[key] = img;
  }
  return out;
}

// ---------------------------------------------------------------- render

const ctxOf = () => {
  const canvas = createCanvas(CANVAS.w, CANVAS.h);
  return { canvas, ctx: canvas.getContext("2d") };
};

function renderGif({ frames, draw, stepMs, opts }) {
  const { canvas, ctx } = ctxOf();
  const stepCs = Math.max(2, Math.round(stepMs / 10));
  const encoded = frames.map((frame, i) => {
    draw(ctx, frame, opts);
    return {
      data: ctx.getImageData(0, 0, CANVAS.w, CANVAS.h).data,
      delayCs: i === frames.length - 1 ? Math.round(FINAL_HOLD_MS / 10) : stepCs,
    };
  });
  // Poster = the final frame, i.e. where things stand today.
  const poster = canvas.toBuffer("image/png");
  return { gif: encodeGif(encoded, CANVAS.w, CANVAS.h), poster };
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const race = raceFrames();
  const raceIcons = await loadIcons(
    Object.entries(players)
      .map(([tag, meta]) => [tag, NAME_TO_ID[meta.mains?.[0]]])
      .filter(([, id]) => id !== undefined),
  );
  const raceMax = Math.max(1, ...race[race.length - 1].standings.map((s) => s.count));
  // Every major would be ~4.5 MB, and this file is re-committed whenever the
  // data changes — that is a lot of permanent git history for one animation.
  // Sampling every other tournament and doubling the hold keeps the artwork
  // and the running time identical at half the bytes. The in-app Share button
  // still exports every frame.
  const raceStride = race.length > 150 ? 2 : 1;
  const raceSampled = race.filter((_, i) => i % raceStride === 0 || i === race.length - 1);
  const raceOut = renderGif({
    frames: raceSampled,
    draw: drawRaceFrame,
    stepMs: RACE_STEP_MS * raceStride,
    opts: { max: raceMax, icons: raceIcons },
  });
  writeFileSync(resolve(OUT_DIR, "melee-majors-race.gif"), raceOut.gif);
  writeFileSync(resolve(OUT_DIR, "melee-majors-race.png"), raceOut.poster);
  console.log(
    `majors race: ${raceSampled.length} frames of ${race.length}${raceStride > 1 ? ` (every ${raceStride})` : ""}, ${mb(raceOut.gif.length)}`,
  );

  const chars = charFrames();
  const charIcons = await loadIcons(
    [...new Set(chars.flatMap((f) => f.chars.map((c) => c.char)))]
      .map((name) => [name, NAME_TO_ID[name]])
      .filter(([, id]) => id !== undefined),
  );
  const charMax = Math.max(1, ...chars.flatMap((f) => f.chars.map((c) => c.count)));
  const charOut = renderGif({
    frames: chars,
    draw: drawCharFrame,
    stepMs: CHAR_STEP_MS,
    opts: { max: charMax, icons: charIcons },
  });
  writeFileSync(resolve(OUT_DIR, "melee-top100-by-main.gif"), charOut.gif);
  writeFileSync(resolve(OUT_DIR, "melee-top100-by-main.png"), charOut.poster);
  console.log(`top 100 by main: ${chars.length} frames, ${mb(charOut.gif.length)}`);

  console.log(`wrote 4 assets to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
