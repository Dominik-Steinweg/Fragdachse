import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Geom: { Rectangle: class { x = 0; y = 0; width = 0; height = 0; }, Line: class {} },
  Math: { FloatBetween: (a: number, b: number) => (a + b) / 2,
    Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) },
}));
import { createProjectileRuntimeTestWorld } from '../ProjectileRuntimeTestHelper';
import { createSingleOwnerProvenance } from '../../src/projectile/ProjectileSpawnRequest';
import { decodeProjectileDynamics, encodeProjectileDynamic, applyProjectileSnapshot } from '../../src/network/projectileSnapshotCodec';
import { encodePeerMessage } from '../../src/network/peer/protocol';
import { compressPeerPayload, encodePeerBytes, makePeerPacket, PeerPacketAssembler, decodePeerPayload,
  PEER_PACKET_BYTES, PEER_PACKET_HEADER_BYTES } from '../../src/network/peer/PeerPacketCodec';
import { ProjectileClientReplica } from '../../src/projectile/ProjectileClientReplica';
import type { SyncedProjectileDynamic, SyncedProjectileStatic } from '../../src/types';
import { NET_TICK_INTERVAL_MS } from '../../src/config';
import weapons from '../../src/loadout/content/data/weapons-ballistic.json';
import utilities from '../../src/loadout/content/data/utilities-tactical.json';
import { TimeBubbleSystem } from '../../src/systems/TimeBubbleSystem';

const p90 = weapons.weapons.P90;
const bubble = utilities.utilities.TIME_BUBBLE;
const epoch = 1_800_000_000_000;
const duration = 12_000;

/** Actual runtime/adapter/codec, with a headless Arcade boundary. Positions are advanced with
 * physics delta; observation timestamps use the integer host clock, as in the browser.
 * Scene consumes the preceding postUpdate position; catch-up steps share a wall timestamp.
 * A maintained bubble corridor uses the authored radius/factor (renewed duration for soak).
 * No resources/reload bottleneck: this deliberately exercises uninterrupted trigger fire. */
async function runLoad(players: number, slowed: boolean, jitter: boolean, variablePhysics = false) {
  const { runtime, physics, setHostNowMs } = createProjectileRuntimeTestWorld(epoch);
  const timeBubbles = new TimeBubbleSystem();
  // Additional variable-step cases use the actual circular field and natural expiry;
  // the fixed-step baseline keeps the maintained diameter corridor used before the change.
  runtime.setProjectileTimeFieldPort({ getMovementFactor: (x, y, now) => variablePhysics
    ? timeBubbles.getProjectileMovementFactorAt(x, y, now)
    : slowed && x >= 50 && x < 50 + bubble.bubbleRadius * 2 ? bubble.projectileSlowFactor : 1 });
  const nextShots = Array.from({ length: players }, (_, i) => i * p90.cooldown / players);
  const positions = new Map<number, { x: number; y: number }>();
  let frameTime = 0, physicsDebt = 0, nextNet = 0, frame = 0, count = 0;
  let stepIndex = 0, nextBubble = 0;
  let totalBytes = 0, peakBytes = 0, pathBytes = 0, endedBytes = 0, points = 0, paths = 0, peakActive = 0;
  let legacyTotal = 0, legacyPeak = 0, legacyPaths = 0, legacyEnds = 0;
  let wireTotal = 0, wirePeak = 0, recovered = 0, dropped = 0;
  const compressionMs: number[] = [], inflateMs: number[] = [];
  const assembler = new PeerPacketAssembler(false), client = new ProjectileClientReplica();
  const statics = new Map<number, SyncedProjectileStatic>();
  const cpuStart = process.cpuUsage();
  const stageMs: number[] = [], encodeMs: number[] = [], decodeMs: number[] = [];
  while (frameTime < duration) {
    const dt = jitter ? [7, 11, 29, 5, 41, 13, 9, 19][frame++ % 8] : 1000 / 60;
    frameTime += dt;
    const now = epoch + Math.floor(frameTime);
    setHostNowMs(now);
    if (variablePhysics && slowed) {
      timeBubbles.hostUpdate(now);
      if (frameTime >= nextBubble && frameTime < duration - 1000) {
        nextBubble += bubble.bubbleDuration;
        for (let owner = 0; owner < players; owner++) timeBubbles.hostCreateBubble(`player-${owner}`,
          50 + bubble.bubbleRadius, owner * 100, { type: 'time_bubble', radius: bubble.bubbleRadius,
            duration: bubble.bubbleDuration, projectileSlowFactor: bubble.projectileSlowFactor,
            playerSlowFactor: bubble.playerSlowFactor, trainSlowFactor: bubble.trainSlowFactor }, now);
      }
    }
    physicsDebt += dt;
    // Arcade worldstep precedes Scene.update and sprite postUpdate.
    for (;;) {
      const physicsMs = variablePhysics ? [1000 / 120, 1000 / 45, 1000 / 90, 1000 / 60][stepIndex % 4] : 1000 / 60;
      if (physicsDebt < physicsMs) break;
      physicsDebt -= physicsMs; stepIndex++;
      for (const [id, handle] of physics.handles) {
        if (!handle.sprite.active) continue;
        const p = positions.get(id)!;
        p.x += variablePhysics ? handle.body.velocity.x * physicsMs / 1000 : handle.body.velocity.x / 60;
        p.y += variablePhysics ? handle.body.velocity.y * physicsMs / 1000 : handle.body.velocity.y / 60;
        physics.observe(id, p.x, p.y, handle.body.velocity.x, handle.body.velocity.y);
      }
    }
    const start = performance.now();
    runtime.runHostProjectileStage(dt, now);
    stageMs.push(performance.now() - start);
    for (let owner = 0; owner < players; owner++) {
      if (frameTime >= nextShots[owner] && frameTime < duration - 1000) {
        nextShots[owner] += p90.cooldown;
        const angle = ((count++ * 0.61803398875) % 1 - 0.5) * 0.15;
        const id = runtime.spawnProjectile({ origin: { x: 0, y: owner * 100, angle },
          flight: { speed: p90.fire.projectileSpeed, size: p90.fire.projectileSize,
            lifetimeMs: p90.range / p90.fire.projectileSpeed * 1000,
            remainingRangePx: p90.range, maxBounces: p90.fire.projectileMaxBounces, isGrenade: false },
          provenance: createSingleOwnerProvenance(`player-${owner}`),
          interaction: { directHit: { damage: p90.damage } },
          presentation: { color: 0xd7b06b, style: 'bullet', bulletVisualPreset: 'p90',
            tracer: { profile: 'automatic' }, shotAudioKey: 'shot_p90' },
        })!;
        positions.set(id, { x: 0, y: owner * 100 });
      }
    }
    peakActive = Math.max(peakActive, runtime.activeCount);
    if (frameTime >= nextNet) {
      nextNet += NET_TICK_INTERVAL_MS;
      const encodeStart = performance.now();
      const snapshot = runtime.getNetSnapshot();
      const payload = encodePeerMessage({ t: 'b', q: nextNet, g: [['gs', { j: snapshot }]] });
      encodeMs.push(performance.now() - encodeStart);
      const bytes = new TextEncoder().encode(payload).length;
      totalBytes += bytes; peakBytes = Math.max(peakBytes, bytes);
      const decodeStart = performance.now();
      const decoded = snapshot ? decodeProjectileDynamics([...snapshot.u, ...(snapshot.e ?? [])]) : [];
      decodeMs.push(performance.now() - decodeStart);
      for (const p of decoded) if (p.flightPath) { points += p.flightPath.points.length; paths++; }
      // Isolate actual encoded path contribution without a second approximate object schema.
      if (snapshot) {
        const noPaths: (number | string)[] = [];
        for (const p of decodeProjectileDynamics(snapshot.u)) encodeProjectileDynamic(noPaths, { ...p, flightPath: undefined });
        pathBytes += JSON.stringify(snapshot.u).length - JSON.stringify(noPaths).length;
        endedBytes += JSON.stringify(snapshot.e ?? []).length;
      }
      const legacy = snapshot ? { ...snapshot,
        u: legacyDynamics(decoded.filter(p => !p.flightPath?.ended)),
        ...(snapshot.e ? { e: legacyDynamics(decoded.filter(p => p.flightPath?.ended)) } : {}),
      } : null;
      const legacyBytes = JSON.stringify({ t: 'b', q: nextNet, g: [['gs', { j: legacy }]] }).length;
      legacyTotal += legacyBytes; legacyPeak = Math.max(legacyPeak, legacyBytes);
      if (legacy) {
        legacyPaths += JSON.stringify(legacy.u).length - JSON.stringify(legacyDynamics(
          decoded.filter(p => !p.flightPath?.ended).map(p => ({ ...p, flightPath: undefined })))).length;
        legacyEnds += JSON.stringify(legacy.e ?? []).length;
      }
      const compressionStart = performance.now();
      const compressed = await compressPeerPayload(encodePeerBytes(payload));
      compressionMs.push(performance.now() - compressionStart);
      const packets: Uint8Array[] = [];
      for (let offset = 0; offset < compressed.bytes.length;) {
        const packet = makePeerPacket(compressed, nextNet, offset, PEER_PACKET_BYTES);
        expect(packet.length).toBeLessThanOrEqual(PEER_PACKET_BYTES);
        packets.push(packet); offset += packet.length - PEER_PACKET_HEADER_BYTES;
      }
      const wireBytes = packets.reduce((sum, p) => sum + p.length, 0);
      wireTotal += wireBytes; wirePeak = Math.max(wirePeak, wireBytes);
      // Drop whole updates/one fragment in a burst; reorder and duplicate all other packets.
      // A previous incomplete message must never apply a partial active list or baseline.
      const lose = nextNet / NET_TICK_INTERVAL_MS % 11 < 3;
      if (lose) dropped++;
      const delivered = lose ? packets.slice(1) : packets;
      for (const packet of delivered.reverse()) {
        const result = assembler.accept(packet, frameTime);
        expect(assembler.accept(packet, frameTime)).toBeNull();
        if (!result) continue;
        recovered++;
        const inflateStart = performance.now();
        expect(await decodePeerPayload(result)).toBe(payload);
        inflateMs.push(performance.now() - inflateStart);
        const state = client.sync(applyProjectileSnapshot(statics, snapshot ?? undefined), frameTime);
        expect(state.projectiles.filter(p => p.flightPath?.ended).every(p => !state.activeIds.has(p.id))).toBe(true);
      }
    }
    for (const [id, handle] of physics.handles) {
      if (!handle.sprite.active) { positions.delete(id); physics.handles.delete(id); continue; }
      const p = positions.get(id)!;
      handle.sprite.x = p.x; handle.sprite.y = p.y;
    }
  }
  runtime.destroy();
  timeBubbles.destroyAll();
  expect(recovered).toBeGreaterThan(100); expect(dropped).toBeGreaterThan(20);
  const cpu = process.cpuUsage(cpuStart);
  const p95 = (values: number[]) => +values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)].toFixed(3);
  return { players, bubble: slowed, jitter, variablePhysics, peakActive, peakBytes,
    bytesPerSecond: Math.round(totalBytes / (frameTime / 1000)),
    activePathPercent: +(pathBytes / totalBytes * 100).toFixed(1), endedPercent: +(endedBytes / totalBytes * 100).toFixed(1),
    pointsPerPath: +(points / paths).toFixed(2), legacyPeak, legacyBytesPerSecond: Math.round(legacyTotal / (frameTime / 1000)),
    legacyActivePathPercent: +(legacyPaths / legacyTotal * 100).toFixed(1),
    legacyEndedPercent: +(legacyEnds / legacyTotal * 100).toFixed(1),
    wirePeak, wireBytesPerSecond: Math.round(wireTotal / (frameTime / 1000)), savingPercent: +(100 * (1 - wireTotal / legacyTotal)).toFixed(1),
    stageP95Ms: p95(stageMs), encodeP95Ms: p95(encodeMs), decodeP95Ms: p95(decodeMs),
    deflateP95Ms: p95(compressionMs), inflateP95Ms: p95(inflateMs), scenarioCpuMs: Math.round((cpu.user + cpu.system) / 1000) };
}

/** Pre-change wire layout for the same measured P90 records. This small benchmark reference
 * protects the comparison from different spawn counts, tuning or simulation trajectories. */
function legacyDynamics(entries: SyncedProjectileDynamic[]): (number | string)[] {
  const out: (number | string)[] = [];
  for (const p of entries) {
    const path = p.flightPath;
    out.push(p.id, path ? 16 : 0, p.x, p.y, p.vx, p.vy, p.size);
    if (path) {
      out.push(path.timeMs, path.ended ? 1 : 0, path.points.length);
      for (const point of path.points) out.push(point.sequence, point.timeMs, point.x, point.y,
        point.vx, point.vy, point.breakBefore ? 1 : 0, point.bounceSequence ?? 0);
    }
  }
  return out;
}

describe('projectile replication sustained P90 load', () => {
  it('measures authored P90 fire, accumulated TimeBubble shots and frame/physics jitter', async () => {
    const results = [];
    for (const players of [1, 4]) for (const slowed of [false, true]) for (const mode of ['fixed', 'jitter', 'variable'] as const) {
      const result = await runLoad(players, slowed, mode !== 'fixed', mode === 'variable');
      expect(result.peakActive).toBeGreaterThan(0);
      expect(result.savingPercent).toBeGreaterThan(60);
      results.push(result);
    }
    console.table(results);
    if (process.env.PROJECTILE_REPLICATION_REPORT) console.info('PROJECTILE_REPLICATION_REPORT='
      + JSON.stringify({ node: process.version, durationMs: duration, results }));
  }, 120_000);
});
