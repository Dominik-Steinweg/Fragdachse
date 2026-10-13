import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getTurretVisualSpec, getTurretVisualTransform, TURRET_VISUALS } from '../../config/turretVisuals';
import type { FireControlPlacementPreview, TurretWeaponId } from '../../types';
import { FireControlHologramFilter } from './FireControlHologramFilter';
import { createFireControlPortalGpuLayer, type FireControlPortalGpuLayer } from './FireControlPortalGpuLayer';
import { FireControlGpuKind as Kind, FireControlPortalGpuStore } from './FireControlPortalGpuStore';
import {
  FIRE_CONTROL_RELAY, FIRE_CONTROL_RELAY_SIZE, ensureFireControlRelayAssets, fireControlRelayFrame,
} from './FireControlRelayAssets';

const HOLOGRAM_COLOR = 0x3dffd0;
/** Ghosts are a promise, not a projection yet: clearly lighter than a deployed copy. */
const GHOST_ALPHA = 0.6;
const PROJECTOR_GHOST_ALPHA = 0.55;
/** Ghosts build up once when the preview opens, like a short version of the real materialize. */
const GHOST_MATERIALIZE_MS = 260;
/** The projector ghost shows its deployed pose, not the deploy clip. */
const PROJECTOR_DEPLOYED_AGE_MS = 10_000;
const MAX_GHOSTS = 8;

interface GhostVisual {
  sprite: Phaser.GameObjects.Sprite;
  filter: FireControlHologramFilter;
  weaponId: TurretWeaponId;
}

/**
 * Local placement preview of the Turmkopien utility: projector ghost at the cursor, hologram
 * ghosts in the planned formation, faint projection beams between them, and a transfer ring on
 * every original that would be copied. Reads {@link FireControlPlacementPreview} only; owns no
 * gameplay decision. Invalid placements switch the ghosts to the shared placement-error red and
 * hide beams and original highlights, so red stays reserved for "this click will be rejected".
 */
export class FireControlPlacementPreviewVisual {
  private readonly store = new FireControlPortalGpuStore();
  private readonly layer: FireControlPortalGpuLayer | null;
  private readonly ghosts: GhostVisual[] = [];
  private projector: Phaser.GameObjects.Sprite | null = null;
  private shownAt: number | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = createFireControlPortalGpuLayer(scene, this.store);
    // Placement previews live in the overlay band (above the lightmap), like every other preview.
    this.layer?.image.setDepth(DEPTH.OVERLAY - 1.02);
    ensureFireControlRelayAssets(scene);
  }

  update(preview: FireControlPlacementPreview, now: number, invalidColor: number): void {
    if (this.destroyed) return;
    this.shownAt ??= now;
    const materialize = Math.min(1, (now - this.shownAt) / GHOST_MATERIALIZE_MS);
    const color = preview.valid ? HOLOGRAM_COLOR : invalidColor;
    const facing = Math.atan2(preview.pointY - preview.playerY, preview.pointX - preview.playerX);
    this.store.begin(now);

    this.updateProjector(preview, color);
    let shown = 0;
    for (const ghost of preview.ghosts) {
      if (shown >= MAX_GHOSTS || !(ghost.weaponId in TURRET_VISUALS)) continue;
      const visual = this.ghostAt(shown++, ghost.weaponId as TurretWeaponId);
      const transform = getTurretVisualTransform(getTurretVisualSpec(visual.weaponId), ghost.x, ghost.y, facing);
      visual.sprite.setPosition(transform.x, transform.y).setRotation(transform.rotation)
        .setAlpha(GHOST_ALPHA).setVisible(true);
      Object.assign(visual.filter.uniforms, {
        color, time: this.store.time, materialize, vanish: 0, warning: 0, preset: 'A' as const,
      });
      if (!preview.valid) continue;
      const length = Math.hypot(ghost.x - preview.pointX, ghost.y - preview.pointY);
      if (length > 4) this.store.add({ x: preview.pointX, y: preview.pointY, radius: length, length,
        angle: Math.atan2(ghost.y - preview.pointY, ghost.x - preview.pointX), kind: Kind.Filament,
        open: .55 * materialize, remaining: 1, flash: 0, seed: shown * 17 });
    }
    for (let i = shown; i < this.ghosts.length; i++) this.ghosts[i].sprite.setVisible(false);

    if (!preview.valid) return;
    this.store.add({ x: preview.pointX, y: preview.pointY, radius: 12, angle: 0, kind: Kind.Projector,
      open: materialize, remaining: 1, flash: 0 });
    // The same transfer ring that marks a paused original during the projection: "this one goes".
    for (const original of preview.originals) {
      this.store.add({ x: original.x, y: original.y, radius: 20, angle: 0, kind: Kind.TransferRing,
        open: 1, remaining: 1, flash: 0 });
    }
  }

  hide(): void {
    if (this.destroyed) return;
    this.shownAt = null;
    this.store.clear();
    this.projector?.setVisible(false);
    for (const ghost of this.ghosts) ghost.sprite.setVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const ghost of this.ghosts) { ghost.filter.destroy(); ghost.sprite.destroy(); }
    this.ghosts.length = 0;
    this.projector?.destroy();
    this.projector = null;
    this.store.clear();
    this.layer?.destroy();
  }

  private updateProjector(preview: FireControlPlacementPreview, color: number): void {
    if (!this.projector && this.scene.textures.exists(FIRE_CONTROL_RELAY.sheetTextureKey)) {
      this.projector = this.scene.add.sprite(0, 0, FIRE_CONTROL_RELAY.sheetTextureKey)
        .setOrigin(...FIRE_CONTROL_RELAY.pivot).setDisplaySize(FIRE_CONTROL_RELAY_SIZE, FIRE_CONTROL_RELAY_SIZE)
        .setDepth(DEPTH.OVERLAY - 1.01);
      this.projector.name = 'fire-control-preview-projector';
    }
    if (!this.projector) return;
    this.projector.setPosition(preview.pointX, preview.pointY)
      .setFrame(fireControlRelayFrame(PROJECTOR_DEPLOYED_AGE_MS))
      .setAlpha(PROJECTOR_GHOST_ALPHA).setVisible(true);
    if (preview.valid) this.projector.clearTint();
    else this.projector.setTint(color);
  }

  private ghostAt(index: number, weaponId: TurretWeaponId): GhostVisual {
    const existing = this.ghosts[index];
    if (existing && existing.weaponId === weaponId) return existing;
    if (existing) { existing.filter.destroy(); existing.sprite.destroy(); }
    const spec = getTurretVisualSpec(weaponId);
    const sprite = this.scene.add.sprite(0, 0, spec.asset.sheetTextureKey, spec.asset.idleFrame)
      .setDisplaySize(spec.displaySize, spec.displaySize).setDepth(DEPTH.OVERLAY - 1);
    sprite.name = `fire-control-preview-ghost:${index}`;
    const visual = { sprite, filter: new FireControlHologramFilter(sprite, 'A'), weaponId };
    this.ghosts[index] = visual;
    return visual;
  }
}
