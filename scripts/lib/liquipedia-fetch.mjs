// Polite, serialized access to Liquipedia's MediaWiki API.
//
// Their terms require an identifying User-Agent and forbid rapid automated
// access, and they enforce it: a burst of parallel requests gets a developer
// IP blocked for hours. Every caller goes through fetchPage, which serializes
// requests with a fixed gap and backs off hard on a 429.

const API = "https://liquipedia.net/smash/api.php";
const CONTACT = process.env.LIQUIPEDIA_CONTACT || "info.studio.pinball@gmail.com";
const UA = `SSBMDashboard/1.0 (bundled scene-history snapshot; contact: ${CONTACT})`;
// Deliberately slower than their limit. Overridable only so offline tests
// don't sit through real pacing.
const REQUEST_GAP_MS = Number(process.env.LIQUIPEDIA_GAP_MS) || 30_000;
const MAX_ATTEMPTS = 4;

/** Thrown when Liquipedia kept refusing; callers treat this as "try later". */
export class RateLimited extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;

/**
 * Fetch one page. `prop` is "text" for rendered HTML or "wikitext" for source
 * — which one you need depends on the figure: anything Liquipedia computes
 * (career winnings, for one) exists only in the rendered page.
 */
export async function fetchPage(page, prop, log = console.log) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();

    const url = `${API}?action=parse&page=${encodeURIComponent(page)}&format=json&prop=${prop}&redirects=1`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });

    if (res.status === 429 || res.status === 403) {
      const backoff = 120_000 * attempt;
      log(`  rate-limited on ${page} (HTTP ${res.status}); waiting ${backoff / 1000}s`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${page}`);

    const body = await res.text();
    if (!body.trimStart().startsWith("{")) {
      // Their rate-limit interstitial is HTML, not JSON.
      const backoff = 120_000 * attempt;
      log(`  non-JSON response for ${page}; waiting ${backoff / 1000}s`);
      await sleep(backoff);
      continue;
    }
    const json = JSON.parse(body);
    if (json.error) throw new Error(`API error for ${page}: ${json.error.info ?? json.error.code}`);
    return json.parse[prop]["*"];
  }
  throw new RateLimited(`gave up fetching ${page} after ${MAX_ATTEMPTS} attempts`);
}
