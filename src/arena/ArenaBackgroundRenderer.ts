import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { ARENA_BACKGROUND_TEXTURE_KEY, ARENA_BACKGROUND_DETAIL_TEXTURE_KEY, ARENA_BACKGROUND_DETAIL_ALPHA } from './ArenaBackground';

/** The same grass composition for every World, including the small base editor World. */
export function createArenaBackground(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
  return {
    ground: scene.add.tileSprite(x, y, width, height, ARENA_BACKGROUND_TEXTURE_KEY).setDepth(DEPTH.GRASS),
    detail: scene.add.tileSprite(x, y, width, height, ARENA_BACKGROUND_DETAIL_TEXTURE_KEY)
      .setDepth(DEPTH.GRASS + 0.01).setAlpha(ARENA_BACKGROUND_DETAIL_ALPHA).setBlendMode(Phaser.BlendModes.MULTIPLY),
  };
}
