import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());
import { DecoySystem } from '../../src/systems/DecoySystem';
import { PlayerUtilityActionRuntime } from '../../src/world/PlayerUtilityActionRuntime';
import { PlayerActionRuntime } from '../../src/world/PlayerActionRuntime';
import { HostHeldActionSystem } from '../../src/systems/HostHeldActionSystem';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type UtilityConfig } from '../../src/loadout/LoadoutConfig';
import { healthBarTestScene } from '../healthBarTestScene';
import { resolvedDecoy } from '../DecoyTestHelper';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';

function fixture() {
  const { scene, cosmetic } = healthBarTestScene();
  let hp = 17, armor = 9, alive = true, accepted = false;
  const owner = { x: 300, y: 300, color: 0xffffff };
  let config: UtilityConfig = resolvedDecoy();
  const network = { isHost: () => true, broadcastEffect: vi.fn() };
  const decoy = new DecoySystem(scene, { getPlayer: () => owner } as never, network as never, false);
  decoy.setWorldMetrics(resolveActiveArenaWorldMetrics());
  decoy.setCombatStateReader({ getHP: () => hp, getArmor: () => armor, getMaxHp: () => 120, isAlive: () => alive });
  decoy.setRunSpeedResolver(() => 80);
  const cooldown = vi.fn();
  const heldAction = new HostHeldActionSystem();
  const action = new PlayerUtilityActionRuntime({
    captureSmokeDamage: () => ({ sourceDamageMultiplier: 1 }), projectileSpawn: { spawnProjectile: () => accepted ? 1 : null },
    combatSystem: {} as never,
    actor: { getPlayer: () => owner, canInteract: () => true, isAlive: () => alive, isUtilityBlocked: () => false },
    loadout: { getEquippedUtilityConfig: () => config, resolveUtilityConfig: (_id, value) => value, noteUtilityUsed() {} },
    heldAction, translocator: null, decoy, stinkCloud: null, gameAudioSystem: { playSound() {} } as never,
    network: { loadout: { publishUtilityCooldownUntil: cooldown, publishTemporaryUtilityInstances() {}, publishHeldUtilityId() {} },
      roundStats: { recordUtilityUsed() {}, recordConstructionBuilt() {} } },
    dropBeer() {}, nukeStrike: () => accepted, placeable: { use: () => accepted },
  });
  decoy.setCooldownRefund((...args) => action.refundUtilityCooldown(...args));
  const commit = (now: number, params = {}) => action.execute({ category: 'utility', playerId: 'owner',
    angle: 0, targetX: 500, targetY: 300, hostNowMs: now, params });
  const close = () => { decoy.clearAll(); action.destroy(); };
  return { scene, decoy, action, commit, cooldown, cosmetic, network, heldAction, owner, close,
    equip: (value: UtilityConfig) => { config = value; action.syncEquippedUtility('owner'); },
    setVitals: (h: number, a: number) => { hp = h; armor = a; },
    setAccepted: (value: boolean) => { accepted = value; }, setAlive: (value: boolean) => { alive = value; } };
}

describe('Decoy World lifecycle without a renderer', () => {
  it('snapshots exact vitals, starts cooldown on activation and chains full stealth after a complete refund', () => {
    const f = fixture();
    expect(f.commit(1000)).toEqual({ ok: true });
    expect(f.cooldown).toHaveBeenLastCalledWith('owner', 13000, 'DECOY');
    const first = f.decoy.createHostSnapshots()[0];
    expect(first).toMatchObject({ hp: 17, maxHp: 120, armor: 9, x: 300, y: 300 });
    f.setVitals(100, 80);
    expect(f.decoy.createHostSnapshots()[0]).toEqual(first);
    expect(f.decoy.getHostTarget(first.id)!.body!.velocity.x).toBe(80);
    expect(f.decoy.getStealthSpeedMultiplier('owner')).toBeCloseTo(1.3);
    expect(f.decoy.getStealthAdrenalineMultiplier('owner')).toBeCloseTo(1.3);
    expect(f.commit(1001).ok).toBe(false);
    const order: string[] = [];
    f.decoy.setLifecyclePort({ beforeActivate() {}, activated() {}, ended: () => {
      expect(f.decoy.getHostTargets()).toEqual([]); order.push('count'); return 100;
    } });
    f.decoy.setEndEffectHandler(() => { order.push('explode'); expect(f.cooldown).toHaveBeenLastCalledWith('owner', 2000, 'DECOY'); });
    f.decoy.hostUpdateLifecycle(2000);
    f.decoy.applyDamage(first.id, 1000);
    expect(order).toEqual(['count', 'explode']);
    expect(f.decoy.isStealthed('owner')).toBe(true);
    expect(f.decoy.getStealthHpRegen('owner')).toBeGreaterThan(0);
    f.decoy.applyDamage(first.id, 1000);
    expect(order).toHaveLength(2);
    expect(f.commit(2000)).toEqual({ ok: true });
    expect(f.decoy.getStealthRemainingFrac('owner', 2000)).toBe(1);
    expect(f.decoy.createHostSnapshots()[0]).toMatchObject({ hp: 100, armor: 80 });
    f.decoy.setEndEffectHandler(null);
    f.decoy.hostUpdateLifecycle(8000);
    expect(f.decoy.hasActiveDecoy('owner')).toBe(false);
    expect(f.decoy.isStealthed('owner')).toBe(false);
    expect(f.decoy.getStealthHpRegen('owner')).toBe(0);
    expect(f.decoy.getStealthAdrenalineMultiplier('owner')).toBe(1);
    expect(f.cosmetic.every(object => object.texture.key === 'test')).toBe(true);
    f.close();
  });

  it('retains its cooldown across equipment changes and treats cleanup as silent removal', () => {
    const f = fixture(); f.commit(1000);
    const explosion = vi.fn(); f.decoy.setEndEffectHandler(explosion);
    f.decoy.clearPlayer('owner'); f.decoy.clearPlayer('owner');
    expect(explosion).not.toHaveBeenCalled(); expect(f.network.broadcastEffect).not.toHaveBeenCalled();
    f.equip(UTILITY_CONFIGS.BFG); f.equip({ ...resolvedDecoy() });
    expect(f.commit(2000)).toEqual({ ok: false, reason: 'cooldown' });
    expect(f.commit(13000).ok).toBe(true);
    f.close(); expect(explosion).not.toHaveBeenCalled();
  });

  it('collides with base buildings without a renderer and releases or rebinds every collider', () => {
    const f = fixture();
    const collider = vi.fn(() => ({ destroy: vi.fn() }));
    f.scene.physics.add.collider = collider;
    const rocks = {} as never, trunks = {} as never, bases = {} as never, nextBases = {} as never;
    f.decoy.setObstacleGroups(rocks, trunks, bases);
    f.commit(1000);
    const physical = f.cosmetic[0];
    expect(collider.mock.calls).toEqual([[physical, rocks], [physical, trunks], [physical, bases]]);
    const original = collider.mock.results.map(result => result.value);

    f.decoy.setObstacleGroups(null, null, nextBases);
    expect(original.every(handle => handle.destroy.mock.calls.length === 1)).toBe(true);
    expect(collider).toHaveBeenLastCalledWith(physical, nextBases);
    const replacement = collider.mock.results.at(-1)!.value;
    f.decoy.setObstacleGroups(null, null, null);
    expect(replacement.destroy).toHaveBeenCalledTimes(1);
    expect(collider).toHaveBeenCalledTimes(4);

    f.decoy.setObstacleGroups(null, null, bases);
    const restored = collider.mock.results.at(-1)!.value;
    f.close();
    expect(restored.destroy).toHaveBeenCalledTimes(1);
    expect(physical.active).toBe(false);
  });

  it('rebuilds active-owner gating on bootstrap, resync and removal independently of stealth', () => {
    const f = fixture(); f.commit(1000);
    const client = new DecoySystem({} as never, {} as never, {} as never, false);
    client.syncSnapshots(f.decoy.createHostSnapshots());
    expect(client.hasActiveDecoy('owner')).toBe(true);
    expect(client.isStealthed('owner')).toBe(false);
    client.syncSnapshots([]); expect(client.hasActiveDecoy('owner')).toBe(false);
    client.syncSnapshots(f.decoy.createHostSnapshots()); client.clearAll();
    expect(client.hasActiveDecoy('owner')).toBe(false); f.close();
  });

  it('reveals only after accepted utility release or placement, not during charging or rejected attempts', () => {
    const f = fixture(); f.commit(1000); f.equip(UTILITY_CONFIGS.HE_GRENADE);
    expect(f.action.startHeldAction('owner', 'charge', 'charged_throw', 1100)).toBe(true);
    expect(f.decoy.isStealthed('owner')).toBe(true);
    expect(f.commit(1200, { heldActionId: 'charge' }).ok).toBe(false);
    expect(f.decoy.isStealthed('owner')).toBe(true);
    f.setAccepted(true); f.action.startHeldAction('owner', 'release', 'charged_throw', 1300);
    expect(f.commit(1400, { heldActionId: 'release' }).ok).toBe(true);
    expect(f.decoy.isStealthed('owner')).toBe(false);
    f.close();
  });

  it('reveals at actual weapon execution, including the next sustained shot, but not scope holding', () => {
    const reveal = vi.fn(); let accepted = false; let sustained = false;
    const actions = new PlayerActionRuntime({ getPlayer: () => ({ x: 0, y: 0, color: 0 }), canInteract: () => true,
      isAlive: () => true, isWeaponBlocked: () => false, isDashBurst: () => false, breakStealth: reveal },
    { getEquippedWeaponConfig: () => WEAPON_CONFIGS.AWP, noteWeaponAction() {} },
    { claimWeaponAction() {}, activateWeapon: () => sustained ? { ok: accepted } : null } as never,
    { activateWeapon: () => ({ ok: accepted }), noteWeaponFired() {} });
    const request = { category: 'weapon' as const, playerId: 'owner', slot: 'weapon1' as const,
      angle: 0, targetX: 100, targetY: 0, hostNowMs: 1000 };
    actions.execute({ ...request, params: { scopeHolding: true } }); actions.execute(request);
    expect(reveal).not.toHaveBeenCalled();
    accepted = true; actions.execute(request); expect(reveal).toHaveBeenCalledTimes(1);
    sustained = true; accepted = false; actions.execute(request); expect(reveal).toHaveBeenCalledTimes(1);
    accepted = true; actions.execute(request); expect(reveal).toHaveBeenCalledTimes(2); actions.destroy();
  });

  it('samples actual slow turns and long physical segments, and emits nothing at rest or after removal', () => {
    const f = fixture(); const trail = vi.fn(); f.decoy.setTrailHandler(trail); f.commit(1000);
    f.decoy.hostPostPhysics(1001); expect(trail).not.toHaveBeenCalled();
    const physical = f.cosmetic[0]; physical.setPosition(302, 300); f.decoy.hostPostPhysics(1020);
    physical.setPosition(302, 303); f.decoy.hostPostPhysics(1040);
    expect(trail.mock.calls.map(call => call.slice(1, 5))).toEqual([[300, 300, 302, 300], [302, 300, 302, 303]]);
    physical.setPosition(502, 303); f.decoy.hostPostPhysics(3000);
    expect(trail.mock.calls.at(-1)!.slice(1, 5)).toEqual([302, 303, 502, 303]);
    f.decoy.hostPostPhysics(3100); expect(trail).toHaveBeenCalledTimes(3);
    f.decoy.clearAll(); f.decoy.hostPostPhysics(3200); expect(trail).toHaveBeenCalledTimes(3); f.close();
  });
});
