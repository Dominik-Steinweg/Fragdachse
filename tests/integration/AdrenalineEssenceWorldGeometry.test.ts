import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../../node_modules/phaser/src/geom/index.js', import.meta.url));
  // Phaser's installed numeric geometry has no browser dependency.
  return { Geom: require('./index'), Math: require('../math') };
});
import { AdrenalineEssenceRuntime } from '../../src/adrenalineEssence/AdrenalineEssenceRuntime';
import { ADRENALINE_ESSENCE_CONFIG } from '../../src/adrenalineEssence/AdrenalineEssenceConfig';
import { essenceWorldGeometry } from '../essenceWorldGeometry';

describe('essence placement through generated World geometry', () => {
  it.each(['coop_defense', 'deathmatch', 'lobby'] as const)('materializes epoch-timed rewards on reachable %s terrain through the real obstacle index', mode => {
    const { geometry, openPoints } = essenceWorldGeometry(mode);
    const open = openPoints(ADRENALINE_ESSENCE_CONFIG.groundClearance);
    const scope = { worldRevision: 42, activityRevision: mode === 'lobby' ? null : 57 };
    expect(open.length).toBeGreaterThan(0);
    const epochNow = 1_800_000_000_000;
    for (let sample = 0; sample < Math.min(32, open.length); sample++) {
      const point = open[Math.floor(sample * open.length / Math.min(32, open.length))];
      const runtime = new AdrenalineEssenceRuntime(scope, {
        getPlayers: () => [],
        resolveGroundPoint: point => geometry.resolveSafeGroundPoint(point.x, point.y, ADRENALINE_ESSENCE_CONFIG.groundClearance),
        hasLineOfSight: (from, to) => geometry.hasLineOfSight(from.x, from.y, to.x, to.y),
        commitResolvedGain: () => { throw new Error('No collector is present'); },
      });
      runtime.update(epochNow);
      expect(runtime.materialize({
        id: `${sample}`, ...scope, creatorId: 'player',
        authoredValue: 3.5, resolvedValue: 3.5, origin: point, createdAt: epochNow, seed: sample,
        accessGroup: mode === 'coop_defense' ? { kind: 'coop' } : { kind: 'personal', playerId: 'player' },
      })).toBe(true);
      expect(runtime.getState().clusters.every(cluster => cluster.state === 'ejecting')).toBe(true);
      runtime.update(epochNow + ADRENALINE_ESSENCE_CONFIG.landingMaxMs);
      expect(runtime.getState().clusters.every(cluster => cluster.state === 'grounded')).toBe(true);
      expect(runtime.getDiagnostics()).toMatchObject({ placementFailureCount: 0, staleRewardCount: 0, rewardCount: 1 });
      expect(runtime.getDiagnostics().activeValue).toBeCloseTo(3.5, 12);
      runtime.destroy();
    }
  });
});
