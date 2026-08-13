import * as Phaser from 'phaser';

/**
 * Shared walking-animation contract for every badger-shaped figure.
 *
 * A walking sheet is one row of north-facing 64x64 cells – the same orientation and cell size
 * as the static single-frame textures it replaces. `WALKING_SHEETS` below is the only place a
 * new animated figure is registered; preload, animation registration and the per-sprite sync
 * all derive from it.
 *
 * The sheet resolution never decides how big a figure is drawn. Display size stays the
 * entity's decision (`PLAYER_SIZE`, `ResolvedCoopDefenseEnemyConfig.size`), see
 * docs/ai/rendering.md.
 */
export interface WalkingSheet {
  /** Texture key of the loaded spritesheet. */
  readonly textureKey: string;
  /** Global animation key; the AnimationManager is shared by all scenes. */
  readonly animationKey: string;
  readonly assetPath: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly frameRate: number;
  /**
   * Key of the static single-frame texture this sheet supersedes. Authored content that only
   * knows its image key – enemy configs – resolves its animated variant through this field.
   */
  readonly staticTextureKey?: string;
}

/** Erster Frame ist zugleich die Idle-Pose; ein Stopp faellt nie mitten in den Schritt. */
export const WALKING_IDLE_FRAME = 0;

export const BADGER_WALKING_SHEET: WalkingSheet = {
  textureKey: 'badger_walking',
  animationKey: 'badger_walk',
  assetPath: './assets/sprites/32x32dachs-walking_Sheet.png',
  frameWidth: 64,
  frameHeight: 64,
  frameCount: 9,
  frameRate: 12,
  staticTextureKey: 'badger',
};

export const ZOMBIE_BADGER_WALKING_SHEET: WalkingSheet = {
  textureKey: 'enemy_zombie_badger_walking',
  animationKey: 'enemy_zombie_badger_walk',
  assetPath: './assets/sprites/enemies/enemy_zombie_badger-Walking_Sheet.png',
  frameWidth: 64,
  frameHeight: 64,
  frameCount: 9,
  // Der Zombie-Dachs ist die langsamste Gegnerart; sein Schritt laeuft entsprechend zaeher.
  frameRate: 9,
  staticTextureKey: 'enemy_zombie_badger',
};

const WALKING_SHEETS: readonly WalkingSheet[] = [
  BADGER_WALKING_SHEET,
  ZOMBIE_BADGER_WALKING_SHEET,
];

// Kompatible Einzelwerte fuer die Spielerfigur; sie hat als einzige eine feste Grundskalierung.
export const BADGER_WALKING_TEXTURE_KEY = BADGER_WALKING_SHEET.textureKey;
export const BADGER_WALKING_ANIMATION_KEY = BADGER_WALKING_SHEET.animationKey;
export const BADGER_WALKING_FRAME_WIDTH = BADGER_WALKING_SHEET.frameWidth;
export const BADGER_WALKING_FRAME_HEIGHT = BADGER_WALKING_SHEET.frameHeight;
export const BADGER_IDLE_FRAME = WALKING_IDLE_FRAME;

/** Walking-Sheet zur aktuell gesetzten Textur, oder `null` fuer eine statische Figur. */
export function getWalkingSheetByTexture(textureKey: string): WalkingSheet | null {
  return WALKING_SHEETS.find((sheet) => sheet.textureKey === textureKey) ?? null;
}

/** Walking-Sheet, das die genannte statische Textur ersetzt, oder `null`. */
export function getWalkingSheetForStaticTexture(staticTextureKey: string): WalkingSheet | null {
  return WALKING_SHEETS.find((sheet) => sheet.staticTextureKey === staticTextureKey) ?? null;
}

/** Queue every registered walking spritesheet before an animated figure is created. */
export function preloadBadgerAnimationAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const sheet of WALKING_SHEETS) {
    loader.spritesheet(sheet.textureKey, sheet.assetPath, {
      frameWidth: sheet.frameWidth,
      frameHeight: sheet.frameHeight,
    });
  }
}

/** Register the global animations once; AnimationManager is shared by all Scenes. */
export function registerBadgerAnimations(anims: Phaser.Animations.AnimationManager): void {
  for (const sheet of WALKING_SHEETS) {
    if (anims.exists(sheet.animationKey)) continue;

    anims.create({
      key: sheet.animationKey,
      frames: anims.generateFrameNumbers(sheet.textureKey, {
        start: WALKING_IDLE_FRAME,
        end: sheet.frameCount - 1,
      }),
      frameRate: sheet.frameRate,
      repeat: -1,
    });
  }
}

/**
 * Apply the requested locomotion state to one figure sprite.
 *
 * The sheet is resolved from the sprite's own texture, so the helper covers players and
 * animated enemies alike and is a no-op for a figure without walking artwork. Idle
 * deliberately returns to frame 0, so stopping never leaves a half-step pose on screen. The
 * helper is idempotent and therefore safe to call from host and client sync.
 */
export function syncBadgerWalkingAnimation(
  sprite: Phaser.GameObjects.Sprite,
  walking: boolean,
): void {
  const sheet = getWalkingSheetByTexture(sprite.texture.key);
  if (!sheet) return;

  const isWalkingAnimation = sprite.anims.currentAnim?.key === sheet.animationKey;

  if (walking) {
    if (!isWalkingAnimation || !sprite.anims.isPlaying) {
      sprite.play(sheet.animationKey);
      // Ein Pulk gleichzeitig gestarteter Figuren liefe sonst im Gleichschritt. Die Phase ist
      // rein visuell und muss zwischen Host und Clients nicht uebereinstimmen.
      sprite.anims.setProgress(Math.random());
    }
    return;
  }

  if (isWalkingAnimation && sprite.anims.isPlaying) {
    sprite.anims.stop();
  }
  if (sprite.frame.name !== String(WALKING_IDLE_FRAME)) {
    sprite.setFrame(WALKING_IDLE_FRAME);
  }
}
