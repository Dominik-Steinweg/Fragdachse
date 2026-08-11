import type * as Phaser from 'phaser';
import type { TurretWeaponId } from '../types';

export interface TurretVisualSpec {
  readonly textureKey: string;
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

const SPORE_VISUAL: TurretVisualSpec = Object.freeze({
  textureKey: 'pilz01',
  // Loaded by the shared arena-decal preloader from the existing hand-authored PNG.
  assetPath: null,
  displaySize: 32,
  rotationOffset: 0,
  // pilz01.png is a 16x16 ground decal whose visible pixels occupy x=1..7,
  // y=8..14. At 32px display size the image pivot therefore needs +7/-7px.
  centerCorrectionX: 7,
  centerCorrectionY: -7,
});

function generated(textureKey: string, fileName: string): TurretVisualSpec {
  return Object.freeze({
    textureKey,
    assetPath: `./assets/sprites/turrets/${fileName}`,
    displaySize: 40,
    rotationOffset: 0,
    centerCorrectionX: 0,
    centerCorrectionY: 0,
  });
}

const ROCKET_VISUAL = generated('turret_weapon_rocket', 'rocket.png');
const MACHINE_GUN_VISUAL = generated('turret_weapon_machine_gun', 'machine_gun.png');
const FLAME_VISUAL = generated('turret_weapon_flame', 'flame.png');
const VOID_FLAME_VISUAL = generated('turret_weapon_void_flame', 'void_flame.png');
const TESLA_VISUAL = generated('turret_weapon_tesla', 'tesla.png');
const GRAVITY_VISUAL = generated('turret_weapon_gravity', 'gravity.png');
const SLOW_BUBBLE_VISUAL = generated('turret_weapon_slow_bubble', 'slow_bubble.png');
const PLASMA_VISUAL = generated('turret_weapon_plasma', 'plasma.png');

export const TURRET_VISUALS: Readonly<Record<TurretWeaponId, TurretVisualSpec>> = Object.freeze({
  SPOREN: SPORE_VISUAL,
  BASE_SPOREN: SPORE_VISUAL,
  TURRET_SPORE: SPORE_VISUAL,
  FLIEGENPILZ_PLASMA: PLASMA_VISUAL,
  TURRET_ROCKET: ROCKET_VISUAL,
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
  }
}
