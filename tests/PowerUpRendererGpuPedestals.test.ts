import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    FloatBetween: (min: number, max: number) => (min + max) / 2,
  },
}));

vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: { critical: 1, standard: 1, decorative: 1 } }),
    subscribe: () => () => {},
  }),
}));

import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GPU_VFX_LANES } from '../src/effects/gpu/GpuVfxRenderLanes';
import { PowerUpRenderer } from '../src/powerups/PowerUpRenderer';
import type { SyncedPowerUpPedestal } from '../src/types';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

const PEDESTAL: SyncedPowerUpPedestal = {
  id: 12,
  defId: 'HEALTH_PACK',
  x: 320,
  y: 224,
  hasPowerUp: true,
  nextRespawnAt: 0,
};

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

describe('PowerUpRenderer GPU pedestals', () => {
  it('uses persistent GPU layers and the shared transient lane without CPU pedestal objects', () => {
    const scene = makeFakeGpuVfxScene();
    const gpuVfx = new GpuVfxSystem(scene as never);
    const renderer = new PowerUpRenderer(scene as never);
    renderer.registerGpuVfx(gpuVfx);

    renderer.syncPedestals([PEDESTAL]);
    renderer.updatePedestals(10_000);
    gpuVfx.update(220);

    expect(scene.layers).toHaveLength(GPU_VFX_LANES.length + 3);
    expect(findFakeLane(scene, 'powerup-pedestal-base').added).toBe(1);
    expect(findFakeLane(scene, 'powerup-pedestal-glow').added).toBe(3);
    expect(scene.objects).toHaveLength(0);
    expect(scene.emitters).toHaveLength(0);

    const transient = findFakeLane(scene, 'powerup-pedestal');
    expect(transient.edited.length).toBeGreaterThan(0);
    expect(new Set(transient.members.map((member) => member.frame)))
      .toEqual(new Set(['death-glow', 'death-fragment']));

    renderer.syncPedestals([]);
    expect(findFakeLane(scene, 'powerup-pedestal-base').visible).toBe(false);
    expect(transient.patched.length).toBeGreaterThan(0);
  });
});
