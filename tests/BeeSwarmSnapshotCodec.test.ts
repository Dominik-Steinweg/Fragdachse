import { describe, expect, it } from 'vitest';
import { BEE_SWARM_MAX_SWARMS, decodeBeeSwarms, encodeBeeSwarms } from '../src/network/beeSwarmSnapshotCodec';
import type { SyncedBeeSwarm } from '../src/types';

const swarm = (id: number, patch: Partial<SyncedBeeSwarm> = {}): SyncedBeeSwarm => ({
  id, hiveIndex: id, phase: 'hunting', phaseStartedAt: 1000, releasedAt: 1000, x: 12.3, y: -45.6,
  target: { kind: 'enemy', id: 'e7' }, hostile: false, stingSequence: 3, ...patch,
});

describe('bee swarm snapshot codec', () => {
  it('round-trips swarms, including returning swarms without target and hostile swarms', () => {
    const swarms = [swarm(1), swarm(2, { phase: 'returning', target: null, hostile: true, stingSequence: 0 })];
    expect(decodeBeeSwarms(JSON.parse(JSON.stringify(encodeBeeSwarms(swarms))))).toEqual(swarms);
  });

  it('drops malformed or duplicate entries and caps the count', () => {
    const [good] = encodeBeeSwarms([swarm(1)]) as unknown[][];
    const bad = [
      [...good.slice(0, 2), 9, ...good.slice(3)],
      [...good.slice(0, 7), 1, '', ...good.slice(9)],
      [...good.slice(0, 9), 2, good[10]],
      good.slice(0, 10),
      'nope',
    ];
    expect(decodeBeeSwarms([good, good, ...bad])).toHaveLength(1);
    expect(decodeBeeSwarms(null)).toEqual([]);
    const many = encodeBeeSwarms(Array.from({ length: BEE_SWARM_MAX_SWARMS + 5 }, (_, i) => swarm(i + 1)));
    expect(decodeBeeSwarms(many)).toHaveLength(BEE_SWARM_MAX_SWARMS);
  });
});
