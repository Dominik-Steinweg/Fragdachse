import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import { TURRET_VISUALS } from '../../config/turretVisuals';
import { createWorldTurretVisual } from '../../entities/WorldTurretVisual';
import type { TurretWeaponId } from '../../types';
import type { AmbientWildlifeRenderer } from '../../arena/AmbientWildlifeRenderer';

/** Dev-only material gallery under the actual world's sunlight, fog and lightmap. */
export class TurretMaterialReview {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private restoreWildlife: (() => void) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, wildlife: AmbientWildlifeRenderer | null) {
    // Moving insects and their pulsing lamps are outside this material fixture.
    // Keep terrain, vegetation, sun, fog and the player's flashlight unchanged.
    if (wildlife) {
      const update = wildlife.model.update;
      const opacity = wildlife.model.animals.map(animal => [animal, animal.opacity] as const);
      wildlife.clearLights();
      wildlife.model.update = () => {};
      for (const [animal] of opacity) animal.opacity = 0;
      this.restoreWildlife = () => {
        wildlife.model.update = update;
        for (const [animal, value] of opacity) animal.opacity = value;
      };
    }
    const seen = new Set<string>();
    for (const [weaponId, spec] of Object.entries(TURRET_VISUALS)) {
      if (seen.has(spec.asset.id)) continue;
      const index = seen.size;
      seen.add(spec.asset.id);
      const px = x + (index % 3 - 1) * 58;
      const py = y + (Math.floor(index / 3) - 1) * 42;
      // Same stationary support frame as the asset-pipeline scale viewer.
      const support = scene.add.image(px, py, 'rocks', 36)
        .setDisplaySize(CELL_SIZE, CELL_SIZE).setDepth(DEPTH.ROCKS);
      const visual = createWorldTurretVisual(scene, weaponId as TurretWeaponId, px, py, 0x88b5a0);
      this.objects.push(support, visual.aura, visual.image);
    }
  }

  destroy(): void {
    this.restoreWildlife?.(); this.restoreWildlife = null;
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }
}
