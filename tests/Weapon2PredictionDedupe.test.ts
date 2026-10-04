import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return { ...createFakePhaserModule(), Input: { Keyboard: {
    JustDown: (key: { justDown?: boolean }) => key.justDown === true,
    JustUp: (key: { justUp?: boolean }) => key.justUp === true,
  } } };
});
import { bridge } from '../src/network/bridge';
import { RpcCoordinator } from '../src/scenes/arena/RpcCoordinator';
import { PlayerActionRuntime } from '../src/world/PlayerActionRuntime';
import { PlayerWeaponActivationRuntime } from '../src/world/PlayerWeaponActivationRuntime';
import { WorldPlayerGameplayRuntime } from '../src/world/WorldPlayerGameplayRuntime';
import { createWeaponBalanceLabWorldPort } from '../src/scenes/arena/ArenaRuntimeAdapters';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { InputSystem } from '../src/systems/InputSystem';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { FakeNetwork, addClientRoom, createHostRoom, dropConnection, type TestRoom } from './fakePeerNetwork';

function world(worldRevision: number): WorldDescriptor {
  return {
    worldRevision,
    definitionId: 'world:coop-defense:7',
    seed: 4242,
    generatorVersion: 3,
    layoutFingerprint: 'deadbeef',
  };
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PREDICT' });
}

describe('host-owned scope gestures over the weapon-2 RPC', () => {
  let rooms: { host: TestRoom; client: TestRoom; network: FakeNetwork } | undefined;
  afterAll(() => {
    rooms?.client.room.leave();
    rooms?.host.room.leave();
    clearActiveSession();
  });

  async function scopeFixture() {
    if (!rooms) {
      const network = new FakeNetwork();
      rooms = { host: await createHostRoom(network), client: await addClientRoom(network, [], 'scope-reload-token'), network };
    }
    useRoom(rooms.host);
    bridge.activate();
    bridge.publishWorldAndActivity(world(1), null);
    const upgrades = new Set<string>();
    const includeUpgrade = (id: string) => {
      if (upgrades.has(id)) return;
      upgrades.add(id);
      for (const requirement of getCoopDefenseUpgradeDefinition(id)!.requires) includeUpgrade(requirement.upgradeId);
    };
    includeUpgrade('awp_full_charge_damage');
    const config = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.AWP, 'weapon2',
      getCoopDefenseResolvedEffectTotals({ upgrades: Object.fromEntries([...upgrades].map(id =>
        [id, { unlocked: true, level: getCoopDefenseUpgradeDefinition(id)?.maxLevel ?? 1 }])) }));
    const player = { x: 100, y: 100, color: 0xffffff, body: { velocity: { x: 0, y: 0 } } };
    const loadout = new LoadoutManager({} as never, { getGameMode: () => 'deathmatch' });
    loadout.assignDefaultLoadout('p1', { weapon2: config });
    const fire = vi.fn(() => true), drain = vi.fn();
    let now = 10_000, adrenaline = 100, blocked = false;
    const activation = new PlayerWeaponActivationRuntime({ playerManager: { getPlayer: () => player }, loadout,
      resourceSystem: { captureAdrenalineGainBasis: () => null, getAdrenaline: () => adrenaline,
        resolveAdrenalineCost: (_id, cost) => cost, drainAdrenaline: drain, pauseAdrenalineRegen: vi.fn() },
      weaponExecution: { fire }, specializedWeaponExecution: { fire: () => false } });
    const actions = new PlayerActionRuntime({ getPlayer: () => player, canInteract: () => true, isAlive: () => true,
      isWeaponBlocked: () => blocked, isDashBurst: () => false }, loadout, null, activation);
    const rpc = Object.create(RpcCoordinator.prototype) as RpcCoordinator;
    Object.assign(rpc, { getHostNowMs: () => now, capabilities: { get: () => ({ canInteract: !blocked, canUseCombat: !blocked }) },
      playerLoadout: { usePlayerAction: actions.execute.bind(actions), getAdrenaline: () => adrenaline, getAdrenalineRevision: () => 1 } });
    (rpc as unknown as { registerLoadoutUseHandler(): void }).registerLoadoutUseHandler();
    return { config, fire, drain, loadout, actions, setBlocked: (value: boolean) => { blocked = value; },
      setNow: (value: number) => { now = value; }, setAdrenaline: (value: number) => { adrenaline = value; },
      request: (prm: unknown) => rooms!.client.room.callHost('lu', { slot: 'weapon2', angle: 0, tx: 200, ty: 100, wr: 1, prm }, 500) };
  }

  it('rejects fabricated full-charge fractions without a host-observed gesture', async () => {
    const f = await scopeFixture();
    expect(await f.request({ scopeProgress: 1, scopeChargeProgress: 1 })).toMatchObject({ ok: false });
    expect(await f.request({ scope: { id: 1, phase: 'release' }, scopeProgress: 1, scopeChargeProgress: 1 })).toMatchObject({ ok: false });
    expect(f.fire).not.toHaveBeenCalled();
    expect(f.drain).not.toHaveBeenCalled();
  });

  it('preserves an uncharged AWP tap through the host tooling adapter without exposing a client shortcut', async () => {
    const f = await scopeFixture();
    const worldRuntime = Object.assign(Object.create(WorldPlayerGameplayRuntime.prototype), {
      systems: { playerAction: f.actions }, turretControl: { isOccupied: () => false },
    }) as WorldPlayerGameplayRuntime;
    const port = createWeaponBalanceLabWorldPort({ getWorldPlayerGameplayRuntime: () => worldRuntime } as never,
      { getPlayer: () => ({ x: 100, y: 100 }) } as never);
    expect(port.useWeaponAction('weapon2', 'p1', 0, 200, 100, 10_000, 1, true)).toMatchObject({ ok: true });
    expect(f.fire).toHaveBeenCalledOnce();
    expect(f.fire.mock.calls[0][0].damage).toBe(f.config.damage);
    expect(f.fire.mock.calls[0][0].awpCharge.corridorEnabled).toBe(0);
    expect(f.drain).toHaveBeenCalledOnce();
    expect(f.loadout.getSpeedMultiplier('p1', 10_000)).toBe(1);
    expect(await f.request({ scopeTrigger: 'tap', scopeProgress: 1, scopeChargeProgress: 1 })).toMatchObject({ ok: false });
    expect(f.fire).toHaveBeenCalledOnce();
  });

  it.each([0.25, 0.5, 1])('uses host duration for a legal charge of %s and commits its release once', async fraction => {
    const f = await scopeFixture();
    expect(await f.request({ scope: { id: 1, phase: 'hold' } })).toMatchObject({ ok: true });
    expect(f.fire).not.toHaveBeenCalled();
    expect(f.drain).not.toHaveBeenCalled();
    const duration = f.config.awpCharge!.durationMs * fraction;
    for (let elapsed = 1_000; elapsed < duration; elapsed += 1_000) {
      f.setNow(10_000 + elapsed);
      expect(await f.request({ scope: { id: 1, phase: 'hold' } })).toMatchObject({ ok: true });
      expect(f.loadout.getSpeedMultiplier('p1', 10_000 + elapsed + 500)).toBe(f.config.holdSpeedFactor);
    }
    f.setNow(10_000 + duration);
    const release = { scope: { id: 1, phase: 'release' }, scopeProgress: 0, scopeChargeProgress: 0 };
    const random = vi.spyOn(Math, 'random').mockReturnValue(1);
    try { expect(await f.request(release)).toMatchObject({ ok: true }); } finally { random.mockRestore(); }
    expect(f.fire).toHaveBeenCalledOnce();
    expect(f.drain).toHaveBeenCalledOnce();
    const shotConfig = f.fire.mock.calls[0][0];
    expect(shotConfig.damage).toBeCloseTo(f.config.damage * (1 + fraction * f.config.awpCharge!.maxDamageBonus)
      * (fraction === 1 ? 1 + f.config.awpCharge!.fullChargeDamageBonus : 1));
    const aimProgress = Math.min(1, duration / f.config.scopeConfig!.scopeInMs);
    expect(f.fire.mock.calls[0][1].angle).toBeCloseTo(f.config.scopeConfig!.unscopedSpreadDeg * (1 - aimProgress) * Math.PI / 360);
    expect(f.loadout.getSpeedMultiplier('p1', 10_000 + duration)).toBe(1);
    expect(await f.request(release)).toMatchObject({ ok: false });
    expect(f.fire).toHaveBeenCalledOnce();
  });

  it('does not revive an expired gesture from a late hold or release before the next host update', async () => {
    const f = await scopeFixture();
    await f.request({ scope: { id: 1, phase: 'hold' } });
    expect(f.loadout.getSpeedMultiplier('p1', 11_500)).toBe(f.config.holdSpeedFactor);
    f.setNow(12_001);
    expect(await f.request({ scope: { id: 1, phase: 'hold' } })).toMatchObject({ ok: false });
    expect(await f.request({ scope: { id: 1, phase: 'release' } })).toMatchObject({ ok: false });
    expect(f.loadout.getSpeedMultiplier('p1', 12_001)).toBe(1);
    expect(f.fire).not.toHaveBeenCalled();
    expect(await f.request({ scope: { id: 2, phase: 'hold' } })).toMatchObject({ ok: true });
  });

  it('requires host readiness and resources before beginning a charge', async () => {
    const f = await scopeFixture();
    f.setAdrenaline(0);
    expect(await f.request({ scope: { id: 1, phase: 'hold' } })).toMatchObject({ ok: false, reason: 'resource' });
    f.setAdrenaline(100);
    f.loadout.recordWeaponUse('p1', 'weapon2', 10_000);
    expect(await f.request({ scope: { id: 2, phase: 'hold' } })).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(f.loadout.getSpeedMultiplier('p1', 10_000)).toBe(1);
    expect(f.fire).not.toHaveBeenCalled();
    expect(f.drain).not.toHaveBeenCalled();
  });

  it('cancels through combat gates and ignores a stale cancellation of the next gesture', async () => {
    const f = await scopeFixture();
    await f.request({ scope: { id: 1, phase: 'hold' } });
    f.setBlocked(true);
    expect(await f.request({ scope: { id: 1, phase: 'cancel' } })).toMatchObject({ ok: true });
    expect(f.loadout.getSpeedMultiplier('p1', 10_000)).toBe(1);
    f.setBlocked(false);
    expect(await f.request({ scope: { id: 1, phase: 'hold' } })).toMatchObject({ ok: false });
    expect(await f.request({ scope: { id: 2, phase: 'hold' } })).toMatchObject({ ok: true });
    expect(await f.request({ scope: { id: 1, phase: 'cancel' } })).toMatchObject({ ok: false });
    f.setNow(10_500);
    expect(await f.request({ scope: { id: 2, phase: 'release' } })).toMatchObject({ ok: true });
    expect(f.fire).toHaveBeenCalledOnce();
  });

  it.each([
    { scope: { id: 1, phase: 'hold' }, rocketMagazine: { id: 1, phase: 'hold', focused: false } },
    { scope: { id: 1, phase: 'hold' }, scopeHolding: true },
    { scope: { id: 1, phase: 'hold' }, inputStarted: true },
    { rocketMagazine: { id: 1, phase: 'hold', focused: false }, scopeProgress: 1 },
  ])('rejects contradictory weapon gesture parameters: %j', async params => {
    const f = await scopeFixture();
    expect(await f.request(params)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(f.fire).not.toHaveBeenCalled();
    expect(f.drain).not.toHaveBeenCalled();
    expect(f.loadout.getSpeedMultiplier('p1', 10_000)).toBe(1);
  });

  it('rejects a gesture from an ended Activity while allowing a fresh current gesture', async () => {
    const f = await scopeFixture();
    await f.request({ scope: { id: 1, phase: 'hold' } });
    f.actions.cancelAllScopes();
    // The same World can exist with no Activity after leaving the previous one.
    expect(await f.request({ scope: { id: 1, phase: 'release' }, activityRevision: 7 })).toMatchObject({ ok: false });
    expect(await f.request({ scope: { id: 1, phase: 'hold' } })).toMatchObject({ ok: false });
    expect(await f.request({ scope: { id: 2, phase: 'hold' } })).toMatchObject({ ok: true });
    expect(f.fire).not.toHaveBeenCalled();
  });

  it.each([false, true])('recovers InputSystem after same-peer Room resume with read-only storage=%s', async readOnly => {
    const f = await scopeFixture();
    const storage = new Map<string, string>();
    let rejectWrites = false;
    vi.stubGlobal('window', { sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (rejectWrites) throw new Error('QuotaExceededError');
        storage.set(key, value);
      },
    } });
    const makeInput = () => {
      let held = true;
      const pointer = { leftButtonDown: () => false, rightButtonDown: () => held };
      const input = new InputSystem({ input: { activePointer: pointer } } as never, {
        getWorldDescriptor: () => world(1), getLocalWorldParticipation: () => 'interactive',
        getLocalPlayerId: () => 'p1', getSynchronizedNow: () => 10_000, sendLocalInput: vi.fn(),
      } as never, () => ({ x: 0, y: 0 } as never));
      const requests: Array<Promise<unknown>> = [], params: unknown[] = [];
      const key = () => ({ isDown: false, justDown: false, justUp: false });
      Object.assign(input, { keyW: key(), keyA: key(), keyS: key(), keyD: key(), keySpace: key(), keyShift: key(),
        keyE: key(), keyQ: key(), keyR: key(), keyB: key(), keyN: key(),
        updateAimFromPointer: () => ({ x: 200, y: 100 }), localBurrowPhase: 'idle' });
      input.setupWeapon2ConfigProvider(() => f.config);
      input.setupLoadoutListener((_slot, _angle, _x, _y, prm) => {
        params.push(prm);
        requests.push(f.request(prm).then(result => {
          if (prm?.scope?.phase === 'hold') input.handleScopeActionResult(prm.scope, result as import('../src/types').LoadoutUseResult);
          return result;
        }));
      });
      return { input, params, requests, release: () => { held = false; input.update(); },
        press: () => { held = true; input.update(); } };
    };
    try {
      const first = makeInput(); first.input.update();
      expect(await first.requests[0]).toMatchObject({ ok: true });
      const oldId = (first.params[0] as { scope: { id: number } }).scope.id;
      expect(storage.get('fragdachse:scope-gesture-sequence')).toBe(String(oldId));
      f.setBlocked(true); f.actions.updateScopes(10_001); f.setBlocked(false);
      if (readOnly) {
        // The departed page continued its in-memory counter while quota prevented persistence.
        await f.request({ scope: { id: oldId + 10, phase: 'hold' } });
        await f.request({ scope: { id: oldId + 10, phase: 'cancel' } });
        rejectWrites = true;
      }
      const oldClient = rooms!.client;
      oldClient.transport.destroy(); dropConnection(oldClient);
      rooms!.client = await addClientRoom(rooms!.network, [], 'scope-reload-token');
      oldClient.room.leave();
      expect(rooms!.client.room.getLocalPlayerId()).toBe('p1');
      expect(await f.request({ scope: { id: oldId, phase: 'hold' } })).toMatchObject({ ok: false });
      // Reloaded storage may be ahead of this module's cache (another Input instance).
      if (!readOnly) storage.set('fragdachse:scope-gesture-sequence', String(oldId + 10));
      const resumed = makeInput(); resumed.input.update();
      expect(await resumed.requests[0]).toMatchObject({ ok: !readOnly });
      if (readOnly) {
        expect(resumed.input.isScoping()).toBe(false);
        expect(f.fire).not.toHaveBeenCalled();
        resumed.release(); resumed.press();
        expect(await resumed.requests.at(-1)).toMatchObject({ ok: true });
      }
      const newId = (resumed.params.at(-1) as { scope: { id: number } }).scope.id;
      expect(newId).toBe(oldId + 11);
      expect(await f.request({ scope: { id: oldId, phase: 'release' } })).toMatchObject({ ok: false });
      f.setNow(10_500); resumed.release();
      expect(await resumed.requests.at(-1)).toMatchObject({ ok: true });
      expect(f.fire).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('Weapon2 prediction deduplication', () => {
  it('returns the stored final result without firing or draining twice', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: true }));
      host.registerLoadoutUseHandler(handler);

      useRoom(hostRoom);
      const request = { slot: 'weapon2', angle: 0.2, tx: 10, ty: 20, wr: 1, pid: 1 };
      const first = await clientRoom.room.callHost('lu', request, 500);
      const retry = await clientRoom.room.callHost('lu', request, 500);

      expect(first).toMatchObject({ ok: true, worldRevision: 1, weapon2PredictionAck: 1 });
      expect(retry).toMatchObject({ ok: true, worldRevision: 1, weapon2PredictionAck: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      clearActiveSession();
    }
  });

  it('does not skip a missing ID and closes the ACK gap when that ID is retried', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: true }));
      host.registerLoadoutUseHandler(handler);
      const use = async (predictionId: number) => clientRoom.room.callHost('lu', {
        slot: 'weapon2', angle: 0, tx: 0, ty: 0, wr: 1, pid: predictionId,
      }, 500);

      useRoom(hostRoom);
      const twelve = await use(12);
      expect(twelve).toMatchObject({ weapon2PredictionAck: 0 });
      const eleven = await use(11);
      expect(eleven).toMatchObject({ weapon2PredictionAck: 0 });

      // IDs are per World and the stream starts at 1: the example's ACK 10 is represented by
      // feeding the preceding contiguous range without changing the dedupe call count.
      for (let id = 1; id <= 10; id++) await use(id);
      expect(host.getWeapon2PredictionAck('p1')).toBe(12);
      expect(handler).toHaveBeenCalledTimes(12);
    } finally {
      clearActiveSession();
    }
  });

  it('leitet keinen Client-Timestamp aus dem lu-Payload an den Host-Handler weiter', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: true }));
      host.registerLoadoutUseHandler(handler);

      useRoom(hostRoom);
      // Absurd alte / weit in der Zukunft liegende Client-Zeit darf den Host nicht erreichen.
      await clientRoom.room.callHost('lu', { slot: 'weapon1', angle: 0, tx: 1, ty: 2, wr: 1, pid: 7, ts: 1 }, 500);
      await clientRoom.room.callHost('lu', { slot: 'weapon1', angle: 0, tx: 1, ty: 2, wr: 1, pid: 7, ts: 9_999_999_999_999 }, 500);

      expect(handler).toHaveBeenCalledTimes(2);
      for (const call of handler.mock.calls) {
        // The extra argument is shot-presentation correlation, never client simulation time.
        expect(call.slice(5)).toEqual([undefined, undefined, undefined, undefined, 7]);
        expect(call.slice(0, 4)).toEqual(['weapon1', 0, 1, 2]);
      }
    } finally {
      clearActiveSession();
    }
  });

  it('deduplicates final rejects as well as accepted shots', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: false, reason: 'resource' as const }));
      host.registerLoadoutUseHandler(handler);

      useRoom(hostRoom);
      const request = { slot: 'weapon2', angle: 0, tx: 0, ty: 0, wr: 1, pid: 1 };
      expect(await clientRoom.room.callHost('lu', request, 500)).toMatchObject({ ok: false });
      expect(await clientRoom.room.callHost('lu', request, 500)).toMatchObject({ ok: false });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      clearActiveSession();
    }
  });
});
