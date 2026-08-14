#!/usr/bin/env node
// Monthly top-up for src/lib/liquipedia/data.ts.
//
// Append-only by design: it adds majors dated after the current snapshot and
// ranking editions not already present, and never rewrites or removes existing
// rows. A parse miss therefore costs an update, not the dataset — the worst
// case is "no changes", which the workflow treats as a no-op. The one thing it
// does revisit is a player whose career winnings are still unknown, so a
// player page that was unreachable one month gets filled in the next.
//
// Liquipedia's API terms require an identifying User-Agent and forbid rapid
// automated access, so every request goes through fetchPage(), which
// serializes calls with a fixed delay and backs off hard on HTTP 429.

import { appendFileSync } from "node:fs";
import {
  parseMajorsHtml,
  parsePlayerEarnings,
  parsePlayerMains,
  parseRankingEditions,
  yearEndEditions,
  displayName,
} from "./lib/liquipedia-parse.mjs";
import { RateLimited, fetchPage as fetchLiquipedia } from "./lib/liquipedia-fetch.mjs";
import { readDataset, writeDataset, today } from "./lib/liquipedia-data.mjs";

/** Cap the per-run backfill so a cold start can't turn into a scrape. */
const MAX_BACKFILL = 6;
/** More new majors than a week can plausibly hold ⇒ treat as a parser fault. */
const MAX_NEW_MAJORS = 25;

const log = (...a) => console.log(...a);
const fetchPage = (page, prop) => fetchLiquipedia(page, prop, log);

// --------------------------------------------------------------------- merge

/** Same event, however the row is worded: name shape + year. */
const majorKey = (m) => `${m.name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${m.year}`;

async function main() {
  const data = readDataset();
  const latestDate = data.majors.reduce((max, m) => (m.date > max ? m.date : max), "0000");
  const knownYears = new Set(data.editions.map((e) => e.year));
  log(`snapshot: ${data.majors.length} majors (latest ${latestDate}), ${data.editions.length} editions`);

  const addedMajors = [];
  const addedEditions = [];

  // ---- new majors ----
  const majorRows = parseMajorsHtml(await fetchPage("Major_Tournaments/Melee", "text"));
  if (majorRows.length === 0) throw new Error("majors page parsed to zero rows — parser is out of date");
  log(`majors page: ${majorRows.length} rows parsed`);

  // Dedup on identity, not on date: an event added to the page after the fact
  // can be dated before our newest row, and a date gate would hide it forever.
  const seen = new Set(data.majors.map(majorKey));
  for (const row of majorRows) {
    const { winnerChars, ...major } = row;
    if (seen.has(majorKey(major))) continue;
    seen.add(majorKey(major));
    data.majors.push(major);
    addedMajors.push({ ...major, winnerChars });
  }
  // Identity dedup only works while the parser names events the same way it
  // did last month. If a change to either side breaks that, every row looks
  // new — bail out loudly instead of committing a duplicated history.
  if (addedMajors.length > MAX_NEW_MAJORS) {
    throw new Error(
      `${addedMajors.length} majors look new (max ${MAX_NEW_MAJORS}) — the parser or the page format probably changed; refusing to write`,
    );
  }
  data.majors.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  // ---- new ranking edition: a fresh data point for the character charts ----
  const editions = yearEndEditions(parseRankingEditions(await fetchPage("SSBMRank", "wikitext")));
  if (editions.length === 0) throw new Error("SSBMRank parsed to zero editions — parser is out of date");
  for (const ed of editions) {
    if (knownYears.has(ed.year)) continue;
    // A half-parsed edition would dent every character series for that year.
    if (ed.entries.length < 50) {
      log(`  skipping ${ed.title}: only ${ed.entries.length} entries parsed`);
      continue;
    }
    const edition = {
      year: ed.year,
      title: ed.title,
      url: ed.url,
      entries: ed.entries.map((e) => ({ rank: e.rank, player: displayName(e.player), chars: e.chars })),
    };
    data.editions.push(edition);
    addedEditions.push(edition);
  }
  data.editions.sort((a, b) => a.year - b.year);

  // ---- player meta: new champions, plus anyone still missing winnings ----
  const needMeta = [];
  for (const m of addedMajors) if (!data.players[m.winner]) needMeta.push(m.winner);
  for (const [tag, meta] of Object.entries(data.players)) {
    if (meta.earningsUsd === null && !needMeta.includes(tag)) needMeta.push(tag);
  }
  const dropped = Math.max(0, needMeta.length - MAX_BACKFILL);
  if (dropped > 0) log(`  ${needMeta.length} players need meta; fetching ${MAX_BACKFILL} this run, ${dropped} deferred`);

  let metaChanged = false;
  for (const tag of needMeta.slice(0, MAX_BACKFILL)) {
    try {
      const prev = data.players[tag];
      // Winnings only exist in the rendered page; mains only in the source.
      // Skip the second request when we already know the character.
      const earnings = parsePlayerEarnings(await fetchPage(tag, "text"));
      const mains =
        prev?.mains?.length || !earnings
          ? (prev?.mains ?? [])
          : parsePlayerMains(await fetchPage(tag, "wikitext"));
      const resolvedMains = mains.length
        ? mains
        : (prev?.mains ?? addedMajors.find((m) => m.winner === tag)?.winnerChars ?? []);
      // Never overwrite a known figure with a null we failed to read.
      const next = { earningsUsd: earnings ?? prev?.earningsUsd ?? null, mains: resolvedMains };
      if (!prev || prev.earningsUsd !== next.earningsUsd || prev.mains.join() !== next.mains.join()) {
        data.players[tag] = next;
        metaChanged = true;
        log(`  ${prev ? "updated" : "added"} player ${tag}${next.earningsUsd === null ? " (winnings still unlisted)" : ""}`);
      }
    } catch (err) {
      if (err instanceof RateLimited) throw err;
      if (!data.players[tag]) {
        const chars = addedMajors.find((m) => m.winner === tag)?.winnerChars ?? [];
        data.players[tag] = { earningsUsd: null, mains: chars };
        metaChanged = true;
      }
      log(`  could not read player page for ${tag}: ${err.message}`);
    }
  }

  const changed = addedMajors.length > 0 || addedEditions.length > 0 || metaChanged;
  if (changed) writeDataset(data, today());

  const summary =
    [
      addedMajors.length ? `${addedMajors.length} new major${addedMajors.length === 1 ? "" : "s"}` : null,
      addedEditions.length ? addedEditions.map((e) => e.title).join(", ") : null,
      !addedMajors.length && !addedEditions.length && metaChanged ? "player details" : null,
    ]
      .filter(Boolean)
      .join(", ") || "no changes";

  log(summary);
  for (const m of addedMajors) log(`  + ${m.date} ${m.name} — ${m.winner}`);

  if (process.env.GITHUB_OUTPUT) {
    // This value is wiki-derived and ends up in a commit message, so strip it
    // to plain text: no newlines (which would forge extra step outputs) and no
    // shell metacharacters, belt-and-braces with the workflow passing it by env.
    const safe = summary.replace(/[^\w .,:()–-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nsummary=${safe}\n`);
  }
}

main().catch((err) => {
  console.error(err.message);
  // A Liquipedia block is expected occasionally and is not a red build: exit 2
  // leaves data.ts untouched and lets next month's run pick it up.
  process.exit(err instanceof RateLimited ? 2 : 1);
});
