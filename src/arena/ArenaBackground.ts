import type { GameMode } from '../types';

/** Gemeinsame, in X/Y nahtlos wiederholbare Boden-Textur für alle Arena-Größen und Modi. */
export const ARENA_BACKGROUND_TEXTURE_KEY = 'gras_bg_tile' as const;
export type ArenaBackgroundTextureKey = typeof ARENA_BACKGROUND_TEXTURE_KEY;

/**
 * Zweite, feinere Boden-Kachel. Sie liegt als Multiply-Ebene über der Basiskachel und trägt
 * Büschel und Halmkorn.
 *
 * Zwei Gründe für die getrennte Kachel statt einer einzigen größeren Textur:
 *
 * 1. **Periodenbruch.** Die Basiskachel ist 627 px breit, die Arena je nach Modus 1440 bis
 *    4320 px – ihre Struktur wiederholt sich also mehrfach im Bild. Diese Kachel ist 512 px
 *    breit; 627 = 3·11·19 ist ungerade und damit teilerfremd zu 512, das kleinste gemeinsame
 *    Vielfache beider Perioden liegt bei 321 024 px. Die Kombination kehrt im Spielfeld also
 *    nie identisch wieder.
 * 2. **Frequenztrennung.** Basiskachel und Detailkachel decken bewusst verschiedene Bänder ab,
 *    sodass sich die Anteile unabhängig nachjustieren lassen.
 *
 * Beide Kacheln entstehen in `scripts/generate-grass-tiles.mjs`.
 */
export const ARENA_BACKGROUND_DETAIL_TEXTURE_KEY = 'gras_detail_tile' as const;
export type ArenaBackgroundDetailTextureKey = typeof ARENA_BACKGROUND_DETAIL_TEXTURE_KEY;

/**
 * Deckkraft der Detailebene. Phasers Multiply-Blend interpoliert mit Alpha gegen Neutral
 * (`dst * (1 - a + a * src)`), das ist also ein sauberer Stärkeregler. Die Kachel ist bereits
 * mit ihrer Zielstärke erzeugt, deshalb 1.
 */
export const ARENA_BACKGROUND_DETAIL_ALPHA = 1;

export interface ArenaBackgroundSpec {
  readonly textureKey: ArenaBackgroundTextureKey;
  readonly detailTextureKey: ArenaBackgroundDetailTextureKey;
  readonly detailAlpha: number;
}

/**
 * Liefert für jeden Arena-Pfad denselben Tile-Key. Die Größe wird ausschließlich am TileSprite
 * bzw. am CPU-Sampler festgelegt; dadurch müssen variable Breiten und Höhen weder gestreckt noch
 * aus modeabhängigen Großbildern zugeschnitten werden.
 */
export function resolveArenaBackgroundSpec(_mode: GameMode, _arenaWidth: number): ArenaBackgroundSpec {
  return {
    textureKey: ARENA_BACKGROUND_TEXTURE_KEY,
    detailTextureKey: ARENA_BACKGROUND_DETAIL_TEXTURE_KEY,
    detailAlpha: ARENA_BACKGROUND_DETAIL_ALPHA,
  };
}
