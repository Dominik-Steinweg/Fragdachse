import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireControlWorldFixture } from '../FireControlTestHelper';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { resolveMgTurretStats } from '../../src/config/mgTurret';
import { applyCoopDefenseModifiersToUtilityConfig } from '../../src/loadout/CoopDefenseLoadoutModifiers';

const hostClock = vi.hoisted(() => ({ now: 1000 }));
vi.mock('../../src/network/bridge', () => ({ bridge: {
  getSynchronizedNow: () => hostClock.now, isArenaCountdownActive: () => false,
  getActivityDescriptor: () => null, getActiveGameMode: () => 'coop_defense',
  getConnectedPlayers: () => [], getLocalPlayerId: () => 'headless',
  getPlayerHeldItemId: () => null, getPlayerInput: () => null, flushEffects() {},
  consumeFullGameStateRequest: () => false, publishGameState() {},
} }));
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { healthBarTestScene } from '../healthBarTestScene';

type Fixture = ReturnType<typeof createFireControlWorldFixture>;
let f: Fixture;
afterEach(() => f?.destroy());
const start = (parallelEnabled = 0) => {
  f = createFireControlWorldFixture({ parallelEnabled });
  const rock = f.add();
  expect(f.place(1000, 100, 0).ok).toBe(true);
  return rock;
};

describe('host utility → deployment → turret fire → lifecycle', () => {
  it('advances deployments in the production host tick before turret fire at expiry', () => {
    const rock = start(); f.spawnEnemy();
    const host = new HostUpdateCoordinator(healthBarTestScene().scene, {
      getWorldCombatCore: () => f.combat, playerManager: { getAllPlayers: () => [], getPlayer: () => undefined },
      decoySystem: { hostUpdateLifecycle() {}, hostPostPhysics() {}, createHostSnapshots: () => [] },
      hostPhysics: { update() {} }, smokeSystem: { syncVisuals() {}, syncTargetVisuals() {} },
      fireSystem: { hostUpdate: () => ({ synced: [], ground: { cells: [] }, damageEvents: [], damageTick: false }) },
      stinkCloudSystem: { hostUpdate: () => ({ synced: [], damageEvents: [] }), syncPlagueVisuals() {}, clientUpdate() {} },
    } as never, {} as never, {} as never, {} as never);
    host.setPresentationActive(false);
    host.setWorldFramePort({ getWorldRuntime: () => ({ context: { descriptor: { definitionId: 'world:lobby' } } }),
      getEnemyManager: () => null, getWorldMutationRuntime: () => null, getTrainRuntime: () => null,
    } as never);
    // Keep unrelated combat systems out of this tick fixture; advance and turret are production owners.
    const advance = vi.spyOn(f.binding, 'advanceFireControl');
    const turret = f.binding.systems!.turret;
    host.setCombatFramePort({ getTargetingRuntime: () => null, getSupportGameplayRuntime: () => null,
      getCombatGameplayBinding: () => ({ systems: { turret }, advanceMgTurrets() {}, advanceAttackDrones() {},
        advanceFireControl: (now: number) => f.binding.advanceFireControl(now) }),
    } as never);
    const fire = vi.spyOn(turret, 'hostUpdate');
    hostClock.now = 1000 + f.config.materializeMs;
    host.runHostUpdate(16);
    expect(f.projectile.spawn.mock.calls.at(-1)![0].origin.x).toBe(100 + f.config.singleCopyOffsetPx);
    hostClock.now = 1000 + f.config.durationMs;
    const shotsBefore = f.projectile.spawn.mock.calls.length;
    host.runHostUpdate(16);
    expect(advance).toHaveBeenLastCalledWith(hostClock.now);
    expect(f.projectile.spawn.mock.calls.length).toBeGreaterThan(shotsBefore);
    expect(f.projectile.spawn.mock.calls.at(-1)![0].origin.x).toBe(f.point(rock).x);
    expect(f.binding.getFireControlSnapshot(hostClock.now).deployments).toEqual([]);
    expect(fire.mock.calls.at(-1)![4]).toBe(advance.mock.results.at(-1)!.value);
    fire.mockRestore(); advance.mockRestore();
  });

  it('preserves temporary charges on rejection and consumes exactly once on success and retry', () => {
    f = createFireControlWorldFixture();
    const instanceId = f.action.addTemporaryUtility('inspector', f.config, 2)!;
    const stock = () => f.inventory.mock.calls.at(-1)![1];
    const before = structuredClone(stock());
    const request = { category: 'utility' as const, playerId: 'inspector', angle: 0, targetX: 100, targetY: 0,
      hostNowMs: 1000, attemptId: 'temporary-copy', params: { temporaryUtilityInstanceId: instanceId } };
    expect(f.action.execute(request)).toMatchObject({ ok: false, reason: 'no_fire_sources' });
    expect(stock()).toEqual(before);
    f.add(); expect(f.action.execute(request).ok).toBe(true);
    expect(stock()).toEqual([expect.objectContaining({ instanceId, charges: 1 })]);
    expect(f.action.execute(request).ok).toBe(true);
    expect(stock()).toEqual([expect.objectContaining({ instanceId, charges: 1 })]);
    expect(f.used).toHaveBeenCalledOnce();
  });

  it('preserves an already running cooldown when the fire-control port detaches', () => {
    start();
    const end = 1000 + f.config.durationMs;
    f.tick(end, false);
    const state = f.action.getFireControlState('inspector');
    expect(state).toMatchObject({ phase: 'cooldown', cooldownUntil: end + f.config.cooldown });
    f.action.setFireControlPort(null);
    expect(f.action.getFireControlState('inspector')).toEqual(state);
    expect(f.place(end + 1, 100)).toMatchObject({ ok: false, reason: 'cooldown' });
  });

  it('uses one definition list for advance and fire without caching construction reads across ticks', () => {
    start(); f.spawnEnemy();
    const definitions = vi.spyOn(f.binding, 'getTurretDefinitions');
    const at = 1000 + f.config.materializeMs;
    const sources = f.binding.advanceFireControl(at);
    f.binding.systems!.turret.hostUpdate(at, UTILITY_CONFIGS.SPORE_TURRET as never, WEAPON_CONFIGS.SPORES, 1000, sources);
    expect(definitions).toHaveBeenCalledOnce();
    expect(f.projectile.spawn).toHaveBeenCalled();
    f.placement.removeRock(Number(sources[0].id));
    expect(f.binding.getTurretDefinitions()).toEqual([]);
    expect(f.binding.advanceFireControl(at + 1)).toEqual([]);
    expect(f.binding.getFireControlSnapshot(at + 1).deployments).toEqual([]);
    definitions.mockRestore();
  });

  it('freezes resolved additive utility upgrades while equipment changes cannot shorten the pending cooldown', () => {
    const resolved = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.FIRE_CONTROL_RELAY, {
      additive: { 'utility.FIRE_CONTROL_RELAY.maxCopies': 1, 'utility.FIRE_CONTROL_RELAY.durationMs': 900,
        'utility.FIRE_CONTROL_RELAY.parallelEnabled': 1 }, percentage: {},
    });
    if (resolved.type !== 'fire_control_relay') throw Error('relay');
    f = createFireControlWorldFixture(resolved); f.add(); f.add('rocket_turret', 'inspector', 9);
    expect(f.place(1000, 100).ok).toBe(true);
    const initial = f.binding.getFireControlSnapshot(1000);
    expect(initial.deployments[0]).toMatchObject({ parallel: true, expiresAt: 1000 + resolved.durationMs });
    expect(initial.deployments[0].kind === 'copies' && initial.deployments[0].copies.length).toBe(2);
    f.equip({ ...resolved, maxCopies: 1, durationMs: 1, cooldown: 1, parallelEnabled: 0 });
    f.tick(1100, false); expect(f.binding.getFireControlSnapshot(1000)).toEqual(initial);
    f.tick(1000 + resolved.durationMs, false);
    expect(f.action.getFireControlState('inspector')).toMatchObject({ cooldownUntil: 1000 + resolved.durationMs + resolved.cooldown });
  });

  it('removes only the departing owner and distinguishes active port-detach from completed cooldown', () => {
    start(); f.add('machine_gun_turret', 'ally', 9);
    expect(f.action.execute({ category: 'utility', playerId: 'ally', angle: 0, targetX: 100, targetY: 0,
      hostNowMs: 1001, params: {} }).ok).toBe(true);
    f.action.removePlayer('inspector');
    expect(f.binding.getFireControlSnapshot(1001).deployments.map(d => d.ownerId)).toEqual(['ally']);
    f.action.setFireControlPort(null);
    expect(f.binding.getFireControlSnapshot(1001).deployments).toEqual([]);
    expect(f.action.getFireControlState('ally')).toBeNull();
    f.action.onFireControlDeploymentEnded(2, 1002); expect(f.action.getFireControlState('ally')).toBeNull();
  });

  it.each([0, 1])('preserves original readiness through projection and return (parallel=%s)', parallelEnabled => {
    const cooldown = resolveMgTurretStats().cooldownMs;
    f = createFireControlWorldFixture({ parallelEnabled, materializeMs: 1, durationMs: cooldown * (parallelEnabled ? 2 : .5) });
    f.add(); f.spawnEnemy(); f.tick(0);
    expect(f.projectile.spawn).toHaveBeenCalledTimes(1);
    expect(f.place(1, 100).ok).toBe(true);
    f.tick(2); expect(f.projectile.spawn).toHaveBeenCalledTimes(1);
    if (!parallelEnabled) f.tick(1 + f.config.durationMs);
    f.tick(cooldown - 1); expect(f.projectile.spawn).toHaveBeenCalledTimes(1);
    f.tick(cooldown); expect(f.projectile.spawn).toHaveBeenCalledTimes(parallelEnabled ? 3 : 2);
  });

  it('finishes the original salvo, transfers its readiness and books regular cooldown when a copy salvo expires', () => {
    const weapon = WEAPON_CONFIGS.TURRET_ROCKET_BURST, burst = weapon.turretBurst!;
    const originalEnd = (burst.count - 1) * burst.intervalMs;
    const copyStart = originalEnd + weapon.cooldown, end = copyStart + 1;
    f = createFireControlWorldFixture({ materializeMs: 1, durationMs: end - 1 });
    const rock = f.add('rocket_turret'); f.spawnEnemy(); f.tick(0);
    expect(f.projectile.spawn).toHaveBeenCalledTimes(1);
    expect(f.place(1, 100).ok).toBe(true); f.tick(2);
    for (let shot = 1; shot < burst.count; shot++) f.tick(shot * burst.intervalMs);
    expect(f.projectile.spawn).toHaveBeenCalledTimes(burst.count);
    expect(f.projectile.spawn.mock.calls.every(([r]) => r.origin.x === f.point(rock).x)).toBe(true);
    f.tick(copyStart - 1); expect(f.projectile.spawn).toHaveBeenCalledTimes(burst.count);
    f.tick(copyStart); expect(f.projectile.spawn).toHaveBeenCalledTimes(burst.count + 1);
    expect(f.projectile.spawn.mock.calls.at(-1)![0].origin.x).toBe(100 + f.config.singleCopyOffsetPx);
    f.tick(end); f.tick(end + weapon.cooldown - 1);
    expect(f.projectile.spawn).toHaveBeenCalledTimes(burst.count + 1);
    f.tick(end + weapon.cooldown); expect(f.projectile.spawn).toHaveBeenCalledTimes(burst.count + 2);
    expect(f.projectile.spawn.mock.calls.at(-1)![0].origin.x).toBe(f.point(rock).x);
  });

  it('materializes at the deadline with stable identity, matching snapshot and unchanged construction stock', () => {
    const rock = start();
    const at = 1000 + f.config.materializeMs;
    f.tick(at - 1, false);
    expect(f.binding.getTurretFireSources().map(s => s.fireState)).toEqual(['paused', 'paused']);
    f.tick(at, false);
    expect(f.binding.getTurretFireSources().map(s => s.fireState)).toEqual(['paused', 'active']);
    expect(f.binding.getTurretFireSources()[1]).toMatchObject({ identityId: rock.id, sequenceKey: rock.id,
      x: 100 + f.config.singleCopyOffsetPx, y: 0 });
    expect(f.binding.systems!.turret.getTurrets().map(t => t.id)).toEqual([rock.id]);
    expect(f.placement.getAllRuntimeRocks().map(t => t.id)).toEqual([rock.id]);
    expect(f.binding.getFireControlSnapshot(at).deployments[0]).toMatchObject({ copies: [{ status: 'active' }] });
  });

  it('consumes once, rejects overlapping use, starts only the frozen end-cooldown and becomes ready at its end', () => {
    start();
    const end = 1000 + f.config.durationMs, ready = end + f.config.cooldown;
    expect(f.place(1001, 100).ok).toBe(false); expect(f.used).toHaveBeenCalledTimes(1);
    expect(f.cooldown.mock.calls.filter(([, until]) => until > 0)).toEqual([]);
    f.tick(end + 10, false);
    expect(f.action.getFireControlState('inspector')).toMatchObject({ phase: 'cooldown', cooldownUntil: ready });
    expect(f.place(ready - 1, 100)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(f.place(ready, 100).ok).toBe(true); expect(f.used).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1])('ends projections on stale allied occupancy with parallelEnabled=%s', parallel => {
    const rock = start(parallel); f.setManned(rock.id); f.tick(1100, false);
    expect(f.binding.getFireControlSnapshot(1100).deployments).toEqual([]);
    expect(f.binding.getTurretFireSources()[0].fireState).toBe('active');
    expect(f.action.getFireControlState('inspector')).toMatchObject({ cooldownUntil: 1100 + f.config.cooldown });
    f.setManned(null); f.tick(1101, false); expect(f.binding.getTurretFireSources()).toHaveLength(1);
  });

  it('keeps death, respawn, equipment changes and live turret upgrades separate from frozen utility config', () => {
    start(1); const end = 1000 + f.config.durationMs;
    f.setAlive(false); f.tick(1100, false);
    f.equip(UTILITY_CONFIGS.HE_GRENADE); f.setAlive(true); f.tick(1200, false);
    expect(f.binding.getFireControlSnapshot(1200).deployments[0]).toMatchObject({ expiresAt: end, parallel: true });
    f.tick(end, false);
    f.equip(f.config);
    expect(f.cooldown).toHaveBeenLastCalledWith('inspector', end + f.config.cooldown, f.config.id);
  });

  it.each(['remove', 'hp', 'carrier', 'permission'] as const)('drops only invalid sources (%s) and ends on last loss', cause => {
    f = createFireControlWorldFixture({ maxCopies: 2 }); const first = f.add(), second = f.add('rocket_turret', 'inspector', 9);
    expect(f.place(1000, 100).ok).toBe(true);
    if (cause === 'remove') f.placement.removeRock(first.id);
    if (cause === 'hp') f.placement.getRuntimeRock(first.id)!.hp = 0;
    if (cause === 'carrier') vi.spyOn(f.placement, 'getCarrierBaseId').mockImplementation(id => id === first.id ? 'missing-carrier' : undefined);
    if (cause === 'permission') f.setCombatAllowed(false);
    f.tick(1100, false);
    const snapshot = f.binding.getFireControlSnapshot(1100);
    if (cause !== 'permission') {
      expect(snapshot.deployments[0]).toMatchObject({ copies: [{ originalId: second.id, sourceId: 'fc-copy:1:0' }] });
      f.placement.removeRock(second.id); f.tick(1200, false);
    }
    expect(f.binding.getFireControlSnapshot(1200).deployments).toEqual([]);
    expect(f.binding.fireControl!.getPausedOriginalIds().size).toBe(0);
  });

  it('selects diverse owned sources in slot order and never creates runtime constructions for copies', () => {
    f = createFireControlWorldFixture({ maxCopies: 3 });
    const mg = f.add(), rocket = f.add('rocket_turret', 'inspector', 9);
    f.add('machine_gun_turret', 'foreign', 13); const dead = f.add('machine_gun_turret', 'inspector', 17); f.placement.getRuntimeRock(dead.id)!.hp = 0;
    const before = f.placement.getAllRuntimeRocks().map(r => r.id);
    expect(f.place(1000, 100).ok).toBe(true);
    const copySources = f.binding.getTurretFireSources().filter(s => s.id !== s.identityId);
    expect(copySources.map(s => s.identityId)).toEqual([rocket.id, mg.id]);
    expect(f.placement.getAllRuntimeRocks().map(r => r.id)).toEqual(before);
  });

  it.each(['no_fire_sources', 'placement', 'range', 'invalid'] as const)('rejects %s without usage, charge, deployment or cooldown', reason => {
    f = createFireControlWorldFixture();
    if (reason !== 'no_fire_sources') f.add();
    if (reason === 'placement') f.setFree(false);
    const x = reason === 'range' ? f.config.placementRangePx + 1 : reason === 'invalid' ? NaN : 100;
    expect(f.place(1000, x)).toEqual({ ok: false, reason: reason === 'range' ? 'placement' : reason });
    expect(f.used).not.toHaveBeenCalled(); expect(f.noteUsed).not.toHaveBeenCalled();
    expect(f.action.getFireControlState('inspector')).toBeNull();
    expect(f.binding.getFireControlSnapshot(1000).deployments).toEqual([]);
    expect(f.cooldown.mock.calls.filter(([, until]) => until > 0)).toEqual([]);
  });

  it('revalidates current sources and uses the host position despite a forged client position', () => {
    f = createFireControlWorldFixture(); const rock = f.add(); f.placement.removeRock(rock.id);
    expect(f.place(1000, 100)).toMatchObject({ reason: 'no_fire_sources' }); f.add();
    expect(f.action.execute({ category: 'utility', playerId: 'inspector', angle: 0, targetX: 10000, targetY: 0,
      clientPosition: { x: 10000, y: 0 }, hostNowMs: 1000, params: {} })).toMatchObject({ reason: 'placement' });
    expect(f.place(1000, 100).ok).toBe(true); // No enemies required.
  });

  it('silently removes owners, activity cooldowns and world deployments, including repeated cleanup and late callbacks', () => {
    start(); f.action.removePlayer('inspector');
    expect(f.binding.getFireControlSnapshot(1100).deployments).toEqual([]);
    f.action.onFireControlDeploymentEnded(1, 1100); expect(f.action.getFireControlState('inspector')).toBeNull();
    expect(f.place(1100, 100).ok).toBe(true); f.tick(1100 + f.config.durationMs, false);
    expect(f.action.getFireControlState('inspector')?.phase).toBe('cooldown');
    f.binding.clearActivityBindings(); f.binding.clearActivityBindings();
    expect(f.action.getFireControlState('inspector')).toBeNull();
    expect(f.place(50000, 100).ok).toBe(true); f.binding.destroy(); f.binding.destroy();
    expect(f.action.getFireControlState('inspector')).toBeNull();
    expect(f.binding.getFireControlSnapshot(50000).deployments).toEqual([]);
    expect(f.place(50001, 100)).toMatchObject({ reason: 'blocked' });
  });
});

// Portal and combined deployment cases belong to M2.
  it.todo('Arrange: transportiertes Geschoss mit Herkunft und Bonus sowie auslaufender Einsatz; Act: expiresAt erreichen und das Geschoss treffen lassen; Assert: Portale und Pausen enden, Projektilherkunft und erworbene Beiträge bleiben erhalten');
  it.todo('Arrange: Kopien- und Portaleinsatz mit unterschiedlichen Endzeiten; Act: jeden Ablauf einzeln passieren; Assert: nur abgelaufener Einsatz endet und Original wird weder vorzeitig entpausiert noch dauerhaft blockiert');
  it.todo('Arrange: bereite Portal-Utility mit ausschließlich fremden, zerstörten oder ungeeigneten Quellen; Act: Wurf anfordern; Assert: derselbe verständliche Failure-Grund und unveränderte Ressourcen ohne geworfenes Projektil');
