import { describe, expect, it } from 'vitest';
import { ultimateHarness, START } from '../balance-lab/InspectorUltimateHarness';
import { INSPECTORS, inspectorUltimate } from '../balance-lab/InspectorUltimateConfigs';
import { bomberDrops, bomberDronePose, bomberPlanParamsFromConfig, bomberDroneFlightEndAt,
  chooseBomberAim, type BomberDronePose } from '../../src/systems/bomberSquadron/BomberSquadronPlan';
import { bomberSquadronBombKey } from '../../src/systems/bomberSquadron/BomberSquadronSnapshot';
import { encodeBomberSquadronSnapshot, decodeBomberSquadronSnapshot } from '../../src/network/bomberSquadronSnapshotCodec';
import { ATTACK_DRONE_RULES } from '../../src/config/attackDrone';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom } from '../fakePeerNetwork';

describe('four full bomber squadrons during ordinary combat', () => {
  it('samples all flight phases at 60 Hz with reusable output and filters distant aim targets', () => {
    const config = inspectorUltimate('BOMBER_SQUADRON', true);
    if (config.type !== 'bomber_squadron') throw Error('Expected bomber config');
    const params = bomberPlanParamsFromConfig(config), anchor = { x: 1000, y: 1000, aimOffset: 0, aimAngle: 0 };
    const squadrons = INSPECTORS.map((_, i) => ({ id: i + 1, angle: i * Math.PI / 2, startedAt: START, params: { ...params } }));
    const out: BomberDronePose = { x: 0, y: 0, heading: 0, bank: 0, alpha: 0, phase: 'approach' };
    const end = bomberDroneFlightEndAt(squadrons[0], params.droneCount - 1);
    let poses = 0, valid = true;
    const began = performance.now();
    for (let t = START; t <= end; t += 1000 / 60) for (const s of squadrons) for (let drone = 0; drone < params.droneCount; drone++) {
      const pose = bomberDronePose(s, drone, anchor, t, out);
      if (!pose) continue;
      poses++;
      valid &&= pose === out && Number.isFinite(pose.x + pose.y + pose.heading + pose.bank) && Math.abs(pose.bank) <= 1;
    }
    const elapsedMs = performance.now() - began;
    expect(valid).toBe(true);
    expect(poses).toBeGreaterThan(params.droneCount * INSPECTORS.length);
    const near = [{ x: anchor.x + params.corridorLengthPx / 2, y: anchor.y, weight: 1 }];
    const far = Array.from({ length: 50000 }, (_, i) => ({ x: 10000 + i, y: 10000, weight: 1 }));
    const bounds = { width: 5000, height: 5000 };
    expect(chooseBomberAim(squadrons[0], 0, anchor, [...near, ...far], [], bounds))
      .toEqual(chooseBomberAim(squadrons[0], 0, anchor, near, [], bounds));
    console.info('BOMBER_FLIGHT_STRESS ' + JSON.stringify({ drones: params.droneCount * INSPECTORS.length,
      poses, elapsedMs: Math.round(elapsedMs), microsecondsPerPose: elapsedMs * 1000 / poses }));
  });
  it('executes every bomb and landing once and batches all chunk FX once per host frame', async () => {
    const config = inspectorUltimate('BOMBER_SQUADRON', true);
    if (config.type !== 'bomber_squadron') throw Error('Expected bomber config');
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network);
    const client = await addClientRoom(network);
    setActiveSession({ room: hostRoom.room, transport: hostRoom.transport as never, roomCode: 'BOMBER-STRESS' });
    const bridge = new NetworkBridge(); bridge.activate();
    bridge.publishLobbySync();
    bridge.publishWorldAndActivity({ worldRevision: 1, definitionId: 'world:lobby', seed: 1,
      generatorVersion: 3, layoutFingerprint: 'bomber-stress' }, null);
    const h = ultimateHarness('dense', INSPECTORS);
    try {
      h.addArsenal('mixed');
      h.chunkFx.mockImplementation((...args) => bridge.broadcastFireChunkEffect(...args));
      h.explosionBroadcast.mockImplementation((...args) => bridge.broadcastExplosionEffect(...args));
      for (const playerId of INSPECTORS) expect(h.bomber.runtime.tryActivate({ playerId,
        nowMs: START, angle: 0, config })).toEqual({ ok: true });
      const squadrons = h.bomber.runtime.getSnapshot().squadrons;
      const plans = new Map<string, ReturnType<typeof bomberDrops>[number]>();
      const expectedBombs = INSPECTORS.length * config.droneCount * config.bombsPerPass * (1 + config.secondPassEnabled);
      const expectedChunks = expectedBombs * config.fireChunksPerBomb;
      const end = Math.max(...squadrons.map(s => s.endsAt)) + ATTACK_DRONE_RULES.chunkFlightMs
        + ATTACK_DRONE_RULES.groundDurationMs + ATTACK_DRONE_RULES.burnDurationMs;
      const messages = () => hostRoom.transport.links[0].sent.filter(e => e.message.t === 'rpc' && e.message.n === 'fcfx');
      let maxBytes = 0, maxEvents = 0, frames = 0;
      const began = performance.now();
      // Includes repeated timestamps and long frames: scheduled damage must neither duplicate nor disappear.
      const deltas = [16, 33, 50, 117, 0];
      for (let at = START; at <= end + 117; at += deltas[frames++ % deltas.length]) {
        const before = messages().length;
        h.advance(at);
        bridge.flushEffects();
        const sent = messages().length - before;
        maxEvents = Math.max(maxEvents, sent);
        expect(sent).toBeLessThanOrEqual(1);
        const snapshot = h.bomber.runtime.getSnapshot(), wire = encodeBomberSquadronSnapshot(snapshot);
        for (const s of snapshot.squadrons) s.anchors.forEach((anchor, drone) => {
          if (anchor) for (const bomb of bomberDrops(s, drone, anchor)) {
            plans.set(bomberSquadronBombKey(s.id, drone, bomb.pass, bomb.bomb), bomb);
          }
        });
        maxBytes = Math.max(maxBytes, new TextEncoder().encode(JSON.stringify(wire)).byteLength);
        expect(decodeBomberSquadronSnapshot(wire)?.squadrons.length).toBe(snapshot.squadrons.length);
      }
      const bombs = h.explode.mock.calls.filter(c => c[5] === 'BOMBER_SQUADRON');
      const landings = h.explode.mock.calls.filter(c => c[5] === 'BOMBER_SQUADRON.chunk');
      expect(plans.size).toBe(expectedBombs);
      expect(bombs).toHaveLength(expectedBombs);
      expect(h.chunks).toHaveBeenCalledTimes(expectedBombs);
      expect(landings).toHaveLength(expectedChunks);
      const actualKeys = h.chunks.mock.calls.map(c => c[4]);
      expect(new Set(actualKeys).size).toBe(expectedBombs);
      expect([...actualKeys].sort()).toEqual([...plans.keys()].sort());
      expect(bombs.map(c => c[6]?.correlation?.executionId).sort()).toEqual([...actualKeys].sort());
      const planned = plans;
      for (const [x, y, , , , , source] of bombs) {
        const bomb = planned.get(source!.correlation!.executionId!)!;
        expect({ x, y }).toEqual({ x: bomb.x, y: bomb.y });
      }
      const landedByBomb = new Map<string, number>();
      for (const [, , , , , , source] of landings) {
        const key = source!.lineage!.parentEffectId!;
        landedByBomb.set(key, (landedByBomb.get(key) ?? 0) + 1);
      }
      for (const key of actualKeys) expect(landedByBomb.get(key)).toBe(config.fireChunksPerBomb);
      for (const [, , , burst] of h.chunks.mock.calls) expect(burst.count).toBe(config.fireChunksPerBomb);
      expect(h.chunkFx.mock.calls.reduce((sum, c) => sum + c[2].length, 0)).toBe(expectedChunks);
      const delivered = messages().flatMap(e => (e.message as { d: { p: number[] }[] }).d);
      expect(delivered).toHaveLength(expectedBombs);
      expect(delivered.reduce((sum, b) => sum + b.p.length / 3, 0)).toBe(expectedChunks);
      expect(h.explosionBroadcast).not.toHaveBeenCalled();
      expect(h.f.projectile.spawn.mock.calls.length).toBeGreaterThan(0);
      expect(h.events.length).toBeGreaterThan(0);
      expect(h.bomber.runtime.getSnapshot().squadrons).toEqual([]);
      // Includes replicated aim and flight parameters, independent of bomb count.
      // Same 3 KiB cap as network integration (60 KiB/s at 20 Hz).
      expect(maxBytes).toBeLessThan(3 * 1024);
      expect(maxEvents).toBe(1);
      console.info('BOMBER_SQUADRON_STRESS ' + JSON.stringify({ bombs: bombs.length, chunks: landings.length,
        bqBytes: maxBytes, maxFcfxPerFrame: maxEvents, fcfxEvents: messages().length,
        ordinaryShots: h.f.projectile.spawn.mock.calls.length, elapsedMs: Math.round(performance.now() - began) }));
    } finally { h.destroy(); clearActiveSession(); client.room.destroy(); hostRoom.room.destroy(); }
  }, 20000);
});
