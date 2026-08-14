// Types for the plain-JS frame painters shared by the app and the asset render.
export declare const CANVAS: { w: number; h: number };

export interface RaceStandingFrame {
  name: string;
  year: number;
  winner: string;
  standings: { player: string; count: number }[];
}

export interface CharBarFrame {
  title: string;
  year: number;
  total: number;
  chars: { char: string; count: number; topPlayer?: string; topRank?: number; isNew?: boolean }[];
}

/** `icons` maps a key (player tag / character name) to a drawable image. */
export interface DrawOptions {
  max: number;
  icons?: Record<string, CanvasImageSource>;
}

export function drawRaceFrame(ctx: CanvasRenderingContext2D, frame: RaceStandingFrame, opts: DrawOptions): void;
export function drawCharFrame(ctx: CanvasRenderingContext2D, frame: CharBarFrame, opts: DrawOptions): void;
