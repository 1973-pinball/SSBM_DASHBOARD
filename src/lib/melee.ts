// In-game external character IDs used by Slippi.
export const CHARACTERS: Record<number, string> = {
  0: "Captain Falcon",
  1: "DK",
  2: "Fox",
  3: "Game & Watch",
  4: "Kirby",
  5: "Bowser",
  6: "Link",
  7: "Luigi",
  8: "Mario",
  9: "Marth",
  10: "Mewtwo",
  11: "Ness",
  12: "Peach",
  13: "Pikachu",
  14: "Ice Climbers",
  15: "Jigglypuff",
  16: "Samus",
  17: "Yoshi",
  18: "Zelda",
  19: "Sheik",
  20: "Falco",
  21: "Young Link",
  22: "Dr. Mario",
  23: "Roy",
  24: "Pichu",
  25: "Ganondorf",
};

export const STAGES: Record<number, string> = {
  2: "Fountain of Dreams",
  3: "Pokémon Stadium",
  8: "Yoshi's Story",
  28: "Dream Land",
  31: "Battlefield",
  32: "Final Destination",
};

export const charName = (id: number): string => CHARACTERS[id] ?? `Char ${id}`;
export const stageName = (id: number): string => STAGES[id] ?? `Stage ${id}`;

/**
 * Melee attack IDs (PostFrame `lastAttackLanded`, as used by slippi-js
 * conversion moves) grouped into the buckets players think in. Jab 1/2/3 and
 * rapid jabs collapse to "Jab"; specials are per-direction (the character
 * context says which move it actually is). Kept local so the main bundle
 * doesn't pull in slippi-js just for names.
 */
const MOVE_GROUPS: [number[], string, string][] = [
  [[2, 3, 4, 5], "jab", "Jab"],
  [[6], "dash", "Dash attack"],
  [[7], "ftilt", "Forward tilt"],
  [[8], "utilt", "Up tilt"],
  [[9], "dtilt", "Down tilt"],
  [[10], "fsmash", "Forward smash"],
  [[11], "usmash", "Up smash"],
  [[12], "dsmash", "Down smash"],
  [[13], "nair", "Neutral air"],
  [[14], "fair", "Forward air"],
  [[15], "bair", "Back air"],
  [[16], "uair", "Up air"],
  [[17], "dair", "Down air"],
  [[18], "neutral-b", "Neutral B"],
  [[19], "side-b", "Side B"],
  [[20], "up-b", "Up B"],
  [[21], "down-b", "Down B"],
  [[50, 51], "getup", "Getup attack"],
  [[52], "pummel", "Pummel"],
  [[53], "fthrow", "Forward throw"],
  [[54], "bthrow", "Back throw"],
  [[55], "uthrow", "Up throw"],
  [[56], "dthrow", "Down throw"],
  [[61, 62], "edge", "Edge attack"],
];

export interface MoveGroup {
  key: string;
  label: string;
}

const MOVE_GROUP_BY_ID = new Map<number, MoveGroup>();
const MOVE_GROUP_LABEL_BY_KEY = new Map<string, string>();
for (const [ids, key, label] of MOVE_GROUPS) {
  MOVE_GROUP_LABEL_BY_KEY.set(key, label);
  for (const id of ids) MOVE_GROUP_BY_ID.set(id, { key, label });
}

const OTHER_MOVE: MoveGroup = { key: "other", label: "Other" };

export const moveGroup = (moveId: number): MoveGroup => MOVE_GROUP_BY_ID.get(moveId) ?? OTHER_MOVE;
export const moveGroupLabel = (key: string): string => MOVE_GROUP_LABEL_BY_KEY.get(key) ?? OTHER_MOVE.label;
