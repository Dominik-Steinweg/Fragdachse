import { describe, expect, it, vi } from 'vitest';
import { NET_TICK_RATE_HZ } from '../../src/config';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { GroundFireChangeJournal, resolveGroundFireChanges } from '../../src/effects/GroundFireChanges';
import type { SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../../src/types';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

async function setup() {
  const network = new FakeNetwork();
  const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
  const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'FIRE' });
  const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
  const host = connect(hostRoom);
  const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'fire' };
  host.publishLobbySync(); host.publishWorldAndActivity(world, null);
  const client = connect(clientRoom);
  const state: Parameters<NetworkBridge['publishGameState']>[0] = {
    roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
    placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [], remoteControlTurrets: [],
    decoys: [], smokes: [], fires: [], powerups: null, pedestals: null, nukes: [], mortarStrikes: [], airstrikes: [], meteors: [], tunnels: [],
    train: null, bases: [], captureTheBeer: null, coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [],
    energyShields: [], guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
    targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
  };
  const publish = (full = false) => {
    use(clientRoom); client.flushNetwork();
    use(hostRoom); host.publishGameState(state, full); hostRoom.room.update(); use(clientRoom);
    client.getLatestGameState();
  };
  return { network, hostRoom, clientRoom, use, connect, host, world, client, state, publish };
}

/** Wire identity is style and raster cell; host ignition ids and array order stay on the host. */
const replicated = (ground: SyncedBurningGroundSnapshot) => ({
  cells: ground.cells.map(({ gridX, gridY, expiresAt, intensity, visualStyle }) => ({ gridX, gridY, expiresAt, intensity, visualStyle }))
    .sort((left, right) => left.visualStyle.localeCompare(right.visualStyle) || left.gridY - right.gridY || left.gridX - right.gridX),
  warnings: [...ground.warnings ?? []].sort((left, right) => left.gridY - right.gridY || left.gridX - right.gridX
    || left.activatesAt - right.activatesAt),
});

/** The `fg` slice of the host's latest fast game-state batch, if that batch carried one. */
function lastGroundSlice(hostRoom: TestRoom): unknown {
  const sent = hostRoom.transport.links[0].sent;
  for (let index = sent.length - 1; index >= 0; index--) {
    const { message, channel } = sent[index];
    if (channel !== 'fast' || message.t !== 'b') continue;
    const state = message.g?.find(([key]) => key === 'gs');
    if (state) return (state[1] as { fg?: unknown }).fg;
  }
  return undefined;
}

describe('ground hazard and base burn replication', () => {
  it.each([-60_000, 60_000])('expires ground and warnings against host time with client clock offset %i', async offset => {
    const { hostRoom, clientRoom, use, host, client, state } = await setup();
    const hostNow = 100_000;
    const localClock = vi.spyOn(Date, 'now').mockReturnValue(hostNow + offset);
    const synchronizedClock = vi.spyOn(client, 'getSynchronizedNow').mockReturnValue(hostNow);
    state.burningGround = {
      cells: [{ id: 1, gridX: 0, gridY: 0, intensity: 1, expiresAt: hostNow + 5_000, visualStyle: 'void' }],
      warnings: [{ gridX: 1, gridY: 0, activatesAt: hostNow + 5_000 }],
    };
    try {
      use(hostRoom); host.publishGameState(state, true); hostRoom.room.update(); use(clientRoom);
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
      client.flushNetwork();
      synchronizedClock.mockReturnValue(hostNow + 5_000);
      localClock.mockReturnValue(hostNow + 5_000 + offset);
      use(hostRoom); host.publishGameState(state); hostRoom.room.update(); use(clientRoom);
      expect(client.getLatestGameState()!.burningGround).toEqual({ cells: [], warnings: [] });
    } finally { vi.restoreAllMocks(); clearActiveSession(); }
  });

  it('bootstraps late join, sends warning-only changes and clears burned bases and ground on cleanup', async () => {
    const { network, hostRoom, clientRoom, use, connect, host, world, client, state, publish } = await setup();
    try {
      state.burningGround = { cells: [{ id: 1, gridX: 0, gridY: 0, intensity: 1, expiresAt: Number.MAX_SAFE_INTEGER, visualStyle: 'void' }],
        warnings: [{ gridX: 1, gridY: 0, activatesAt: Date.now() + 60000 }] };
      state.bases = [{ id: 'base', hp: 500, maxHp: 1000, voidBurning: true }];
      publish(true);
      const late = connect(await addClientRoom(network));
      expect(replicated(late.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
      expect(late.getLatestGameState()!.bases).toEqual(state.bases);
      state.burningGround = { ...state.burningGround, warnings: [{ gridX: 2, gridY: 0, activatesAt: Date.now() + 60000 }] };
      publish(); publish();
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
      state.burningGround = { ...state.burningGround, warnings: [] };
      publish(); publish();
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
      state.burningGround = { cells: [], warnings: [] }; state.bases = [{ id: 'base', hp: 0, maxHp: 1000 }];
      publish(); publish();
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
      expect(client.getLatestGameState()!.bases).toEqual(state.bases);
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null); use(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); }
  });

  it('reuses encoded geometry after ordinary and explicit full snapshots while publishing warnings', async () => {
    const { client, state, publish } = await setup();
    let cellReads = 0;
    const groundCells = [{ id: 1, get gridX() { cellReads++; return 0; }, gridY: 0,
      intensity: 1, expiresAt: Number.MAX_SAFE_INTEGER, visualStyle: 'void' as const }];
    state.burningGround = { cells: groundCells };
    try {
      publish();
      expect(cellReads).toBeGreaterThan(0);
      cellReads = 0;
      publish();
      expect(cellReads).toBe(0);

      // Published cells are immutable values: a new array of the same objects reuses their encoding.
      state.burningGround = { cells: [...groundCells] };
      publish(true);
      expect(cellReads).toBe(0);
      expect(client.getLatestGameState()!.burningGround.cells).toHaveLength(1);
      state.burningGround = { ...state.burningGround,
        warnings: [{ gridX: 2, gridY: 0, activatesAt: Date.now() + 60_000 }] };
      publish(); publish();
      expect(cellReads).toBe(0);
      expect(client.getLatestGameState()!.burningGround.warnings).toEqual(state.burningGround.warnings);
      state.burningGround = { ...state.burningGround, warnings: [] };
      publish(); publish();
      expect(cellReads).toBe(0);
      expect(client.getLatestGameState()!.burningGround.warnings).toEqual([]);
      expect(client.getLatestGameState()!.burningGround.cells).toHaveLength(1);
    } finally { clearActiveSession(); }
  });

  it('repairs a dropped ground delta with the periodic full snapshot despite unchanged cells', async () => {
    const { hostRoom, client, state, publish } = await setup();
    const cell = { id: 1, gridX: 0, gridY: 0, intensity: 1,
      expiresAt: Number.MAX_SAFE_INTEGER, visualStyle: 'void' as const };
    state.burningGround = { cells: [cell], warnings: [] };
    try {
      publish();
      hostRoom.transport.links[0].fastReady = false;
      state.burningGround = { cells: [{ ...cell, intensity: 2 }], warnings: [] };
      publish();
      hostRoom.transport.links[0].fastReady = true;
      publish();
      // Unchanged replicated geometry keeps its array, so per-change consumers stay idle.
      const stale = client.getLatestGameState()!.burningGround.cells;
      for (let tick = 4; tick < NET_TICK_RATE_HZ; tick++) publish();
      expect(client.getLatestGameState()!.burningGround.cells).toBe(stale);
      expect(stale[0].intensity).toBe(1);
      publish();
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
      const repaired = client.getLatestGameState()!.burningGround.cells;
      for (let tick = 0; tick <= NET_TICK_RATE_HZ; tick++) publish();
      expect(client.getLatestGameState()!.burningGround.cells).toBe(repaired);
    } finally { clearActiveSession(); }
  });

  it('rebuilds its publication baseline after reset even when the producer reuses the same cells', async () => {
    const { hostRoom, clientRoom, use, host, client, state, publish } = await setup();
    state.burningGround = { cells: [{ id: 1, gridX: 0, gridY: 0, intensity: 1,
      expiresAt: Number.MAX_SAFE_INTEGER, visualStyle: 'void' }], warnings: [] };
    try {
      publish(); publish();
      use(hostRoom); host.resetGameStateCache();
      use(clientRoom); client.resetGameStateCache();
      publish();
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
      publish();
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated(state.burningGround));
    } finally { clearActiveSession(); }
  });

  it('replicates journaled host changes and expiry exactly through incremental deltas', async () => {
    const { client, state, publish } = await setup();
    const journal = new GroundFireChangeJournal();
    type Cell = SyncedBurningGroundCell;
    const now = Date.now();
    const step = (base: Cell[], removed: Cell[], upserts: Cell[]) => {
      const byId = new Map(base.map(cell => [cell.id, cell]));
      for (const cell of removed) byId.delete(cell.id);
      for (const cell of upserts) byId.set(cell.id, cell);
      const cells = [...byId.values()];
      journal.record(cells, { base, removed, upserts });
      return cells;
    };
    const cell = (id: number, gridX: number, expiresAt = Number.MAX_SAFE_INTEGER): Cell =>
      ({ id, gridX, gridY: 3, intensity: 1, expiresAt, visualStyle: 'void' });
    try {
      let cells = [cell(1, 0), cell(2, 1), cell(3, 2, now + 60_000)];
      state.burningGround = { cells };
      publish(true);
      // Growth, a refresh, a removal, a skipped publish and an expiring cell.
      cells = step(cells, [], [cell(4, 3), cell(5, 4)]);
      state.burningGround = { cells }; publish();
      cells = step(cells, [cells[1]], [{ ...cell(1, 0), intensity: 3 }]);
      cells = step(cells, [], [cell(6, 5, now + 5_000)]);
      state.burningGround = { cells }; publish();
      expect(replicated(client.getLatestGameState()!.burningGround)).toEqual(replicated({ cells }));
      const merged = client.getLatestGameState()!.burningGround.cells;
      publish();
      expect(client.getLatestGameState()!.burningGround.cells).toBe(merged);
      vi.spyOn(client, 'getSynchronizedNow').mockReturnValue(now + 5_010);
      publish();
      expect(replicated(client.getLatestGameState()!.burningGround))
        .toEqual(replicated({ cells: cells.filter(entry => entry.id !== 6) }));
    } finally { vi.restoreAllMocks(); clearActiveSession(); }
  });
  it('replays a cell re-ignited within one publish as removal and ignition', async () => {
    const { client, state, publish } = await setup();
    const journal = new GroundFireChangeJournal();
    const first: SyncedBurningGroundCell = { id: 1, gridX: 2, gridY: 3, intensity: 1, expiresAt: Number.MAX_SAFE_INTEGER, visualStyle: 'void' };
    const initial = [first];
    state.burningGround = { cells: initial };
    try {
      publish();
      const before = client.getLatestGameState()!.burningGround.cells;
      // FireSystem gives a cell that went out and re-ignited a new visual id.
      const second = { ...first, id: 9 }, replaced = [second];
      journal.record(replaced, { base: initial, removed: [first], upserts: [second] });
      state.burningGround = { cells: replaced };
      publish();
      const after = client.getLatestGameState()!.burningGround.cells;
      const [step] = resolveGroundFireChanges(after, before)!;
      expect(step.removed).toEqual([before[0]]);
      expect(step.upserts).toHaveLength(1);
      expect(step.upserts[0]).not.toBe(before[0]);
      // The replicated identity is spatial, so the replacement keeps its client id.
      expect(after.map(cell => cell.id)).toEqual(before.map(cell => cell.id));
    } finally { clearActiveSession(); }
  });

  it('sends only changed warnings and repairs lost warning deltas', async () => {
    const { hostRoom, client, state, publish } = await setup();
    const now = Date.now();
    const link = hostRoom.transport.links[0];
    const warning = (gridX: number, activatesAt: number) => ({ gridX, gridY: 4, activatesAt });
    const warnings = () => replicated(client.getLatestGameState()!.burningGround).warnings;
    state.burningGround = { cells: [], warnings: [warning(1, now + 60_000), warning(2, now + 60_000)] };
    try {
      publish();
      // The host re-estimates activation times every frame; a few milliseconds are not resent.
      state.burningGround = { cells: [], warnings: [warning(1, now + 60_003), warning(2, now + 60_000)] };
      publish();
      expect(lastGroundSlice(hostRoom)).toBeUndefined();
      expect(warnings()).toEqual([warning(1, now + 60_000), warning(2, now + 60_000)]);
      // A moved activation, a withdrawn cell and a new one are sent.
      state.burningGround = { cells: [], warnings: [warning(1, now + 59_000), warning(3, now + 61_000)] };
      publish();
      expect(warnings()).toEqual(replicated(state.burningGround).warnings);
      // A single lost delta is healed by the next tick, which repeats recent changes.
      link.fastReady = false;
      state.burningGround = { cells: [], warnings: [warning(4, now + 62_000)] };
      publish();
      link.fastReady = true;
      publish();
      expect(warnings()).toEqual(replicated(state.burningGround).warnings);
      // A longer outage waits for the complete band.
      link.fastReady = false;
      state.burningGround = { cells: [], warnings: [warning(5, now + 63_000)] };
      publish(); publish(); publish();
      link.fastReady = true;
      for (let tick = 9; tick < NET_TICK_RATE_HZ; tick++) publish();
      expect(warnings()).toEqual([warning(4, now + 62_000)]);
      publish();
      expect(warnings()).toEqual(replicated(state.burningGround).warnings);
    } finally { clearActiveSession(); }
  });
});
