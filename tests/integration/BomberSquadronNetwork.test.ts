import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { EMPTY_BOMBER_SQUADRON_SNAPSHOT, type BomberSquadronSnapshot, type BomberSquadronPlanParams } from '../../src/systems/bomberSquadron/BomberSquadronSnapshot';
import { encodeBomberSquadronSnapshot, decodeBomberSquadronSnapshot } from '../../src/network/bomberSquadronSnapshotCodec';
import { FULL_GAME_STATE_SLICE_KEYS, isCompleteGameStatePayload } from '../../src/network/FullGameStateBootstrap';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
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

// Frozen full-upgrade GDD plan fixture: authored ultimate content belongs to Lane A.
// All generated counts derive from this config, independently of current balance tuning.
const plan: BomberSquadronPlanParams = {
  droneCount: 14, bombsPerPass: 9, passCount: 2, launchIntervalMs: 250, approachMs: 600,
  approachDistancePx: 240, runSpeedPxPerSec: 400, corridorLeadPx: 48, corridorLengthPx: 640,
  corridorWidthPx: 560, turnMs: 1000, departureMs: 600, bombFallMs: 250, explosionRadius: 72,
};
const owners = ['inspector', 'p2', 'p3', 'p4'];
function snapshot(): BomberSquadronSnapshot {
  return { squadrons: [{ id: 1, ownerId: owners[0], ownerColor: 0xffffff,
    startedAt: 1000.125, endsAt: 9300.875, angle: 0.333, params: { ...plan },
    anchors: Array.from({ length: plan.droneCount }, (_, i) => i === 0 ? { x: -200.1, y: 300.2 } : null),
    stoppedAt: null }] };
}

describe('bomber squadron codec', () => {
  it('round-trips frozen plan values, optional stop and unquantized host times', () => {
    const facts = snapshot();
    expect(decodeBomberSquadronSnapshot(encodeBomberSquadronSnapshot(facts))).toEqual(facts);
    const input = { squadrons: [{ ...facts.squadrons[0], angle: -0.123456, stoppedAt: 2000.456,
      anchors: facts.squadrons[0].anchors.map(a => a && { x: -2.345, y: 12.789 }) }] };
    const result = decodeBomberSquadronSnapshot(encodeBomberSquadronSnapshot(input))!;
    expect(result.squadrons[0]).toMatchObject({ angle: -0.123, stoppedAt: input.squadrons[0].stoppedAt,
      startedAt: input.squadrons[0].startedAt, endsAt: input.squadrons[0].endsAt, params: plan });
    expect(result.squadrons[0].anchors[0]).toEqual({ x: -2.3, y: 12.8 });
  });

  it('rejects any malformed row atomically, including duplicate ids and unsafe plan expansion', () => {
    const valid = encodeBomberSquadronSnapshot(snapshot());
    const corruptions: ((rows: any[]) => void)[] = [
      r => r.push(r[0]), r => { r[0][0] = -1; }, r => { r[0][1] = ''; },
      r => { r[0][2] = 0x1000000; }, r => { r[0][3] = NaN; }, r => { r[0][4] = 0; },
      r => { r[0][5] = 0.3; }, r => { r[0][6][0] = 65; }, r => { r[0][6][0] = 0; },
      r => { r[0][6][1] = 65; }, r => { r[0][6][1] = 0.5; }, r => { r[0][6][2] = 3; },
      r => { r[0][6][3] = -1; }, r => { r[0][6][4] = 60_001; },
      r => { r[0][6][5] = Infinity; }, r => { r[0][6][6] = 0; },
      r => { r[0][6][8] = 0; }, r => { r[0][6].pop(); }, r => { r[0][7].pop(); },
      r => { r[0][7][0] = [0, 0.1]; }, r => { r[0][7][0] = [0, Infinity]; },
      r => { r[0][7][0] = [0, 0, 0]; }, r => { r[0][7][0] = null; },
      r => { r[0][8] = 0; }, r => { r[0][8] = Infinity; }, r => { r[0][8] = null; },
      r => { r[0].push(2000, 3000); },
    ];
    for (const corrupt of corruptions) {
      const rows = structuredClone(valid); corrupt(rows);
      // Even a preceding valid squadron must not survive a bad row.
      expect(decodeBomberSquadronSnapshot([...valid.map(r => [99, ...r.slice(1)]), ...rows])).toBeNull();
    }
    for (const raw of [null, undefined, {}, 'bq', [0], Array(65).fill(valid[0])]) {
      expect(decodeBomberSquadronSnapshot(raw)).toBeNull();
    }
  });

  it('retains identities only for unchanged wire facts and owns its cache independently of the input', () => {
    const raw = encodeBomberSquadronSnapshot(snapshot());
    const first = decodeBomberSquadronSnapshot(raw)!;
    expect(decodeBomberSquadronSnapshot(structuredClone(raw), first)).toBe(first);
    raw[0][7][1] = [1234, 5678];
    const changed = decodeBomberSquadronSnapshot(raw, first)!;
    expect(changed).not.toBe(first);
    expect(first.squadrons[0].anchors[1]).toBeNull();
    expect(changed.squadrons[0].anchors[1]).toEqual({ x: 123.4, y: 567.8 });
    expect(decodeBomberSquadronSnapshot([], changed)).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
  });

  it('keeps four full squadrons below 2 KiB of JSON without per-bomb data', () => {
    const facts = { squadrons: owners.map((ownerId, i) => ({ ...snapshot().squadrons[0], id: i + 1,
      ownerId, startedAt: 1_000_000.125, endsAt: 1_009_000.875, stoppedAt: 1_004_000.5,
      anchors: Array.from({ length: plan.droneCount }, (_, drone) => ({ x: 4000 + drone * 17.1, y: -3000.2 })) })) };
    const wire = encodeBomberSquadronSnapshot(facts);
    // 512 bytes per owner allows frozen parameters and 14 anchors, independent of the
    // droneCount * bombsPerPass * passCount impacts. At 20 Hz this caps bq at 40 KiB/s.
    expect(new TextEncoder().encode(JSON.stringify(wire)).byteLength).toBeLessThan(2 * 1024);
    expect(decodeBomberSquadronSnapshot(wire)?.squadrons).toHaveLength(owners.length);
  });
});

describe('bomber squadron world replication', () => {
  it('requires bq in a full bootstrap, including an empty one', async () => {
    expect(FULL_GAME_STATE_SLICE_KEYS).toContain('bq');
    const raw = { ...Object.fromEntries(FULL_GAME_STATE_SLICE_KEYS.map(k => [k, []])), _full: true };
    expect(isCompleteGameStatePayload(raw)).toBe(true);
    delete (raw as Record<string, unknown>).bq;
    expect(isCompleteGameStatePayload(raw)).toBe(false);
    const f = await fixture();
    try {
      f.publish(f.state, true);
      expect(f.hostRoom.room.getGlobal('gsi')).toHaveProperty('bq', []);
      expect(f.client.bridge.getBomberSquadronSnapshot()).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
      expect((await f.join()).bridge.getBomberSquadronSnapshot()).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
    } finally { f.destroy(); }
  });

  it('late joins running plans, caches unchanged facts and heals dropped updates and cleanup', async () => {
    const f = await fixture();
    let facts = snapshot();
    f.host.setBomberSquadronSnapshotProvider(() => facts);
    try {
      f.publish(f.state, true);
      const first = f.client.bridge.getBomberSquadronSnapshot();
      expect(first).toEqual(facts);
      f.client.bridge.flushNetwork();
      f.publish();
      expect(f.client.bridge.getBomberSquadronSnapshot()).toBe(first);
      const late = await f.join();
      expect(late.bridge.getBomberSquadronSnapshot()).toEqual(facts);
      expect(late.bridge.getBomberSquadronSnapshot().squadrons[0].startedAt).toBe(facts.squadrons[0].startedAt);
      f.use(f.client.room); f.client.bridge.flushNetwork();
      const link = f.hostRoom.transport.links[0];
      link.fastReady = false;
      facts = { squadrons: [{ ...facts.squadrons[0], stoppedAt: 1500.5 }] };
      f.publish();
      expect(f.client.bridge.getBomberSquadronSnapshot()).toBe(first);
      link.fastReady = true;
      f.publish();
      expect(f.client.bridge.getBomberSquadronSnapshot()).toEqual(facts);
      f.client.bridge.flushNetwork();
      link.fastReady = false;
      f.host.setBomberSquadronSnapshotProvider(null);
      f.publish();
      expect(f.client.bridge.getBomberSquadronSnapshot().squadrons).toHaveLength(facts.squadrons.length);
      link.fastReady = true;
      f.publish();
      expect(f.client.bridge.getBomberSquadronSnapshot()).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
      f.changeWorld();
      for (const peer of [f.client, late]) {
        f.use(peer.room);
        expect(peer.bridge.getBomberSquadronSnapshot()).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
      }
    } finally { f.destroy(); }
  });

  it('retains the last valid slice on malformed or absent deltas and rejects incomplete late-join baselines', async () => {
    const f = await fixture();
    f.host.setBomberSquadronSnapshotProvider(snapshot);
    try {
      f.publish(f.state, true);
      const first = f.client.bridge.getBomberSquadronSnapshot();
      f.client.bridge.flushNetwork();
      const baseline = f.hostRoom.room.getGlobal('gsi') as Record<string, unknown>;
      let sequence = 100;
      for (const raw of [null, [[0]], undefined]) {
        const delta = { ...baseline, _full: false, _s: sequence++, bq: raw };
        if (raw === undefined) delete (delta as Record<string, unknown>).bq;
        f.use(f.hostRoom); f.hostRoom.room.setGlobal('gs', delta); f.hostRoom.room.update(); f.use(f.client.room);
        expect(f.client.bridge.getBomberSquadronSnapshot()).toBe(first);
      }
      const missing = { ...baseline }; delete missing.bq;
      f.use(f.hostRoom); f.hostRoom.room.setGlobal('gsi', missing, true);
      f.hostRoom.room.setGlobal('gs', missing); f.hostRoom.room.update();
      expect((await f.join()).bridge.getLatestGameState()).toBeUndefined();
    } finally { f.destroy(); }
  });
});

describe('fire chunk frame batches', () => {
  it('sends one event per frame and delivers every burst in order, including on the host', async () => {
    const f = await fixture();
    const received: unknown[][] = [], local: unknown[][] = [];
    try {
      f.use(f.client.room); f.client.bridge.registerFireChunkEffectHandler((...args) => received.push(args));
      f.use(f.hostRoom); f.host.registerFireChunkEffectHandler((...args) => local.push(args));
      const bursts = Array.from({ length: plan.bombsPerPass }, (_, i) => [i, -i - 1,
        [{ x: i + 1, y: i + 2, landsAt: 2000.75 }], 1000.125, 'normal'] as const);
      const events = () => f.hostRoom.transport.links[0].sent.filter(e => e.message.t === 'rpc' && e.message.n === 'fcfx');
      for (const b of bursts) f.host.broadcastFireChunkEffect(...b);
      expect(events()).toHaveLength(0);
      f.host.flushEffects();
      expect(events()).toHaveLength(1);
      expect(received).toEqual(bursts);
      expect(local).toEqual(bursts);
      f.host.flushEffects();
      expect(events()).toHaveLength(1);
      f.host.broadcastFireChunkEffect(...bursts[0]);
      f.host.flushEffects();
      expect(received).toEqual([...bursts, bursts[0]]);
    } finally { f.destroy(); }
  });

  it('validates each burst independently and rejects stale world revisions', async () => {
    const f = await fixture();
    const received: unknown[][] = [];
    try {
      f.client.bridge.registerFireChunkEffectHandler((...args) => received.push(args));
      const valid = { wr: f.world.worldRevision, x: 1, y: 2, t: 1000.125, p: [3, 4, 2000.75] };
      f.use(f.hostRoom);
      f.hostRoom.room.broadcast('fcfx', [valid, null, { ...valid, p: [3, 4] },
        { ...valid, p: [3, 4, 999] }, { ...valid, x: Infinity }, { ...valid, wr: 99 }, { ...valid, x: 5 }]);
      expect(received).toEqual([
        [1, 2, [{ x: 3, y: 4, landsAt: 2000.75 }], 1000.125, 'normal'],
        [5, 2, [{ x: 3, y: 4, landsAt: 2000.75 }], 1000.125, 'normal'],
      ]);
    } finally { f.destroy(); }
  });

  it.each(['change', 'clear'] as const)('flushes pending old-world bursts before world %s without leaking them into a later frame', async action => {
    const f = await fixture();
    const received: unknown[][] = [];
    try {
      f.client.bridge.registerFireChunkEffectHandler((...args) => received.push(args));
      f.use(f.hostRoom);
      f.host.broadcastFireChunkEffect(1, 2, [{ x: 3, y: 4, landsAt: 2000 }], 1000);
      if (action === 'change') f.changeWorld(); else f.host.clearWorldAndActivity();
      expect(received).toEqual([[1, 2, [{ x: 3, y: 4, landsAt: 2000 }], 1000, 'normal']]);
      f.host.flushEffects();
      expect(received).toHaveLength(1);
    } finally { f.destroy(); }
  });
});
