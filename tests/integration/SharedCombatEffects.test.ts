import { describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ now: 1000 }));
vi.mock('../../src/network/bridge', () => ({ bridge: {
  getSynchronizedNow: () => clock.now, isArenaCountdownActive: () => false,
  getActivityDescriptor: () => null, getActiveGameMode: () => 'coop_defense',
  getConnectedPlayers: () => [], getLocalPlayerId: () => 'headless',
  getPlayerHeldItemId: () => null, getPlayerInput: () => null, flushEffects() {},
  getPlayerColor: () => 0xffffff, broadcastExplosionEffect() {},
} }));
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url), root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  const Line = require(root + 'src/geom/line/Line.js');
  return { ...phaser, Geom: { ...phaser.Geom,
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Line: Object.assign(Line, { Length: (l: any) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }) } };
});

import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { StinkCloudSystem } from '../../src/effects/StinkCloudSystem';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { ShootingRangeWorldBinding } from '../../src/shootingRange/ShootingRangeWorldBinding';
import { SHOOTING_RANGE } from '../../src/shootingRange/ShootingRangeLayout';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { CELL_SIZE } from '../../src/config';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../../src/projectile/ProjectileIdentityScope';
import { createSingleOwnerProvenance } from '../../src/projectile/ProjectileSpawnRequest';
import { PlasmaSwarmReactionSystem } from '../../src/systems/PlasmaCharge';
import { createTechnicalPhysicsBinding, createPresentation } from '../ProjectileRuntimeTestHelper';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';
import type { TargetDamageAppliedOutcome } from '../../src/combat/CombatMutation';
import { EnemyMovementStatusSystem } from '../../src/systems/EnemyMovementStatusSystem';
import { TargetStatusSystem } from '../../src/systems/TargetStatusSystem';
import { WorldMgTurretBinding } from '../../src/world/WorldMgTurretBinding';
import { WorldStinkPlagueBinding } from '../../src/world/WorldStinkPlagueBinding';
import { WorldCombatReactions } from '../../src/world/WorldCombatReactions';
import { plagueSource } from '../StinkPlagueTestHelper';
import { mgOwner } from '../MgTurretTestHelper';
import { RockVisualHelper } from '../../src/scenes/arena/RockVisualHelper';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import type { ProjectileStyle } from '../../src/types';
import type { ProjectileReplicationRecord } from '../../src/projectile/ProjectileReplicationAdapter';

function fixture(training = false) {
  clock.now = 1000;
  const scene = healthBarTestScene().scene;
  const existing = scene.physics.add.existing;
  scene.physics.add.existing = (object: { body: object }) => {
    existing(object); Object.assign(object.body, { setImmovable() {} });
  };
  const configs = resolveCoopDefenseEnemyConfigs(1);
  const kind = SHOOTING_RANGE.enemyKind as keyof typeof configs;
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(scene, configs);
  const player = fakeEntity({ id: 'p1', x: 300, y: 100, active: true, color: 0xffffff,
    body: { velocity: { x: 0, y: 0 } } });
  for (const name of ['updateHP', 'updateArmor', 'updateBurnStacks', 'setVisible', 'setTurretMounted',
    'setWalking', 'setRageTint', 'setDecoyStealth', 'setHeldItemId', 'syncBar', 'setMovementDashPhase', 'setBurrowPhase']) player[name] = () => {};
  const players = { getPlayer: (id: string) => id === 'p1' ? player : undefined, getAllPlayers: () => [player] };
  const network = { isHost: () => true, getPlayerProfile: players.getPlayer, areTeammates: () => false,
    getLocalPlayerId: () => 'p1', isEnemyPair: () => true, broadcastEffect: vi.fn(), broadcastAudioFeedback: vi.fn() };
  const combat = new WorldCombatCore(players as never, network as never);
  combat.bindPlayerVitalsScope({ worldRevision: 71, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => clock.now, random: () => 0 });
  combat.initPlayer('p1'); combat.setEnemyManager(enemies);
  const [gx, gy] = SHOOTING_RANGE.targets[0];
  const metrics = { ...resolveActiveArenaWorldMetrics(), offsetX: 300 - (gx + .5) * CELL_SIZE, offsetY: 100 - (gy + .5) * CELL_SIZE };
  const range = training ? new ShootingRangeWorldBinding(enemies, metrics, combat, true) : null;
  range?.runtime.request({ control: 'power', action: 'enable', session: 0 }, clock.now);
  const enemy = range ? enemies.getEnemy(range.snapshot().targets[0]!.id)! : enemies.hostSpawnAtWorld(300, 100, kind);
  enemies.hostSetVitalsBaseline(enemy.id, SHOOTING_RANGE.targetHp, SHOOTING_RANGE.targetHp);
  Object.assign(enemy.sprite, { getBounds: () => ({ left: 290, top: 90, right: 310, bottom: 110 }) });
  const receipts: TargetDamageAppliedOutcome[] = [];
  combat.observeEnemyDamageCommitted(outcome => receipts.push(outcome));
  const plasma = new PlasmaSwarmReactionSystem(() => {});
  combat.setPlasmaSwarmMechanicPort(plasma);
  const physics = createTechnicalPhysicsBinding();
  const projectiles = new WorldProjectileRuntime({ physicsBinding: physics.binding, presentation: createPresentation(),
    identityScope: new ProjectileIdentityScope(71), hostNowMs: () => clock.now,
    resolveProvenance: source => combat.captureProjectileProvenance(source) });
  projectiles.setProjectileCombatPort(combat);
  projectiles.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => combat.readCollisionTargets(sink) });
  projectiles.setProjectileTargetabilityPort({
    canDamage: (source, target, team) => combat.canProjectileDamageTarget(source, String(target.id), team),
    isTargetCurrentlyValid: id => enemies.hasEnemy(id),
  } as never);
  const spawnSwarm = () => {
    combat.setPlasmaSwarmReactionHandler(impact => projectiles.applyPlasmaSwarmImpact(impact));
    combat.resolveDirectImpact({ projectileId: 900, target: { kind: 'enemy', id: enemy.id },
      impact: { x: 300, y: 100 }, velocity: { x: 400, y: 0 },
      provenance: createSingleOwnerProvenance('p1', { weaponSourceId: 'PLASMA', sourceSlot: 'weapon2' }),
      directHit: { damage: 2, plasmaSwarm: {} }, augments: [],
      plasmaSwarmSource: { normalSize: 8, normalRange: 1000,
        homing: { targetTypes: ['enemies'], searchRadius: 1000, acquireDelayMs: 0, retargetIntervalMs: 0, maxTurnDegreesPerStep: 180 } },
    });
    expect(physics.handles.size).toBeGreaterThan(0);
    return [...physics.handles.keys()];
  };
  const move = (ids: number[], x: number, y = 100) => {
    for (const id of ids) {
      const h = physics.handles.get(id)!;
      h.body.reset(x, y); physics.observe(id, x, y, h.body.velocity.x, h.body.velocity.y);
    }
    clock.now += 16;
    projectiles.runHostInteractionStage(clock.now);
    projectiles.runHostProjectileStage(16, clock.now);
  };
  return { scene, enemies, enemy, player, players, combat, receipts, range, plasma, projectiles, physics, spawnSwarm, move, network,
    destroy() { projectiles.destroy(); range?.destroy(); enemies.destroy(); } };
}

function cloudHost(f: ReturnType<typeof fixture>) {
  const textures = vi.spyOn(StinkCloudSystem.prototype as any, 'ensureTextures').mockImplementation(() => {});
  const cloud = new StinkCloudSystem(f.scene); textures.mockRestore();
  vi.spyOn(cloud, 'syncVisuals').mockImplementation(() => {});
  vi.spyOn(cloud, 'syncPlagueVisuals').mockImplementation(() => {});
  vi.spyOn(cloud, 'clientUpdate').mockImplementation(() => {});
  const host = new HostUpdateCoordinator(f.scene, {
    getWorldCombatCore: () => f.combat, playerManager: f.players, stinkCloudSystem: cloud,
    fireSystem: { hostUpdate: () => ({ synced: [], ground: { cells: [] }, damageEvents: [], damageTick: false }) },
    decoySystem: { hostUpdateLifecycle() {}, hostPostPhysics() {}, createHostSnapshots: () => [], isStealthed: () => false },
    hostPhysics: { update() {}, getDashPhase: () => 0, isBurrowDash: () => false },
    smokeSystem: { syncVisuals() {}, syncTargetVisuals() {} },
  } as never, {} as never, {} as never, {} as never);
  host.setPresentationActive(false);
  host.setWorldFramePort({ getWorldRuntime: () => ({ context: { descriptor: { definitionId: 'world:lobby' } } }),
    getEnemyManager: () => f.enemies, getWorldMutationRuntime: () => null, getTrainRuntime: () => null,
    getShootingRange: () => f.range } as never);
  return { cloud, host, step(now: number) { clock.now = now; host.runHostUpdate(0); } };
}

describe('shared swarm collision and homing', () => {
  it('preserves opaque presentation through collision, combat and swarm spawn; only the capability enables gameplay', () => {
    const run = (style: ProjectileStyle, enabled: boolean) => {
      const f = fixture();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
      try {
        const presentation = { style, color: 0x123456, ownerColor: 0xabcdef,
          energyBallVariant: 'plasma' as const, tracer: { profile: 'automatic' as const } };
        const impacts = vi.spyOn(f.combat, 'resolveDirectImpact');
        const swarm = vi.fn(impact => f.projectiles.applyPlasmaSwarmImpact(impact));
        f.combat.setPlasmaSwarmReactionHandler(swarm);
        const hp = f.enemy.getHp();
        const id = f.projectiles.spawnProjectile({
          origin: { x: 250, y: 100, angle: 0 },
          provenance: createSingleOwnerProvenance('p1', { weaponSourceId: 'PLASMA', sourceSlot: 'weapon2' }),
          flight: { speed: 400, size: 8, lifetimeMs: 2500, maxBounces: 0, isGrenade: false },
          interaction: { directHit: { damage: 20, plasmaSwarm: enabled ? {} : undefined } },
          presentation,
        })!;
        expect(id).not.toBeNull();
        f.move([id], 300);
        expect(impacts).toHaveBeenCalledOnce();
        expect(impacts.mock.calls[0][0].target).toMatchObject({ kind: 'enemy', id: f.enemy.id });
        const children: ProjectileReplicationRecord[] = [];
        f.projectiles.readProjectileReplication(record => children.push(record));
        if (enabled) {
          expect(swarm).toHaveBeenCalledOnce();
          expect(children.length).toBeGreaterThan(0);
          expect(children).toHaveLength(swarm.mock.calls[0][0].projectileCount);
          for (const child of children) expect(child.static).toMatchObject(presentation);
          for (const child of f.projectiles.getThreatSamples()) {
            expect(child.provenance.lineage).toMatchObject({ parentProjectileId: id, plasmaSwarmChild: true });
          }
        } else {
          expect(swarm).not.toHaveBeenCalled();
          expect(children).toEqual([]);
        }
        // Exercise the children's real collision/damage path as well as their spawn.
        const childIds = children.map(child => child.id);
        if (enabled) {
          f.move(childIds, 400);
          f.move(childIds, 300);
          expect(impacts.mock.calls.length).toBeGreaterThan(1);
          expect(swarm).toHaveBeenCalledOnce();
        }
        return { damage: hp - f.enemy.getHp(), hits: impacts.mock.calls.map(([request]) => request.directHit),
          children: children.map(child => child.dynamic), physics: f.physics.specs };
      } finally { random.mockRestore(); f.destroy(); }
    };
    // Plasma-looking metadata alone cannot grant a gameplay capability; unrelated
    // presentation styles cannot suppress or change an explicitly granted swarm.
    const styles = ['energy_ball', 'bullet', 'rocket'] as const;
    for (const enabled of [false, true]) {
      const results = styles.map(style => run(style, enabled));
      expect(results[0].damage).toBeGreaterThan(0);
      for (const result of results.slice(1)) expect(result).toEqual(results[0]);
    }
  });

  it.each([false, true])('protects spawn, partial overlap and the entire exit sweep, then permits return (training=%s)', training => {
    const f = fixture(training);
    try {
      const ids = f.spawnSwarm(), hp = f.enemy.getHp();
      f.move(ids, 300); // zero-length sweep goes through overlap
      f.move(ids, 303); // movement inside origin must not release protection
      f.move(ids, 309);
      expect(f.enemy.getHp()).toBe(hp);
      f.move(ids, 400); // exit face must not be counted as an impact
      expect(f.enemy.getHp()).toBe(hp);
      f.move(ids, 300);
      expect(f.enemy.getHp()).toBeLessThan(hp);
      expect(f.physics.specs).toHaveLength(ids.length); // no recursive swarm
      expect(f.plasma.read(f.enemies.getCombatTargetRef(f.enemy.id)!, clock.now)?.stacks).toBe(1);
    } finally { f.destroy(); }
  });

  it('can hit another enemy before leaving the origin', () => {
    const f = fixture();
    try {
      const other = f.enemies.hostSpawnAtWorld(302, 100, f.enemy.kind);
      Object.assign(other.sprite, { getBounds: () => ({ left: 292, right: 312, top: 90, bottom: 110 }) });
      const ids = f.spawnSwarm(), hp = f.enemy.getHp(), otherHp = other.getHp();
      f.move(ids, 300);
      expect(f.enemy.getHp()).toBe(hp);
      expect(other.getHp()).toBeLessThan(otherHp);
    } finally { f.destroy(); }
  });

  it('prefers other valid homing targets and uses the origin only after exit as a fallback', () => {
    const f = fixture();
    try {
      const other = f.enemies.hostSpawnAtWorld(500, 200, f.enemy.kind);
      Object.assign(other.sprite, { getBounds: () => ({ left: 490, right: 510, top: 190, bottom: 210 }) });
      f.projectiles.setProjectileTargetQueryPort({ queryTargets: (_cfg, _owner, _x, _y, _r, sink) => {
        for (const e of f.enemies.getAllEnemies()) sink(e.id, 'enemies', e.sprite.x, e.sprite.y);
      } });
      const ids = f.spawnSwarm();
      f.move(ids, 303);
      let velocity = f.physics.handles.get(ids[0])!.body.velocity;
      expect(velocity.x).toBeGreaterThan(0); expect(velocity.y).toBeGreaterThan(0);
      f.move(ids, 400);
      f.move(ids, 410);
      velocity = f.physics.handles.get(ids[0])!.body.velocity;
      expect(velocity.x).toBeGreaterThan(0); // origin is closer, other is preferred
      f.enemies.hostRemoveWithoutKill(other.id);
      f.move(ids, 420);
      expect(f.physics.handles.get(ids[0])!.body.velocity.x).toBeLessThan(0);
    } finally { f.destroy(); }
  });
});

describe('clouds through the host frame and confirmed combat', () => {
  it('retains the destroyed spore turret as the source of its death cloud', () => {
    const f = fixture(), h = cloudHost(f);
    try {
      const textures = vi.spyOn(RockVisualHelper.prototype as any, 'ensureTurretTextures').mockImplementation(() => {});
      const helper = new RockVisualHelper(f.scene, { stinkCloudSystem: h.cloud, getWorldCombatCore: () => f.combat } as never,
        null, {} as never, null, { getWorldRuntime: () => ({ context: { metrics: { offsetX: 300 - CELL_SIZE / 2, offsetY: 100 - CELL_SIZE / 2 } } }) } as never);
      textures.mockRestore();
      f.combat.runHostExecution(() => helper.spawnTurretDeathCloud({ kind: 'turret', id: 23, gridX: 0, gridY: 0,
        ownerId: 'p1', ownerColor: 0xffffff } as never));
      const cfg = UTILITY_CONFIGS.SPORE_TURRET;
      if (cfg.type !== 'placeable_turret') throw Error('Expected spore turret');
      const weapon = WEAPON_CONFIGS[cfg.weaponId as keyof typeof WEAPON_CONFIGS];
      if (weapon.fire.type !== 'projectile' || !weapon.fire.impactCloud) throw Error('Expected impact cloud');
      h.step(1000 + weapon.fire.impactCloud.tickInterval);
      expect(f.receipts[0].actualDamage).toBeGreaterThan(0);
      expect(f.receipts[0].source).toMatchObject({ authoredSourceId: cfg.weaponId, sourceSlot: 'utility', origin: 'ground',
        actor: { kind: 'turret', id: '23' }, attribution: { kind: 'player', id: 'p1' } });
    } finally { h.cloud.destroyAll(); f.destroy(); }
  });

  it('keeps detonation aftercloud source and slot through the shared resolver', () => {
    const f = fixture(), h = cloudHost(f);
    try {
      const pending = [{ x: 300, y: 100, projectileOwnerId: 'p1', detonatorOwnerId: 'p1', sourceId: 'ASMD_SECONDARY', sourceSlot: 'weapon2',
        effect: { tag: 'asmd_ball', aoeDamage: 2, aoeRadius: 50, allowCrossTeam: false,
          dotArea: { damagePerTick: 3, durationMs: 500, tickIntervalMs: 100, style: 'plasma' } } }];
      h.host.setCombatFramePort({ getTargetingRuntime: () => null, getCombatGameplayBinding: () => null,
        getSupportGameplayRuntime: () => ({ systems: { detonation: { checkProjectileDetonations() {}, flushDetonations: () => pending.splice(0) } } }) } as never);
      h.step(1000); h.step(1100); h.step(1200);
      expect(f.receipts.map(r => r.damage.damageKind)).toEqual(['explosion', 'ground', 'ground']);
      expect(f.receipts.slice(1).every(r => r.source.authoredSourceId === 'ASMD_SECONDARY' && r.source.sourceSlot === 'weapon2')).toBe(true);
    } finally { h.cloud.destroyAll(); f.destroy(); }
  });

  it('retains strict rejection of mismatched source origins in the AoE adapter', () => {
    const f = fixture(), h = cloudHost(f);
    try {
      const source = f.combat.captureWorldDamageSource('p1', 'test', 'ground');
      f.combat.applyAoeDamage(300, 100, 50, 5, 'p1', false, { damageKind: 'explosion', source });
      expect(f.receipts).toEqual([]);
      expect(f.enemy.getHp()).toBe(SHOOTING_RANGE.targetHp);
      f.combat.applyAoeDamage(300, 100, 50, 5, 'p1', false, { damageKind: 'ground', source });
      expect(f.receipts[0].actualDamage).toBe(5);
      h.cloud.hostCreateStationaryCloud('p1', 0xffffff, 300, 100, 50, 500, 5, 100, 1, 1, 1, 'spore', 1000, source);
      h.step(1100);
      expect(f.receipts[1].actualDamage).toBe(5);
      expect(f.receipts[1].source.sourceSlot).toBeUndefined();
    } finally { h.cloud.destroyAll(); f.destroy(); }
  });

  it.each([false, true])('commits repeated primary, aftercloud and turret ticks with one scaling pass (training=%s)', training => {
    const f = fixture(training), h = cloudHost(f);
    try {
      f.combat.setPowerUpSystem({ getDamageMultiplier: () => 2, removePlayer() {} });
      f.combat.setPlayerOutgoingDamageResolver((_id, _target, amount, _critical, slot) => ({ amount: amount * (slot === 'weapon2' ? 3 : 2), isCritical: false }));
      h.cloud.hostActivate('p1', 50, 300, 2, 100, 1, 1, 1, 400, 1, .5, 'stink', 1000, undefined, 'player-primary');
      h.step(1000); h.step(1100); h.step(1200); h.step(1300); h.step(1400); h.step(1500);
      expect(f.receipts.map(r => r.actualDamage)).toEqual([8, 8, 8, 4, 4]);
      expect(f.receipts.every(r => r.source.origin === 'ground' && r.damage.damageKind === 'ground')).toBe(true);
      h.cloud.destroyAll();
      const source = f.combat.captureWorldDamageSource('p1', 'TURRET_SPORE', 'ground',
        createSingleOwnerProvenance('p1', { weaponSourceId: 'TURRET_SPORE', sourceSlot: 'weapon2', sourceTurretId: 'removed-turret' }), 700);
      h.cloud.hostCreateStationaryCloud('p1', 0xffffff, 300, 100, 50, 500, 2, 100, 1, 1, 1, 'spore', 1500, source);
      h.step(1600); h.step(1700);
      expect(f.receipts.slice(-2).map(r => r.actualDamage)).toEqual([12, 12]);
      expect(f.receipts.at(-1)?.source).toMatchObject({ authoredSourceId: 'TURRET_SPORE', sourceSlot: 'weapon2',
        actor: { kind: 'turret', id: 'removed-turret' }, attribution: { kind: 'player', id: 'p1' }, origin: 'ground' });
      f.combat.applyAoeDamage(300, 100, 50, 2, 'p1');
      expect(f.receipts.at(-1)?.damage.damageKind).toBe('explosion');
      const loss = SHOOTING_RANGE.targetHp - f.enemy.getHp();
      expect(loss).toBe(f.receipts.reduce((sum, r) => sum + r.actualDamage, 0));
      if (f.range) { f.range.finishHostStep(clock.now + SHOOTING_RANGE.sampleIntervalMs); expect(f.range.snapshot().dps).toBe(loss); }
    } finally { h.cloud.destroyAll(); f.destroy(); }
  });
});

function statusBindings(f: ReturnType<typeof fixture>) {
  const status = new TargetStatusSystem(), movement = new EnemyMovementStatusSystem();
  f.combat.setMovementStatusPort(movement);
  f.combat.setTargetIncomingDamageMultiplierResolver((target, now) => status.getIncomingDamageMultiplier(target, now));
  f.combat.setEnemyLifeEndedHandler(target => status.removeTarget({ targetType: 'enemy', targetId: String(target.id) }));
  const plague = new WorldStinkPlagueBinding({ combat: f.combat, getEnemies: () => f.enemies, status,
    getNavigation: () => null, isPlayerPresent: () => true, areAllies: () => true, deathBurst: () => null, publishBurst() {} });
  const mg = new WorldMgTurretBinding({ combat: f.combat, getEnemies: () => f.enemies, bases: null, getMutation: () => null,
    owners: () => [mgOwner('p1', { network: true, bleedLevel: 1 })] });
  mg.advance(clock.now); plague.advance(clock.now);
  const infect = () => plague.applyPrimaryContact({ cloudId: 1, kind: 'player-primary', tickAt: clock.now,
    x: 300, y: 100, radius: 50, ownerId: 'p1', damage: 0, rockDamageMult: 0, trainDamageMult: 0, baseDamageMult: 1,
    visualVariant: 'stink', plague: plagueSource('p1', { vulnerabilityEnabled: 1, damagePerTick: 2 }) }, clock.now);
  const hitMg = () => f.combat.resolveDirectImpact({ projectileId: 901, target: { kind: 'enemy', id: f.enemy.id },
    impact: { x: 300, y: 100 }, velocity: { x: 100, y: 0 }, directHit: { damage: 2 }, augments: [],
    provenance: createSingleOwnerProvenance('p1', { weaponSourceId: 'TURRET_MG', sourceSlot: 'utility',
      sourceTurretId: 'turret', personalMgOwnerId: 'p1', personalMgScope: f.combat.getCombatScope() }) });
  return { status, movement, plague, mg, infect, hitMg, destroy() { plague.destroy(); mg.destroy(); } };
}

describe('normal and stationary enemy combat parity', () => {
  it('uses the same confirmed AoE, burn, plague, bleed, debuff and hit/kill reaction paths', () => {
    const results = [false, true].map(training => {
      const f = fixture(training), s = statusBindings(f);
      try {
        const primary = vi.fn(() => ({ slowFraction: .25, slowDurationMs: 5000, shouldCull: false }));
        const kill = vi.fn(), itemKill = vi.fn(), xp = vi.fn(), frag = vi.fn(), drop = vi.fn();
        const reactions = new WorldCombatReactions({ combatSystem: f.combat,
          isTrainingTarget: id => f.range?.isTrainingTarget(id) ?? false, isCoopMission: () => !training,
          isActivityActive: () => !training, getPowerUpSystem: () => ({ onCoopDefenseEnemyKilled: drop }) as never,
          getPlayerCombatIntegration: () => ({ reactions: { handleDirectPrimaryHit: primary, registerKill: kill,
            handleCoopDefenseItemKill: itemKill }, modifier: { getClassDefinition: () => null } }) as never,
          network: { authority: { ...f.network, getConnectedPlayers: () => [] },
            round: { canPlayerReceiveRoundRewards: () => true, addCoopDefenseRoundXp: xp },
            stats: { incrementPlayerFrags: frag, recordPlayerKill() {} }, effects: { broadcastCoopDefenseXpPopup() {} } } as never });
        f.combat.setDirectPrimaryHitHandler((a, id, hp, max, boss, target) =>
          reactions.handleDirectPrimaryHit(a, id, hp, max, boss, clock.now, target, () => true));
        f.combat.setKillCallback((...args) => reactions.handleKill(...args, () => true));
        f.combat.applyDamage(f.enemy.id, 2, false, 'p1', 'GLOCK', undefined, { sourceSlot: 'weapon1', damageKind: 'direct' });
        expect(primary).toHaveBeenCalledOnce();
        expect(f.combat.getEnemyMovementFactor(f.enemy.id, clock.now)).toBe(.75);
        f.combat.applyAoeDamage(300, 100, 50, 2, 'p1');
        f.combat.applyBurnHit(f.enemy.id, 'p1', 4000, 2, 'burn', 'MOLOTOV');
        s.infect(); s.hitMg();
        clock.now = 1500; f.combat.advanceStatuses(clock.now); s.plague.advance(clock.now); s.mg.advance(clock.now);
        const damage = f.receipts.map(r => ({ amount: r.actualDamage, source: r.source.authoredSourceId, kind: r.damage.damageKind }));
        expect(damage.some(r => r.kind === 'burn')).toBe(true);
        expect(damage.some(r => r.source === 'weapon.stink_plague')).toBe(true);
        expect(damage.some(r => r.source === 'mg_bleed')).toBe(true);
        expect(s.status.getIncomingDamageMultiplier({ targetType: 'enemy', targetId: f.enemy.id }, clock.now)).toBeGreaterThan(1);
        f.combat.applyDamage(f.enemy.id, SHOOTING_RANGE.targetHp * 10, false, 'p1', 'terminal');
        expect(kill).toHaveBeenCalledOnce(); expect(itemKill).toHaveBeenCalledOnce();
        if (training) {
          expect(xp).not.toHaveBeenCalled(); expect(frag).not.toHaveBeenCalled(); expect(drop).not.toHaveBeenCalled();
          f.range!.finishHostStep(clock.now);
          expect(f.range!.snapshot().dps).toBeCloseTo(SHOOTING_RANGE.targetHp);
        } else { expect(frag).toHaveBeenCalledOnce(); expect(drop).toHaveBeenCalledOnce(); }
        return damage;
      } finally { s.destroy(); f.destroy(); }
    });
    expect(results[1]).toEqual(results[0]);
  });

  it('removes target-bound burn, swarm, slow, plague and MG state before new training targets are used', () => {
    const f = fixture(true), s = statusBindings(f);
    try {
      const old = f.enemies.getCombatTargetRef(f.enemy.id)!;
      f.spawnSwarm();
      f.combat.applyBurnHit(f.enemy.id, 'p1', 4000, 2, 'burn', 'MOLOTOV');
      f.combat.applyEnemySlow(f.enemy.id, .5, 4000);
      s.infect(); s.hitMg();
      expect(f.combat.getBurnStackCount(f.enemy.id, clock.now)).toBeGreaterThan(0);
      expect(s.mg.score('p1', 'turret', 'enemy', f.enemy.id, clock.now)).toBeGreaterThan(0);
      f.range!.runtime.request({ control: 'power', action: 'disable', session: f.range!.snapshot().session }, clock.now);
      f.range!.runtime.request({ control: 'power', action: 'enable', session: f.range!.snapshot().session }, clock.now);
      const next = f.range!.snapshot().targets[0]!;
      expect(next.id).not.toBe(f.enemy.id);
      expect(f.plasma.read(old, clock.now)).toBeUndefined();
      expect(s.movement.getMovementFactor(old, clock.now)).toBe(1);
      clock.now += 500; f.combat.advanceStatuses(clock.now); s.plague.advance(clock.now); s.mg.advance(clock.now);
      expect(f.combat.getBurnStackCount(next.id, clock.now)).toBe(0);
      expect(f.combat.getEnemyMovementFactor(next.id, clock.now)).toBe(1);
      expect(s.plague.runtime.getSnapshot(clock.now).targets).toEqual([]);
      expect(s.mg.runtime.snapshot(clock.now).targets).toEqual([]);
      expect(f.enemies.getEnemy(next.id)!.getHp()).toBe(SHOOTING_RANGE.targetHp);
      expect(f.receipts.filter(r => r.target.id === next.id)).toEqual([]);
      f.range!.finishHostStep(clock.now); expect(f.range!.snapshot().dps).toBe(0);
    } finally { s.destroy(); f.destroy(); }
  });
});
