import * as Phaser from 'phaser';

/**
 * Shared badger animation contract.
 *
 * The artwork is authored at 64x64 per sheet cell, while the visible badger remains
 * scaled to the game's 32px player size. Keeping the texture, frame layout and animation
 * key here lets every future badger presentation use the same Phaser animation definition.
 */
export const BADGER_WALKING_TEXTURE_KEY = 'badger_walking';
export const BADGER_WALKING_ANIMATION_KEY = 'badger_walk';
export const BADGER_WALKING_FRAME_WIDTH = 64;
export const BADGER_WALKING_FRAME_HEIGHT = 64;
export const BADGER_WALKING_FRAME_COUNT = 9;
export const BADGER_WALKING_FRAME_RATE = 12;
export const BADGER_IDLE_FRAME = 0;

const BADGER_WALKING_ASSET_PATH = './assets/sprites/32x32dachs-walking_Sheet.png';

/** Queue the shared badger spritesheet before any animated badger is created. */
export function preloadBadgerAnimationAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.spritesheet(BADGER_WALKING_TEXTURE_KEY, BADGER_WALKING_ASSET_PATH, {
    frameWidth: BADGER_WALKING_FRAME_WIDTH,
    frameHeight: BADGER_WALKING_FRAME_HEIGHT,
  });
}

/** Register the global animation once; AnimationManager is shared by all Scenes. */
export function registerBadgerAnimations(anims: Phaser.Animations.AnimationManager): void {
  if (anims.exists(BADGER_WALKING_ANIMATION_KEY)) return;

  anims.create({
    key: BADGER_WALKING_ANIMATION_KEY,
    frames: anims.generateFrameNumbers(BADGER_WALKING_TEXTURE_KEY, {
      start: BADGER_IDLE_FRAME,
      end: BADGER_WALKING_FRAME_COUNT - 1,
    }),
    frameRate: BADGER_WALKING_FRAME_RATE,
    repeat: -1,
  });
}

/**
 * Apply the requested locomotion state to one badger sprite.
 *
 * Idle deliberately returns to frame 0, so stopping never leaves a half-step pose on
 * screen. The helper is idempotent and therefore safe to call from host and client sync.
 */
export function syncBadgerWalkingAnimation(
  sprite: Phaser.GameObjects.Sprite,
  walking: boolean,
): void {
  const isWalkingAnimation = sprite.anims.currentAnim?.key === BADGER_WALKING_ANIMATION_KEY;

  if (walking) {
    if (!isWalkingAnimation || !sprite.anims.isPlaying) {
      sprite.play(BADGER_WALKING_ANIMATION_KEY);
    }
    return;
  }

  if (isWalkingAnimation && sprite.anims.isPlaying) {
    sprite.anims.stop();
  }
  if (sprite.texture.key === BADGER_WALKING_TEXTURE_KEY && sprite.frame.name !== String(BADGER_IDLE_FRAME)) {
    sprite.setFrame(BADGER_IDLE_FRAME);
  }
}
