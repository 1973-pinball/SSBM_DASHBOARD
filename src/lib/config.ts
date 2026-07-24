// Hard-coded allowlist of stages included in the dashboard. Games played on
// any other stage (e.g. casual/free-play stages like Stage 7, 15, 29) are
// dropped at resolve time and never reach filters, aggregations, or the log.
export const INCLUDED_STAGE_IDS = [
  2, // Fountain of Dreams
  3, // Pokémon Stadium
  8, // Yoshi's Story
  28, // Dream Land
  31, // Battlefield
  32, // Final Destination
];

export const INCLUDED_STAGE_ID_SET: ReadonlySet<number> = new Set(INCLUDED_STAGE_IDS);
