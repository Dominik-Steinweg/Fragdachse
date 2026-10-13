import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { DAWN_SITE_DISPLAY_SIZE } from '../assets/DawnAssets';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { DawnWorldPlan } from '../dawn/contracts/DawnPlans';
import { toDawnSiteBaseId, toDawnSiteObjectiveId } from '../dawn/resolution/DawnScenarioResolution';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';
import { resolveCoopDefenseWorldMetrics } from '../world/WorldMetrics';
import { getBaseWorldBounds, resolveWorldBases } from './BaseRegistry';
import { resolveDawnSitePropVisual } from './DawnSitePropModel';

/** World material on the main camera, independent of the base's dormant representation. */
export class DawnSitePropRenderer {
  private readonly sites;
  private readonly sprites = new Map<string, Phaser.GameObjects.Sprite>();

  constructor(
    private readonly scene: Phaser.Scene,
    plan: DawnWorldPlan,
    world: WorldDefinition,
    private readonly isStructureDestroyed: (baseId: string) => boolean,
  ) {
    const metrics = resolveCoopDefenseWorldMetrics(world.metrics.widthCells, world.metrics.heightCells);
    const bases = resolveWorldBases(world, metrics);
    this.sites = plan.sites.flatMap(site => {
      const baseId = toDawnSiteBaseId(site.slotId);
      const base = bases.find(entry => entry.id === baseId);
      if (!base || base.cells.length === 0) return [];
      const bounds = getBaseWorldBounds(base.region, metrics);
      return [{ ...site, baseId, objectiveId: toDawnSiteObjectiveId(site.slotId),
        x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }];
    });
  }

  sync(objectives: CoopDefenseSecondaryObjectivePresentationState | null): void {
    for (const site of this.sites) {
      const state = objectives?.find(entry => entry.objectiveId === site.objectiveId)?.state;
      const visual = resolveDawnSitePropVisual(site.archetypeId, site.tier, state, this.isStructureDestroyed(site.baseId));
      let sprite = this.sprites.get(site.baseId);
      if (!visual || !this.scene.textures.exists(visual.textureKey)
        || (visual.animationKey !== null && !this.scene.anims.exists(visual.animationKey))) {
        sprite?.destroy();
        this.sprites.delete(site.baseId);
        continue;
      }
      if (!sprite) {
        sprite = this.scene.add.sprite(site.x, site.y, visual.textureKey)
          .setOrigin(0.5).setDepth(DEPTH.BASES);
        this.sprites.set(site.baseId, sprite);
      }
      if (visual.animationKey) {
        sprite.play(visual.animationKey, true);
      } else {
        sprite.stop();
        sprite.setTexture(visual.textureKey);
      }
      sprite.setDisplaySize(DAWN_SITE_DISPLAY_SIZE, DAWN_SITE_DISPLAY_SIZE);
    }
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }
}
