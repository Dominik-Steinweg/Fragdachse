import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { UtilityChargePrediction } from '../../src/loadout/UtilityChargePrediction';
import { FakeNetwork, createHostRoom, addClientRoom, dropConnection } from '../fakePeerNetwork';
import { PlayerUtilityActionRuntime } from '../../src/world/PlayerUtilityActionRuntime';
import { HostHeldActionSystem } from '../../src/systems/HostHeldActionSystem';
import { InputSystem } from '../../src/systems/InputSystem';
import { resolvedHe } from '../HeGrenadeTestHelper';

vi.mock('phaser', () => ({ Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)), Angle: { Between: () => 0 } } }));
vi.mock('../../src/ui/RadialActionMenu', () => ({ RadialActionMenu: class { close() {} destroy() {} } }));

describe('HE reliable player state without an Activity', () => {
  it('accepts fresh stocks after same-World reentry, rejects old replies and resets prediction for a new World', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network);
    setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'CHARGE' });
    const bridge = new NetworkBridge(); bridge.activate();
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1,
      generatorVersion: 3, layoutFingerprint: 'charge-reentry' };
    bridge.publishWorldAndActivity(world, null);
    const now = 100;
    vi.spyOn(bridge, 'getSynchronizedNow').mockReturnValue(now);
    const config = resolvedHe(), held = new HostHeldActionSystem();
    const createRuntime = () => new PlayerUtilityActionRuntime({
      captureSmokeDamage: () => ({ sourceDamageMultiplier: 1 }),
      projectileSpawn: { spawnProjectile: () => 1 }, combatSystem: {} as never,
      actor: { getPlayer: () => ({ x: 0, y: 0, color: 0xffffff }), canInteract: () => true,
        isAlive: () => true, isUtilityBlocked: () => false },
      loadout: { getEquippedUtilityConfig: () => config, resolveUtilityConfig: (_p, value) => value, noteUtilityUsed() {} },
      heldAction: held, translocator: null, decoy: null, stinkCloud: null,
      gameAudioSystem: { playSound() {} } as never,
      network: { loadout: { publishUtilityChargeState: (...args) => bridge.publishUtilityChargeState(...args),
        publishUtilityCooldownUntil() {}, publishTemporaryUtilityInstances() {}, publishHeldUtilityId() {} },
        roundStats: { recordUtilityUsed() {}, recordConstructionBuilt() {} } },
      dropBeer() {}, nukeStrike: () => false, placeable: null,
    });
    let runtime = createRuntime();
    const input = new InputSystem({ input: { activePointer: { x: 0, y: 0 } } } as never, bridge, () => undefined);
    const ref = { kind: 'utility' as const, utilityId: config.id };
    try {
      runtime.syncEquippedUtility('p0');
      expect(runtime.startHeldAction('p0', 'first', 'charged_throw', 0)).toBe(true);
      expect(runtime.execute({ category: 'utility', playerId: 'p0', angle: 0, targetX: 100, targetY: 0,
        hostNowMs: now, attemptId: 'first', params: { heldActionId: 'first' } }).ok).toBe(true);
      const previous = input.getLocalUtilityChargeState(ref)!;
      expect(previous.availableCharges).toBe(config.charges!.maxCharges - 1);
      // The PlayerWorldRuntime loadout-detach and attach paths invoke these owners.
      // HUD reads only while a local Player exists; the null publication need not be observed.
      runtime.removePlayer('p0');
      expect(bridge.getPlayerUtilityChargeState('p0', config.id)).toBeNull();
      runtime.syncEquippedUtility('p0');
      const fresh = bridge.getPlayerUtilityChargeState('p0', config.id)!;
      expect(fresh.revision).toBeGreaterThan(previous.revision);
      expect(input.getLocalUtilityChargeState(ref)).toMatchObject({ availableCharges: config.charges!.maxCharges,
        nextChargeAt: null, lockoutUntil: 0 });

      const delayedReply = new UtilityChargePrediction();
      delayedReply.observe(previous);
      delayedReply.predict(config.id, 'old-delayed-reply', now, 100);
      delayedReply.observe(fresh);
      delayedReply.acknowledge('old-delayed-reply', previous);
      expect(delayedReply.project(config.id, now)).toMatchObject(fresh);

      runtime.destroy();
      bridge.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      runtime = createRuntime();
      runtime.syncEquippedUtility('p0');
      const nextWorld = bridge.getPlayerUtilityChargeState('p0', config.id)!;
      expect(nextWorld.revision).toBeLessThan(fresh.revision);
      expect(input.getLocalUtilityChargeState(ref)).toMatchObject(nextWorld);
    } finally { runtime.destroy(); clearActiveSession(); vi.restoreAllMocks(); }
  });

  it('carries stock, utility-slot replies, late-join/bootstrap, resume and teardown through the existing player channel', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network, [], 'he-grenade-client-resume-token');
    try {
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'HE-TEST' });
      const host = new NetworkBridge(); host.activate();
      host.publishWorldAndActivity({ worldRevision: 1, definitionId: 'world:coop-defense:7',
        seed: 1, generatorVersion: 3, layoutFingerprint: 'he-test' }, null);
      const initial = { utilityId: 'HE_GRENADE', revision: 1, availableCharges: 4, maxCharges: 4,
        rechargeIntervalMs: 2000, nextChargeAt: null, lockoutUntil: 0 };
      host.publishUtilityChargeState('p1', initial.utilityId, initial);
      const used = { ...initial, revision: 2, availableCharges: 3, nextChargeAt: 2100,
        lockoutUntil: 200, lastCommittedAttemptId: 'throw-one' };
      host.registerLoadoutUseHandler(vi.fn(() => {
        host.publishUtilityChargeState('p1', used.utilityId, used);
        return { ok: true, utilityChargeState: used };
      }));
      const prediction = new UtilityChargePrediction();
      prediction.observe(initial); prediction.predict(initial.utilityId, 'throw-one', 100, 100);
      const reply = await clientRoom.room.callHost('lu', { slot: 'utility', angle: 0, tx: 100, ty: 0,
        wr: 1, prm: { attemptId: 'throw-one' } }, 500);
      expect(reply).toMatchObject({ ok: true, worldRevision: 1, utilityChargeState: used });
      expect(clientRoom.room.getPlayerState('p1', 'uch')).toEqual({ HE_GRENADE: used });
      prediction.acknowledge('throw-one', (reply as { utilityChargeState: typeof used }).utilityChargeState);
      expect(prediction.project(initial.utilityId, 500)?.availableCharges).toBe(3);
      expect(host.getPlayerUtilityCooldownUntil('p1', initial.utilityId)).toBe(used.lockoutUntil);

      const late = await addClientRoom(network);
      setActiveSession({ room: late.room, transport: late.transport, roomCode: 'HE-TEST' });
      const lateBridge = new NetworkBridge(); lateBridge.activate();
      expect(lateBridge.getPlayerUtilityChargeState('p1', initial.utilityId)).toEqual(used);
      clientRoom.transport.reconnectEnabled = false;
      dropConnection(clientRoom);
      const resumed = await addClientRoom(network, [], 'he-grenade-client-resume-token');
      expect(resumed.room.getLocalPlayerId()).toBe('p1');
      expect(resumed.room.getPlayerState('p1', 'uch')).toEqual({ HE_GRENADE: used });

      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'HE-TEST' });
      host.publishUtilityChargeState('p1', initial.utilityId, null);
      expect(lateBridge.getPlayerUtilityChargeState('p1', initial.utilityId)).toBeNull();
      expect(resumed.room.getPlayerState('p1', 'uch')).toEqual({});
    } finally { clearActiveSession(); }
  });
});
