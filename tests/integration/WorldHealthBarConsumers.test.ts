import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  return {
    ...phaser,
    Geom: { ...phaser.Geom, Line: class {} },
    Math: {
      ...phaser.Math,
      RND: { realInRange: (min: number) => min },
    },
  };
});
vi.mock('../../src/effects/SpawnEffectRenderer', () => ({
  SpawnEffectRenderer: class { setLightingSystem() {} play() {} },
}));
import { EnemyManager } from '../../src/entities/EnemyManager';
import { WorldCombatCore as CombatSystem } from '../../src/combat/WorldCombatCore';
import { WorldCombatReactions } from '../../src/world/WorldCombatReactions';
import { WorldCombatGameplayBinding } from '../../src/world/WorldCombatGameplayBinding';
import { WorldPlayerGameplayRuntime } from '../../src/world/WorldPlayerGameplayRuntime';
import { CoopDefenseItemRuntimeSystem } from '../../src/systems/CoopDefenseItemRuntimeSystem';
import { TargetStatusSystem } from '../../src/systems/TargetStatusSystem';
import { EnergyInjectorSystem } from '../../src/systems/EnergyInjectorSystem';
import type { PlayerManager } from '../../src/entities/PlayerManager';
import type { NetworkBridge } from '../../src/network/NetworkBridge';
import { PlayerEntity } from '../../src/entities/PlayerEntity';
import { BaseEntity } from '../../src/entities/BaseEntity';
import { BaseManager } from '../../src/entities/BaseManager';
import { RockVisualHelper } from '../../src/scenes/arena/RockVisualHelper';
import { encodeEnemyUpsert } from '../../src/network/enemySnapshotCodec';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs, type CoopDefenseEnemyDeathSpawnConfig } from '../../src/config/coopDefenseEnemies';
import { HEALTH_BAR_TUNING, TURRET_HEALTH_BAR_STYLE } from '../../src/effects/health/healthBarStyles';
import { WorldHealthBarRenderer } from '../../src/effects/health/WorldHealthBarRenderer';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';
import { COOP_DEFENSE_CONSTRUCTION_IDS, getCoopDefenseConstructionDefinition } from '../../src/config/coopDefenseConstructions';
import type { BaseSpec } from '../../src/arena/BaseRegistry';
import type { PlayerProfile, SyncedEnemyDeltaState, SyncedPlaceableRock } from '../../src/types';
import type { CombatSource } from '../../src/combat/CombatScope';
import { healthBarTestScene } from '../healthBarTestScene';
import { BURN_TICK_INTERVAL_MS } from '../../src/config';
import { EnemyMovementStatusSystem } from '../../src/systems/EnemyMovementStatusSystem';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../../src/projectile/ProjectileIdentityScope';
import { createSingleOwnerProvenance } from '../../src/projectile/ProjectileSpawnRequest';
import { WorldWeaponExecutionRuntime } from '../../src/world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../../src/world/AutomatedWeaponExecutionAdapter';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { createTechnicalPhysicsBinding, createPresentation } from '../ProjectileRuntimeTestHelper';
import { fakeEntity } from '../fakeEntity';

function harness() {
  const fake = healthBarTestScene();
  let time = 0;
  const renderer = new WorldHealthBarRenderer(fake.scene, () => time, HEALTH_BAR_TUNING,
    { prewarmEnemyViews: 0, maxFreeViews: 100 });
  renderer.openWorld({});
  return { ...fake, renderer, clock(t: number) { time = t; }, tick() { renderer.update(true); } };
}
const kind = COOP_DEFENSE_ENEMY_KINDS[0];
function enemies(h: ReturnType<typeof harness>, boss = false, deathSpawns: readonly CoopDefenseEnemyDeathSpawnConfig[] = []) {
  const configs = resolveCoopDefenseEnemyConfigs(1);
  // Preserve the real codec kind, but exclude unrelated authored attacks and glow from the fixture.
  configs[kind] = {
    ...configs[kind],
    isBoss: boss,
    glow: undefined,
    weapons: [],
    imageKey: 'health-test',
    deathSpawns,
  };
  const manager = new EnemyManager(h.scene, configs);
  manager.setHealthBarRenderer(h.renderer);
  return manager;
}
function upsert(manager: EnemyManager, entry: SyncedEnemyDeltaState) {
  const u: (number | string)[] = [];
  encodeEnemyUpsert(u, entry);
  manager.applySnapshot({ u, r: [] });
}
const baseSpec: BaseSpec = {
  id: 'base', hpMax: 100, startHp: 70, faction: 'friendly', role: 'main',
  cells: [{ gridX: 1, gridY: 1 }], region: { minGridX: 1, maxGridX: 1, minGridY: 1, maxGridY: 1 },
  turrets: [], powerUpPedestals: [],
};

describe('World HP consumer boundaries', () => {
  function projectileFixture() {
    const h = harness(), manager = enemies(h);
    const players = ['p1', 'p2'].map(id => {
      const x = id === 'p1' ? 100 : 200;
      return fakeEntity({ id, x, y: 100, color: 0xffffff,
        getBounds: () => ({ left: x - 16, right: x + 16, top: 84, bottom: 116 }) });
    });
    const combat = new CombatSystem({ getPlayer: (id: string) => players.find(p => p.id === id), getAllPlayers: () => players } as unknown as PlayerManager,
      { isHost: () => true, getPlayerProfile: (id: string) => players.find(p => p.id === id),
        broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0.25 });
    combat.setEnemyManager(manager);
    combat.setPlayerMaxHpResolver(() => 1000);
    players.forEach(p => combat.initPlayer(p.id));
    upsert(manager, { id: 'e1', kind, x: 300, y: 100, hp: 1000, maxHp: 1000 });
    upsert(manager, { id: 'e2', kind, x: 400, y: 100, hp: 1000, maxHp: 1000, faction: 'allied', ownerId: 'p1' });
    upsert(manager, { id: 'e3', kind, x: 500, y: 100, hp: 1000, maxHp: 1000 });
    for (const enemy of manager.getAllEnemies()) {
      Object.assign(enemy.sprite, { getBounds: () => ({ left: enemy.sprite.x - 8, right: enemy.sprite.x + 8,
        top: enemy.sprite.y - 8, bottom: enemy.sprite.y + 8 }) });
    }
    const runtime = new WorldProjectileRuntime({ physicsBinding: createTechnicalPhysicsBinding().binding,
      presentation: createPresentation(), identityScope: new ProjectileIdentityScope(1), hostNowMs: () => 1000,
      resolveProvenance: provenance => combat.captureProjectileProvenance(provenance) });
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => combat.readCollisionTargets(sink) });
    runtime.setProjectileTargetabilityPort({
      canDamage: (source, target, team) => combat.canProjectileDamageTarget(source, String(target.id), team),
      canDamageOwner: (source, id, team) => combat.canProjectileDamageTarget(source, id, team),
      isTargetCurrentlyValid: () => true,
    });
    const direct = vi.fn(combat.resolveDirectImpact.bind(combat));
    runtime.setProjectileCombatPort({ resolveDirectImpact: direct, resolveExplosionCombat: combat.resolveExplosionCombat.bind(combat) });
    const shared = new WorldWeaponExecutionRuntime({ projectileSpawn: runtime, combatSystem: combat });
    const automated = new AutomatedWeaponExecutionAdapter(shared, runtime);
    const fire = (ownerId: string, x: number, automatic = false) => {
      const config = { ...WEAPON_CONFIGS.GLOCK, damage: 20, directDamageOverride: undefined };
      const params = { ownerId, ownerColor: 0xffffff, x, y: 100, angle: 0, targetX: x + 100, targetY: 100 };
      return automatic ? automated.fire(config, { ...params, options: { directDamageMultiplier: 2 } }) : shared.fire(config, params);
    };
    return { combat, manager, runtime, direct, fire, close: () => { runtime.destroy(); manager.destroy(); } };
  }

  it.each([false, true])('keeps hostile projectile allegiance after source removal (%s)', remove => {
    const f = projectileFixture();
    expect(f.fire('e1', 100)).toBe(true);
    const saved = f.combat.captureProjectileProvenance(createSingleOwnerProvenance('e1'));
    if (remove) f.manager.applySnapshot({ u: [], r: [1] });
    expect(f.combat.canProjectileDamageTarget(saved, 'p1')).toBe(true);
    expect(f.combat.canProjectileDamageTarget(saved, 'e2')).toBe(true);
    expect(f.combat.canProjectileDamageTarget(saved, 'e3')).toBe(false);
    f.runtime.runHostInteractionStage(1000);
    expect(f.combat.getHP('p1')).toBe(980);
    expect(f.direct.mock.results[0]?.value).toMatchObject({ accepted: true, actualDamage: 20 });
    expect(f.direct.mock.calls[0]?.[0].provenance).toMatchObject({ gameplaySourceKind: 'enemy', allegiance: { kind: 'enemy', factionId: 'hostile' } });
    f.close();
  });

  it('keeps an allied projectile reward recipient after its source disappears', () => {
    const f = projectileFixture(), kill = vi.fn();
    upsert(f.manager, { id: 'e1', hp: 10, maxHp: 1000 });
    f.combat.setKillCallback(kill);
    expect(f.fire('e2', 300)).toBe(true);
    f.manager.applySnapshot({ u: [], r: [2] });
    f.runtime.runHostInteractionStage(1000);
    expect(f.manager.getEnemy('e1')).toBeUndefined();
    expect(kill).toHaveBeenCalledExactlyOnceWith('p1', 'e1', expect.any(String), 300, 100, expect.objectContaining({
      provenance: expect.objectContaining({ gameplaySource: { kind: 'enemy', id: 'e2' }, attribution: { kind: 'player', id: 'p1' } }),
    }));
    f.close();
  });

  it.each(['player', 'enemy'] as const)('applies pending projectile power once against %s and retains automatic scaling', target => {
    for (const automatic of [false, true]) {
      const f = projectileFixture();
      f.combat.setLoadoutManager({ getDamageMultiplier: () => 2, getWeaponDamageMultiplier: () => 2 });
      f.combat.setPowerUpSystem({ getDamageMultiplier: () => 3 } as never);
      const shield = vi.fn(() => false);
      f.combat.setEnergyShieldSystem({ tryBlockDamage: shield, tryDomeProtect: () => false } as never);
      expect(f.fire('p1', target === 'player' ? 200 : 300, automatic)).toBe(true);
      f.runtime.runHostInteractionStage(1000);
      const expected = automatic ? 40 : 120;
      expect(f.direct.mock.results[0]?.value).toMatchObject({ accepted: true, actualDamage: expected });
      expect(target === 'player' ? f.combat.getHP('p2') : f.manager.getEnemy('e1')!.getHp()).toBe(1000 - expected);
      if (target === 'player') expect(shield).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ damage: expected }));
      f.close();
    }
  });

  it('applies Plasma explosion slow only to eligible enemies', () => {
    const f = projectileFixture(), movement = new EnemyMovementStatusSystem();
    f.combat.setMovementStatusPort(movement);
    const source = createSingleOwnerProvenance('p1', { weaponSourceId: 'weapon.plasma:swarm-explosion' });
    f.combat.resolveExplosionCombat({ x: 350, y: 100, provenance: source,
      effect: { radius: 100, maxDamage: 20, minDamage: 20, knockback: 0, selfDamageMult: 0,
        damageTarget: 'enemies', enemySlowFraction: 0.5, enemySlowDurationMs: 1000 } });
    expect(f.manager.getEnemy('e1')!.getHp()).toBe(980);
    expect(f.manager.getEnemy('e2')!.getHp()).toBe(1000);
    expect(movement.getMovementFactor(f.manager.getCombatTargetRef('e1')!, 1000)).toBe(0.5);
    expect(movement.getMovementFactor(f.manager.getCombatTargetRef('e2')!, 1000)).toBe(1);
    movement.clear();
    const statusOnly = f.combat.resolveDirectImpact({ projectileId: 123, target: { kind: 'enemy', id: 'e1' },
      impact: { x: 300, y: 100 }, velocity: { x: 1, y: 0 }, provenance: source,
      directHit: { damage: 0, slowFraction: 0.5, slowDurationMs: 1000 }, augments: [] });
    expect(statusOnly).toMatchObject({ accepted: true, actualDamage: 0 });
    expect(movement.getMovementFactor(f.manager.getCombatTargetRef('e1')!, 1000)).toBe(0.5);
    f.close();
  });

  it.each([
    { hook: 'timebomb', applyNewStatus: false },
    { hook: 'timebomb', applyNewStatus: true },
    { hook: 'necromancy', applyNewStatus: false },
    { hook: 'necromancy', applyNewStatus: true },
    { hook: 'death-spawn', applyNewStatus: false },
    { hook: 'death-spawn', applyNewStatus: true },
    { hook: 'none', applyNewStatus: false },
  ] as const)('ends old target status before $hook (new status: $applyNewStatus)', ({ hook, applyNewStatus }) => {
    const h = harness(), manager = enemies(h, false, hook === 'death-spawn' ? [{ enemyKind: kind, count: 1, offsetPx: 0 }] : []);
    const statuses = new TargetStatusSystem(), injector = new EnergyInjectorSystem();
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 40, maxHp: 100 });
    const oldTarget = manager.getCombatTargetRef('e1');
    const target = { targetType: 'enemy' as const, targetId: 'e1' };
    statuses.applyVulnerability(target, 10000, 1000); injector.setFocusTarget('old-owner', target, 10000, 1000);
    injector.setFocusTarget('renewed-owner', target, 10000, 1000);
    const inert = new Proxy({}, { get: () => () => undefined }); // Unrelated attachment ports only.
    const itemRuntime = new CoopDefenseItemRuntimeSystem({
      getAffixValue: () => 0, getPlayerHp: () => null,
    });
    itemRuntime.setTargetStatusSystem(statuses);
    // Exercise the production reaction adapters with the real item/status owners.
    const playerRuntime = Object.assign(Object.create(WorldPlayerGameplayRuntime.prototype), {
      systems: { resource: inert, loadout: inert, playerModifier: inert, burrow: inert,
        itemRuntime, utilityAction: inert },
    }) as WorldPlayerGameplayRuntime;
    const playerCombat = playerRuntime.getPlayerCombatIntegrationPort();
    let playerCombatAttached = false;
    const players = { getPlayer: () => undefined, getAllPlayers: () => [], setSpawnContextProvider: () => {} } as unknown as PlayerManager;
    const combat = new CombatSystem(players,
      { isHost: () => true, broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => 1234, random: () => 0.25 });
    const replace = () => {
      expect(statuses.isVulnerable(target, 1234)).toBe(false);
      expect(injector.getFocusTarget('old-owner', 1234)).toBeNull();
      expect(injector.getFocusTarget('renewed-owner', 1234)).toBeNull();
      upsert(manager, { id: 'e1', kind, x: 30, y: 40, hp: 100, maxHp: 100 });
      expect(manager.getCombatTargetRef('e1')).not.toEqual(oldTarget);
      if (applyNewStatus) {
        // A successor's shorter application must not merge with the old lifetime.
        statuses.applyVulnerability(target, 1000, 1234);
        injector.setFocusTarget('new-owner', target, 1000, 1234);
        injector.setFocusTarget('renewed-owner', target, 1000, 1234);
      }
    };
    if (hook === 'death-spawn') manager.setEnemySpawnedCallback(replace);
    const binding = new WorldCombatGameplayBinding({
      playerManager: players, combatSystem: combat, baseManager: null, automatedWeaponExecution: null,
      getPlayerCombatIntegration: () => playerCombatAttached ? playerCombat : null, getEnemyManager: () => manager,
      getTargetStatusSystem: () => statuses, getEnergyInjectorSystem: () => injector,
      getTargetFootprint: () => null, getPowerUpSystem: () => null,
      getWorldGeometryBinding: () => null, getMissionBarrierObstacles: () => null,
      syncActiveBaseIds: () => {},
      getTimebombSystem: () => ({ handleKilled: () => { if (hook === 'timebomb') replace(); return hook === 'timebomb'; } }),
      getNecromancySystem: () => ({ recordEnemyDeath: () => { if (hook === 'necromancy') replace(); } }),
      isCoopMission: () => false, isActivityActive: () => false, getSpawnContext: () => undefined,
      hostPhysics: inert, decoySystem: inert, fireSystem: inert, gameAudioSystem: inert, placementSystem: inert,
      projectileEvents: inert, projectileTimeField: inert, projectileHoming: inert, projectileWorldImpact: inert,
      projectileSwarm: inert, projectileInteraction: inert, hostUpdate: inert,
      network: { authority: { isHost: () => true, getPlayerProfile: () => undefined, getConnectedPlayers: () => [] },
        stats: inert, effects: inert, round: inert },
    } as never);
    playerCombatAttached = true;
    const result = combat.applyDamage('e1', 100, false, 'old-attacker', 'test');
    expect(result).toMatchObject({ actualDamage: 40, transition: { kind: 'dead' } });
    expect(statuses.getSnapshot(1234)).toEqual(applyNewStatus ? [{ ...target, expiresAt: 2234 }] : []);
    expect(injector.getFocusTarget('old-owner', 1234)).toBeNull();
    expect(injector.getNetFocusSnapshot(1234)).toEqual(applyNewStatus ? [
      { ...target, ownerId: 'new-owner', startedAt: 1234, expiresAt: 2234 },
      { ...target, ownerId: 'renewed-owner', startedAt: 1234, expiresAt: 2234 },
    ] : []);
    if (hook !== 'none') expect(manager.getEnemy('e1')!.getHp()).toBe(100);
    else expect(manager.getEnemy('e1')).toBeUndefined();
    binding.destroy(); manager.destroy();
  });

  it.each([
    { teardown: 'owner', afterSpawn: 1 },
    { teardown: 'owner', afterSpawn: 2 },
    { teardown: 'owner', afterSpawn: 4 },
    { teardown: 'activity', afterSpawn: 1 },
    { teardown: 'world', afterSpawn: 4 },
    { teardown: 'none', afterSpawn: 0 },
  ] as const)('bounds death spawns by $teardown lifetime after spawn $afterSpawn', ({ teardown, afterSpawn }) => {
    const deathSpawns = [
      { enemyKind: kind, count: 2, offsetPx: 10 },
      { enemyKind: kind, count: 3, offsetPx: 20 },
      { enemyKind: kind, count: 1, offsetPx: 30 },
    ];
    const h = harness(), manager = enemies(h, false, deathSpawns);
    const parent = manager.hostSpawnAtWorld(10, 20, kind, { originId: 'encounter' });
    manager.hostSetVitalsBaseline(parent.id, 40, 100);
    const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager,
      { isHost: () => true, broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    const world = combat.bindHostExecutionSources({ nowMs: () => 1234, random: () => 0.25 });
    combat.setEnemyManager(manager);
    const spawned: { x: number; y: number; kind: string; originId?: string }[] = [];
    manager.setEnemySpawnedCallback(enemy => {
      expect(manager.getAllEnemies()).not.toContain(parent);
      spawned.push({ x: enemy.sprite.x, y: enemy.sprite.y, kind: enemy.kind, originId: enemy.originId });
      if (spawned.length !== afterSpawn) return;
      if (teardown === 'owner') manager.destroy();
      if (teardown === 'activity') combat.invalidatePlayerLifecyclePolicy();
      if (teardown === 'world') world.destroy();
    });
    const death = vi.fn(), kill = vi.fn();
    combat.setEnemyDeathCallback(death); combat.setKillCallback(kill);
    const outcome = combat.applyDamage(parent.id, 100, false, 'attacker', 'synthetic');
    expect(outcome).toMatchObject({ actualDamage: 40, resultingState: { hp: 0, alive: false }, transition: { kind: 'dead' } });
    const expectedBatch = deathSpawns.flatMap(config => Array.from({ length: config.count }, (_, index) => ({
      x: 10 + Math.cos(index * Math.PI * 2 / config.count) * config.offsetPx,
      y: 20 + Math.sin(index * Math.PI * 2 / config.count) * config.offsetPx,
      kind: config.enemyKind, originId: 'encounter',
    })));
    expect(spawned).toEqual(teardown === 'none' ? expectedBatch : expectedBatch.slice(0, afterSpawn));
    expect(manager.getAllEnemies()).toHaveLength(teardown === 'owner' ? 0 : spawned.length);
    // Owner removal alone does not cancel the committed parent's terminal facts.
    const terminalCalls = teardown === 'activity' || teardown === 'world' ? 0 : 1;
    expect(death).toHaveBeenCalledTimes(terminalCalls);
    expect(kill).toHaveBeenCalledTimes(terminalCalls);
    manager.completeCombatDeath(outcome!);
    expect(spawned).toHaveLength(teardown === 'none' ? expectedBatch.length : afterSpawn);
    manager.destroy(); world.destroy();
  });

  it.each(['death', 'kill'] as const)('preserves successor attribution across the old enemy %s hook', hook => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 40, maxHp: 100 });
    const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager,
      { isHost: () => true, broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => 1234, random: () => 0.25 }); combat.setEnemyManager(manager);
    const observed = vi.fn(); combat.addDamageDealtObserver(observed);
    let replaced = false;
    const replaceAndHit = () => {
      if (replaced) return;
      replaced = true;
      upsert(manager, { id: 'e1', kind, x: 30, y: 40, hp: 100, maxHp: 100 });
      combat.applyDamage('e1', 10, false, 'new-attacker', 'new-weapon', undefined, { damageKind: 'direct', sourceSlot: 'weapon1' });
    };
    const kills = vi.fn(() => { if (hook === 'kill') replaceAndHit(); });
    combat.setKillCallback(kills);
    combat.setEnemyDeathCallback(() => { if (hook === 'death') replaceAndHit(); });
    const oldOutcome = combat.applyDamage('e1', 40, false, 'old-attacker', 'old-weapon');
    expect(oldOutcome).toMatchObject({ actualDamage: 40, transition: { kind: 'dead' } });
    expect(manager.getEnemy('e1')!.getHp()).toBe(90);
    const newOutcome = combat.applyDamage('e1', 100, false);
    expect(newOutcome).toMatchObject({ actualDamage: 90, transition: { kind: 'dead' } });
    expect(kills.mock.calls.map(call => (call as unknown[]).slice(0, 3))).toEqual([
      ['old-attacker', 'e1', 'old-weapon'], ['new-attacker', 'e1', 'new-weapon'],
    ]);
    expect(observed.mock.calls.map(call => call[0].damage)).toEqual([10, 40, 90]);
    manager.destroy();
  });

  it.each(['leech', 'primary', 'slow'] as const)('does not Cull a replacement enemy after the %s hook', stage => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 40, maxHp: 100 });
    const actor = { id: 'attacker', x: 0, y: 0, body: { enable: true } };
    const combat = new CombatSystem({ getPlayer: (id: string) => id === actor.id ? actor : undefined } as unknown as PlayerManager,
      { isHost: () => true, broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => 1234, random: () => 0.25 });
    combat.setEnemyManager(manager); combat.initPlayer(actor.id);
    const observed = vi.fn(); combat.addDamageDealtObserver(observed);
    const replace = () => {
      manager.applySnapshot({ u: [], r: [1] });
      upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 100, maxHp: 100 });
    };
    if (stage === 'leech') {
      combat.applyDamage(actor.id, 20, false);
      combat.setPlayerLifeLeechFractionResolver(() => 1);
      combat.setHealingReceivedHandler(replace);
    }
    if (stage === 'slow') vi.spyOn(combat, 'applyEnemySlow').mockImplementation(replace);
    const primary = vi.fn(() => {
      if (stage === 'primary') replace();
      return { slowFraction: 0.1, slowDurationMs: 1000, shouldCull: true };
    });
    const reactions = new WorldCombatReactions({ combatSystem: combat,
      getPlayerCombatIntegration: () => ({ reactions: { handleDirectPrimaryHit: primary } }),
    } as never);
    combat.setDirectPrimaryHitHandler((attacker, id, hp, max, boss, target) =>
      reactions.handleDirectPrimaryHit(attacker, id, hp, max, boss, 1234, target, () => true));
    const parent = combat.applyDamage('e1', 10, false, actor.id, 'synthetic', undefined,
      { damageKind: 'direct', sourceSlot: 'weapon1' });
    expect(parent).toMatchObject({ actualDamage: 10, resultingState: { hp: 30, alive: true } });
    expect(manager.getEnemy('e1')!.getHp()).toBe(100);
    expect(primary).toHaveBeenCalledTimes(stage === 'leech' ? 0 : 1);
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'e1', damage: 10 }));
    manager.destroy();
  });

  it('retains the allied Burn source snapshot and player attribution after the source disappears', () => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 10, maxHp: 100 });
    upsert(manager, { id: 'e2', kind, x: 30, y: 40, hp: 100, maxHp: 100, faction: 'allied', ownerId: 'credited' });
    let now = 1000;
    const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager,
      { isHost: () => true, broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 }); combat.setEnemyManager(manager);
    const kill = vi.fn(); combat.setKillCallback(kill);
    combat.applyBurnHit('e1', 'e2', 2000, 10, 'fire', 'summon.fire', 'generic');
    manager.applySnapshot({ u: [], r: [2] });
    now += 250; combat.updateBurnEffects(now);
    expect(manager.getEnemy('e1')).toBeUndefined();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls[0]?.[0]).toBe('credited');
    expect(kill.mock.calls[0]?.[5]).toMatchObject({ damageOrigin: { kind: 'burn' }, provenance: {
      gameplaySource: { kind: 'enemy', id: 'e2' }, actor: { kind: 'enemy', id: 'e2' },
      attribution: { kind: 'player', id: 'credited' }, allegiance: { ownerId: 'e2', factionId: 'allied' },
      authoredSourceId: 'summon.fire', origin: 'burn',
    } });
    manager.destroy();
  });

  it.each([false, true])('uses the new Burn lifetime attribution after expiry (another source remains: %s)', keepOtherSource => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 100, maxHp: 100 });
    upsert(manager, { id: 'e2', kind, x: 30, y: 40, hp: 100, maxHp: 100, faction: 'allied', ownerId: 'old-owner' });
    upsert(manager, { id: 'e3', kind, x: 30, y: 40, hp: 100, maxHp: 100, faction: 'allied', ownerId: 'other-owner' });
    const tick = BURN_TICK_INTERVAL_MS;
    let now = 4 * tick;
    const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager,
      { isHost: () => true, broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 }); combat.setEnemyManager(manager);
    const kill = vi.fn(); combat.setKillCallback(kill);
    combat.applyBurnHit('e1', 'e2', 2 * tick, 1, 'fire', 'summon.fire', 'generic');
    if (keepOtherSource) combat.applyBurnHit('e1', 'e3', 10 * tick, 1, 'fire', 'summon.fire', 'generic');
    now += 2 * tick; combat.updateBurnEffects(now);
    expect(combat.getActiveBurnSources('e1', now).map(entry => entry.attackerId))
      .toEqual(keepOtherSource ? ['e3'] : []);
    manager.applySnapshot({ u: [], r: [2] });
    upsert(manager, { id: 'e2', kind, x: 30, y: 40, hp: 100, maxHp: 100, faction: 'allied', ownerId: 'new-owner' });
    combat.applyBurnHit('e1', 'e2', 3 * tick, 100, 'fire', 'summon.fire', 'generic');
    // Both the new effect's attribution and its actor survive removal before the lethal tick.
    manager.applySnapshot({ u: [], r: [2] });
    now += tick; combat.updateBurnEffects(now);
    expect(manager.getEnemy('e1')).toBeUndefined();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls[0]?.[0]).toBe('new-owner');
    expect(kill.mock.calls[0]?.[5].provenance).toMatchObject({
      gameplaySource: { kind: 'enemy', id: 'e2' }, actor: { kind: 'enemy', id: 'e2' },
      attribution: { kind: 'player', id: 'new-owner' }, authoredSourceId: 'summon.fire', origin: 'burn',
    });
    manager.destroy();
  });

  it('keeps old Burn ticks credited to their source while a replacement source overlaps', () => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 10, maxHp: 100 });
    upsert(manager, { id: 'e2', kind, x: 30, y: 40, hp: 100, maxHp: 100, faction: 'allied', ownerId: 'old-owner' });
    const tick = BURN_TICK_INTERVAL_MS;
    let now = 4 * tick;
    const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager,
      { isHost: () => true, broadcastEffect: () => {}, areTeammates: () => false } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 }); combat.setEnemyManager(manager);
    const kill = vi.fn(); combat.setKillCallback(kill);
    combat.applyBurnHit('e1', 'e2', 3 * tick, 10, 'fire', 'summon.fire', 'generic');
    manager.applySnapshot({ u: [], r: [2] });
    upsert(manager, { id: 'e2', kind, x: 30, y: 40, hp: 100, maxHp: 100, faction: 'allied', ownerId: 'new-owner' });
    combat.applyBurnHit('e1', 'e2', 3 * tick, 1, 'fire', 'summon.fire', 'generic');
    manager.applySnapshot({ u: [], r: [2] });
    now += tick; combat.updateBurnEffects(now);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls[0]?.[0]).toBe('old-owner');
    expect(kill.mock.calls[0]?.[5].provenance).toMatchObject({
      actor: { kind: 'enemy', id: 'e2' }, attribution: { kind: 'player', id: 'old-owner' },
    });
    manager.destroy();
  });

  it('keeps a nonlethal parent receipt separate from the Cull death and its terminal attribution', () => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 40, maxHp: 100 });
    const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager, {
      isHost: () => true, broadcastEffect: () => {},
    } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => 1234, random: () => 0.25 });
    combat.setEnemyManager(manager);
    const kill = vi.fn(), death = vi.fn();
    combat.setKillCallback(kill); combat.setEnemyDeathCallback(death);
    const primary = vi.fn((attacker: string, id: string, hp: number) => {
      combat.applyDamage(id, hp, false, attacker, 'cull', undefined, { damageKind: 'reaction', sourceSlot: 'weapon1', skipLifeLeech: true });
    });
    combat.setDirectPrimaryHitHandler(primary);
    const parent = combat.applyDamage('e1', 10, false, 'attacker', 'synthetic', undefined, { damageKind: 'direct', sourceSlot: 'weapon1' });
    expect(parent).toMatchObject({ actualDamage: 10, resultingState: { hp: 30, alive: true }, transition: { kind: 'none' } });
    expect(primary).toHaveBeenCalledTimes(1); expect(death).toHaveBeenCalledTimes(1); expect(kill).toHaveBeenCalledTimes(1);
    expect(manager.getEnemy('e1')).toBeUndefined();
    expect(kill.mock.calls[0]?.[5]).toMatchObject({ enemyKind: kind, victimFaction: 'hostile', damageOrigin: { kind: 'reaction' } });
    manager.destroy();
  });

  it('retains saved attribution after source and victim removal and stops on Activity teardown', () => {
    for (const teardown of [false, true]) {
      const h = harness(), manager = enemies(h);
      upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 40, maxHp: 100 });
      const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager, {
        isHost: () => true, broadcastEffect: () => {},
      } as unknown as NetworkBridge);
      combat.bindHostExecutionSources({ nowMs: () => 1234, random: () => 0.25 }); combat.setEnemyManager(manager);
      const source: CombatSource = {
        gameplaySource: { kind: 'enemy', id: 'removed-summon' }, actor: { kind: 'enemy', id: 'removed-summon' },
        attribution: { kind: 'player', id: 'credited-player' },
        allegiance: { ownerId: 'different-team-owner', factionId: 'allied' }, origin: 'burn',
      };
      const kill = vi.fn(); combat.setKillCallback(kill);
      combat.setEnemyDeathCallback(() => {
        expect(manager.getEnemy('e1')).toBeUndefined();
        if (teardown) { combat.invalidatePlayerLifecyclePolicy(); manager.destroy(); }
      });
      const outcome = combat.applyDamage('e1', 100, false, 'removed-summon', 'burn', undefined, { source, damageKind: 'burn' });
      expect(outcome).toMatchObject({ actualDamage: 40, transition: { kind: 'dead' } });
      if (teardown) expect(kill).not.toHaveBeenCalled();
      else {
        expect(kill).toHaveBeenCalledTimes(1);
        expect(kill.mock.calls[0]?.[0]).toBe('credited-player');
        expect(kill.mock.calls[0]?.[5].provenance).toEqual(source);
      }
      manager.destroy();
    }
  });

  it('reports real Combat resolution damage separately from Enemy rescue healing', () => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 40, maxHp: 100 });
    manager.setLethalDamageGuard(() => ({ kind: 'rescue', healing: 20 }));
    const combat = new CombatSystem({ getPlayer: () => undefined } as unknown as PlayerManager, {
      isHost: () => true, broadcastEffect: () => {},
    } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => 1234, random: () => 0.25 });
    combat.setEnemyManager(manager);
    const damage = vi.fn(), primary = vi.fn();
    combat.setDamageDealtHandler(damage);
    combat.setDirectPrimaryHitHandler(primary);
    const outcome = combat.applyDamage('e1', 100, false, 'attacker', 'synthetic', undefined, { damageKind: 'direct', sourceSlot: 'weapon1' });
    expect(outcome).toMatchObject({ kind: 'damage-applied', actualDamage: 40, rescueHealing: 20, transition: { kind: 'none' }, resultingState: { hp: 20, alive: true } });
    expect(damage).toHaveBeenCalledWith('enemy', 'e1', 'attacker', 40, 'direct', 'hostile');
    expect(primary).toHaveBeenCalledOnce();
    const target = manager.getCombatTargetRef('e1')!;
    const supported = combat.applySupport({ outcomeId: 'enemy-heal', target, source: {
      gameplaySource: { kind: 'enemy', id: 'e1' }, attribution: { kind: 'enemy', id: 'e1' },
      allegiance: { ownerId: 'e1', factionId: 'hostile' }, origin: 'support',
    }, supportKind: 'heal', amount: 30 });
    expect(supported).toMatchObject({ kind: 'support-applied', actualAmount: 30, resultingState: { hp: 50 } });
    expect(outcome).toMatchObject({ actualDamage: 40, resultingState: { hp: 20 } });
  });

  it('uses per-entity baselines and real encoded full/refresh upserts without extending visibility', () => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 100, maxHp: 100 });
    upsert(manager, { id: 'e2', kind, x: 30, y: 40, hp: 60, maxHp: 100 });
    h.tick();
    expect(h.renderer.getStats()).toMatchObject({ bindings: 2, active: 0 });
    upsert(manager, { id: 'e2', hp: 40, maxHp: 100 });
    manager.getEnemy('e2')!.setHealthBarRenderer(h.renderer); // Idempotent visual wiring preserves the trail.
    h.tick();
    expect(h.rectangles[2].width * h.rectangles[2].scaleX / h.rectangles[0].width).toBeCloseTo(0.4);
    expect(h.rectangles[1].width * h.rectangles[1].scaleX / h.rectangles[0].width).toBeCloseTo(0.6);
    for (let t = 100; t <= HEALTH_BAR_TUNING.visibleAfterDamageMs + 200; t += 100) {
      h.clock(t);
      upsert(manager, { id: 'e2', kind, x: 30, y: 40, hp: 40, maxHp: 100 });
      h.tick();
    }
    expect(h.renderer.getStats().active).toBe(0);
    upsert(manager, { id: 'e2', hp: 39, maxHp: 100 });
    h.tick();
    expect(h.renderer.getStats().active).toBe(1);
    manager.destroy();
    expect(h.renderer.getStats().bindings).toBe(0);
  });

  it('silently absorbs burrow recovery snapshots and resets removed/reused entity IDs', () => {
    const h = harness(), manager = enemies(h);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 100, maxHp: 100 });
    upsert(manager, { id: 'e1', hp: 70, maxHp: 100 });
    h.tick();
    upsert(manager, { id: 'e1', burrowed: true, hp: 50, maxHp: 100 });
    upsert(manager, { id: 'e1', burrowed: false, hp: 30, maxHp: 100 });
    h.tick();
    expect(h.renderer.getStats().active).toBe(0);
    manager.applySnapshot({ u: [], r: [1] });
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 15, maxHp: 100 });
    h.tick();
    expect(h.renderer.getStats()).toMatchObject({ bindings: 1, active: 0 });
  });

  it('keeps bosses visible and retains non-HP decorations, including lethal guard rescue', () => {
    const h = harness(), manager = enemies(h, true);
    upsert(manager, { id: 'e1', kind, x: 10, y: 20, hp: 100, maxHp: 100 });
    h.tick();
    expect(h.renderer.getStats().active).toBe(1);
    const enemy = manager.getEnemy('e1')!;
    enemy.setPosition(90, 100);
    enemy.syncBar();
    expect(h.cosmetic.some(object => object.x === 90 && object !== enemy.sprite)).toBe(true);
    manager.setLethalDamageGuard(() => ({ kind: 'rescue', healing: 30 }));
    const rescued = manager.applyDamage('e1', 1000);
    expect(rescued?.died).toBe(false);
    expect(rescued?.outcome).toMatchObject({
      kind: 'damage-applied',
      actualDamage: 100,
      hpLost: 100,
      rescueHealing: 30,
      transition: { kind: 'none' },
      resultingState: { hp: 30, alive: true },
    });
    expect(manager.applyHealing('e1', 100, 'hp-regeneration')).toMatchObject({
      kind: 'support-applied',
      supportKind: 'hp-regeneration',
      actualAmount: 70,
      resultingState: { hp: 100, alive: true },
    });
    h.tick();
    expect(h.renderer.getStats()).toMatchObject({ bindings: 1, active: 1 });
    h.clock(100_000); h.tick();
    expect(h.renderer.getStats().active).toBe(1);
    manager.destroy();
  });

  it('freezes terminal Enemy facts before removal and runs death spawns after cleanup', () => {
    const h = harness(), manager = enemies(h, false, [{ enemyKind: kind, count: 1, offsetPx: 0 }]);
    const enemy = manager.hostSpawnAtWorld(45, 67, kind);
    const target = manager.getCombatTargetRef(enemy.id)!;
    const spawnedAfterRemoval = vi.fn(() => {
      expect(manager.hasEnemy(enemy.id)).toBe(false);
    });
    manager.setEnemySpawnedCallback(spawnedAfterRemoval);

    const result = manager.applyDamage(enemy.id, enemy.getMaxHp() + 100)!;

    expect(result.outcome).toMatchObject({
      kind: 'damage-applied',
      actualDamage: enemy.getMaxHp(),
      hpLost: enemy.getMaxHp(),
      transition: {
        kind: 'dead',
        facts: {
          position: { x: 45, y: 67 },
          targetCategory: kind,
          rewardEligible: true,
        },
      },
    });
    expect(Object.isFrozen(result.outcome)).toBe(true);
    expect(spawnedAfterRemoval).toHaveBeenCalledOnce();

    const source: CombatSource = {
      gameplaySource: { kind: 'player', id: 'p1' },
      attribution: { kind: 'player', id: 'p1' },
      allegiance: { ownerId: 'p1' },
      origin: 'direct',
    };
    expect(manager.commitDamage({
      outcomeId: 'stale-enemy',
      target,
      source,
      damage: {
        amount: 1,
        damageKind: 'direct',
        basis: { kind: 'authored', amount: 1 },
        sourceFactors: [],
        targetFactors: [],
        isCritical: false,
      },
    })).toMatchObject({ kind: 'rejected', reason: 'target-missing' });
    manager.destroy();
  });

  it('keeps Player world policies, health baselines, armor separation, stealth and respawn', () => {
    const h = harness();
    const player = new PlayerEntity(h.scene, { id: 'p', name: 'P', colorHex: 0x88ff88 } as PlayerProfile,
      10, 20, true, null, { spawnEffect: false });
    player.setHealthBarRenderer(h.renderer);
    player.updateHP(60, 100);
    h.tick();
    const [bg, trail, fill] = h.rectangles.slice(-3);
    expect(fill.width * fill.scaleX / bg.width).toBeCloseTo(0.6);
    expect(trail.visible).toBe(false);
    player.updateArmor(30);
    player.updateHP(60, 100);
    h.tick();
    expect(trail.visible).toBe(false);
    player.updateHP(40, 100); h.tick();
    expect(trail.visible).toBe(true);
    player.setWorldBarsVisible(false); h.tick();
    expect(h.renderer.getStats().active).toBe(0);
    player.setWorldBarsVisible(true); h.tick();
    expect(h.renderer.getStats().active).toBe(1);
    player.setDecoyStealth(true); player.updateHP(20, 100); h.tick();
    expect(h.renderer.getStats().active).toBe(0);
    player.setDecoyStealth(false); h.tick();
    expect(trail.visible).toBe(false);
    player.updateHP(0, 100); player.setVisible(false); h.tick();
    player.updateHP(100, 100); player.setVisible(true); h.tick();
    expect(fill.width * fill.scaleX).toBe(bg.width);
    expect(trail.visible).toBe(false);
    player.destroy();
    expect(h.renderer.getStats().bindings).toBe(0);
  });

  it('creates no bars or animation resources for rendererless player/base simulation', () => {
    const h = harness();
    const player = new PlayerEntity(h.scene, { id: 'p', colorHex: 1, name: 'P' } as PlayerProfile,
      0, 0, false, null, { visuals: false });
    player.setHealthBarRenderer(h.renderer);
    player.updateHP(20, 100);
    const base = new BaseEntity(h.scene, baseSpec, resolveCoopDefenseWorldMetrics(20, 20), false, true, h.renderer);
    base.applyDamage(10);
    h.tick();
    expect(h.renderer.getStats()).toMatchObject({ bindings: 0, active: 0, created: 0 });
    player.destroy(); base.destroy();
  });

  it('applies base snapshots once, preserves start HP, and treats repair/overlay/dormancy correctly', () => {
    const h = harness();
    const bases = new BaseManager(h.scene, [baseSpec], resolveCoopDefenseWorldMetrics(20, 20), {}, true, true, h.renderer);
    h.tick();
    const [bg, trail, fill] = h.rectangles.slice(-3);
    expect(fill.width * fill.scaleX / bg.width).toBeCloseTo(0.7);
    bases.applySnapshot([{ id: 'base', hp: 50, maxHp: 100 }]); h.tick();
    expect(trail.visible).toBe(false);
    bases.applySnapshot([{ id: 'base', hp: 30, maxHp: 100 }]); h.tick();
    expect(trail.visible).toBe(true);
    h.clock(10_000);
    bases.applySnapshot([{ id: 'base', hp: 30, maxHp: 100 }]); h.tick();
    expect(trail.visible).toBe(false);
    const color = fill.fillColor;
    bases.heal('base', 10); h.tick();
    expect(fill.width * fill.scaleX / bg.width).toBeCloseTo(0.4);
    expect(fill.fillColor).not.toBe(color);
    const activity = bases.createActivityBinding([{ baseId: 'base', hpMax: 200, startHp: 100,
      dormant: true, powerUpPedestals: [] }]);
    activity.attach(); h.tick();
    expect(h.renderer.getStats().bindings).toBe(0);
    bases.getBase('base')!.activate(); h.tick();
    expect(fill.width * fill.scaleX / bg.width).toBeCloseTo(0.5);
    expect(trail.visible).toBe(false);
    activity.detach(); h.tick();
    expect(h.renderer.getStats().bindings).toBe(0);
    bases.destroy();
  });

  it('keeps construction bars damaged until repair, without a timed enemy deadline', () => {
    const h = harness();
    const world = { context: { metrics: resolveCoopDefenseWorldMetrics(20, 20) },
      materialization: { arena: { rockVisualSystem: {} } }, presentation: { layout: {} } };
    const helper = new RockVisualHelper(h.scene, {} as never, null, {} as never, null,
      { getWorldRuntime: () => world as never, getTargetingRuntime: () => null,
        getPlayerGameplayRuntime: () => null, getPowerUpRuntime: () => null }, h.renderer);
    const rock = { id: 1, kind: 'turret', gridX: 2, gridY: 2, hp: 70, maxHp: 100,
      angle: 0, ownerColor: 0x123456, ownerId: 'p' } as SyncedPlaceableRock;
    helper.createOrUpdateTurretVisual(rock); h.tick();
    const [bg, trail, fill] = h.rectangles;
    expect(fill.width * fill.scaleX).toBe(TURRET_HEALTH_BAR_STYLE.width * 0.7);
    expect(trail.visible).toBe(false);
    helper.createOrUpdateTurretVisual({ ...rock, hp: 40 }); h.tick();
    expect(trail.visible).toBe(true);
    h.clock(100_000); h.tick();
    expect(fill.visible).toBe(true);
    helper.createOrUpdateTurretVisual({ ...rock, hp: 40, gridX: 4 }); h.tick();
    expect(trail.visible).toBe(false);
    expect(bg.x).toBeGreaterThan(0);
    helper.createOrUpdateTurretVisual({ ...rock, hp: 100 }); h.tick();
    expect(fill.visible).toBe(false);
    helper.destroyAllTurretVisuals();
    expect(h.renderer.getStats().bindings).toBe(0);
    const indestructible = COOP_DEFENSE_CONSTRUCTION_IDS.find(id => getCoopDefenseConstructionDefinition(id).indestructible)!;
    expect(indestructible).toBeDefined();
    helper.createOrUpdateTurretVisual({ ...rock, id: 2, constructionId: indestructible }); h.tick();
    expect(h.renderer.getStats().bindings).toBe(0);
    helper.destroyAllTurretVisuals();
  });
});
