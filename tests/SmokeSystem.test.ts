import { describe, expect, it } from 'vitest';

import { smokeEffect, smokeHarness, smokeSource, smokeTarget } from './SmokeTestHelper';
import type { SmokeGrenadeEffect } from '../src/types';

describe('SmokeSystem cloud state', () => {
  it('uses the snapshot radius for exposure and makes dissipating smoke purely visual', () => {
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
        behavior: smokeEffect().behavior,
      } satisfies SmokeGrenadeEffect,
      ownerId: 'player-1',
      lastTickAt: 1_000,
    };
    const { runtime } = smokeHarness();
    const id = runtime.createCloud(cloud.x, cloud.y, cloud.config, smokeSource(), cloud.createdAt);
    const snapshot = runtime.getSnapshots(1_050)[0];
    expect(snapshot.radius).toBeGreaterThan(0);
    expect(snapshot.radius).toBeLessThan(cloud.config.radius);
    runtime.updateExposure([
      smokeTarget('inside', 100 + snapshot.radius - 0.01, 100),
      smokeTarget('outside', 100 + snapshot.radius + 0.01, 100),
    ], 1_050);
    expect(runtime.getConfusion('inside', 1_050)?.cloudId).toBe(id);
    expect(runtime.getConfusion('outside', 1_050)).toBeNull();

    const dissipatingSnapshot = runtime.getSnapshots(1_250)[0];
    expect(dissipatingSnapshot.phase).toBe('dissipating');
    expect(dissipatingSnapshot.radius).toBe(cloud.config.radius);
    expect(dissipatingSnapshot.alpha).toBeGreaterThan(0);
    expect(dissipatingSnapshot.alpha).toBeLessThan(snapshot.alpha);
    runtime.updateExposure([smokeTarget('late-entry', 100, 100)], 1_250);
    expect(runtime.getConfusion('late-entry', 1_250)).toBeNull();
    expect(runtime.getSnapshots(1_300)).toEqual([]);
  });
});
