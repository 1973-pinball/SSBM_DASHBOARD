import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Canonical order is part of the fingerprint format. Change the version prefix
// as well as this list if the public export gains or removes a derived table.
export const ARCHIVE_CONTENT_TABLES = Object.freeze([
  "archive_tournament_series",
  "archive_tournaments",
  "archive_bundles",
  "archive_players",
  "archive_player_aliases",
  "archive_player_rankings",
  "archive_sets",
  "archive_set_players",
  "archive_games",
  "archive_game_players",
  "archive_rollups",
]);

export async function computeArchiveContentSha256({ dir, datasetRow }) {
  const hasher = createHash("sha256");
  hasher.update("nikki-public-export-v1\0");
  hasher.update(JSON.stringify({ ...datasetRow, content_sha256: null }));
  for (const table of ARCHIVE_CONTENT_TABLES) {
    hasher.update(`\0${table}\0`);
    hasher.update(await readFile(path.join(dir, `${table}.ndjson`)));
  }
  return hasher.digest("hex");
}
