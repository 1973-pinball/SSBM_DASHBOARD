#!/usr/bin/env node
// Render the static HTML pages that exist for crawlers, and the sitemap that
// lists them. Runs after `vite build`, writing straight into dist/.
//
// Why this exists: the app is a client-rendered SPA with no router, so the
// HTML Vercel serves is `<div id="root"></div>` and nothing else. Google does
// render JavaScript, but on a deferred second pass that a domain with no
// authority cannot rely on — so the site had no indexable text at all. These
// pages are real HTML with real content, need no JavaScript, and are the only
// thing a crawler can read on a first pass.
//
// They are generated rather than hand-written because every word here already
// exists somewhere authoritative: the metric definitions come from the same
// module the Metrics guide dialog renders, and the majors table from the
// bundled Liquipedia snapshot. A hand-maintained copy would drift.
//
// Output is dist/, not public/, deliberately: writing into public/ would put
// these in the PWA precache manifest, and they are documents for crawlers, not
// part of the offline app shell.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS } from "./lib/metrics-data.mjs";
import { readDataset } from "./lib/liquipedia-data.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const ORIGIN = "https://ssbmstats.com";

/** Text -> HTML text node. Definitions contain `<` (e.g. "p<0.01"), so this is load-bearing. */
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Heading/term -> URL fragment, so every section and definition is linkable. */
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[%]/g, " percent ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * JSON-LD goes in as `<script type="application/ld+json">`, which is data and
 * not subject to script-src, but its *contents* are still parsed as raw text by
 * the HTML tokenizer: an unescaped `</script>` inside a string would end the
 * block early. esc() is wrong here — it would corrupt the JSON — so only `<`
 * gets neutralised, using the < escape JSON itself understands.
 */
const ldJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

// Stable @ids so the four documents resolve as one site rather than four
// unrelated pages. Anything referencing an @id must emit that node in the same
// graph — a dangling reference is worse than an absent property.
const ORG_ID = `${ORIGIN}/#studio-pinball`;
const SITE_ID = `${ORIGIN}/#website`;

const SITE_NODES = [
  {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Studio Pinball",
    url: `${ORIGIN}/`,
    email: "info.studio.pinball@gmail.com",
  },
  {
    "@type": "WebSite",
    "@id": SITE_ID,
    name: "SSBM Stats",
    url: `${ORIGIN}/`,
    inLanguage: "en-US",
    publisher: { "@id": ORG_ID },
  },
];

// Kept in one place so the three pages cannot drift apart visually. Mirrors the
// app's tokens in src/index.css; inlined because a static page should not have
// to fetch a stylesheet to render its first paint.
const CSS = `
:root{--bg:#121022;--panel:#201c38;--panel-2:#272245;--line:#34305a;--text:#ece9f8;
--muted:#aaa3c9;--faint:#8981ae;--accent:#8f7ff7;--gold:#e8b54d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Inter",system-ui,sans-serif;
line-height:1.65;font-size:16px;-webkit-font-smoothing:antialiased}
.wrap{max-width:780px;margin:0 auto;padding:0 20px 80px}
a{color:var(--accent);text-underline-offset:2px}
a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
header.top{display:flex;align-items:center;gap:10px;padding:22px 0;border-bottom:1px solid var(--line);
margin-bottom:40px;flex-wrap:wrap}
header.top img{width:26px;height:26px}
header.top .brand{font-family:"Chakra Petch",system-ui,sans-serif;font-weight:600;font-size:17px;
color:var(--text);text-decoration:none}
header.top nav{margin-left:auto;display:flex;gap:18px;font-size:14px}
h1{font-family:"Chakra Petch",system-ui,sans-serif;font-weight:700;font-size:clamp(28px,5vw,40px);
line-height:1.15;margin:0 0 14px;text-wrap:balance}
.lede{font-size:18px;color:var(--muted);margin:0 0 34px;max-width:62ch}
h2{font-family:"Chakra Petch",system-ui,sans-serif;font-weight:600;font-size:22px;margin:44px 0 14px;
padding-bottom:9px;border-bottom:1px solid var(--line);text-wrap:balance}
h3{font-family:"Chakra Petch",system-ui,sans-serif;font-weight:600;font-size:17px;margin:28px 0 10px}
p{margin:0 0 15px;color:var(--muted);max-width:68ch}
p strong,li strong{color:var(--text)}
ul{color:var(--muted);padding-left:22px;max-width:68ch}
li{margin-bottom:7px}
dl{margin:0}
.def{padding:14px 0;border-bottom:1px solid var(--line)}
.def:last-child{border-bottom:0}
dt{font-family:"Chakra Petch",system-ui,sans-serif;font-weight:600;font-size:16px;color:var(--text);
margin-bottom:5px}
dd{margin:0;color:var(--muted);max-width:68ch}
.cta{display:inline-block;background:var(--accent);color:#16132b;font-weight:600;text-decoration:none;
padding:11px 20px;border-radius:10px;margin:10px 0 6px}
.cta:hover{filter:brightness(1.08)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin:0 0 18px}
table{border-collapse:collapse;width:100%;font-size:14px;min-width:520px}
th,td{text-align:left;padding:9px 13px;border-bottom:1px solid var(--line);white-space:nowrap}
th{background:var(--panel-2);font-family:"Chakra Petch",system-ui,sans-serif;font-weight:600;
font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);
position:sticky;top:0}
tr:last-child td{border-bottom:0}
td.num{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;color:var(--text)}
.tier{font-size:11px;color:var(--gold);border:1px solid var(--gold);border-radius:3px;padding:1px 5px;
font-family:"IBM Plex Mono",ui-monospace,monospace}
.note{border-left:2px solid var(--accent);background:rgba(143,127,247,.09);border-radius:0 8px 8px 0;
padding:13px 17px;margin:0 0 18px;font-size:14.5px;color:var(--muted)}
.note strong{color:var(--text)}
.toc{border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:0 0 12px;
display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px 26px}
.toc-sec{display:flex;flex-direction:column;gap:3px;font-size:13.5px}
.toc-sec a{color:var(--muted);text-decoration:none}
.toc-sec a:hover{color:var(--accent);text-decoration:underline}
.toc a.toc-h{font-family:"Chakra Petch",system-ui,sans-serif;font-weight:600;font-size:12px;
letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:4px}
.updated{font-size:13.5px;color:var(--faint);margin:0 0 22px}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);font-size:13.5px;
color:var(--faint);display:flex;gap:16px;flex-wrap:wrap}
@media(max-width:560px){header.top nav{margin-left:0;width:100%}}
`.trim();

/**
 * Wrap page content in the shared shell. Every page gets its own title,
 * description and self-referencing canonical — a shared canonical pointing at
 * `/` (which is what index.html correctly does for its own `?view=` params)
 * would tell Google these pages are duplicates of the app and drop them.
 *
 * There is deliberately no `preconnect` here. These pages carry no webfont at
 * all — the inline CSS names Inter and Chakra Petch and falls straight through
 * to system-ui — and the CSP in vercel.json forbids third-party style and font
 * origins anyway, so a preconnect to one could never pay off. One pointing at
 * fonts.googleapis.com survived here from before the fonts were self-hosted,
 * opening a TLS handshake on every page load for a request never made.
 */
function page({ slug, title, description, heading, body, mainEntity }) {
  const url = slug === "" ? `${ORIGIN}/` : `${ORIGIN}/${slug}`;

  // WebPage + breadcrumb per document, on top of the shared site nodes. The
  // breadcrumb's leaf carries no `item`: it is the current page, and schema.org
  // takes the trailing entry as self-referential.
  const graph = [
    ...SITE_NODES,
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: title,
      description,
      isPartOf: { "@id": SITE_ID },
      inLanguage: "en-US",
      breadcrumb: { "@id": `${url}#breadcrumb` },
      ...(mainEntity ? { mainEntity: { "@id": mainEntity["@id"] } } : {}),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "SSBM Stats", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: heading },
      ],
    },
    // Emitted last and only when supplied, which is what keeps the mainEntity
    // reference above from ever dangling.
    ...(mainEntity ? [mainEntity] : []),
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#121022">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SSBM Stats">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ORIGIN}/share/melee-majors-race.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ORIGIN}/share/melee-majors-race.png">
<script type="application/ld+json">${ldJson({ "@context": "https://schema.org", "@graph": graph })}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <img src="/favicon.svg" alt="">
  <a class="brand" href="/">SSBM Stats</a>
  <nav>
    <a href="/about">About</a>
    <a href="/metrics">Melee metrics</a>
    <a href="/melee-majors">Melee majors</a>
  </nav>
</header>
${body}
<footer>
  <span>Brought to you by Studio Pinball · © 2026</span>
  <a href="/">ssbmstats.com</a>
  <a href="https://github.com/1973-pinball/SSBM_DASHBOARD">Source on GitHub</a>
  <a href="mailto:info.studio.pinball@gmail.com">info.studio.pinball@gmail.com</a>
</footer>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------- /about

const about = page({
  slug: "about",
  // The brand belongs at the end, not the front. This is the only page on the
  // site with crawlable prose about the product, so its title has to spend its
  // opening words on what the product is rather than on the word "About".
  title: "Slippi Replay Analytics, Parsed In Your Browser — SSBM Stats",
  description:
    "How SSBM Stats reads local .slp and compressed .slpz replays to build a Super Smash Bros. Melee stats dashboard: what it computes, what browsers it needs, and the privacy contract — replays are parsed on your machine and never uploaded.",
  heading: "About",
  body: `
<h1>Slippi replay stats, parsed in your browser</h1>
<p class="lede">SSBM Stats reads your local Slippi replay folder and builds a full statistical
readout of your Super Smash Bros. Melee play — without your replays ever leaving your machine.</p>

<a class="cta" href="/">Open the dashboard</a>

<h2>How it works</h2>
<p>You select a replay folder or individual replay files in either standard <strong>.slp</strong>
or compressed <strong>.slpz</strong> format. The browser reads them directly off your disk,
decompresses compressed replays locally, parses them in background workers, and caches the
resulting per-game statistics locally. There is no upload step, because there is nowhere to
upload to.</p>
<p>The first run parses your whole library, which can take a while on a large collection. After
that only new replays are parsed — a return visit re-scans the folder and skips everything it
has already seen.</p>

<h2>The privacy contract</h2>
<p>This is the claim the whole product rests on, so it is worth stating precisely:</p>
<ul>
  <li><strong>Raw replay files (.slp and .slpz) never leave your machine.</strong> No exceptions,
  no setting that changes it. Parsing and decompression happen in your browser.</li>
  <li><strong>Cloud sync is opt-in and stats-only.</strong> If you sign in, the roughly 5&nbsp;KB of
  parsed numbers per game can sync to your own private account so a second device can restore
  them. The replays themselves are not part of that, and are never sent.</li>
  <li><strong>Community contribution is a separate opt-in, off by default.</strong> Turning it on
  adds your anonymised stats to shared benchmarks that only publish aggregates clearing both
  contributor and game-count thresholds. Connect codes, names, emails, replay paths and
  individual rows are never published.</li>
  <li><strong>No tracking.</strong> Aggregate, cookieless page-view counting is the single
  exception, and it never touches replay-derived data.</li>
</ul>

<h2>What you get</h2>
<ul>
  <li><strong>Win rates</strong> broken out by opponent, matchup, character, and stage.</li>
  <li><strong>Kill and damage stats</strong> — stocks taken and lost per game, damage per game,
  and how efficiently you convert.</li>
  <li><strong>Execution metrics</strong> — L-cancel percentage, inputs per minute, wavedash and
  dash-dance counts, grab success.</li>
  <li><strong>Neutral and punish</strong> — openings per kill, damage per opening, neutral-win
  share, counter hits, beneficial trades.</li>
  <li><strong>A counterpick sheet</strong> — your win rate on every stage against every opponent
  character, so you can see which stages are picks and which are bans.</li>
  <li><strong>Sessions and tilt</strong> — win rate by position in a session and by the streak you
  entered a game on.</li>
  <li><strong>Doubles</strong> — team win rates, damage share, and friendly fire, computed from a
  custom frame pass because Slippi's own stat engine reports nothing for 4-player games.</li>
  <li><strong>A win model</strong> — a logistic regression over your own games estimating which
  metrics actually move your odds, with the honest caveats about sample size attached.</li>
</ul>
<p>Every term above is defined on the <a href="/metrics">metrics reference</a>.</p>

<h2>Requirements</h2>
<p>A Chromium-based browser gives the smoothest experience, since it can hold a reference to your
replay folder and re-scan it on later visits. Firefox and Safari work through a folder-upload
fallback that re-selects the folder each time. Nothing is installed, though the app can be
installed as a PWA and works offline once cached.</p>
<p>No account is required to use the dashboard. Signing in is only for syncing parsed stats
between your own devices.</p>

<h2>Melee history, no replays needed</h2>
<p>Two parts of the site need no replay folder at all: the
<a href="/melee-majors">Melee majors record</a>, covering every offline major since 2003, and the
anonymous community benchmarks. Both are open to anyone.</p>

<h2>Open source</h2>
<p>The whole thing is on GitHub at
<a href="https://github.com/1973-pinball/SSBM_DASHBOARD">1973-pinball/SSBM_DASHBOARD</a>, MIT licensed. The
parsing pipeline, the statistics, and the database schema behind cloud sync and the community aggregates are all
there to read.</p>
<p>That matters more here than it would elsewhere, because most of what this page claims is otherwise
unfalsifiable. You cannot see from the outside that frame data is discarded after parsing, or that only
thresholded aggregates are published. You can read the code that does it.</p>
<p>Being honest about the limit of that: reading the source tells you what the code does, not that the server is
running exactly this code. Builds here are not byte-for-byte reproducible, so nobody can diff what you download
against what is served. What you <em>can</em> check without trusting anyone is the browser itself — open the
network panel and watch a parse: no request carries replay bytes, because there is no code path that sends
them.</p>
<p>You can also run your own copy. Self-hosting points cloud sync at a Supabase project you control, which
removes the operator from the picture entirely.</p>

<a class="cta" href="/">Open the dashboard</a>
`,
});

// -------------------------------------------------------------- /metrics

// Every section and every term gets an id. Two reasons: a definitional query
// like "what is L-cancel percentage" needs something on the page to point at
// finer than the whole document, and the DefinedTerm nodes below give each term
// a `url` — which is only honest if that fragment actually resolves.
const metricsBody = SECTIONS.map(
  (s) => `
<h2 id="${slug(s.title)}">${esc(s.title)}</h2>
<dl>
${s.items
  .map(
    (it) =>
      `  <div class="def" id="${slug(it.term)}"><dt>${esc(it.term)}</dt><dd>${esc(it.def)}</dd></div>`,
  )
  .join("\n")}
</dl>`,
).join("\n");

const metricsToc = `
<nav class="toc" aria-label="On this page">
${SECTIONS.map(
  (s) =>
    `  <div class="toc-sec"><a class="toc-h" href="#${slug(s.title)}">${esc(s.title)}</a>
${s.items.map((it) => `    <a href="#${slug(it.term)}">${esc(it.term)}</a>`).join("\n")}
  </div>`,
).join("\n")}
</nav>`;

// A glossary of 40 terms is the one thing on this site that maps cleanly onto a
// schema.org type. Per-term `url` is safe because the ids above exist; there is
// deliberately no FAQPage, which would misrepresent definitions as Q&A.
const METRICS_GLOSSARY_ID = `${ORIGIN}/metrics#glossary`;
const metricsGlossary = {
  "@type": "DefinedTermSet",
  "@id": METRICS_GLOSSARY_ID,
  name: "Super Smash Bros. Melee and Slippi metrics glossary",
  description:
    "Definitions of every statistic SSBM Stats computes from Slippi replays, from openings per kill to L-cancel percentage.",
  url: `${ORIGIN}/metrics`,
  inLanguage: "en-US",
  hasDefinedTerm: SECTIONS.flatMap((s) =>
    s.items.map((it) => ({
      "@type": "DefinedTerm",
      "@id": `${ORIGIN}/metrics#${slug(it.term)}`,
      name: it.term,
      description: it.def,
      url: `${ORIGIN}/metrics#${slug(it.term)}`,
      inDefinedTermSet: { "@id": METRICS_GLOSSARY_ID },
    })),
  ),
};

const metrics = page({
  slug: "metrics",
  title: "Melee & Slippi Metrics Reference — Openings Per Kill, L-Cancel %, and More",
  description:
    "Plain-English definitions of every Super Smash Bros. Melee statistic SSBM Stats computes from Slippi replays: openings per kill, damage per opening, L-cancel percentage, neutral wins, tilt, and more.",
  heading: "Metrics reference",
  mainEntity: metricsGlossary,
  body: `
<h1>Metrics reference</h1>
<p class="lede">Every statistic SSBM Stats computes from your Slippi replays, and exactly what it
means. This is the same reference the app shows in its metrics guide.</p>
<div class="note"><strong>Where these come from.</strong> Neutral and punish metrics are derived
from slippi-js conversion detection over each replay's frame data, so they exist only for games
where that data is present. Everything else is computed from the parsed game record.</div>
${metricsToc}
${metricsBody}
<h2 id="your-own-games">Seeing them on your own games</h2>
<p>The dashboard computes all of the above from your local replay folder, in your browser.
Nothing is uploaded — see <a href="/about">how Slippi replay parsing works in your browser</a>.</p>
<a class="cta" href="/">Open the dashboard</a>
`,
});

// -------------------------------------------------- /melee-majors

const { majors, sources, asOf } = readDataset();

// Decision 6: netplay events are flagged, not deleted, and excluded from every
// total the site publishes. The same rule has to hold here or this page would
// contradict the Liquipedia tab it is derived from.
const offline = majors
  .filter((m) => !m.online)
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));

const titles = new Map();
for (const m of offline) titles.set(m.winner, (titles.get(m.winner) ?? 0) + 1);
const leaderboard = [...titles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const years = offline.map((m) => m.year);
const firstYear = Math.min(...years);
const lastYear = Math.max(...years);
const superMajors = offline.filter((m) => m.tier === "supermajor");
const onlineExcluded = majors.length - offline.length;

const row = (m) =>
  `<tr><td class="num">${esc(m.date)}</td><td>${esc(m.name)}${
    m.tier === "supermajor" ? ' <span class="tier">super</span>' : ""
  }</td><td>${esc(m.winner)}</td><td>${esc(m.runnerUp ?? "—")}</td></tr>`;

// One block per year rather than a single 211-row table. The flat version had
// no year signal at all beyond an ISO date in a cell — the word "year" did not
// appear on the page — so nothing here could match "melee major winners by
// year", which is the second-largest query this page exists to serve.
//
// The heading has to sit outside the table: heading content is not permitted
// inside <table>/<tbody>, and a parser hoists it out, so each year gets its own
// complete table rather than an <h3> wedged between rows.
const byYear = new Map();
for (const m of offline) {
  if (!byYear.has(m.year)) byYear.set(m.year, []);
  byYear.get(m.year).push(m);
}
const yearsDesc = [...byYear.keys()].sort((a, b) => b - a);

const majorsByYear = yearsDesc
  .map(
    (y) => `
<h3 id="majors-${y}">${y} Melee major winners</h3>
<div class="tablewrap">
<table>
<thead><tr><th>Date</th><th>Event</th><th>Winner</th><th>Runner-up</th></tr></thead>
<tbody>
${byYear.get(y).map(row).join("\n")}
</tbody>
</table>
</div>`,
  )
  .join("\n");

// Three columns, not the full four: this is the same dataset already listed
// below, and reprinting it wholesale would read as one page padded twice.
const superTable = superMajors
  .map(
    (m) => `<tr><td class="num">${m.year}</td><td>${esc(m.name)}</td><td>${esc(m.winner)}</td></tr>`,
  )
  .join("\n");

const majorsDescription = `A complete record of ${offline.length} offline Super Smash Bros. Melee majors and supermajors from ${firstYear} to ${lastYear}, with winners, runners-up, and an all-time titles leaderboard.`;

const majorsDataset = {
  "@type": "Dataset",
  "@id": `${ORIGIN}/melee-majors#dataset`,
  name: `Super Smash Bros. Melee offline majors, ${firstYear}–${lastYear}`,
  description: majorsDescription,
  url: `${ORIGIN}/melee-majors`,
  inLanguage: "en-US",
  license: "https://creativecommons.org/licenses/by-sa/3.0/",
  isBasedOn: sources.map((s) => s.url),
  temporalCoverage: `${offline.at(-1).date}/${offline[0].date}`,
  creator: { "@id": ORG_ID },
  keywords: [
    "Super Smash Bros. Melee",
    "Melee majors",
    "Melee supermajors",
    "tournament winners",
    "esports results",
  ],
  variableMeasured: ["Event name", "Date", "Winner", "Runner-up", "Tier"],
  // Deliberately no 211 Event nodes: the Major type carries no venue or
  // location, so every one of them would be ineligible for the Event rich
  // result and would only generate warnings.
};

const leaderTable = leaderboard
  .slice(0, 25)
  .map(
    ([player, n], i) =>
      `<tr><td class="num">${i + 1}</td><td>${esc(player)}</td><td class="num">${n}</td></tr>`,
  )
  .join("\n");

const meleeMajors = page({
  slug: "melee-majors",
  title: "Every Super Smash Bros. Melee Major Since 2003 — Winners By Year",
  description: majorsDescription,
  heading: `Every Melee major since ${firstYear}`,
  mainEntity: majorsDataset,
  body: `
<h1>Every Melee major since ${firstYear}</h1>
<p class="lede">${offline.length} offline Super Smash Bros. Melee majors and supermajors, ${firstYear}–${lastYear},
with winner and runner-up for each, listed year by year. ${superMajors.length} of them are supermajors.</p>
${asOf ? `<p class="updated">Dataset updated ${esc(asOf)}.</p>` : ""}

<div class="note"><strong>Offline events only.</strong> ${onlineExcluded} netplay events that
Liquipedia lists with an &quot;Online&quot; venue are excluded from this table and from every count on
this page. That is a judgement call, not a data cleanup — counting individual weeks of an online
league beside Genesis materially changes the all-time standings — and the underlying records keep
the flag so the choice stays auditable.</div>

<h2 id="all-time-titles">All-time titles</h2>
<div class="tablewrap">
<table>
<thead><tr><th>#</th><th>Player</th><th>Majors won</th></tr></thead>
<tbody>
${leaderTable}
</tbody>
</table>
</div>
<p>Top 25 by offline major titles. ${leaderboard.length} players have won at least one.</p>

<h2 id="supermajors">Melee supermajors</h2>
<p>${superMajors.length} of the ${offline.length} events on this page are supermajors — the
largest tier, by entrant count and field strength. Every one of them, newest first:</p>
<div class="tablewrap">
<table>
<thead><tr><th>Year</th><th>Event</th><th>Winner</th></tr></thead>
<tbody>
${superTable}
</tbody>
</table>
</div>

<h2 id="by-year">Every major by year</h2>
<p>All ${offline.length} offline majors, newest year first. Jump to
${yearsDesc.map((y) => `<a href="#majors-${y}">${y}</a>`).join(" · ")}.</p>
${majorsByYear}

<h2 id="sources">Sources and licence</h2>
<p>This page is compiled from Liquipedia, which publishes under
<a href="https://creativecommons.org/licenses/by-sa/3.0/" rel="license">CC BY-SA 3.0</a>. The
dataset ships with the app as a bundled snapshot and is topped up weekly.</p>
<ul>
${sources.map((s) => `  <li><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></li>`).join("\n")}
</ul>

<h2 id="track-your-own">Track your own record</h2>
<p>SSBM Stats also reads your personal Slippi replays and builds the same kind of record for your
own play — win rates, matchups, and execution stats, parsed entirely in your browser.
<a href="/about">How Slippi replay analytics works here</a>.</p>
<a class="cta" href="/">Open the dashboard</a>
`,
});

// ------------------------------------------------------------- sitemap

// <lastmod> on /melee-majors only. Google trusts the field only when it is
// consistently accurate, so a build timestamp — which would claim all four
// pages changed on every deploy — is worse than omitting it, and /, /about and
// /metrics still carry none. The majors page is the exception because its
// content is the Liquipedia snapshot and DATA_AS_OF is that snapshot's real
// date, not a build artifact.
//
// The honest caveat: DATA_AS_OF tracks the whole snapshot, so a refresh that
// only topped up player winnings advances it without changing anything on this
// page. That overstates freshness occasionally; it never invents a change that
// did not happen somewhere in the dataset.
const lastmod = { "melee-majors": asOf };

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["", "about", "metrics", "melee-majors"]
  .map((s) => {
    const loc = s === "" ? `${ORIGIN}/` : `${ORIGIN}/${s}`;
    const mod = lastmod[s] ? `\n    <lastmod>${lastmod[s]}</lastmod>` : "";
    return `  <url>\n    <loc>${loc}</loc>${mod}\n  </url>`;
  })
  .join("\n")}
</urlset>
`;

// ---------------------------------------------------------------- write

if (!existsSync(DIST)) {
  console.error(`render-seo-pages: ${DIST} does not exist — run vite build first.`);
  process.exit(1);
}
mkdirSync(DIST, { recursive: true });

const written = [
  ["about.html", about],
  ["metrics.html", metrics],
  ["melee-majors.html", meleeMajors],
  ["sitemap.xml", sitemap],
];
for (const [name, content] of written) {
  writeFileSync(resolve(DIST, name), content);
}
console.log(
  `render-seo-pages: wrote ${written.map(([n]) => n).join(", ")} ` +
    `(${SECTIONS.reduce((n, s) => n + s.items.length, 0)} metric definitions, ${offline.length} majors)`,
);
