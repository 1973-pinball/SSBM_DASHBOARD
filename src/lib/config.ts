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

/**
 * Hard-coded allowlist of the 26 playable characters. Melee's external
 * character table runs past the roster into Master Hand, the wireframes, Giga
 * Bowser, Sandbag and Popo (IDs 26–32); those can't be picked in a versus
 * match, so a replay reporting one is malformed or came out of a mod, not a
 * game worth a row in anyone's stats. Games where either side sits outside
 * this list are dropped at resolve time, exactly like an illegal stage —
 * otherwise they surface as "Char 31" in the matchup tables.
 */
export const INCLUDED_CHARACTER_IDS = [
  0, // Captain Falcon
  1, // DK
  2, // Fox
  3, // Game & Watch
  4, // Kirby
  5, // Bowser
  6, // Link
  7, // Luigi
  8, // Mario
  9, // Marth
  10, // Mewtwo
  11, // Ness
  12, // Peach
  13, // Pikachu
  14, // Ice Climbers
  15, // Jigglypuff
  16, // Samus
  17, // Yoshi
  18, // Zelda
  19, // Sheik
  20, // Falco
  21, // Young Link
  22, // Dr. Mario
  23, // Roy
  24, // Pichu
  25, // Ganondorf
];

export const INCLUDED_CHARACTER_ID_SET: ReadonlySet<number> = new Set(INCLUDED_CHARACTER_IDS);
