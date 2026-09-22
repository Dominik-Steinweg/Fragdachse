import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { getTurretVisualSpec, getTurretVisualTransform } from '../config/turretVisuals';
import { fillRadialGradientTexture } from '../effects/EffectUtils';
import type { TurretAnimationController } from '../effects/TurretAnimationController';
import type { TurretWeaponId } from '../types';

export interface WorldTurretVisual { image: Phaser.GameObjects.Sprite; aura: Phaser.GameObjects.Image }

/** Shared world visual, including aura, asset pivot and animation pose. */
export function createWorldTurretVisual(scene: Phaser.Scene, weaponId: TurretWeaponId, x: number, y: number, color: number): WorldTurretVisual {
  const key = '__placeable_turret_aura';
  fillRadialGradientTexture(scene.textures, key, 64, [[0, 'rgba(255,255,255,0.34)'], [0.46, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']]);
  const spec = getTurretVisualSpec(weaponId);
  return {
    aura: scene.add.image(x, y, key).setDisplaySize(CELL_SIZE + 24, CELL_SIZE + 24)
      .setTint(color).setAlpha(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ROCKS + 0.1),
    image: scene.add.sprite(x, y, spec.textureKey).setDisplaySize(spec.displaySize, spec.displaySize).setDepth(DEPTH.ROCKS + 0.2),
  };
}

export function syncWorldTurretVisualPose(visual: WorldTurretVisual, id: string, weaponId: TurretWeaponId,
  x: number, y: number, angle: number, color: number, animations: TurretAnimationController | null, interpolate = false): void {
  const spec = getTurretVisualSpec(weaponId);
  animations?.bind(id, visual.image, weaponId);
  if (!animations) visual.image.setTexture(spec.textureKey);
  visual.image.setDisplaySize(spec.displaySize, spec.displaySize);
  if (animations) animations.syncPose(id, x, y, angle, interpolate);
  else {
    const pose = getTurretVisualTransform(spec, x, y, angle);
    visual.image.setPosition(pose.x, pose.y).setRotation(pose.rotation);
  }
  visual.aura.setPosition(x, y).setTint(color).setVisible(visual.image.visible);
}
