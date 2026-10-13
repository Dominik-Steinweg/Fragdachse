import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getPipelineAsset } from '../../config/pipelineAssets';
import type { ProjectileCustomVisual, ProjectileCustomVisualFactory } from '../../projectile/ProjectileVisualOverrides';

export const FIRE_CONTROL_PORTAL_FLIGHT = getPipelineAsset('fire-control-portal-flight');
/** Catalog target size; the HQ source is drawn at half its pixel size like the other fire-control images. */
export const FIRE_CONTROL_PORTAL_FLIGHT_SIZE = 34;
const PORTAL_UTILITY_ID = 'FIRE_CONTROL_PORTAL';

function ensureFlightTexture(scene: Phaser.Scene): boolean {
  const asset = FIRE_CONTROL_PORTAL_FLIGHT;
  if (scene.textures.exists(asset.sheetTextureKey)) return true;
  scene.load.spritesheet(asset.sheetTextureKey, asset.sheetPath, { ...asset.layout, endFrame: asset.layout.frameCount - 1 });
  if (!scene.load.isLoading()) scene.load.start();
  return false;
}

/** Thrown portal device: faces its flight direction (forward = north) and keeps it once at rest. */
class FireControlPortalFlightView implements ProjectileCustomVisual {
  private readonly sprite: Phaser.GameObjects.Image;
  private rotation: number | null = null;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.add.image(x, y, FIRE_CONTROL_PORTAL_FLIGHT.sheetTextureKey, FIRE_CONTROL_PORTAL_FLIGHT.idleFrame)
      .setOrigin(...FIRE_CONTROL_PORTAL_FLIGHT.pivot)
      .setDisplaySize(FIRE_CONTROL_PORTAL_FLIGHT_SIZE, FIRE_CONTROL_PORTAL_FLIGHT_SIZE)
      .setDepth(DEPTH.PROJECTILES);
  }
  update(x: number, y: number, _size: number, vx: number, vy: number): void {
    if (Math.hypot(vx, vy) > 1) this.rotation = Math.atan2(vy, vx) + Math.PI / 2;
    this.sprite.setPosition(x, y).setRotation(this.rotation ?? 0);
  }
  destroy(): void { this.sprite.destroy(); }
}

/**
 * Claims portal throws by their replicated utility source on host and client. Until the texture
 * is loaded the generic grenade renderer keeps drawing them.
 */
export function createFireControlPortalFlightFactory(scene: Phaser.Scene): ProjectileCustomVisualFactory {
  ensureFlightTexture(scene);
  return projectile => projectile.weaponSourceId === PORTAL_UTILITY_ID
    && scene.textures.exists(FIRE_CONTROL_PORTAL_FLIGHT.sheetTextureKey)
    ? new FireControlPortalFlightView(scene, projectile.x, projectile.y) : null;
}
