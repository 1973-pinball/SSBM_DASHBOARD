/**
 * Stress the pure whole-library passes with a deterministic 20k-game corpus.
 * This does not fabricate replay files or exercise slippi-js; bench:parse owns
 * that job. It catches accidental superlinear selectors and oversized derived
 * state without transmitting or reading any user's replay data.
 *
 *   npm run verify:large -- [singles-count]
 */
import { createServer } from "vite";

const requested = Math.max(1, Number(process.argv[2] ?? 20_000));
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

try {
  const demo = await server.ssrLoadModule("/src/lib/demo.ts");
  const stats = await server.ssrLoadModule("/src/lib/stats.ts");
  const dedupe = await server.ssrLoadModule("/src/lib/dedupe.ts");
  const types = await server.ssrLoadModule("/src/lib/types.ts");
  const started = performance.now();
  const records = demo.generateDemoRecords(requested);
  const payloadBytes = Buffer.byteLength(JSON.stringify(records));
  const unique = dedupe.dedupeRecords(records);
  const codes = new Set(demo.DEMO_ACCOUNTS.map((account) => account.code));
  const singles = stats.resolveGames(unique, codes);
  const teams = stats.resolveTeamGames(unique, codes);

  // Exercise the heaviest selectors represented across the default tabs.
  stats.overview(singles, singles, types.DEFAULT_FILTERS);
  stats.moveTable(singles);
  stats.executionSummary(singles);
  stats.statCardData(singles);
  stats.tiltStats(stats.computeSessions(singles));
  stats.teamOverview(teams);

  if (unique.length !== records.length) throw new Error("deterministic demo unexpectedly produced duplicate games");
  if (singles.length !== requested) throw new Error(`expected ${requested} singles, resolved ${singles.length}`);
  if (teams.length === 0) throw new Error("large-library corpus did not exercise teams selectors");

  const elapsedMs = performance.now() - started;
  const heap = process.memoryUsage();
  console.log(
    JSON.stringify({
      records: records.length,
      singles: singles.length,
      teams: teams.length,
      payloadMiB: Number((payloadBytes / 1024 / 1024).toFixed(1)),
      heapUsedMiB: Number((heap.heapUsed / 1024 / 1024).toFixed(1)),
      elapsedMs: Math.round(elapsedMs),
    }),
  );
} finally {
  await server.close();
}
