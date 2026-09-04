/** Multiple folder imports: synthetic files/handles only; no private replays. */
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { createServer } from "vite";

function directory(name, children = [], options = {}) {
  const identity = options.identity ?? Symbol(name);
  return {
    kind: "directory", name, identity,
    async isSameEntry(other) { return identity === other.identity; },
    async queryPermission() {
      if (options.permissionError) throw new Error("unavailable handle");
      return options.permission ?? "granted";
    },
    async requestPermission() { return options.requestedPermission ?? this.queryPermission(); },
    async *entries() {
      if (options.scanError) throw new Error("drive disconnected");
      for (const child of children) yield [child.name, child];
    },
  };
}

function file(name, contents = "replay") {
  return { kind: "file", name, async getFile() { return new File([contents], name, { lastModified: 1000 }); } };
}

const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { addReplayFolder, accessibleReplayFolders } = await server.ssrLoadModule("/src/lib/folders.ts");
  const { discoverFromFolders, discoverFromHandle, discoverFromFileList } = await server.ssrLoadModule("/src/lib/pool.ts");
  const { db, getReplayFolders, setReplayFolders } = await server.ssrLoadModule("/src/lib/db.ts");
  const { dedupeRecords } = await server.ssrLoadModule("/src/lib/dedupe.ts");
  const { generateDemoRecords } = await server.ssrLoadModule("/src/lib/demo.ts");

  const nested = directory("2026", [file("game.SLP"), file("compressed.slpz"), file("notes.txt")]);
  const first = directory("Slippi", [nested]);
  const second = directory("Slippi", [directory("2026", [file("game.SLP", "other!")])]);
  let added = await addReplayFolder([], first);
  added = await addReplayFolder(added.folders, second);
  const folders = added.folders;
  assert.equal(folders.length, 2, "same directory names are distinct roots");
  const repicked = await addReplayFolder(folders, directory("Slippi", [], { identity: first.identity }));
  assert.deepEqual(repicked.folders, folders, "a cloned handle to the same directory reuses its namespace");

  const initial = await discoverFromFolders(folders);
  assert.equal(initial.files.length, 3, "recursive discovery supports both replay extensions");
  assert.equal(new Set(initial.files.map((f) => f.id)).size, 3, "equal paths, sizes and mtimes in distinct roots do not collide");
  const rescanned = await discoverFromFolders(folders);
  assert.deepEqual(rescanned.files.map((f) => f.id), initial.files.map((f) => f.id), "refresh uses stable cache keys");

  // Use the real persistence helpers with a minimal key/value store. A legacy
  // install must neither lose its root nor change the ids already in `seen`.
  const kv = new Map([["dirHandle", { value: first }]]);
  db.kv.get = async (key) => kv.get(key);
  db.kv.put = async (row) => { kv.set(row.key, row); };
  const migrated = await getReplayFolders();
  const legacy = await discoverFromFolders(migrated);
  assert.deepEqual(legacy.files.map((f) => f.id), (await discoverFromHandle(first)).map((f) => f.id));
  const extended = await addReplayFolder(migrated, second);
  assert.equal(await setReplayFolders(extended.folders), true);
  assert.deepEqual(await getReplayFolders(), extended.folders, "every root survives reload");
  await setReplayFolders([]);
  assert.deepEqual(await getReplayFolders(), [], "an explicit empty list overrides the legacy key");
  db.kv.put = async () => { throw new Error("storage unavailable"); };
  assert.equal(await setReplayFolders(folders), false, "persistence failure can be reported to the user");

  const denied = { id: "denied", handle: directory("Denied", [], { permission: "denied" }) };
  const prompt = { id: "prompt", handle: directory("Reconnect", [], { permission: "prompt", requestedPermission: "granted" }) };
  const broken = { id: "broken", handle: directory("Broken", [], { permissionError: true }) };
  const access = await accessibleReplayFolders([...folders, denied, prompt, broken]);
  assert.deepEqual(access.granted, folders);
  assert.deepEqual(access.unavailable, [denied, prompt, broken]);
  const reconnected = await accessibleReplayFolders([...folders, denied, prompt, broken], true);
  assert.deepEqual(reconnected.granted, [...folders, prompt]);
  assert.deepEqual(reconnected.unavailable, [denied, broken]);
  const disconnected = { id: "drive", handle: directory("USB", [], { scanError: true }) };
  const partial = await discoverFromFolders([disconnected, ...folders]);
  assert.deepEqual(partial.unavailable, [disconnected]);
  assert.deepEqual(partial.files.map((f) => f.id), initial.files.map((f) => f.id), "one failed root cannot block another");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverFromFolders(folders, controller.signal), { name: "AbortError" });

  const fallbackFile = new File(["replay"], "game.slp", { lastModified: 1000 });
  Object.defineProperty(fallbackFile, "webkitRelativePath", { value: "Slippi/game.slp" });
  const fallbackA = discoverFromFileList([fallbackFile], "selection-a");
  const fallbackB = discoverFromFileList([fallbackFile], "selection-b");
  assert.notEqual(fallbackA[0].id, fallbackB[0].id, "fallback picks cannot silently skip a same-named root");

  const overlap = await addReplayFolder(folders, nested);
  const overlapping = await discoverFromFolders(overlap.folders);
  const games = generateDemoRecords(5);
  const gameByHandle = new Map();
  for (const entry of overlapping.files) {
    if (!gameByHandle.has(entry.handle)) gameByHandle.set(entry.handle, games[gameByHandle.size]);
  }
  const parsed = overlapping.files.map((entry) => ({ ...gameByHandle.get(entry.handle), id: entry.id, fileName: entry.path }));
  assert.equal(parsed.length, 5);
  assert.equal(dedupeRecords(parsed).length, 3, "parent/child folder overlap counts each game once");
  console.log("Folder checks passed: migration, persistence, recursive imports, same-name roots, repeat picks, refresh, partial permissions, disconnected drives, cancellation, fallback keys, and overlapping games.");
} finally {
  await server.close();
}
