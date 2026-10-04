import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import type { AmbientWildlifeRenderer } from '../src/arena/AmbientWildlifeRenderer';
import { TurretMaterialReview } from '../src/dev/scenario/TurretMaterialReview';
import { PIPELINE_ASSETS } from '../src/config/pipelineAssets';

vi.mock('../src/entities/WorldTurretVisual', () => ({
  createWorldTurretVisual: (scene: Phaser.Scene) => ({
    image: scene.add.image(0, 0, ''), aura: scene.add.image(0, 0, ''),
  }),
}));

describe('isolated turret material review', () => {
  it('covers each shared asset once and restores cosmetic wildlife when the gallery ends', () => {
    const objects: { destroy: ReturnType<typeof vi.fn> }[] = [];
    const scene = { add: { image() {
      const object = { destroy: vi.fn(), setDisplaySize() { return this; }, setDepth() { return this; } };
      objects.push(object); return object;
    } } } as unknown as Phaser.Scene;
    const update = vi.fn(), animals = [{ opacity: .4 }, { opacity: .8 }];
    const wildlife = { model: { animals, update }, clearLights: vi.fn() } as unknown as AmbientWildlifeRenderer;
    const gallery = new TurretMaterialReview(scene, 0, 0, wildlife);
    expect(objects).toHaveLength(PIPELINE_ASSETS.filter(a => a.category === 'turret').length * 3);
    expect(wildlife.clearLights).toHaveBeenCalledOnce();
    expect(animals.map(a => a.opacity)).toEqual([0, 0]);
    expect(wildlife.model.update).not.toBe(update);
    gallery.destroy(); gallery.destroy();
    expect(wildlife.model.update).toBe(update);
    expect(animals.map(a => a.opacity)).toEqual([.4, .8]);
    for (const object of objects) expect(object.destroy).toHaveBeenCalledOnce();
  });
});
