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

export const LEGAL_STAGE_IDS = [2, 3, 8, 28, 31, 32];

export const charName = (id: number): string => CHARACTERS[id] ?? `Char ${id}`;
export const stageName = (id: number): string => STAGES[id] ?? `Stage ${id}`;
