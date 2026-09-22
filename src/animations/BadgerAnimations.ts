import * as Phaser from 'phaser';
import { PIPELINE_ASSETS, pipelineAnimationKey } from '../config/pipelineAssets';

/**
 * Shared walking-animation contract for every badger-shaped figure.
 *
 * Walking sheets contain north-facing cells with explicit gutters and clip frame lists.
 * A separate rest frame is excluded from the move loop; an authored idle clip is optional.
 * `WALKING_SHEETS` below is the only place a
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
  readonly frames: readonly number[];
  readonly margin: number;
  readonly spacing: number;
  readonly frameRate: number;
  readonly idle?: {
    readonly animationKey: string;
    readonly frames: readonly number[];
    readonly frameRate: number;
  };
  /**
   * Key of the static single-frame texture this sheet supersedes. Authored content that only
   * knows its image key – enemy configs – resolves its animated variant through this field.
   */
  readonly staticTextureKey?: string;
}

/** Frame 0 ist die neutrale Ruhepose für inaktive Figuren und Sheets ohne Idle-Clip. */
export const WALKING_IDLE_FRAME = 0;

const WALKING_SHEETS: readonly WalkingSheet[] = PIPELINE_ASSETS
  .filter((asset) => asset.category === 'character' || asset.category === 'enemy')
  .map((asset) => {
    const clip = asset.clips.find((candidate) => candidate.name === 'move')!;
    const idle = asset.clips.find((candidate) => candidate.name === 'idle');
    return {
      textureKey: asset.sheetTextureKey,
      animationKey: pipelineAnimationKey(asset, clip),
      assetPath: asset.sheetPath,
      frameWidth: asset.layout.frameWidth,
      frameHeight: asset.layout.frameHeight,
      margin: asset.layout.margin,
      spacing: asset.layout.spacing,
      frameCount: asset.layout.frameCount,
      frames: clip.frames,
      frameRate: clip.frameRate,
      idle: idle ? { animationKey: pipelineAnimationKey(asset, idle), frames: idle.frames, frameRate: idle.frameRate } : undefined,
      staticTextureKey: asset.textureKey,
    };
  });

export const BADGER_WALKING_SHEET = WALKING_SHEETS.find((sheet) => sheet.staticTextureKey === 'badger')!;
export const ZOMBIE_BADGER_WALKING_SHEET = WALKING_SHEETS.find((sheet) => sheet.staticTextureKey === 'enemy_zombie_badger')!;

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
      margin: sheet.margin,
      spacing: sheet.spacing,
      endFrame: sheet.frameCount - 1,
    });
  }
}

/** Register the global animations once; AnimationManager is shared by all Scenes. */
export function registerBadgerAnimations(anims: Phaser.Animations.AnimationManager): void {
  for (const sheet of WALKING_SHEETS) {
    for (const clip of sheet.idle ? [sheet, sheet.idle] : [sheet]) {
      if (anims.exists(clip.animationKey)) continue;
      anims.create({
        key: clip.animationKey,
        frames: anims.generateFrameNumbers(sheet.textureKey, { frames: [...clip.frames] }),
        frameRate: clip.frameRate,
        repeat: -1,
      });
    }
  }
}

/**
 * Apply the requested locomotion state to one figure sprite.
 *
 * The sheet is resolved from the sprite's own texture, so the helper covers players and
 * animated enemies alike and is a no-op for a figure without walking artwork. Standing figures
 * use their authored idle clip when present, otherwise frame 0. Inactive figures hold frame 0. The
 * helper is idempotent and therefore safe to call from host and client sync.
 */
export function syncBadgerWalkingAnimation(
  sprite: Phaser.GameObjects.Sprite,
  walking: boolean,
  active: boolean = true,
): void {
  const sheet = getWalkingSheetByTexture(sprite.texture.key);
  if (!sheet) return;

  const currentKey = sprite.anims.currentAnim?.key;
  const desiredKey = active ? (walking ? sheet.animationKey : sheet.idle?.animationKey) : undefined;

  if (desiredKey) {
    if (currentKey !== desiredKey || !sprite.anims.isPlaying) {
      sprite.play(desiredKey);
      // Ein Pulk gleichzeitig gestarteter Figuren liefe sonst im Gleichschritt. Die Phase ist
      // rein visuell und muss zwischen Host und Clients nicht uebereinstimmen.
      if (walking) sprite.anims.setProgress(Math.random());
    }
    return;
  }

  if ((currentKey === sheet.animationKey || currentKey === sheet.idle?.animationKey) && sprite.anims.isPlaying) {
    sprite.anims.stop();
  }
  if (sprite.frame.name !== String(WALKING_IDLE_FRAME)) {
    sprite.setFrame(WALKING_IDLE_FRAME);
  }
}
