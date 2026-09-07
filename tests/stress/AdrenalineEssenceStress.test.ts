import { describe, expect, it } from 'vitest';
import { AdrenalineEssenceRuntime } from '../../src/adrenalineEssence/AdrenalineEssenceRuntime';
import { ADRENALINE_ESSENCE_CONFIG } from '../../src/adrenalineEssence/AdrenalineEssenceConfig';
import { AdrenalineEssenceClientReplica, AdrenalineEssenceReplication } from '../../src/adrenalineEssence/AdrenalineEssenceReplication';
import { decodeEssenceSnapshot, encodeEssenceSnapshot } from '../../src/adrenalineEssence/AdrenalineEssenceWireCodec';
import { ESSENCE_VALUE_TOLERANCE, type EssencePlayerSnapshot } from '../../src/adrenalineEssence/AdrenalineEssenceTypes';
import { NET_TICK_INTERVAL_MS } from '../../src/config';

function runCombatStress(seed: number, fragmentsPerReward: number) {
  let randomState = seed;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) | 0) >>> 0) / 0x1_0000_0000;
  type Player = { -readonly [P in keyof EssencePlayerSnapshot]: EssencePlayerSnapshot[P] };
  const players: Player[] = Array.from({ length: 12 }, (_, index) => ({
    playerId: String(index), lifeRevision: 1, participationRevision: 1, interactive: true,
    alive: true, collectible: true, accessGroup: { kind: 'coop' }, x: index * 120, y: 200,
    adrenaline: 0, maxAdrenaline: 100,
  }));
  let commits = 0;
  const publisher = new AdrenalineEssenceReplication();
  const replica = new AdrenalineEssenceClientReplica({ worldRevision: 1, activityRevision: seed });
  const frameSamples: number[] = [];
  let verboseBytes = 0;
  let nextSnapshotAt = 0;
  const byteEncoder = new TextEncoder();
  const runtime = new AdrenalineEssenceRuntime({ worldRevision: 1, activityRevision: seed }, {
    getPlayers: () => players,
    resolveGroundPoint: origin => origin,
    hasLineOfSight: (from, to) => Math.floor(from.x / 300) === Math.floor(to.x / 300),
    commitResolvedGain: (id, value) => {
      const player = players.find(candidate => candidate.playerId === id)!;
      const creditedValue = Math.max(0, Math.min(value, player.maxAdrenaline - player.adrenaline));
      player.adrenaline += creditedValue;
      return { creditedValue, resourceRevision: ++commits };
    },
  }, { fragmentsPerReward });
  for (let tick = 0; tick < 500; tick++) {
    const now = tick * 40;
    for (let hit = 0; hit < 12; hit++) {
      const amount = (1 + Math.floor(random() * 100)) / 37;
      runtime.materialize({
        worldRevision: 1, activityRevision: seed, id: `${tick}:${hit}`, creatorId: String(hit % players.length),
        authoredValue: amount, resolvedValue: amount, origin: { x: random() * 1600, y: random() * 800 },
        createdAt: now, seed: tick * 12 + hit, accessGroup: { kind: 'coop' }, weaponId: 'stress', branchId: 'primary', targetKind: 'enemy',
      });
    }
    for (const player of players) {
      player.x += (random() - 0.5) * 12;
      player.adrenaline = Math.max(0, Math.min(100, player.adrenaline + (random() - 0.5) * 12));
      player.collectible = random() > 0.08;
      if (random() < 0.01) player.lifeRevision++;
    }
    const start = performance.now();
    runtime.update(now);
    frameSamples.push(performance.now() - start);
    publisher.addReceipts(runtime.drainReceipts());
    if (now >= nextSnapshotAt) {
      nextSnapshotAt += NET_TICK_INTERVAL_MS;
      const snapshot = publisher.build(runtime.getState(), now);
      if (snapshot) verboseBytes += byteEncoder.encode(JSON.stringify(snapshot)).length;
      // Lose occasional deltas and exercise the same periodic full recovery as gameplay.
      if (snapshot && (snapshot.full || tick % 35 !== 0)) {
        replica.apply(decodeEssenceSnapshot(JSON.parse(JSON.stringify(encodeEssenceSnapshot(snapshot)))));
      }
    }
    const diagnostic = runtime.getDiagnostics();
    expect(Math.abs(diagnostic.conservationError)).toBeLessThan(ESSENCE_VALUE_TOLERANCE * Math.max(1, diagnostic.materializedValue));
    expect(diagnostic.placementFailureCount).toBe(0);
    expect(diagnostic.activeValue).toBeGreaterThanOrEqual(0);
  }
  expect(runtime.getDiagnostics().rewardCount).toBe(6000);
  expect(runtime.getDiagnostics().mergeCount).toBeGreaterThan(0);
  expect(runtime.getDiagnostics().committedValue).toBeGreaterThan(0);
  expect(runtime.getDiagnostics().returnedValue).toBeGreaterThan(0);
  const finalFull = publisher.build(runtime.getState(), 20_000, true)!;
  verboseBytes += byteEncoder.encode(JSON.stringify(finalFull)).length;
  replica.apply(decodeEssenceSnapshot(JSON.parse(JSON.stringify(encodeEssenceSnapshot(finalFull)))));
  expect(replica.getState()).toEqual(runtime.getState());
  expect(publisher.getDiagnostics().bytes).toBeGreaterThan(0);
  frameSamples.sort((left, right) => left - right);
  const percentile = (p: number) => Number(frameSamples[Math.floor((frameSamples.length - 1) * p)].toFixed(3));
  const metrics = {
    seed, fragmentsPerReward, rewards: runtime.getDiagnostics().rewardCount,
    materializedValue: runtime.getDiagnostics().materializedValue, networkRateHz: 1000 / NET_TICK_INTERVAL_MS,
    updateP50Ms: percentile(0.5), updateP95Ms: percentile(0.95),
    peakClusters: runtime.getDiagnostics().peakClusterCount,
    peakTransfers: runtime.getDiagnostics().peakTransferCount,
    cpuMs: runtime.getDiagnostics().cpuMs, network: publisher.getDiagnostics(),
    verboseBytes, wireSavingsPercent: Number((100 * (1 - publisher.getDiagnostics().bytes / verboseBytes)).toFixed(1)),
  };
  console.info('Essence 12-player stress', JSON.stringify(metrics));
  runtime.destroy();
  const final = runtime.getDiagnostics();
  expect(final.activeValue).toBe(0);
  expect(Math.abs(final.conservationError)).toBeLessThan(ESSENCE_VALUE_TOLERANCE * final.materializedValue);
  return metrics;
}

describe('essence conservation under sustained combat', () => {
  it.each([17, 311, 8191])('compares one-drop and production scatter under the same fractional combat workload (seed %s)', seed => {
    const baseline = runCombatStress(seed, 1);
    const fragmented = runCombatStress(seed, ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward);
    // Different spatial collection outcomes are allowed; changing reward facts or dropping value is not.
    expect(fragmented.rewards).toBe(baseline.rewards);
    expect(fragmented.materializedValue).toBe(baseline.materializedValue);
    console.info('Essence fragmentation cost comparison', JSON.stringify({
      seed,
      updateP95Ms: { single: baseline.updateP95Ms, fragmented: fragmented.updateP95Ms },
      materializeCpuMs: { single: baseline.cpuMs.materialize, fragmented: fragmented.cpuMs.materialize },
      peakClusters: { single: baseline.peakClusters, fragmented: fragmented.peakClusters },
      wireBytes: { single: baseline.network.bytes, fragmented: fragmented.network.bytes },
      lastFullBytes: { single: baseline.network.lastFullBytes, fragmented: fragmented.network.lastFullBytes },
      bytesPerSecondPerRecipient: { single: baseline.network.bytes / 20, fragmented: fragmented.network.bytes / 20 },
    }));
  }, 30_000);
});
