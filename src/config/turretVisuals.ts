import { getPipelineAsset, pipelineAnimationKey, type PipelineAsset } from './pipelineAssets';
import type * as Phaser from 'phaser';
import type { TurretWeaponId } from '../types';

export interface TurretVisualSpec {
  readonly textureKey: string;
  readonly asset: PipelineAsset;
  readonly assetPath: string | null;
  readonly displaySize: number;
  /** Source sprites point east, matching Phaser's zero-radian aim direction. */
  readonly rotationOffset: number;
  /** Pixel correction that moves the visible artwork onto the logical turret center. */
  readonly centerCorrectionX: number;
  readonly centerCorrectionY: number;
}

export interface TurretVisualTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

function selected(id: string): TurretVisualSpec {
  const asset = getPipelineAsset(id);
  return Object.freeze({
    textureKey: asset.textureKey,
    asset,
    assetPath: asset.idlePath,
    displaySize: id === 'spore' ? 32 : 40,
    rotationOffset: 0,
    centerCorrectionX: 0,
    centerCorrectionY: 0,
  });
}
const SPORE_VISUAL = selected('spore');
const ROCKET_VISUAL = selected('rocket');
const MACHINE_GUN_VISUAL = selected('machine-gun');
const FLAME_VISUAL = selected('flame');
const VOID_FLAME_VISUAL = selected('void-flame');
const TESLA_VISUAL = selected('tesla');
const GRAVITY_VISUAL = selected('gravity');
const SLOW_BUBBLE_VISUAL = selected('slow-bubble');
const PLASMA_VISUAL = selected('plasma');

export const TURRET_VISUALS: Readonly<Record<TurretWeaponId, TurretVisualSpec>> = Object.freeze({
  SPORES: SPORE_VISUAL,
  BASE_SPORES: SPORE_VISUAL,
  TURRET_SPORES: SPORE_VISUAL,
  SPORE_TURRET_PLASMA: PLASMA_VISUAL,
  TURRET_ROCKET_BURST: ROCKET_VISUAL,
  TURRET_MG: MACHINE_GUN_VISUAL,
  TURRET_FLAME: FLAME_VISUAL,
  TURRET_VOID_FLAME: VOID_FLAME_VISUAL,
  TURRET_TESLA: TESLA_VISUAL,
  TURRET_GRAVITY: GRAVITY_VISUAL,
  TURRET_SLOW_BUBBLE: SLOW_BUBBLE_VISUAL,
});

export function getTurretVisualSpec(weaponId: TurretWeaponId): TurretVisualSpec {
  return TURRET_VISUALS[weaponId];
}

/** Resolves a transform that keeps visible turret artwork on its logical point. */
export function getTurretVisualTransform(
  spec: TurretVisualSpec,
  x: number,
  y: number,
  angle: number,
): TurretVisualTransform {
  const rotation = angle + spec.rotationOffset;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: x + cos * spec.centerCorrectionX - sin * spec.centerCorrectionY,
    y: y + sin * spec.centerCorrectionX + cos * spec.centerCorrectionY,
    rotation,
  };
}

export function preloadTurretVisualAssets(loader: Phaser.Loader.LoaderPlugin): void {
  const loaded = new Set<string>();
  for (const spec of Object.values(TURRET_VISUALS)) {
    if (!spec.assetPath || loaded.has(spec.textureKey)) continue;
    loaded.add(spec.textureKey);
    loader.image(spec.textureKey, spec.assetPath);
    const { asset } = spec;
    loader.spritesheet(asset.sheetTextureKey, asset.sheetPath, {
      frameWidth: asset.layout.frameWidth,
      frameHeight: asset.layout.frameHeight,
      margin: asset.layout.margin,
      spacing: asset.layout.spacing,
      endFrame: asset.layout.frameCount - 1,
    });
  }
}

export function registerTurretAnimations(anims: Phaser.Animations.AnimationManager): void {
  for (const spec of new Set(Object.values(TURRET_VISUALS))) {
    for (const clip of spec.asset.clips) {
      const key = pipelineAnimationKey(spec.asset, clip);
      if (anims.exists(key)) continue;
      anims.create({ key,
        frames: anims.generateFrameNumbers(spec.asset.sheetTextureKey, { frames: clip.frames }),
        frameRate: clip.frameRate, repeat: clip.loop ? -1 : 0,
      });
    }
  }
}
