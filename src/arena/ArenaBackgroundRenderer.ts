import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { ARENA_BACKGROUND_TEXTURE_KEY } from './ArenaBackground';
import { GROUND_MACRO_KEY, GROUND_MACRO_TILE_SCALE } from './GroundMaterialConfig';

export interface ArenaBackgroundObjects {
  readonly ground: Phaser.GameObjects.TileSprite;
  readonly macro: Phaser.GameObjects.TileSprite;
}

/** Shared by Worlds, editor and labs. Grass at one world pixel per texel, below the soil
 * chunks; the macro map multiplies grass, soil and tufts alike, so they share one light. */
export function createArenaBackground(scene: Phaser.Scene, x: number, y: number, width: number, height: number): ArenaBackgroundObjects {
  return {
    ground: scene.add.tileSprite(x, y, width, height, ARENA_BACKGROUND_TEXTURE_KEY).setDepth(DEPTH.GRASS),
    macro: scene.add.tileSprite(x, y, width, height, GROUND_MACRO_KEY).setDepth(DEPTH.GROUND_MACRO)
      .setTileScale(GROUND_MACRO_TILE_SCALE).setBlendMode(Phaser.BlendModes.MULTIPLY),
  };
}
