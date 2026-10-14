import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { BULLET_GLOW_TEXTURE } from '../BulletRenderer';
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

/** Turquoise lens glow (P1); emissive above the lightmap so the device stays readable at night. */
const LENS_GLOW_COLOR = 0x3dffd0;
const LENS_GLOW_SIZE = 22;

/** Thrown portal device: faces its flight direction (forward = north) and keeps it once at rest. */
class FireControlPortalFlightView implements ProjectileCustomVisual {
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Image | null;
  private rotation: number | null = null;
  constructor(private readonly scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.add.image(x, y, FIRE_CONTROL_PORTAL_FLIGHT.sheetTextureKey, FIRE_CONTROL_PORTAL_FLIGHT.idleFrame)
      .setOrigin(...FIRE_CONTROL_PORTAL_FLIGHT.pivot)
      .setDisplaySize(FIRE_CONTROL_PORTAL_FLIGHT_SIZE, FIRE_CONTROL_PORTAL_FLIGHT_SIZE)
      .setDepth(DEPTH.PROJECTILES);
    // The body sits under the lightmap like every projectile; only its small lens glow is
    // emissive (above the lightmap, below the canopy), so the throw reads in the dark.
    this.glow = scene.textures.exists(BULLET_GLOW_TEXTURE)
      ? scene.add.image(x, y, BULLET_GLOW_TEXTURE).setDisplaySize(LENS_GLOW_SIZE, LENS_GLOW_SIZE)
        .setTint(LENS_GLOW_COLOR).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.CANOPY - 0.3)
      : null;
  }
  update(x: number, y: number, _size: number, vx: number, vy: number): void {
    if (Math.hypot(vx, vy) > 1) this.rotation = Math.atan2(vy, vx) + Math.PI / 2;
    this.sprite.setPosition(x, y).setRotation(this.rotation ?? 0);
    this.glow?.setPosition(x, y).setAlpha(.55 + .15 * Math.sin(this.scene.time.now / 90));
  }
  destroy(): void { this.sprite.destroy(); this.glow?.destroy(); }
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
