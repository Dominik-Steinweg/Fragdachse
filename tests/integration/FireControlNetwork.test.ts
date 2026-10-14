import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { EMPTY_FIRE_CONTROL_SNAPSHOT, fireControlHoloSourceId, type FireControlHoloDeploymentSnapshot, type FireControlSnapshot } from '../../src/systems/fireControl/FireControlSnapshot';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../../src/utils/coopDefenseUpgrades';
import { encodeFireControlSnapshot, decodeFireControlSnapshot } from '../../src/network/fireControlSnapshotCodec';
import { FULL_GAME_STATE_SLICE_KEYS, isCompleteGameStatePayload } from '../../src/network/FullGameStateBootstrap';
import { encodeProjectileStatic, encodeProjectileDynamic } from '../../src/network/projectileSnapshotCodec';
import { ProjectileClientReplica } from '../../src/projectile/ProjectileClientReplica';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

/** Real bridge/room/bootstrap composition from TimeBubbleNetwork; no fabricated fc wire API. */
async function fixture() {
  const network = new FakeNetwork();
  const rooms: TestRoom[] = [];
  // FakeTransport implements message delivery; native WebRTC diagnostic fields are not used here.
  const use = (room: TestRoom) => setActiveSession({ room: room.room,
    transport: room.transport as unknown as Parameters<typeof setActiveSession>[0]['transport'], roomCode: 'FIRE-CONTROL' });
  const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
  const destroy = () => { clearActiveSession(); for (const room of [...rooms].reverse()) room.room.destroy(); };
  try {
    const hostRoom = await createHostRoom(network); rooms.push(hostRoom);
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1,
      generatorVersion: 3, layoutFingerprint: 'fire-control-test' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const join = async () => {
      const room = await addClientRoom(network); rooms.push(room);
      return { room, bridge: connect(room) };
    };
    const client = await join();
    const state: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], mortarStrikes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    return { host, hostRoom, client, state, world, join, use, destroy,
      publish(next = state, full = false) {
        use(hostRoom); host.publishGameState(next, full); hostRoom.room.update(); use(client.room);
      },
      changeWorld() { use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: world.worldRevision + 1 }, null); },
    };
  } catch (error) { destroy(); throw error; }
}

// Synthetic snapshot facts, not authored tuning. Mutable replacement objects allow delta cases.
function snapshot(): FireControlSnapshot {
  return { deployments: [
    { id: 1, kind: 'copies', ownerId: 'inspector', ownerColor: 0xffffff, x: 300, y: 100,
      startedAt: 1000, expiresAt: 9000, parallel: false, copies: [
        { sourceId: 'fc-copy:1:0', originalId: 7, constructionId: 'machine_gun_turret', weaponId: 'TURRET_MG',
          x: 300, y: 100, angle: 0.3, status: 'materializing', materializedAt: 1400, originalPaused: true },
      ] },
    { id: 2, kind: 'portal', ownerId: 'inspector', ownerColor: 0xffffff, x: 700, y: 100,
      startedAt: 1100, expiresAt: 6000, localFireRelease: true, entries: [
        { sourceId: 8, identityId: 8, mode: 'portal', x: 20, y: 0, angle: 0.3, lastTransportAt: 1200 },
      ] },
    holo(),
  ] };
}

// Synthetic full-upgrade GDD config; authored ultimate content is supplied separately by Lane A.
const holoConfig = { copyLifetimeMs: 9000, materializeMs: 400, spawnIntervalMs: 600 };
function holo(id = 3): FireControlHoloDeploymentSnapshot {
  return { id, kind: 'holo', ownerId: 'inspector', ownerColor: 0xffffff, x: 300, y: 100,
    startedAt: 1000.125, expiresAt: 19000.125, spawnUntil: 11000.125,
    copyLifetimeMs: holoConfig.copyLifetimeMs, materializeMs: holoConfig.materializeMs,
    copies: [{ seq: 0, sourceId: fireControlHoloSourceId(id, 0), weaponId: 'TURRET_MG',
      x: -300.1, y: 100.2, angle: -0.123, spawnedAt: 1000.125 }] };
}

describe('Ausführbarer Netzwerk-Fixture-Baustein', () => {
  it('Arrange: Host und Client in einer World; Act: Full-State publizieren, spät beitreten und World wechseln; Assert: beide Empfänger erhalten Bootstrap und verwerfen alten World-State', async () => {
    const f = await fixture();
    try {
      f.publish(f.state, true);
      expect(f.client.bridge.getLatestGameState()?.roundStartTime).toBe(f.state.roundStartTime);
      f.client.bridge.flushNetwork();
      const late = await f.join();
      expect(late.bridge.getLatestGameState()?.roundStartTime).toBe(f.state.roundStartTime);
      f.changeWorld();
      f.use(f.client.room); expect(f.client.bridge.getLatestGameState()).toBeUndefined();
      f.use(late.room); expect(late.bridge.getLatestGameState()).toBeUndefined();
    } finally { f.destroy(); }
  });
});


describe('fire-control world replication', () => {
  it('round-trips kind 2 alone and alongside relays and portals without changing identities or host times', () => {
    for (const input of [{ deployments: [holo()] }, snapshot()]) {
      const raw = encodeFireControlSnapshot(input);
      const decoded = decodeFireControlSnapshot(raw)!;
      expect(decoded).toEqual(input);
      expect(decodeFireControlSnapshot(structuredClone(raw), decoded)).toBe(decoded);
      const deployment = decoded.deployments.find(d => d.kind === 'holo')!;
      expect(deployment.copies[0].sourceId).toBe(fireControlHoloSourceId(deployment.id, deployment.copies[0].seq));
    }
    const input = holo();
    const quantized = decodeFireControlSnapshot(encodeFireControlSnapshot({ deployments: [{ ...input,
      copies: input.copies.map(c => ({ ...c, x: -2.345, y: 12.789, angle: -0.123456 })) }] }))!;
    expect(quantized.deployments[0]).toMatchObject({ copies: [{ x: -2.3, y: 12.8, angle: -0.123,
      spawnedAt: input.copies[0].spawnedAt }] });
  });

  it('rejects invalid Holo rows atomically within a mixed slice', () => {
    const corruptions: ((d: any[]) => void)[] = [
      d => { d[8] = 1; }, d => { d[10] = -1; }, d => { d[11] = NaN; },
      d => { d[12] = d[6] - 1; }, d => { d[12] = Infinity; }, d => { d.pop(); },
      d => { d[9][0][0] = -1; }, d => { d[9][0][0] = 0.5; }, d => { d[9][0][1] = ''; },
      d => { d[9][0][2] = Infinity; }, d => { d[9][0][3] = 0.1; },
      d => { d[9][0][4] = NaN; }, d => { d[9][0][5] = -1; },
      d => { d[9][0].push(0); }, d => { d[9].push(d[9][0]); },
    ];
    for (const corrupt of corruptions) {
      const raw = encodeFireControlSnapshot(snapshot());
      corrupt(raw.find(d => d[0] === 2)!);
      expect(decodeFireControlSnapshot(raw)).toBeNull();
    }
  });

  it('budgets 60 Holo and 12 relay copies below 6 KiB per full fc slice', () => {
    const owners = ['inspector', 'p2', 'p3', 'p4'];
    const relay = snapshot().deployments[0];
    if (relay.kind !== 'copies') throw Error('Expected relay');
    const relayCount = 1 + COOP_DEFENSE_UPGRADE_DEFINITIONS.fire_control_relay_connections.maxLevel;
    const holoCount = Math.ceil(holoConfig.copyLifetimeMs / holoConfig.spawnIntervalMs);
    const facts: FireControlSnapshot = { deployments: owners.flatMap((ownerId, i) => {
      const h = holo(i * 2 + 1);
      return [{ ...h, ownerId, copies: Array.from({ length: holoCount }, (_, seq) => ({ ...h.copies[0], seq,
        sourceId: fireControlHoloSourceId(h.id, seq), spawnedAt: h.startedAt + seq * holoConfig.spawnIntervalMs })) },
      { ...relay, id: i * 2 + 2, ownerId, copies: Array.from({ length: relayCount }, (_, seq) => ({ ...relay.copies[0],
        sourceId: `fc-copy:${i * 2 + 2}:${seq}`, originalId: seq })) }];
    }) };
    const wire = encodeFireControlSnapshot(facts);
    // 6 KiB bounds the every-tick slice (120 KiB/s at 20 Hz), with headroom for IDs and
    // fractional host timestamps. Compact Holo rows must not repeat deployment metadata.
    expect(new TextEncoder().encode(JSON.stringify(wire)).byteLength).toBeLessThan(6 * 1024);
    expect(decodeFireControlSnapshot(wire)).toEqual(facts);
  });

  it('round-trips both deployment kinds and all modes with exact host times and quantized poses', () => {
    const facts = snapshot();
    const portal = facts.deployments[1];
    if (portal.kind !== 'portal') throw new Error('Expected portal');
    const input: FireControlSnapshot = { deployments: [facts.deployments[0], { ...portal,
      x: -100.123, entries: ['portal', 'waiting', 'local'].map((mode, i) => ({
        sourceId: i === 0 ? 'fc-copy:1:0' : i, identityId: 7, mode: mode as 'portal' | 'waiting' | 'local',
        x: -2.345, y: 12.789, angle: -0.123456, ...(i === 0 ? { lastTransportAt: 1234.567 } : {}),
      })) }] };
    const decoded = decodeFireControlSnapshot(encodeFireControlSnapshot(input))!;
    expect(decoded.deployments[0]).toEqual(input.deployments[0]);
    const result = decoded.deployments[1];
    if (result.kind !== 'portal') throw new Error('Expected portal');
    expect(result).toMatchObject({ startedAt: portal.startedAt, expiresAt: portal.expiresAt, x: -100.1 });
    expect(result.entries.map(e => e.mode)).toEqual(['portal', 'waiting', 'local']);
    expect(result.entries[0]).toMatchObject({ sourceId: 'fc-copy:1:0', x: -2.3, y: 12.8, angle: -0.123, lastTransportAt: 1234.567 });
    expect(result.entries[1]).not.toHaveProperty('lastTransportAt');
    expect(decodeFireControlSnapshot(encodeFireControlSnapshot(input), decoded)).toBe(decoded);
  });

  it('rejects malformed or ambiguous slices atomically', () => {
    const valid = encodeFireControlSnapshot(snapshot());
    const corruptions: ((rows: any[]) => void)[] = [
      rows => { rows[0][0] = 2; }, rows => { rows[0][1] = -1; },
      rows => { rows[0][2] = ''; }, rows => { rows[0][3] = 0x1000000; },
      rows => { rows[0][4] = Infinity; }, rows => { rows[0][5] = 0.1; },
      rows => { rows[0][6] = NaN; }, rows => { rows[0][7] = 0; },
      rows => { rows[0][8] = true; }, rows => { rows[0][9][0][7] = 2; },
      rows => { rows[0][9][0][8] = -1; }, rows => { rows[0][9][0][9] = 2; },
      rows => { rows[0][9].push(rows[0][9][0]); }, rows => { rows.push(rows[0]); },
      rows => { rows[1][9][0][0] = {}; }, rows => { rows[1][9][0][1] = -1; },
      rows => { rows[1][9][0][2] = 3; }, rows => { rows[1][9][0][6] = Infinity; },
      rows => { rows[1][9].push(rows[1][9][0]); }, rows => { rows[1].pop(); },
    ];
    for (const corrupt of corruptions) {
      const rows = structuredClone(valid); corrupt(rows);
      expect(decodeFireControlSnapshot(rows)).toBeNull();
    }
    for (const invalid of [null, undefined, {}, 'fc']) expect(decodeFireControlSnapshot(invalid)).toBeNull();
    expect(decodeFireControlSnapshot([])).toBe(EMPTY_FIRE_CONTROL_SNAPSHOT);
  });

  it('requires fc even when the full bootstrap has no deployments', async () => {
    expect(FULL_GAME_STATE_SLICE_KEYS).toContain('fc');
    const raw = Object.fromEntries(FULL_GAME_STATE_SLICE_KEYS.map(key => [key, []]));
    expect(isCompleteGameStatePayload({ ...raw, _full: true })).toBe(true);
    delete raw.fc;
    expect(isCompleteGameStatePayload({ ...raw, _full: true })).toBe(false);
    const f = await fixture();
    try {
      f.publish(f.state, true);
      expect(f.client.bridge.getFireControlSnapshot()).toBe(EMPTY_FIRE_CONTROL_SNAPSHOT);
      const late = await f.join();
      expect(late.bridge.getFireControlSnapshot()).toBe(EMPTY_FIRE_CONTROL_SNAPSHOT);
    } finally { f.destroy(); }
  });

  it('replicates confirmed facts, preserves unchanged arrays and bootstraps remaining lifetime', async () => {
    const f = await fixture();
    let facts = snapshot();
    f.host.setFireControlSnapshotProvider(() => facts);
    try {
      f.publish(f.state, true);
      const first = f.client.bridge.getFireControlSnapshot();
      expect(first).toEqual(facts);
      f.client.bridge.flushNetwork();
      facts = structuredClone(facts);
      f.publish();
      expect(f.client.bridge.getFireControlSnapshot()).toBe(first);
      expect(f.client.bridge.getFireControlSnapshot().deployments).toBe(first.deployments);
      const late = await f.join();
      const joined = late.bridge.getFireControlSnapshot();
      expect(joined).toEqual(facts);
      expect(joined.deployments[0].expiresAt - 2000).toBe(7000);
      f.use(f.client.room);
      f.client.bridge.setFireControlSnapshotProvider(() => EMPTY_FIRE_CONTROL_SNAPSHOT);
      f.client.bridge.publishGameState(f.state, true);
      expect(f.client.bridge.getFireControlSnapshot()).toBe(first);
      f.use(f.hostRoom); expect(f.host.getFireControlSnapshot()).toBe(facts);
      f.use(f.client.room); f.client.bridge.flushNetwork();
      const copies = facts.deployments[0];
      const portal = facts.deployments[1];
      if (copies.kind !== 'copies' || portal.kind !== 'portal') throw new Error('Expected both kinds');
      facts = { deployments: [{ ...copies, parallel: true, copies: copies.copies.map(c => ({ ...c, status: 'active', originalPaused: false })) },
        { ...portal, entries: portal.entries.map(e => ({ ...e, mode: 'waiting', angle: 0.6, lastTransportAt: 1500 })) }] };
      f.publish();
      expect(f.client.bridge.getFireControlSnapshot()).toEqual(facts);
      f.client.bridge.flushNetwork();
      facts = { deployments: [{ ...portal, entries: [] }] };
      f.publish(); expect(f.client.bridge.getFireControlSnapshot()).toEqual(facts);
      f.client.bridge.flushNetwork();
      f.host.setFireControlSnapshotProvider(null);
      f.publish(f.state, true);
      expect(f.client.bridge.getFireControlSnapshot()).toBe(EMPTY_FIRE_CONTROL_SNAPSHOT);
      const afterCleanup = await f.join();
      expect(afterCleanup.bridge.getFireControlSnapshot()).toBe(EMPTY_FIRE_CONTROL_SNAPSHOT);
      f.changeWorld();
      for (const c of [f.client, late, afterCleanup]) {
        f.use(c.room); expect(c.bridge.getFireControlSnapshot()).toBe(EMPTY_FIRE_CONTROL_SNAPSHOT);
      }
    } finally { f.destroy(); }
  });
});

describe('fire-control wire boundaries', () => {
  it('rejects invalid facts and stale world packets and requires fc on a late-join baseline', async () => {
    const f = await fixture();
    f.host.setFireControlSnapshotProvider(snapshot);
    try {
      f.publish(f.state, true);
      const first = f.client.bridge.getFireControlSnapshot();
      f.client.bridge.flushNetwork();
      const baseline = f.hostRoom.room.getGlobal('gsi') as Record<string, unknown>;
      const send = (payload: Record<string, unknown>) => {
        f.use(f.hostRoom); f.hostRoom.room.setGlobal('gs', payload); f.hostRoom.room.update(); f.use(f.client.room);
      };
      send({ ...baseline, _full: false, _s: 100, fc: [[0]] });
      expect(f.client.bridge.getFireControlSnapshot()).toBe(first);
      send({ ...baseline, _full: false, _s: 101, fc: null });
      expect(f.client.bridge.getFireControlSnapshot()).toBe(first);
      f.changeWorld();
      send({ ...baseline, _s: 102, _b: 102 });
      expect(f.client.bridge.getFireControlSnapshot()).toBe(EMPTY_FIRE_CONTROL_SNAPSHOT);
      f.host.setFireControlSnapshotProvider(null);
      f.publish(f.state, true);
      const current = f.hostRoom.room.getGlobal('gsi') as Record<string, unknown>;
      const missing = { ...current }; delete missing.fc;
      f.use(f.hostRoom); f.hostRoom.room.setGlobal('gsi', missing, true);
      f.hostRoom.room.setGlobal('gs', missing); f.hostRoom.room.update();
      const late = await f.join();
      expect(late.bridge.getLatestGameState()).toBeUndefined();
    } finally { f.destroy(); }
  });

  it('carries original identity, firing sprite and separate flame streams through room, codec and replica', async () => {
    const f = await fixture();
    try {
      const s: (string | number)[] = [], u: (string | number)[] = [];
      for (const [index, turretVisualId] of [undefined, 'fc-copy:1:0'].entries()) {
        encodeProjectileStatic(s, { id: index + 1, ownerId: 'inspector', sourceTurretId: '7', turretVisualId,
          style: 'flame', flameStreamKey: turretVisualId ? '7#fc-copy:1:0@fc:2' : '7@fc:2' });
        encodeProjectileDynamic(u, { id: index + 1, x: 700, y: 100, vx: 10, vy: 0, size: 4 });
      }
      f.publish({ ...f.state, projectiles: { f: true, s, u } }, true);
      for (const peer of [f.client, await f.join()]) {
        f.use(peer.room);
        const projectiles = peer.bridge.getLatestGameState()!.projectiles;
        expect(projectiles.map(p => p.sourceTurretId)).toEqual(['7', '7']);
        expect(projectiles.map(p => p.turretVisualId)).toEqual([undefined, 'fc-copy:1:0']);
        expect(new Set(projectiles.map(p => p.flameStreamKey)).size).toBe(2);
        const frame = new ProjectileClientReplica().sync(projectiles, 2000);
        expect(frame.updates.map(update => update.state.turretVisualId)).toEqual([undefined, 'fc-copy:1:0']);
        expect(frame.updates.map(update => update.state.sourceTurretId)).toEqual(['7', '7']);
        expect(new Set(frame.updates.map(update => update.state.flameStreamKey)).size).toBe(2);
      }
    } finally { f.destroy(); }
  });
});
