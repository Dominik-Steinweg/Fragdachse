import type { GameMode } from '../types';
import { GRASS_MATERIAL_KEY } from './GroundMaterialConfig';

/** Native colour and blade structure are carried by one seamless material. */
export const ARENA_BACKGROUND_TEXTURE_KEY = GRASS_MATERIAL_KEY;
export type ArenaBackgroundTextureKey = typeof ARENA_BACKGROUND_TEXTURE_KEY;
export interface ArenaBackgroundSpec { readonly textureKey: ArenaBackgroundTextureKey; }
export function resolveArenaBackgroundSpec(_mode: GameMode, _arenaWidth: number): ArenaBackgroundSpec {
  return { textureKey: ARENA_BACKGROUND_TEXTURE_KEY };
}
