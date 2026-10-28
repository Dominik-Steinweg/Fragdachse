import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { getPipelineAsset } from '../config/pipelineAssets';
import { getTurretVisualSpec, getTurretVisualTransform } from '../config/turretVisuals';
import { fillRadialGradientTexture } from '../effects/EffectUtils';
import type { TurretAnimationController } from '../effects/TurretAnimationController';
import type { TurretWeaponId } from '../types';

export interface WorldTurretVisual {
  image: Phaser.GameObjects.Sprite;
  aura: Phaser.GameObjects.Image;
  /** The stone plinth of a turret built on open ground; created on first need. */
  foundation?: Phaser.GameObjects.Image | null;
}

/**
 * A turret built on open ground stands on its wall block, capped by the same stone plinth the fort lays
 * under a turret on its decks (pipeline asset turret-plinth); the block's ground shadow is the static
 * `turret` caster.
 */
const FOUNDATION = { asset: getPipelineAsset('turret-plinth'), sidePx: 26 };

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

/** Shows the stone plinth under a turret standing on open ground; a turret on a base deck has the fort's own. */
export function syncWorldTurretFoundation(visual: WorldTurretVisual, x: number, y: number, onGround: boolean): void {
  const scene = visual.image.scene;
  if (onGround && !visual.foundation && scene?.textures.exists(FOUNDATION.asset.textureKey)) {
    visual.foundation = scene.add.image(x, y, FOUNDATION.asset.textureKey)
      // Above the block and rock moss, below the turret's mounted shadow (ROCKS + 0.09).
      .setDisplaySize(FOUNDATION.sidePx, FOUNDATION.sidePx).setDepth(DEPTH.ROCKS + 0.087);
  }
  visual.foundation?.setPosition(x, y).setVisible(onGround && visual.image.visible);
}

export function destroyWorldTurretVisual(visual: WorldTurretVisual): void {
  visual.image.destroy();
  visual.aura.destroy();
  visual.foundation?.destroy();
  visual.foundation = null;
}
