import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { dawnDecalTextureKey } from '../assets/DawnAssets';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { DawnWorldPlan } from '../dawn/contracts/DawnPlans';
import { resolveCoopDefenseWorldMetrics } from '../world/WorldMetrics';
import { resolveDawnSiteDecals } from './DawnSitePropModel';

const DAWN_SITE_DECAL_ALPHA = 0.8;

/**
 * Static ground history under the Dawn site props (Art Direction V1). World-owned and laid once from the
 * replicated plan; it stays when a structure falls (scorch remains). Missing art is skipped silently.
 */
export class DawnSiteDecalRenderer {
  private readonly decals: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, plan: DawnWorldPlan, world: WorldDefinition) {
    const metrics = resolveCoopDefenseWorldMetrics(world.metrics.widthCells, world.metrics.heightCells);
    const center = (gridX: number, gridY: number) =>
      ({ x: metrics.offsetX + (gridX + .5) * CELL_SIZE, y: metrics.offsetY + (gridY + .5) * CELL_SIZE });
    const anchor = world.persistentBaseSite?.anchor;
    const base = anchor ? center(anchor.gridX, anchor.gridY) : null;
    for (const site of plan.sites) {
      const clearing = world.terrain.siteClearings?.find(entry => entry.id === site.slotId);
      if (!clearing) continue;
      const at = center(clearing.gridX, clearing.gridY);
      const towardBase = base ? Math.atan2(base.y - at.y, base.x - at.x) : 0;
      for (const decal of resolveDawnSiteDecals(site.archetypeId, site.slotId, towardBase)) {
        const key = dawnDecalTextureKey(decal.name);
        if (!scene.textures.exists(key)) continue;
        // Just below the prop, painted (not multiplied: dense ground cover swallowed multiply); never emits light.
        this.decals.push(scene.add.image(at.x + decal.offsetX, at.y + decal.offsetY, key)
          .setDisplaySize(decal.size, decal.size).setRotation(decal.rotation)
          .setAlpha(DAWN_SITE_DECAL_ALPHA).setDepth(DEPTH.BASES - 0.05));
      }
    }
  }

  get count(): number { return this.decals.length; }

  destroy(): void {
    for (const decal of this.decals) decal.destroy();
    this.decals.length = 0;
  }
}
