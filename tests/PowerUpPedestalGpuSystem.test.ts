import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));

import {
  PowerUpPedestalGpuSystem,
  resolvePowerUpPedestalGpuMode,
} from '../src/powerups/PowerUpPedestalGpuSystem';
import type { SyncedPowerUpPedestal } from '../src/types';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function pedestal(overrides: Partial<SyncedPowerUpPedestal> = {}): SyncedPowerUpPedestal {
  return {
    id: 7,
    defId: 'HEALTH_PACK',
    x: 320,
    y: 224,
    hasPowerUp: false,
    nextRespawnAt: 0,
    ...overrides,
  };
}

describe('PowerUpPedestalGpuSystem', () => {
  it('keeps every pedestal on three persistent layers with reusable stable slots', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new PowerUpPedestalGpuSystem(scene as never);
    const base = findFakeLane(scene, 'powerup-pedestal-base');
    const owner = findFakeLane(scene, 'powerup-pedestal-owner');
    const glow = findFakeLane(scene, 'powerup-pedestal-glow');

    expect(scene.layers).toHaveLength(3);
    expect([glow.blendMode, base.blendMode, owner.blendMode]).toEqual([1, 0, 0]);
    expect(scene.layers.every((layer) => layer.enabledEases.includes('Sine.easeInOut'))).toBe(true);

    system.upsert(pedestal(), 'idle');
    expect(base.added).toBe(1);
    expect(owner.added).toBe(1);
    expect(glow.added).toBe(3);
    expect(scene.layers.every((layer) => layer.visible)).toBe(true);

    system.upsert(pedestal(), 'idle');
    expect(base.edited).toEqual([]);
    expect(glow.edited).toEqual([]);

    system.upsert(pedestal({ hasPowerUp: true }), 'ready');
    expect(base.edited).toEqual([0]);
    expect(owner.edited).toEqual([0]);
    expect(glow.edited).toEqual([0, 1, 2]);

    system.remove(7);
    expect(scene.layers.every((layer) => !layer.visible)).toBe(true);

    system.upsert(pedestal({ id: 8, x: 512 }), 'idle');
    expect(base.added).toBe(1);
    expect(owner.added).toBe(1);
    expect(glow.added).toBe(3);
    expect(base.edited.at(-1)).toBe(0);
    expect(glow.edited.slice(-3)).toEqual([0, 1, 2]);
  });

  it('derives the GPU animation mode from the replicated respawn state', () => {
    expect(resolvePowerUpPedestalGpuMode(pedestal({ hasPowerUp: true }), 10_000)).toBe('ready');
    expect(resolvePowerUpPedestalGpuMode(pedestal({ nextRespawnAt: 16_000 }), 10_000)).toBe('idle');
    expect(resolvePowerUpPedestalGpuMode(pedestal({ nextRespawnAt: 14_500 }), 10_000)).toBe('announcing');
    expect(resolvePowerUpPedestalGpuMode(pedestal({ nextRespawnAt: 9_999 }), 10_000)).toBe('idle');
  });
});
