import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Linear: (from: number, to: number, t: number) => from + (to - from) * t,
    Easing: {
      Cubic: { Out: (t: number) => 1 - ((1 - t) ** 3) },
      Quadratic: { In: (t: number) => t * t },
    },
  },
}));

import { SmokeSystem } from '../src/effects/SmokeSystem';
import type { SmokeGrenadeEffect } from '../src/types';

interface SmokeSystemInternals {
  activeClouds: Array<{
    id: number;
    x: number;
    y: number;
    createdAt: number;
    config: SmokeGrenadeEffect;
    ownerId: string;
    lastTickAt: number;
  }>;
  visuals: Map<number, unknown>;
  syncVisuals: (clouds: readonly unknown[]) => void;
  resolveCloudState: (cloud: SmokeSystemInternals['activeClouds'][number], now: number) => {
    radius: number;
    alpha: number;
    density: number;
    storm: boolean;
    stormTickMs?: number;
  } | null;
}

function createTestSystem(cloud: SmokeSystemInternals['activeClouds'][number]): SmokeSystem {
  const system = Object.create(SmokeSystem.prototype) as SmokeSystem;
  const internals = system as unknown as SmokeSystemInternals;
  internals.activeClouds = [cloud];
  internals.visuals = new Map();
  internals.syncVisuals = () => {};
  return system;
}

describe('SmokeSystem cloud state', () => {
  it('uses the snapshot state resolver for both visible and AI radius queries', () => {
    const cloud = {
      id: 4,
      x: 100,
      y: 100,
      createdAt: 1_000,
      config: {
        type: 'smoke',
        radius: 100,
        spreadDuration: 100,
        lingerDuration: 100,
        dissipateDuration: 100,
        maxAlpha: 0.8,
      } satisfies SmokeGrenadeEffect,
      ownerId: 'player-1',
      lastTickAt: 1_000,
    };
    const system = createTestSystem(cloud);
    const internals = system as unknown as SmokeSystemInternals;
    const state = internals.resolveCloudState(cloud, 1_050)!;
    const snapshot = system.hostUpdate(1_050).synced[0];

    expect(snapshot.radius).toBe(Math.round(state.radius));
    expect(snapshot.alpha).toBe(Math.round(state.alpha * 100) / 100);
    expect(snapshot.density).toBe(Math.round(state.density * 100) / 100);
    expect(system.getActiveCloudIdAt(100 + state.radius - 0.01, 100, 1_050)).toBe(4);
    expect(system.getActiveCloudIdAt(100 + state.radius + 0.01, 100, 1_050)).toBeNull();

    const dissipating = internals.resolveCloudState(cloud, 1_250)!;
    const dissipatingSnapshot = system.hostUpdate(1_250).synced[0];
    expect(dissipatingSnapshot.radius).toBe(Math.round(dissipating.radius));
    expect(system.isPointInCloud(4, 100 + dissipating.radius - 0.01, 100, 1_250)).toBe(true);
    expect(system.isPointInCloud(4, 100 + dissipating.radius + 0.01, 100, 1_250)).toBe(false);
  });
});
