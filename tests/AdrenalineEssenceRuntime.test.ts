import { describe, expect, it, vi } from 'vitest';
import { AdrenalineEssenceRuntime } from '../src/adrenalineEssence/AdrenalineEssenceRuntime';
import { ADRENALINE_ESSENCE_CONFIG } from '../src/adrenalineEssence/AdrenalineEssenceConfig';
import { canSeeEssence, ESSENCE_VALUE_TOLERANCE, type EssencePlayerSnapshot, type EssenceReward } from '../src/adrenalineEssence/AdrenalineEssenceTypes';

const scope = { worldRevision: 2, activityRevision: 3 };
const coop = { kind: 'coop' } as const;
type Player = { -readonly [P in keyof EssencePlayerSnapshot]: EssencePlayerSnapshot[P] };
const player = (id: string, x = 0, capacity = 100): Player => ({
  playerId: id, lifeRevision: 1, participationRevision: 1, interactive: true, alive: true, collectible: true,
  accessGroup: coop, x, y: 0, adrenaline: 100 - capacity, maxAdrenaline: 100,
});
const reward = (id: string, value = 10, x = 0, createdAt = 0, overrides: Partial<EssenceReward> = {}): EssenceReward => ({
  ...scope, id, creatorId: 'a', authoredValue: value, resolvedValue: value, origin: { x, y: 0 },
  createdAt, seed: 42, accessGroup: coop, weaponId: 'test', branchId: 'primary', targetKind: 'enemy', ...overrides,
});

function fixture(players: Player[] = [], config = {}) {
  let revision = 0;
  const ports = {
    getPlayers: () => players.map(entry => ({ ...entry })),
    resolveGroundPoint: vi.fn((origin: { x: number; y: number }) => origin as { x: number; y: number } | null),
    hasLineOfSight: vi.fn(() => true),
    commitResolvedGain: vi.fn((playerId: string, value: number) => {
      const collector = players.find(entry => entry.playerId === playerId)!;
      const creditedValue = Math.max(0, Math.min(value, collector.maxAdrenaline - collector.adrenaline));
      collector.adrenaline += creditedValue;
      if (creditedValue > 0) revision++;
      return { creditedValue, resourceRevision: revision };
    }),
    onPlacementFailure: vi.fn(),
  };
  const runtime = new AdrenalineEssenceRuntime(scope, ports, {
    // Isolate collection/lifetime rules below from scatter tuning; dedicated tests use production defaults.
    fragmentsPerReward: 1, scatterMinRadius: 0, scatterMaxRadius: 0,
    landingMinMs: 100, landingMaxMs: 100, groundLifetimeMs: 1000,
    transferMinMs: 100, transferMaxMs: 100, mergeRadius: 30, mergeWindowMs: 150, ...config,
  });
  return { runtime, ports, players };
}

function conserved(runtime: AdrenalineEssenceRuntime): void {
  const diagnostics = runtime.getDiagnostics();
  expect(Math.abs(diagnostics.conservationError)).toBeLessThanOrEqual(ESSENCE_VALUE_TOLERANCE * Math.max(1, diagnostics.materializedValue));
}

describe('AdrenalineEssenceRuntime', () => {
  it('materializes full resolved fractions for a full creator, waits for landing, and commits only at arrival', () => {
    const creator = player('a', 0, 0);
    const teammate = player('b', 10, 100);
    const { runtime, ports } = fixture([creator, teammate]);
    expect(runtime.materialize(reward('hit', 3.5))).toBe(true);
    expect(runtime.getState().clusters[0]).toMatchObject({ value: 3.5, state: 'ejecting' });
    expect(ports.commitResolvedGain).not.toHaveBeenCalled();
    runtime.update(99);
    expect(runtime.getState().transfers).toHaveLength(0);
    runtime.update(100);
    expect(runtime.getState().transfers[0]).toMatchObject({ playerId: 'b', value: 3.5 });
    runtime.update(199);
    expect(teammate.adrenaline).toBe(0);
    runtime.update(200);
    expect(teammate.adrenaline).toBe(3.5);
    expect(runtime.drainReceipts()[0]).toMatchObject({ status: 'committed', creditedValue: 3.5, resourceRevision: 1 });
    runtime.update(201);
    expect(ports.commitResolvedGain).toHaveBeenCalledTimes(1);
    conserved(runtime);
  });

  it('deduplicates exact reward facts without suppressing separate hits or accepting stale scopes', () => {
    const { runtime } = fixture();
    runtime.materialize(reward('hit', 0.1));
    expect(runtime.materialize(reward('hit', 0.1))).toBe(false);
    runtime.materialize(reward('another-hit', 0.2));
    expect(runtime.materialize(reward('wrong-world', 2, 0, 0, { worldRevision: 1 }))).toBe(false);
    expect(runtime.materialize(reward('wrong-activity', 2, 0, 0, { activityRevision: 1 }))).toBe(false);
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) runtime.materialize(reward(`invalid-${invalid}`, invalid));
    expect(runtime.getDiagnostics()).toMatchObject({ rewardCount: 2, duplicateRewardCount: 1, staleRewardCount: 2, invalidRewardCount: 4 });
    conserved(runtime);
  });

  it('bounds dedupe retention while keeping old replayed facts inert', () => {
    const { runtime } = fixture([], { dedupeRetentionMs: 2000 });
    runtime.materialize(reward('old'));
    runtime.update(2000);
    expect(runtime.getDiagnostics().dedupeCount).toBe(1);
    expect(runtime.materialize(reward('old'))).toBe(false);
    runtime.update(2100);
    expect(runtime.getDiagnostics().dedupeCount).toBe(0);
    expect(runtime.materialize(reward('old'))).toBe(false);
    expect(runtime.getDiagnostics().materializedValue).toBe(10);
    conserved(runtime);
  });

  it('merges only against a fixed anchor, compatible access, original window and clear geometry', () => {
    const { runtime, ports } = fixture();
    runtime.materialize(reward('a', 1, 0));
    runtime.materialize(reward('b', 2, 25));
    runtime.materialize(reward('c', 3, 50));
    runtime.materialize(reward('team', 4, 0, 0, { accessGroup: { kind: 'team', teamId: 'blue' } }));
    runtime.update(100);
    expect(runtime.getState().clusters.map(cluster => [cluster.x, cluster.value])).toEqual([[0, 3], [50, 3], [0, 4]]);
    runtime.materialize(reward('late', 5, 0, 151));
    runtime.update(251);
    expect(runtime.getState().clusters).toHaveLength(4);
    ports.hasLineOfSight.mockReturnValue(false);
    runtime.materialize(reward('blocked', 6, 0, 152));
    runtime.update(252);
    expect(runtime.getState().clusters).toHaveLength(5);
    conserved(runtime);
  });

  it('preserves per-contribution expiry when nearby fractions merge', () => {
    const { runtime } = fixture();
    runtime.materialize(reward('older', 0.1));
    runtime.update(100);
    runtime.materialize(reward('newer', 0.2, 5, 100));
    runtime.update(200);
    expect(runtime.getState().clusters).toHaveLength(1);
    expect(runtime.getState().clusters[0]).toMatchObject({ expiresAt: 1100, lastExpiresAt: 1200 });
    runtime.update(1100);
    expect(runtime.getState().clusters[0]).toMatchObject({ value: 0.2, expiresAt: 1200 });
    expect(runtime.getDiagnostics().expiredValue).toBe(0.1);
    runtime.update(1200);
    expect(runtime.getState().clusters).toHaveLength(0);
    conserved(runtime);
  });

  it('rejects inconsistent scatter ranges without affecting valid authored defaults', () => {
    expect(() => fixture([], { scatterMinRadius: 30, scatterMaxRadius: 20 })).toThrow(/radius range/);
  });

  it('uses stable nearest selection and parallel reservations without overbooking incoming capacity', () => {
    const { runtime } = fixture([player('b', 0, 12), player('a', 0, 8)]);
    runtime.materialize(reward('first', 30));
    runtime.materialize(reward('outside-merge', 5, 100));
    runtime.update(100);
    expect(runtime.getState().transfers.map(transfer => [transfer.playerId, transfer.value])).toEqual([['a', 8], ['b', 12]]);
    expect(runtime.getDiagnostics()).toMatchObject({ groundedValue: 15, reservedValue: 20 });
    runtime.update(200);
    expect(runtime.getDiagnostics()).toMatchObject({ groundedValue: 15, reservedValue: 0, committedValue: 20 });
    conserved(runtime);
  });

  it('checks LoS at reservation only; moving beyond radius or behind a wall does not cancel a flight', () => {
    const collector = player('a');
    const { runtime, ports } = fixture([collector]);
    runtime.materialize(reward('hit'));
    runtime.update(100);
    expect(ports.hasLineOfSight).toHaveBeenCalledTimes(1);
    collector.x = 2000;
    ports.hasLineOfSight.mockReturnValue(false);
    runtime.update(200);
    expect(collector.adrenaline).toBe(10);
    expect(ports.hasLineOfSight).toHaveBeenCalledTimes(1);
    conserved(runtime);
  });

  it('rechecks capacity atomically, credits earliest-expiring contributions and returns rest to the fixed source', () => {
    const collector = player('a', 20, 100);
    const { runtime } = fixture([collector]);
    collector.collectible = false;
    runtime.materialize(reward('older', 4, 0));
    runtime.update(100);
    runtime.materialize(reward('newer', 6, 0, 100));
    collector.collectible = true;
    runtime.update(200);
    collector.adrenaline = 96;
    collector.x = 1000;
    runtime.update(300);
    expect(collector.adrenaline).toBe(100);
    expect(runtime.getState().clusters[0]).toMatchObject({ x: 0, value: 6, expiresAt: 1200 });
    expect(runtime.drainReceipts()[0]).toMatchObject({ creditedValue: 4, returnedValue: 6, sourceX: 0 });
    runtime.update(1100);
    expect(runtime.getState().clusters[0].value).toBe(6);
    conserved(runtime);
  });

  it.each(['death', 'life', 'burrow', 'underground', 'participation', 'access', 'disconnect'] as const)(
    'cancels %s before arrival and keeps returned essence immediately available', reason => {
      const collector = player('a');
      const { runtime, players, ports } = fixture([collector]);
      runtime.materialize(reward('hit'));
      runtime.update(100);
      if (reason === 'death') collector.alive = false;
      if (reason === 'life') collector.lifeRevision++;
      if (reason === 'burrow' || reason === 'underground') {
        collector.collectible = false;
        collector.blockedReason = reason;
      }
      if (reason === 'participation') collector.participationRevision++;
      if (reason === 'access') collector.accessGroup = { kind: 'team', teamId: 'blue' };
      if (reason === 'disconnect') players.length = 0;
      runtime.update(200);
      expect(ports.commitResolvedGain).not.toHaveBeenCalled();
      expect(runtime.drainReceipts()[0]).toMatchObject({ reason, creditedValue: 0, returnedValue: 10 });
      expect(runtime.getDiagnostics().cancellations[reason]).toBe(1);
      // A fresh life/participation may reserve the returned source immediately, but never inherits the old transfer.
      if (reason === 'life' || reason === 'participation') expect(runtime.getState().transfers[0].startedAt).toBe(200);
      else expect(runtime.getState().clusters[0]).toMatchObject({ x: 0, value: 10 });
      conserved(runtime);
    },
  );

  it('revalidates each arrival after synchronous effects of an earlier resource commit', () => {
    const first = player('a', 0, 5);
    const second = player('b', 0, 5);
    const { runtime, ports } = fixture([first, second]);
    runtime.materialize(reward('both', 10));
    runtime.update(100);
    const commit = ports.commitResolvedGain.getMockImplementation()!;
    ports.commitResolvedGain.mockImplementation((id, value) => {
      const result = commit(id, value);
      if (id === 'a') second.alive = false;
      return result;
    });
    runtime.update(200);
    expect(ports.commitResolvedGain).toHaveBeenCalledTimes(1);
    expect(second.adrenaline).toBe(95);
    expect(runtime.getDiagnostics()).toMatchObject({ committedValue: 5, groundedValue: 5 });
    expect(runtime.drainReceipts()).toEqual(expect.arrayContaining([expect.objectContaining({ playerId: 'b', reason: 'death' })]));
    conserved(runtime);
  });

  it('expires value on a delayed first update without ever reserving an already expired ejection', () => {
    const { runtime, ports } = fixture([player('a')]);
    runtime.materialize(reward('delayed', 0.1));
    runtime.update(20_000);
    expect(runtime.getState()).toMatchObject({ clusters: [], transfers: [] });
    expect(ports.commitResolvedGain).not.toHaveBeenCalled();
    expect(runtime.getDiagnostics()).toMatchObject({ expiredValue: 0.1, activeValue: 0 });
    conserved(runtime);
  });

  it('lets a flight started before expiry arrive, but expires any non-creditable remainder', () => {
    const collector = player('a');
    collector.collectible = false;
    const { runtime } = fixture([collector]);
    runtime.materialize(reward('hit'));
    runtime.update(100);
    collector.collectible = true;
    runtime.update(1099);
    collector.adrenaline = 96;
    runtime.update(1199);
    expect(collector.adrenaline).toBe(100);
    expect(runtime.getDiagnostics()).toMatchObject({ committedValue: 4, expiredValue: 6, expiredReturnValue: 6, activeValue: 0 });
    conserved(runtime);
  });

  it('does not resurrect expired flight value on cancellation', () => {
    const collector = player('a');
    collector.collectible = false;
    const { runtime } = fixture([collector]);
    runtime.materialize(reward('hit'));
    runtime.update(100);
    collector.collectible = true;
    runtime.update(1099);
    runtime.cancelPlayer('a', 'burrow', 1100);
    runtime.update(1200);
    expect(collector.adrenaline).toBe(0);
    expect(runtime.getDiagnostics()).toMatchObject({ expiredValue: 10, activeValue: 0, committedValue: 0 });
    conserved(runtime);
  });

  it('preserves already created essence through creator departure and lets its fresh life collect it', () => {
    const collector = player('a');
    const { runtime, players } = fixture([]);
    runtime.materialize(reward('posthumous', 5, 0, 0, { accessGroup: { kind: 'personal', playerId: 'a' } }));
    runtime.update(100);
    collector.accessGroup = { kind: 'personal', playerId: 'a' };
    collector.lifeRevision = 2;
    players.push(collector);
    runtime.update(200);
    runtime.update(300);
    expect(collector.adrenaline).toBe(5);
    conserved(runtime);
  });

  it('accounts placement failure once without retries or an invisible resource credit', () => {
    const { runtime, ports } = fixture([player('a')]);
    ports.resolveGroundPoint.mockReturnValue(null);
    runtime.materialize(reward('bad-geometry', 0.3));
    runtime.update(100);
    runtime.update(2000);
    expect(ports.resolveGroundPoint).toHaveBeenCalledTimes(1);
    expect(ports.onPlacementFailure).toHaveBeenCalledTimes(1);
    expect(ports.commitResolvedGain).not.toHaveBeenCalled();
    expect(runtime.getDiagnostics()).toMatchObject({ placementFailureCount: 1, placementFailedValue: 0.3, activeValue: 0 });
    conserved(runtime);
  });

  it('teardown accounts ejecting, grounded and reserved values once and leaves no late commit', () => {
    const { runtime, ports } = fixture([player('a', 0, 5)]);
    runtime.materialize(reward('ground-and-flight', 10));
    runtime.update(100);
    runtime.materialize(reward('ejecting', 2, 0, 101));
    runtime.destroy();
    runtime.destroy();
    runtime.update(200);
    expect(runtime.materialize(reward('late', 5, 0, 200))).toBe(false);
    expect(ports.commitResolvedGain).not.toHaveBeenCalled();
    expect(runtime.getState()).toMatchObject({ clusters: [], transfers: [] });
    expect(runtime.getDiagnostics()).toMatchObject({ activeValue: 0, lifecycleDiscardedValue: 12 });
    expect(runtime.drainReceipts()).toEqual([]);
    conserved(runtime);
  });

  it('retains tiny positive values through repeated fractional capacity splits', () => {
    const collector = player('a', 0, 0);
    const { runtime } = fixture([collector], { groundLifetimeMs: 100_000 });
    runtime.materialize(reward('fraction', 1 / 3));
    runtime.materialize(reward('tiny', 1e-12, 60));
    runtime.update(100);
    for (let step = 0; step < 100; step++) {
      collector.adrenaline = 99.99;
      runtime.update(200 + step * 200);
      runtime.update(300 + step * 200);
      conserved(runtime);
    }
    expect(runtime.getDiagnostics().committedValue).toBeCloseTo(1 / 3 + 1e-12, 12);
    expect(runtime.getDiagnostics().activeValue).toBe(0);
  });

  it.each([
    { capacity: 3.5, teardown: false },
    { capacity: 100, teardown: false },
    { capacity: 100, teardown: true },
  ])('fully consumes merged fractions without reconstructing rounding residue (capacity $capacity, teardown $teardown)', ({ capacity, teardown }) => {
    const collector = player('a', 0, capacity);
    collector.collectible = false;
    const { runtime, ports } = fixture([collector]);
    const share = 3.5 / 3;
    const values = [share, 3.5 - (share + share), share];
    for (const [index, value] of values.entries()) {
      runtime.materialize(reward(`fraction-${index}`, value, 0, 0, { weaponId: `weapon-${index}` }));
    }
    runtime.update(100);
    expect(runtime.getState().clusters).toEqual([expect.objectContaining({ value: 3.5 })]);
    collector.collectible = true;
    runtime.update(101);
    expect(runtime.getState().clusters).toEqual([]);
    expect(runtime.getState().transfers).toEqual([expect.objectContaining({ value: 3.5 })]);
    if (teardown) {
      const commit = ports.commitResolvedGain.getMockImplementation()!;
      ports.commitResolvedGain.mockImplementation((id, value) => {
        const result = commit(id, value);
        runtime.destroy();
        return result;
      });
    }
    runtime.update(201);
    expect(runtime.getState()).toMatchObject({ clusters: [], transfers: [] });
    expect(runtime.getDiagnostics()).toMatchObject({ committedValue: 3.5, returnedValue: 0, lifecycleDiscardedValue: 0, activeValue: 0 });
    for (const [index, value] of values.entries()) {
      expect(runtime.getDiagnostics().byAttribution.find(entry => entry.weaponId === `weapon-${index}`))
        .toMatchObject({ committedValue: value, creatorCollectedValue: value });
    }
    conserved(runtime);
  });

  it('returns a genuinely uncredited subnormal fraction without deleting it as rounding residue', () => {
    const collector = player('a');
    const { runtime, ports } = fixture([collector]);
    runtime.materialize(reward('below-resource-quantum', Number.MIN_VALUE));
    runtime.update(100);
    ports.commitResolvedGain.mockImplementation(() => {
      collector.collectible = false;
      return { creditedValue: 0, resourceRevision: 0 };
    });
    runtime.update(200);
    expect(runtime.getState().clusters).toEqual([expect.objectContaining({ value: Number.MIN_VALUE })]);
    expect(runtime.getDiagnostics()).toMatchObject({ committedValue: 0, returnedValue: Number.MIN_VALUE, activeValue: Number.MIN_VALUE });
    expect(runtime.drainReceipts()[0]).toMatchObject({ creditedValue: 0, returnedValue: Number.MIN_VALUE });
  });
});

describe('essence reward fragmentation', () => {
  it('scatters a reward deterministically into independently grounded fractions while counting its basis once', () => {
    const first = fixture([], ADRENALINE_ESSENCE_CONFIG);
    const replay = fixture([], ADRENALINE_ESSENCE_CONFIG);
    const fact = reward('fractional-hit', 3.5, 150, 0, { origin: { x: 150, y: -50 }, authoredValue: 7 });
    first.runtime.materialize(fact);
    replay.runtime.materialize(fact);
    const clusters = first.runtime.getState().clusters;
    expect(clusters).toEqual(replay.runtime.getState().clusters);
    expect(clusters).toHaveLength(ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward);
    expect(clusters.reduce((sum, cluster) => sum + cluster.value, 0)).toBe(fact.resolvedValue);
    expect(new Set(clusters.map(cluster => cluster.id)).size).toBe(clusters.length);
    const angles = clusters.map(cluster => Math.atan2(cluster.y - fact.origin.y, cluster.x - fact.origin.x));
    for (const [index, cluster] of clusters.entries()) {
      const radius = Math.hypot(cluster.x - fact.origin.x, cluster.y - fact.origin.y);
      expect(radius).toBeGreaterThanOrEqual(ADRENALINE_ESSENCE_CONFIG.scatterMinRadius);
      expect(radius).toBeLessThanOrEqual(ADRENALINE_ESSENCE_CONFIG.scatterMaxRadius);
      const next = clusters[(index + 1) % clusters.length];
      expect(Math.hypot(next.x - cluster.x, next.y - cluster.y)).toBeGreaterThan(ADRENALINE_ESSENCE_CONFIG.mergeRadius);
      const angleGap = (angles[(index + 1) % clusters.length] - angles[index] + Math.PI * 2) % (Math.PI * 2);
      const nominalGap = Math.PI * 2 / clusters.length;
      expect(Math.abs(angleGap - nominalGap)).toBeLessThanOrEqual(2 * ADRENALINE_ESSENCE_CONFIG.scatterAngleJitterDegrees * Math.PI / 180);
    }
    first.runtime.update(ADRENALINE_ESSENCE_CONFIG.landingMaxMs);
    expect(first.runtime.getState().clusters.every(cluster => cluster.state === 'grounded')).toBe(true);
    expect(first.runtime.getState().clusters).toHaveLength(clusters.length);
    expect(first.runtime.materialize(fact)).toBe(false);
    expect(first.runtime.getDiagnostics()).toMatchObject({ rewardCount: 1, duplicateRewardCount: 1, authoredValue: 7, materializedValue: 3.5 });
    expect(first.runtime.getDiagnostics().byAttribution).toEqual([expect.objectContaining({ rewardCount: 1, authoredValue: 7, materializedValue: 3.5 })]);
    const changedSeed = fixture([], ADRENALINE_ESSENCE_CONFIG);
    changedSeed.runtime.materialize({ ...fact, seed: fact.seed + 1 });
    expect(changedSeed.runtime.getState().clusters.map(cluster => [cluster.x, cluster.y]))
      .not.toEqual(clusters.map(cluster => [cluster.x, cluster.y]));
    conserved(first.runtime);
  });

  it('collects one fragment at its own location and returns only that fragment when its collector dies', () => {
    const collector = player('a', 1000);
    const { runtime } = fixture([collector], { ...ADRENALINE_ESSENCE_CONFIG, magnetRadius: 5 });
    runtime.materialize(reward('separate-pickups', 1));
    const source = runtime.getState().clusters[0];
    collector.x = source.x;
    collector.y = source.y;
    const landedAt = ADRENALINE_ESSENCE_CONFIG.landingMaxMs;
    runtime.update(landedAt);
    expect(runtime.getState().clusters).toHaveLength(ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward - 1);
    expect(runtime.getState().transfers).toHaveLength(1);
    expect(runtime.getState().transfers[0].value).toBe(source.value);
    collector.alive = false;
    runtime.update(landedAt + 1);
    expect(runtime.getState().transfers).toHaveLength(0);
    expect(runtime.getState().clusters.find(cluster => cluster.id === source.id))
      .toMatchObject({ x: source.x, y: source.y, value: source.value });
    collector.alive = true;
    collector.lifeRevision++;
    runtime.update(landedAt + 2);
    runtime.update(landedAt + 2 + ADRENALINE_ESSENCE_CONFIG.transferMaxMs);
    expect(collector.adrenaline).toBe(source.value);
    expect(runtime.getState().clusters).toHaveLength(ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward - 1);
    expect(runtime.getDiagnostics().byAttribution[0].creatorCollectedValue).toBe(source.value);
    conserved(runtime);
  });

  it('redistributes all value across unique valid fallback positions before splitting', () => {
    const { runtime, ports } = fixture([], ADRENALINE_ESSENCE_CONFIG);
    const positions = [{ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 100, y: 200 }];
    ports.resolveGroundPoint.mockImplementation(() => positions.shift()!);
    runtime.materialize(reward('duplicates', 0.1));
    expect(runtime.getState().clusters.map(cluster => cluster.value)).toEqual([0.05, 0.05]);
    expect(ports.onPlacementFailure).not.toHaveBeenCalled();
    const partial = fixture([], ADRENALINE_ESSENCE_CONFIG);
    partial.ports.resolveGroundPoint.mockReturnValueOnce(null).mockReturnValueOnce({ x: 10, y: 20 }).mockReturnValueOnce(null);
    partial.runtime.materialize(reward('one-valid', 0.1));
    expect(partial.runtime.getState().clusters).toEqual([expect.objectContaining({ x: 10, y: 20, value: 0.1 })]);
    expect(partial.runtime.getDiagnostics().placementFailedValue).toBe(0);
    conserved(runtime);
    conserved(partial.runtime);
  });

  it('discards an entirely unplaceable reward exactly once after bounded fragment placement attempts', () => {
    const { runtime, ports } = fixture([], ADRENALINE_ESSENCE_CONFIG);
    ports.resolveGroundPoint.mockReturnValue(null);
    const fact = reward('no-valid-points', 0.1);
    runtime.materialize(fact);
    runtime.update(ADRENALINE_ESSENCE_CONFIG.landingMaxMs);
    expect(runtime.materialize(fact)).toBe(false);
    expect(ports.resolveGroundPoint).toHaveBeenCalledTimes(ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward);
    expect(ports.onPlacementFailure).toHaveBeenCalledTimes(1);
    expect(runtime.getDiagnostics()).toMatchObject({ rewardCount: 1, placementFailureCount: 1, placementFailedValue: fact.resolvedValue, activeValue: 0 });
    conserved(runtime);
  });

  it.each([Number.MIN_VALUE, 2 * Number.MIN_VALUE, 3 * Number.MIN_VALUE, 1e-12, 0.1, 1 / 3])(
    'preserves the exact positive remainder when splitting %s, including subnormal amounts', value => {
      const { runtime } = fixture([], ADRENALINE_ESSENCE_CONFIG);
      runtime.materialize(reward('small-fragments', value));
      const clusters = runtime.getState().clusters;
      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters.every(cluster => cluster.value > 0)).toBe(true);
      expect(clusters.reduce((sum, cluster) => sum + cluster.value, 0)).toBe(value);
      runtime.destroy();
      expect(runtime.getDiagnostics()).toMatchObject({ activeValue: 0, lifecycleDiscardedValue: value });
    },
  );
});

describe('essence visibility', () => {
  it('uses current access/participation without hiding essences solely because a player is dead or full', () => {
    const viewer = player('a', 0, 0);
    viewer.alive = false;
    viewer.collectible = false;
    expect(canSeeEssence(coop, viewer)).toBe(true);
    expect(canSeeEssence({ kind: 'team', teamId: 'red' }, viewer)).toBe(false);
    viewer.accessGroup = { kind: 'team', teamId: 'red' };
    expect(canSeeEssence({ kind: 'team', teamId: 'red' }, viewer)).toBe(true);
    viewer.interactive = false;
    expect(canSeeEssence({ kind: 'team', teamId: 'red' }, viewer)).toBe(false);
  });
});
