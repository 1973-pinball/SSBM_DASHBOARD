// Character-name helpers for the Liquipedia dataset. The dataset stores
// canonical full names ("Donkey Kong", "Mr. Game & Watch"); the stock-icon
// sprites in /public/stock are keyed by Melee external character ID.

const NAME_TO_ID: Record<string, number> = {
  "Captain Falcon": 0,
  "Donkey Kong": 1,
  DK: 1,
  Fox: 2,
  "Mr. Game & Watch": 3,
  "Game & Watch": 3,
  Kirby: 4,
  Bowser: 5,
  Link: 6,
  Luigi: 7,
  Mario: 8,
  Marth: 9,
  Mewtwo: 10,
  Ness: 11,
  Peach: 12,
  Pikachu: 13,
  "Ice Climbers": 14,
  Jigglypuff: 15,
  Samus: 16,
  Yoshi: 17,
  Zelda: 18,
  Sheik: 19,
  Falco: 20,
  "Young Link": 21,
  "Dr. Mario": 22,
  Roy: 23,
  Pichu: 24,
  Ganondorf: 25,
};

/** Melee external character ID for a dataset character name (null if unknown). */
export const charId = (name: string): number | null => NAME_TO_ID[name] ?? null;

/** Stock-icon URL for a dataset character name (null if unknown). */
export const stockUrl = (name: string): string | null => {
  const id = charId(name);
  return id === null ? null : `/stock/${id}.png`;
};

/**
 * Series colors for the character-composition charts. CVD-validated 7-hue
 * dark-mode sequence (loss-red slot deliberately unused — red is reserved);
 * hues are assigned to the perennial top characters, loosely matched to
 * in-game identity, and stock icons + direct labels carry identity as the
 * secondary encoding. Characters outside this map fold into
 * OTHER_CHAR_COLOR — never generate extra hues.
 *
 * CHAR_STACK_ORDER is the validated adjacency sequence: stacked charts must
 * layer series in this order (Other on top) or the CVD guarantees lapse.
 */
export const CHAR_COLORS: Record<string, string> = {
  Falco: "#3987e5", // blue
  Fox: "#d95926", // orange
  Marth: "#199e70", // aqua
  Peach: "#c98500", // yellow
  Jigglypuff: "#d55181", // magenta
  Sheik: "#008300", // green
  "Captain Falcon": "#9085e9", // violet
};

export const CHAR_STACK_ORDER = ["Falco", "Fox", "Marth", "Peach", "Jigglypuff", "Sheik", "Captain Falcon"];

export const OTHER_CHAR = "Other";
export const OTHER_CHAR_COLOR = "#6b6490"; // --faint

export const charColor = (name: string): string => CHAR_COLORS[name] ?? OTHER_CHAR_COLOR;
