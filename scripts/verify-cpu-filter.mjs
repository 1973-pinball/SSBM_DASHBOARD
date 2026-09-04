/** CPU exclusion, including previews and stale cloud copies. No private replays. */
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { encode } from "@shelacek/ubjson";
import { createServer } from "vite";

// Minimal synthetic SLP: real GAME_START player-type bytes, no frame data.
// https://github.com/project-slippi/slippi-wiki/blob/master/SPEC.md
function replay(playerTypes) {
  const start = Buffer.alloc(0x321);
  start[0] = 0x36;
  start[1] = 3;
  start[0x0d] = Number(playerTypes.length === 4);
  start.writeUInt16BE(31, 0x13);
  for (let i = 0; i < 4; i++) {
    start[0x65 + i * 0x24] = 2; // Fox
    start[0x66 + i * 0x24] = playerTypes[i] ?? 3; // empty port
    start[0x67 + i * 0x24] = 4;
    start[0x6e + i * 0x24] = Math.floor(i / 2);
  }
  const sizes = Buffer.from([0x35, 7, 0x36, 3, 0x20, 0x39, 0, 6]);
  const end = Buffer.from([0x39, 2, 0xff, 0, 1, 0xff, 0xff]);
  const raw = Buffer.concat([sizes, start, end]);
  const prefix = Buffer.from([0x7b, 0x55, 3, 0x72, 0x61, 0x77, 0x5b, 0x24, 0x55, 0x23, 0x6c, 0, 0, 0, 0]);
  prefix.writeUInt32BE(raw.length, 11);
  const metadata = Buffer.from(encode({ startAt: "2026-01-01T12:00:00Z", lastFrame: 3600 }));
  const bytes = Buffer.concat([prefix, raw, Buffer.from("U\x08metadata"), metadata, Buffer.from("}")]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const demo = await server.ssrLoadModule("/src/lib/demo.ts");
  const stats = await server.ssrLoadModule("/src/lib/stats.ts");
  const types = await server.ssrLoadModule("/src/lib/types.ts");
  const { dedupeRecords } = await server.ssrLoadModule("/src/lib/dedupe.ts");
  const parser = await server.ssrLoadModule("/src/lib/parse.ts");

  for (const playerTypes of [[0, 0], [0, 1], [1, 0], [0, 0, 1, 0], [0, 1, 0, 0]]) {
    const buf = replay(playerTypes);
    const header = parser.parseHeader("fixture", "fixture.slp", buf);
    const ranged = await parser.parseHeaderFile("fixture", "fixture.slp", new File([buf], "fixture.slp"));
    const full = parser.parseReplay("fixture", "fixture.slp", buf);
    for (const rec of [header, ranged, full]) {
      assert.deepEqual(rec.players.map((p) => p.isCpu), playerTypes.map((t) => t === 1));
    }
    assert.deepEqual(ranged, header, "ranged and whole-buffer previews agree");
    assert.ok(types.hasCurrentStats(full));
  }

  const records = demo.generateDemoRecords(200);
  const codes = new Set(demo.DEMO_ACCOUNTS.map((a) => a.code));
  const singles = stats.resolveGames(records, codes);
  const teams = stats.resolveTeamGames(records, codes);
  assert.equal(singles.length, 200);
  assert.ok(teams.length > 0);
  stats.overview(singles, singles, types.DEFAULT_FILTERS);
  stats.executionSummary(singles);
  stats.teamOverview(teams);

  for (const [games, resolve] of [[singles, stats.resolveGames], [teams, stats.resolveTeamGames]]) {
    const human = games[0].rec;
    assert.equal(resolve([human], codes).length, 1);
    // CPU opponents, teammates, and even a CPU slot carrying the user's code.
    for (let i = 0; i < human.players.length; i++) {
      const cpu = structuredClone(human);
      cpu.players[i].isCpu = true;
      assert.equal(resolve([cpu], codes).length, 0);
      assert.equal(resolve([{ ...cpu, statsLevel: "header" }], codes).length, 0);

      const legacy = structuredClone(human);
      delete legacy.players[i].isCpu;
      legacy.statsVersion = 1;
      assert.equal(resolve([legacy], codes).length, 0, "unknown CPU status cannot enter stats");
      assert.ok(types.needsStatsRepair(legacy), "old cloud copies prompt a refresh");
      for (const copies of [[legacy, cpu], [cpu, legacy]]) {
        const deduped = dedupeRecords(copies);
        assert.deepEqual(deduped, [cpu], "reparsed CPU beats stale cloud copy in either order");
        assert.equal(resolve(deduped, codes).length, 0);
      }
    }
    assert.ok(types.hasCurrentStats(human));
    assert.ok(!types.needsStatsRepair(human));
    assert.equal(resolve([{ ...human, statsLevel: "header" }], codes).length, 1);
  }
  const offline = structuredClone(singles[0].rec);
  offline.gameType = "offline";
  offline.players.find((p) => !codes.has(p.connectCode)).connectCode = null;
  assert.equal(stats.resolveGames([offline], codes).length, 1, "a human without a code is not a CPU");
  assert.ok(!types.needsStatsRepair({ ...offline, players: [], parseError: "corrupt replay" }));
  console.log("CPU filtering passed: parser, both previews, singles, teams, legacy cloud repair, dedup, and demo selectors.");
} finally {
  await server.close();
}
