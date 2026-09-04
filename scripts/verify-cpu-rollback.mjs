/** Regression: CPU rollback restores legacy and v2 games without network access. */
import assert from "node:assert/strict";
import { createServer } from "vite";

const persisted = [];
let packs = [];
globalThis.__cpuRollbackDb = { putRecords: async (rows) => persisted.push(...rows), pruneDuplicates: async (rows) => rows };
globalThis.__cpuRollbackCloud = {
  from(table) {
    assert.equal(table, "game_record_packs");
    let buckets = null;
    let range = null;
    const query = {
      select() { return query; },
      order() { return query; },
      range(from, to) { range = [from, to]; return query; },
      in(column, values) { assert.equal(column, "bucket"); buckets = values; return query; },
      then(resolve) {
        let data = packs.filter((pack) => !buckets || buckets.includes(pack.bucket));
        if (range) data = data.slice(range[0], range[1] + 1);
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  },
  rpc() { throw new Error("Existing compatible cloud games must not be uploaded again"); },
};

const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: "mock-private-storage",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.endsWith("/src/lib/cloudSync.ts")) return;
      if (source === "./supabase") return "\0rollback-cloud";
      if (source === "./db") return "\0rollback-db";
    },
    load(id) {
      if (id === "\0rollback-cloud") return "export const supabase = globalThis.__cpuRollbackCloud;";
      if (id === "\0rollback-db") return "export const { putRecords, pruneDuplicates } = globalThis.__cpuRollbackDb;";
    },
  }],
});

try {
  const { generateDemoRecords, DEMO_ACCOUNTS } = await server.ssrLoadModule("/src/lib/demo.ts");
  const stats = await server.ssrLoadModule("/src/lib/stats.ts");
  const types = await server.ssrLoadModule("/src/lib/types.ts");
  const { gameKey } = await server.ssrLoadModule("/src/lib/dedupe.ts");
  const cloud = await server.ssrLoadModule("/src/lib/cloudSync.ts");
  const records = generateDemoRecords(600);
  const codes = new Set(DEMO_ACCOUNTS.map((account) => account.code));
  const singles = stats.resolveGames(records, codes);
  const teams = stats.resolveTeamGames(records, codes);
  assert.equal(singles.length, 600);
  assert.ok(teams.length > 0);
  stats.overview(singles, singles, types.DEFAULT_FILTERS);
  stats.executionSummary(singles);
  stats.teamOverview(teams);

  for (const [game, resolve] of [[singles[0], stats.resolveGames], [teams[0], stats.resolveTeamGames]]) {
    for (const value of [undefined, false, true]) {
      const record = structuredClone(game.rec);
      for (const player of record.players) {
        if (value === undefined) delete player.isCpu;
        else player.isCpu = value;
      }
      assert.equal(resolve([record], codes).length, 1, "rollback must not filter either CPU or unknown status");
      assert.ok(types.hasCurrentStats(record));
      assert.ok(!types.needsStatsRepair(record));
    }
  }

  // A 482-game cache must recover older cloud games as well as CPU-release
  // payloads. Exercise the real restore and sync code with in-memory storage.
  const history = singles.map(({ rec }, i) => {
    const record = structuredClone(rec);
    record.statsVersion = i % 2 ? 2 : 1;
    if (record.statsVersion === 2) record.players.forEach((player) => { player.isCpu = false; });
    return record;
  });
  packs = [{
    bucket: 0,
    records: Object.fromEntries(history.map((record) => [gameKey(record), record])),
    versions: Object.fromEntries(history.map((record) => [gameKey(record), record.statsVersion])),
    updated_at: "2026-09-04T12:00:00Z",
  }];
  const restored = await cloud.restoreCloudRecords();
  assert.equal(restored.length, 600);
  assert.equal(persisted.length, 600, "both cloud versions must survive a reload");
  persisted.length = 0;
  const local = history.slice(0, 482);
  const result = await cloud.syncRecords(local, codes);
  assert.equal(result.pushed, 0);
  assert.equal(result.pulled.length, 118);
  assert.equal(persisted.length, 118);
  assert.equal(stats.resolveGames([...local, ...result.pulled], codes).length, 600);
  console.log("CPU rollback passed: singles, teams, unknown status, demo selectors, both cloud versions, and partial-cache recovery.");
} finally {
  await server.close();
  delete globalThis.__cpuRollbackDb;
  delete globalThis.__cpuRollbackCloud;
}
