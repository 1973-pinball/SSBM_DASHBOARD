// Parsers for the two Liquipedia pages the scene dataset is built from.
// Kept separate from the fetching so they can be run against a saved copy of a
// page — which is how they were validated (226/226 majors, 69/69 supermajors,
// and every ranking entry matching the live pages).
//
// Both formats are stable structured markup, not prose:
//
//   Major_Tournaments/Melee  — rendered HTML: <h3 id="YEAR"> sections, one
//     <div class="divRow"> per tournament ("divRow tournament-card-premier"
//     marks a supermajor), with Tournament / EventDetails / Placement cells.
//   SSBMRank                 — wikitext: {{PRstart|title=…}} … {{PRend}} per
//     edition, {{PRplayer|rank=N|Page{{!}}Display|chars=a,b}} per player.

// ---------------------------------------------------------------- characters

/** Liquipedia's character abbreviations → the names used in the dataset. */
const CHAR_ABBR = {
  fox: "Fox",
  falco: "Falco",
  marth: "Marth",
  sheik: "Sheik",
  puff: "Jigglypuff",
  jigglypuff: "Jigglypuff",
  peach: "Peach",
  cf: "Captain Falcon",
  falcon: "Captain Falcon",
  "captain falcon": "Captain Falcon",
  ic: "Ice Climbers",
  ics: "Ice Climbers",
  "ice climbers": "Ice Climbers",
  samus: "Samus",
  luigi: "Luigi",
  yoshi: "Yoshi",
  pika: "Pikachu",
  pikachu: "Pikachu",
  ganon: "Ganondorf",
  ganondorf: "Ganondorf",
  dk: "Donkey Kong",
  "donkey kong": "Donkey Kong",
  link: "Link",
  yl: "Young Link",
  "young link": "Young Link",
  doc: "Dr. Mario",
  "dr mario": "Dr. Mario",
  "dr. mario": "Dr. Mario",
  zelda: "Zelda",
  mario: "Mario",
  mewtwo: "Mewtwo",
  bowser: "Bowser",
  ness: "Ness",
  roy: "Roy",
  kirby: "Kirby",
  pichu: "Pichu",
  gw: "Mr. Game & Watch",
  "game & watch": "Mr. Game & Watch",
  "mr. game & watch": "Mr. Game & Watch",
};

export const canonChar = (raw) => CHAR_ABBR[String(raw).trim().toLowerCase()] ?? null;

// -------------------------------------------------------------- player names

/**
 * Tags that refer to one person. Liquipedia renames pages when a player
 * changes tag (iBDW → Cody Schwab), so without this the same human shows up
 * as two entries in the major-titles race.
 */
const ALIASES = {
  ibdw: "codyschwab",
  cody: "codyschwab",
  codyschwab: "codyschwab",
  m2k: "mew2king",
  mew2king: "mew2king",
  drpeepee: "ppmd",
  ppmd: "ppmd",
  wizzy: "wizzrobe",
  wizzrobe: "wizzrobe",
  hbox: "hungrybox",
  hungrybox: "hungrybox",
  azenzagenite: "azen",
  azen: "azen",
};

/** Identity key for a tag: case/punctuation/leetspeak-insensitive, plus aliases. */
export function playerKey(tag) {
  const base = String(tag)
    .toLowerCase()
    .replace(/[\s._'`’-]/g, "")
    .replace(/0/g, "o")
    .replace(/\$/g, "s");
  return ALIASES[base] ?? base;
}

/** Preferred display spelling per identity, e.g. iBDW and Cody Schwab → one. */
export const CANONICAL_DISPLAY = {
  codyschwab: "Cody Schwab",
  mew2king: "Mew2King",
  ppmd: "PPMD",
  hungrybox: "Hungrybox",
  wizzrobe: "Wizzrobe",
  mango: "Mang0",
  azen: "Azen",
};

export const displayName = (tag) => CANONICAL_DISPLAY[playerKey(tag)] ?? String(tag).trim();

// ------------------------------------------------------------- majors (HTML)

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

const stripTags = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * "Nov 20 - 21, 2010" / "Aug 9, 2026" / "Dec 30, 2003 - Jan 2, 2004" → the END
 * date, which is when a tournament is actually won.
 */
function parseEventDate(text, fallbackYear) {
  const parts = [...text.matchAll(/([A-Z][a-z]{2})\s+(\d{1,2})(?:\s*[-–]\s*(?:([A-Z][a-z]{2})\s+)?(\d{1,2}))?,?\s*(\d{4})?/g)];
  const last = parts[parts.length - 1];
  if (!last) return `${fallbackYear}-01`;
  const [, mon, d1, mon2, d2, yr] = last;
  const month = MONTHS[mon2 ?? mon] ?? MONTHS[mon];
  if (!month) return `${fallbackYear}-01`;
  return `${yr ?? fallbackYear}-${pad(month)}-${pad(Number(d2 ?? d1))}`;
}

/** Slice out a balanced <div>…</div> starting just after an opening tag. */
function balancedDiv(html, start) {
  let depth = 1;
  let i = start;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html)) !== null) {
    depth += m[0] === "</div>" ? -1 : 1;
    i = re.lastIndex;
    if (depth === 0) return { inner: html.slice(start, m.index), end: i };
  }
  return { inner: html.slice(start), end: html.length };
}

function rowCells(rowHtml) {
  const cells = [];
  const re = /<div class="(divCell[^"]*)">/g;
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    const { inner, end } = balancedDiv(rowHtml, re.lastIndex);
    cells.push({ cls: m[1], inner });
    re.lastIndex = end;
  }
  return cells;
}

/** Player link text + the character icons shown beside it in a placement cell. */
function placement(cellHtml) {
  const chars = [...cellHtml.matchAll(/class="heads-padding-right"><img alt="([^"]+)"/g)]
    .map((m) => canonChar(m[1]))
    .filter(Boolean);
  const links = [...cellHtml.matchAll(/<a href="\/smash\/[^"]+" title="[^"]*">([^<]+)<\/a>/g)];
  const last = links[links.length - 1];
  return { player: last ? last[1].trim() : stripTags(cellHtml) || null, chars };
}

/**
 * Every major on Major_Tournaments/Melee, oldest first. Events with no winner
 * yet (upcoming) are dropped rather than stored as "TBD".
 */
export function parseMajorsHtml(html) {
  const heads = [...html.matchAll(/<h3 id="(\d{4})">/g)].map((m) => ({ year: Number(m[1]), at: m.index }));
  const bounds = [...heads.map((h) => h.at), html.length];
  const out = [];

  heads.forEach((head, hi) => {
    const body = html.slice(bounds[hi], bounds[hi + 1]);
    const re = /<div class="divRow( tournament-card-premier[^"]*)?">/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const tier = m[1] ? "supermajor" : "major";
      const { inner: row, end } = balancedDiv(body, re.lastIndex);
      re.lastIndex = end;

      let name = null;
      let date = null;
      let winner = null;
      let runnerUp = null;
      let winnerChars = [];
      for (const { cls, inner } of rowCells(row)) {
        if (cls.includes("Tournament") && name === null) {
          const links = [...inner.matchAll(/<a href="\/smash\/[^"]+" title="[^"]*">([^<]+)<\/a>/g)];
          const last = links[links.length - 1];
          name = last ? last[1].trim() : stripTags(inner);
        } else if (cls.includes("EventDetails-Left-55") && date === null) {
          date = parseEventDate(stripTags(inner), head.year);
        } else if (cls.includes("FirstPlace")) {
          const p = placement(inner);
          winner = p.player;
          winnerChars = p.chars;
        } else if (cls.includes("SecondPlace")) {
          runnerUp = placement(inner).player;
        }
      }

      if (!name || !date || !winner) continue;
      if (/^(TBD|TBA|N\/A)$/i.test(winner)) continue;
      out.push({
        name,
        year: head.year,
        date,
        winner: displayName(winner),
        ...(runnerUp && !/^(TBD|TBA)$/i.test(runnerUp) ? { runnerUp: displayName(runnerUp) } : {}),
        tier,
        ...(winnerChars.length ? { winnerChars } : {}),
      });
    }
  });

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}

// --------------------------------------------------------- rankings (wikitext)

/**
 * All ranking editions on the SSBMRank page. `title` is authoritative for
 * whether an edition is mid-season: the Summer 2026 block sets edition=2026,
 * so filtering on the edition field alone would mistake it for a year-end list.
 */
export function parseRankingEditions(wikitext) {
  // {{!}} is the wiki's escape for a literal pipe, and it contains "}}" — which
  // would end a template match early, truncating the name and swallowing the
  // chars= that follows. Swap it for a sentinel before any template matching.
  const PIPE = "";
  const text = wikitext.split("{{!}}").join(PIPE);

  const editions = [];
  for (const block of text.matchAll(/\{\{PRstart\|([^}]*)\}\}([\s\S]*?)\{\{PRend\}\}/g)) {
    const [, head, body] = block;
    const field = (n) => head.match(new RegExp(`\\b${n}=([^|}]*)`))?.[1]?.trim() ?? null;
    const title = field("title");
    if (!title) continue;
    const year = Number(title.match(/(\d{4})/)?.[1] ?? field("edition")?.match(/(\d{4})/)?.[1]);
    if (!year) continue;

    const entries = [];
    for (const pm of body.matchAll(/\{\{PRplayer\|([^}]*)\}\}/g)) {
      const raw = pm[1];
      const rank = Number(raw.match(/\brank=(\d+)/)?.[1]);
      if (!rank) continue;
      // The name is the one positional parameter, written either as "Tag" or
      // as "PageTitle|Display" (via {{!}}) when the page is disambiguated —
      // "Ken (Melee player)|Ken". The displayed half is what players know.
      let player = null;
      for (const part of raw.split("|")) {
        const p = part.trim();
        if (!p || p.includes("=")) continue;
        player = p.includes(PIPE) ? p.split(PIPE).pop().trim() : p;
        break;
      }
      if (!player) continue;
      const chars = (raw.match(/\bchars=([^|}]*)/)?.[1] ?? "")
        .split(",")
        .map((c) => canonChar(c))
        .filter(Boolean);
      entries.push({ rank, player: player.trim(), chars });
    }
    entries.sort((a, b) => a.rank - b.rank);

    editions.push({
      year,
      title,
      isSummer: /summer|spring|mid[- ]?season/i.test(title),
      url: `https://liquipedia.net/smash/SSBMRank/${year}`,
      entries,
    });
  }
  return editions;
}

/** Year-end editions only — mid-season lists would double-count a season. */
export const yearEndEditions = (editions) => editions.filter((e) => !e.isSummer && e.entries.length >= 50);

// ------------------------------------------------------- player page (wikitext)

/** Approx. total winnings + mains from a player page infobox. */
export function parsePlayerPage(wikitext) {
  const money = wikitext.match(/\|\s*(?:totalearnings|earnings|winnings)\s*=\s*\$?\s*([\d,]+)/i);
  const chars = [];
  for (const m of wikitext.matchAll(/\|\s*game\d*_?char\d*\s*=\s*([^|\n}]+)/gi)) chars.push(m[1]);
  if (chars.length === 0) {
    const main = wikitext.match(/\|\s*mains?\s*=\s*([^|\n}]+)/i);
    if (main) chars.push(...main[1].split(/[,/]/));
  }
  return {
    earningsUsd: money ? Number(money[1].replace(/,/g, "")) : null,
    mains: chars.map((c) => canonChar(c)).filter(Boolean),
  };
}
