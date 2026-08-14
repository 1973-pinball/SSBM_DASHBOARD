#!/usr/bin/env node
// Print the parts of a Liquipedia page that the refresh parsers care about.
//
// Exists because the figures we want are computed by Liquipedia and rendered
// into HTML rather than stored in wikitext, so guessing at markup has already
// cost two wrong parsers. Run it (locally, or via the "Inspect Liquipedia
// page" workflow when your IP is rate-limited) and read the real structure.
//
//   node scripts/inspect-liquipedia-page.mjs Hungrybox [needle]

const page = process.argv[2] ?? "Hungrybox";
const needle = process.argv[3] ?? "winnings|earnings";
const CONTACT = process.env.LIQUIPEDIA_CONTACT || "info.studio.pinball@gmail.com";

const res = await fetch(
  `https://liquipedia.net/smash/api.php?action=parse&page=${encodeURIComponent(page)}&format=json&prop=text&redirects=1`,
  { headers: { "User-Agent": `SSBMDashboard/1.0 (pipeline debugging; contact: ${CONTACT})` } },
);
if (!res.ok) {
  console.error(`HTTP ${res.status} for ${page}`);
  process.exit(res.status === 429 ? 2 : 1);
}
const body = await res.text();
if (!body.trimStart().startsWith("{")) {
  console.error("non-JSON response (rate-limit interstitial?)");
  process.exit(2);
}
const html = JSON.parse(body).parse.text["*"];
console.log(`page=${page} htmlBytes=${html.length}`);

// Prize totals: the quickest way to tell whether a results page covers one
// game or a player's whole career is to add up what's on it.
const amounts = [...html.matchAll(/\$\s?([\d,]+)(?!\d)/g)].map((m) => Number(m[1].replace(/,/g, "")));
if (amounts.length) {
  const sum = amounts.reduce((a, b) => a + b, 0);
  console.log(`dollar amounts: ${amounts.length}, sum $${sum.toLocaleString("en-US")}, max $${Math.max(...amounts).toLocaleString("en-US")}`);
}

const re = new RegExp(needle, "gi");
let hit;
let n = 0;
while ((hit = re.exec(html)) !== null && n < 12) {
  n++;
  const from = Math.max(0, hit.index - 700);
  const slice = html.slice(from, hit.index + 700);
  const text = slice
    .replace(/<[^>]+>/g, " | ")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/\s*\|\s*(\|\s*)+/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
  console.log(`\n--- match ${n} at ${hit.index} ---\n${text}`);
}
if (n === 0) console.log(`no match for /${needle}/i`);
