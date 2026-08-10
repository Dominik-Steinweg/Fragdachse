import {
  CAPTURE_THE_BEER_ARENA_WIDTH,
  DEFAULT_ARENA_HEIGHT,
  FULL_ARENA_WIDTH,
} from '../config';
import { CAPTURE_THE_BEER_MODE } from '../gameModes';
import type { GameMode } from '../types';

export type ArenaBackgroundTextureKey = 'gras_bg_dm' | 'gras_bg_ctb';

export interface ArenaBackgroundSpec {
  readonly textureKey: ArenaBackgroundTextureKey;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

/**
 * Wählt den Hintergrund und einen nativen, mittigen Quellbereich. Dadurch werden Zwischenbreiten
 * nie horizontal gestaucht und Renderer sowie Terrain-Farbsampler können dieselben Pixel nutzen.
 */
export function resolveArenaBackgroundSpec(mode: GameMode, arenaWidth: number): ArenaBackgroundSpec {
  const useExpandedTexture = mode === CAPTURE_THE_BEER_MODE || arenaWidth > FULL_ARENA_WIDTH;
  const textureWidth = useExpandedTexture ? CAPTURE_THE_BEER_ARENA_WIDTH : FULL_ARENA_WIDTH;
  const sourceWidth = Math.min(textureWidth, Math.max(1, Math.floor(arenaWidth)));

  return {
    textureKey: useExpandedTexture ? 'gras_bg_ctb' : 'gras_bg_dm',
    sourceX: Math.floor((textureWidth - sourceWidth) * 0.5),
    sourceY: 0,
    sourceWidth,
    // The supplied terrain sheets are 1056 px high. Keep that native slice so high
    // arenas repeat the source vertically instead of stretching it.
    sourceHeight: DEFAULT_ARENA_HEIGHT,
  };
}
