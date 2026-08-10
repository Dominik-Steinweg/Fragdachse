import type { GameMode } from '../types';

/** Gemeinsame, in X/Y nahtlos wiederholbare Boden-Textur für alle Arena-Größen und Modi. */
export const ARENA_BACKGROUND_TEXTURE_KEY = 'gras_bg_tile' as const;
export type ArenaBackgroundTextureKey = typeof ARENA_BACKGROUND_TEXTURE_KEY;

export interface ArenaBackgroundSpec {
  readonly textureKey: ArenaBackgroundTextureKey;
}

/**
 * Liefert für jeden Arena-Pfad denselben Tile-Key. Die Größe wird ausschließlich am TileSprite
 * bzw. am CPU-Sampler festgelegt; dadurch müssen variable Breiten und Höhen weder gestreckt noch
 * aus modeabhängigen Großbildern zugeschnitten werden.
 */
export function resolveArenaBackgroundSpec(_mode: GameMode, _arenaWidth: number): ArenaBackgroundSpec {
  return { textureKey: ARENA_BACKGROUND_TEXTURE_KEY };
}
