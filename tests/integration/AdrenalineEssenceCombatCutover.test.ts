import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  class Line {
    constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {}
    setTo(x1: number, y1: number, x2: number, y2: number) { Object.assign(this, { x1, y1, x2, y2 }); return this; }
    static Length(line: Line) { return Math.hypot(line.x2 - line.x1, line.y2 - line.y1); }
  }
  class Rectangle {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    setTo(x: number, y: number, width: number, height: number) { Object.assign(this, { x, y, width, height }); return this; }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
  }
  return { ...phaser, Geom: { ...phaser.Geom, Line, Rectangle } };
});

import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import type { PrimaryHitAdrenalineRewardFact } from '../../src/combat/PrimaryHitReward';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { DecoySystem } from '../../src/systems/DecoySystem';
import { UTILITY_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { LoadoutManager } from '../../src/loadout/LoadoutManager';
import { PlayerActionRuntime } from '../../src/world/PlayerActionRuntime';
import { PlayerWeaponActivationRuntime } from '../../src/world/PlayerWeaponActivationRuntime';
import { WorldWeaponExecutionRuntime } from '../../src/world/WorldWeaponExecutionRuntime';
import { SpecializedWeaponExecutionAdapter } from '../../src/world/SpecializedWeaponExecutionAdapter';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../../src/projectile/ProjectileIdentityScope';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { createPresentation, createTechnicalPhysicsBinding } from '../ProjectileRuntimeTestHelper';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';
import { AdrenalineEssenceBinding } from '../../src/adrenalineEssence/AdrenalineEssenceBinding';
import { ADRENALINE_ESSENCE_CONFIG } from '../../src/adrenalineEssence/AdrenalineEssenceConfig';
import { essenceWorldGeometry } from '../essenceWorldGeometry';
import { ShootingRangeWorldBinding } from '../../src/shootingRange/ShootingRangeWorldBinding';
import { SHOOTING_RANGE } from '../../src/shootingRange/ShootingRangeLayout';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';
import { CELL_SIZE } from '../../src/config';
import { NecromancySystem } from '../../src/systems/NecromancySystem';
import { navigationTestWorld } from '../navigationTestWorld';

function glockEnemyFixture(origin = { x: 300, y: 100 }) {
  const scene = healthBarTestScene().scene;
  const kind = COOP_DEFENSE_ENEMY_KINDS[0];
  const configs = resolveCoopDefenseEnemyConfigs(1);
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(scene, configs);
  const enemy = enemies.hostSpawnAtWorld(origin.x, origin.y, kind);
  Object.assign(enemy.sprite, { getBounds: () => ({ left: origin.x - 10, top: origin.y - 10, right: origin.x + 10, bottom: origin.y + 10 }) });
  const player = fakeEntity({ id: 'p1', x: origin.x - 100, y: origin.y, color: 0xffffff,
    getBounds: () => ({ left: origin.x - 116, top: origin.y - 16, right: origin.x - 84, bottom: origin.y + 16 }) });
  const playerMap = new Map([['p1', player]]);
  const players = { getPlayer: (id: string) => playerMap.get(id), getAllPlayers: () => [...playerMap.values()] };
  const network = {
    isHost: () => true, getPlayerProfile: players.getPlayer, areTeammates: () => false,
    getLocalPlayerId: () => 'p1', isEnemyPair: () => true,
    broadcastEffect: vi.fn(), broadcastHitscanTracer: vi.fn(),
    broadcastAudioFeedback: vi.fn(),
  };
  const combat = new WorldCombatCore(players as never, network as never);
  combat.bindPlayerVitalsScope({ worldRevision: 7340, runtimeGeneration: 5 });
  combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0.25 });
  combat.initPlayer('p1');
  combat.setEnemyManager(enemies);
  const resource = new ResourceSystem();
  resource.initPlayer('p1');
  combat.setResourceSystem(resource);
  const facts: PrimaryHitAdrenalineRewardFact[] = [];
  const detachReward = combat.bindPrimaryHitRewardSink(82, fact => facts.push(fact));
  const loadout = new LoadoutManager(resource, { getGameMode: () => 'coop_defense' });
  loadout.assignDefaultLoadout('p1');
  const physics = createTechnicalPhysicsBinding();
  const projectiles = new WorldProjectileRuntime({
    physicsBinding: physics.binding, presentation: createPresentation(),
    identityScope: new ProjectileIdentityScope(7340), hostNowMs: () => 1000,
    resolveProvenance: provenance => combat.captureProjectileProvenance(provenance),
  });
  projectiles.setProjectileCombatPort(combat);
  projectiles.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => combat.readCollisionTargets(sink) });
  projectiles.setProjectileTargetabilityPort({
    canDamage: (source, target, team) => combat.canProjectileDamageTarget(source, String(target.id), team),
    canDamageOwner: (source, id, team) => combat.canProjectileDamageTarget(source, id, team),
    isTargetCurrentlyValid: () => true,
  });
  const activation = new PlayerWeaponActivationRuntime({
    playerManager: players, loadout, resourceSystem: resource,
    capturePrimaryHitRewardScope: () => combat.getPrimaryHitRewardScope(),
    weaponExecution: new WorldWeaponExecutionRuntime({ projectileSpawn: projectiles, combatSystem: combat }),
    specializedWeaponExecution: new SpecializedWeaponExecutionAdapter(projectiles),
  });
  const actions = new PlayerActionRuntime({ ...players, canInteract: () => true,
    isAlive: id => combat.isAlive(id), isWeaponBlocked: () => false, isDashBurst: () => false,
  }, loadout, null, activation);
  let decoys: DecoySystem | undefined;
  return { combat, enemy, enemies, facts, detachReward, resource, network, players,
    addRange(getPlayerIds = () => ['p1']) {
      enemies.hostRemoveWithoutKill(enemy.id);
      const existing = scene.physics.add.existing;
      scene.physics.add.existing = (object: { body: object }) => {
        existing(object); Object.assign(object.body, { setImmovable() {} });
      };
      const [gx, gy] = SHOOTING_RANGE.targets[0];
      const metrics = { ...resolveActiveArenaWorldMetrics(),
        offsetX: origin.x - (gx + 0.5) * CELL_SIZE, offsetY: origin.y - (gy + 0.5) * CELL_SIZE };
      const range = new ShootingRangeWorldBinding(enemies, metrics, combat, true, getPlayerIds);
      range.runtime.request({ control: 'power', action: 'enable', session: 0 }, 1000);
      return range;
    },
    addDecoyTarget() {
      enemies.hostRemoveWithoutKill(enemy.id);
      const owner = fakeEntity({ id: 'p2', x: 300, y: 100, color: 0xffffff,
        getBounds: () => ({ left: 490, top: 490, right: 510, bottom: 510 }) });
      playerMap.set('p2', owner); combat.initPlayer('p2');
      // Supply only the missing technical Arcade method; the real Decoy entity/owner are retained.
      const addPhysics = scene.physics.add.existing;
      scene.physics.add.existing = (object: { body: object }) => {
        addPhysics(object); Object.assign(object.body, { setAllowGravity() {} });
      };
      decoys = new DecoySystem(scene, players as never, network as never);
      decoys.setCombatStateReader(combat);
      expect(decoys.activate(UTILITY_CONFIGS.DECOY, 'p2', 0, 0xffffff, 1000)).toBe(true);
      combat.setDecoySystem(decoys);
      owner.x = 500; owner.y = 500;
      const target = decoys.getHostTargets()[0];
      return { target: decoys.getCombatTargetRef(target.id)!, hp: () => decoys!.createHostSnapshots()[0]?.hp ?? 0 };
    },
    fire() {
      expect(loadout.getEquippedWeaponConfig('p1', 'weapon1')!.id).toBe('GLOCK');
      expect(actions.execute({ category: 'weapon', playerId: 'p1', slot: 'weapon1', angle: 0,
        targetX: origin.x, targetY: origin.y, hostNowMs: 1000 })).toEqual({ ok: true });
      const [id, handle] = [...physics.handles][0];
      Object.assign(handle.sprite, origin);
      physics.observe(id, origin.x, origin.y, handle.body.velocity.x, handle.body.velocity.y);
      projectiles.runHostProjectileStage(16, 1000);
      projectiles.runHostInteractionStage(1000);
    },
    destroy() { projectiles.destroy(); enemies.destroy(); decoys?.clearAll(); },
  };
}

describe('training targets through the real weapon and enemy combat owners', () => {
  it('keeps ground queries and personal ally navigation bound through lobby joins, departures and cleanup', () => {
    let players = ['p1'];
    const f = glockEnemyFixture({ x: 128, y: 96 }), range = f.addRange(() => players);
    const nav = navigationTestWorld([{ id: 'pond', kind: 'water', shape: 'rect', left: 32, top: 128, right: 64, bottom: 224 }]);
    range.navigation = nav.coordinator; range.ground = nav.field; range.intents = nav.intents;
    range.prepareHostStep(100, 1000); nav.flush();
    expect(range.ground.isCircleGroundFreeAt(128, 96, 10)).toBe(true);
    expect(range.ground.isCircleGroundFreeAt(48, 160, 10)).toBe(false);
    expect(range.ground.hasWalkableCircleLine(96, 96, 192, 96, 10)).toBe(true);
    expect(range.ground.hasWalkableCircleLine(48, 96, 48, 240, 10)).toBe(false);
    expect(range.allyFlowFields.has('p1')).toBe(true);
    players = ['p1', 'late']; range.prepareHostStep(100, 1100);
    expect(range.allyFlowFields.has('late')).toBe(true);
    players = ['late']; range.prepareHostStep(100, 1200);
    expect(range.allyFlowFields.has('p1')).toBe(false);
    expect(nav.coordinator.getFieldView('ally:p1')).toBeNull();
    range.runtime.request({ control: 'power', action: 'disable', session: range.snapshot().session }, 1200);
    expect(range.allyFlowFields.has('late')).toBe(true);
    range.destroy(); expect(range.allyFlowFields.size).toBe(0); f.destroy();
  });

  it('counts Glock, status and terminal HP loss once, excluding damage outside registered targets', () => {
    const f = glockEnemyFixture(), range = f.addRange();
    let now = 1000;
    f.combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 });
    const id = range.snapshot().targets[0]!.id;
    const enemy = f.enemies.getEnemy(id)!;
    Object.assign(enemy.sprite, { getBounds: () => ({ left: 290, top: 90, right: 310, bottom: 110 }) });
    expect(enemy.getHp()).toBe(SHOOTING_RANGE.targetHp);
    f.fire();
    expect(enemy.getHp()).toBeLessThan(SHOOTING_RANGE.targetHp);
    const afterWeapon = enemy.getHp();
    f.combat.applyBurnHit(id, 'p1', 4000, 1, 'training-burn', 'MOLOTOV');
    expect(f.combat.getBurnStackCount(id, now)).toBeGreaterThan(0);
    now = 1500; f.combat.advanceStatuses(now);
    expect(enemy.getHp()).toBeLessThan(afterWeapon);
    const outside = f.enemies.hostSpawnAtWorld(1000, 1000, enemy.kind);
    f.combat.applyDamage(outside.id, 5, false, 'p1', 'outside');
    f.combat.applyDamage(id, SHOOTING_RANGE.targetHp * 3, false, 'p1', 'terminal');
    range.finishHostStep(now);
    expect(range.snapshot().dps).toBe(SHOOTING_RANGE.targetHp);
    const next = range.snapshot().targets[0]!;
    expect(next.id).not.toBe(id);
    expect(f.combat.getBurnStackCount(next.id, now)).toBe(0);
    expect(f.enemies.getEnemy(next.id)!.getHp()).toBe(SHOOTING_RANGE.targetHp);
    range.destroy(); f.destroy();
  });

  it('finishes nested explosion deaths before respawn and preserves normal resurrected allies on disable', () => {
    const f = glockEnemyFixture(), range = f.addRange();
    f.players.getPlayer('p1')!.active = true;
    range.runtime.request({ control: 'plus', action: 'add', session: range.snapshot().session }, 1000);
    range.necromancy = new NecromancySystem(f.players as never, f.enemies, f.combat,
      { fire: () => false } as never, new Map(), (_id, stat, base) =>
        stat === 'player.necromancy.enabled' || stat === 'player.necromancy.maxAllies' ? 1 : base);
    const corpses = vi.fn();
    range.necromancy.setCorpseSink({ onCorpseAdded: corpses, onCorpseRemoved() {} });
    f.combat.setEnemyDeathCallback((_id, _x, _y, _burns, death) => {
      if (death) range.necromancy!.recordEnemyDeath(death, 1000);
    });
    const explosion = { radius: 500, maxDamage: 1000, minDamage: 1000, damageTarget: 'enemies' } as const;
    const kills = vi.fn(() => f.combat.applyExplosionDamage(300, 100, explosion, 'p1'));
    f.combat.setKillCallback(kills);
    const first = range.snapshot().targets[0]!;
    const target = f.enemies.getEnemy(first.id)!;
    target.setPosition(500, 500); target.setDesiredVelocity(200, 200);
    expect([target.sprite.x, target.sprite.y]).toEqual([300, 100]);
    expect(target.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
    f.combat.applyExplosionDamage(300, 100, explosion, 'p1');
    expect(kills).toHaveBeenCalledTimes(2); expect(corpses).toHaveBeenCalledTimes(2);
    expect(f.enemies.getAllEnemies()).toHaveLength(0);
    range.finishHostStep(1000);
    expect(range.snapshot().dps).toBe(SHOOTING_RANGE.targetHp * 2);
    expect(f.enemies.getAllEnemies()).toHaveLength(2);
    range.prepareHostStep(16, 1000);
    const allies = f.enemies.getAlliedEnemies('p1');
    expect(allies).toHaveLength(1);
    expect(range.isTrainingTarget(allies[0].id)).toBe(false);
    allies[0].setPosition(350, 100);
    expect(allies[0].sprite.x).toBe(350);
    range.runtime.request({ control: 'power', action: 'disable', session: range.snapshot().session }, 1000);
    expect(f.enemies.getAllEnemies()).toEqual(allies);
    expect(kills).toHaveBeenCalledTimes(2);
    range.prepareHostStep(16, 1100);
    expect(f.enemies.getAlliedEnemies('p1')).toHaveLength(1);
    range.destroy(); expect(f.enemies.getAllEnemies()).toHaveLength(0); f.destroy();
  });
});

describe('Glock reward with independently scoped target owners', () => {
  it('announces confirmed enemy kills even with suppressed death visuals, while administrative removal stays silent', () => {
    const f = glockEnemyFixture();
    f.combat.setEnemyDeathCallback(() => true);
    const audio = f.network.broadcastAudioFeedback;
    f.combat.applyDamage(f.enemy.id, f.enemy.getMaxHp() * 2, false, 'p1', 'test');
    f.combat.applyDamage(f.enemy.id, 99999, false, 'p1', 'test');
    expect(audio).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'sfx_enemy_death' }), false);
    const next = f.enemies.hostSpawnAtWorld(320, 100, f.enemy.kind);
    f.enemies.hostRemoveWithoutKill(next.id);
    f.enemies.destroy();
    expect(audio).toHaveBeenCalledOnce();
  });
  it('scatters one real Glock enemy hit into independently grounded fractions on authored Map 1', () => {
    const { metrics, geometry, openPoints } = essenceWorldGeometry('coop_defense');
    const origin = openPoints(ADRENALINE_ESSENCE_CONFIG.scatterMaxRadius + ADRENALINE_ESSENCE_CONFIG.groundClearance)[0];
    expect(origin).toBeDefined();
    const f = glockEnemyFixture(origin);
    f.combat.setWorldMetrics(metrics);
    const binding = new AdrenalineEssenceBinding({ worldRevision: 7340, activityRevision: 82 }, {
      isHost: true, now: () => 1000, servicesReady: () => true,
      bindRewardSink: sink => f.combat.bindPrimaryHitRewardSink(82, fact => { f.facts.push(fact); sink(fact); }),
      observeBurrow: () => () => {}, getPlayers: () => [],
      accessGroupFor: () => ({ kind: 'coop' }), localPlayerId: () => 'p1', isLocallyVisible: () => true,
      resolveGroundPoint: point => geometry.resolveSafeGroundPoint(point.x, point.y, ADRENALINE_ESSENCE_CONFIG.groundClearance),
      hasLineOfSight: (from, to) => geometry.hasLineOfSight(from.x, from.y, to.x, to.y),
      commitResolvedGain: (id, value) => ({ creditedValue: f.resource.commitResolvedAdrenalineGain(id, value), resourceRevision: f.resource.getAdrenalineRevision(id) }),
      resourceRevisionFor: id => f.resource.getAdrenalineRevision(id),
      createPresentation: () => ({ sync() {}, clear() {}, destroy() {} }),
    });
    try {
      binding.prepare();
      const before = f.enemy.getHp();
      f.fire();
      expect(f.enemy.getHp()).toBeLessThan(before);
      expect(f.facts).toHaveLength(1);
      const clusters = binding.runtime!.getState().clusters;
      expect(clusters).toHaveLength(ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward);
      expect(clusters.reduce((sum, cluster) => sum + cluster.value, 0)).toBe(f.facts[0].resolvedValue);
      for (const cluster of clusters) {
        expect(cluster.state).toBe('ejecting');
        expect(geometry.isCircleBlocked(cluster.x, cluster.y, ADRENALINE_ESSENCE_CONFIG.groundClearance)).toBe(false);
        for (const other of clusters) if (cluster !== other) {
          expect(Math.hypot(cluster.x - other.x, cluster.y - other.y)).toBeGreaterThan(ADRENALINE_ESSENCE_CONFIG.mergeRadius);
        }
      }
      binding.updateHost(Math.max(...clusters.map(cluster => cluster.landAt)));
      expect(binding.runtime!.getState().clusters).toHaveLength(clusters.length);
      expect(binding.runtime!.getState().clusters.every(cluster => cluster.state === 'grounded')).toBe(true);
      expect(binding.getDiagnostics().gameplay).toMatchObject({ rewardCount: 1, materializedValue: f.facts[0].resolvedValue });
    } finally { binding.destroy(); f.destroy(); }
  });

  it('publishes committed real EnemyManager damage in the activation World and Activity scope', () => {
    const f = glockEnemyFixture();
    const target = f.enemies.getCombatTargetRef(f.enemy.id)!;
    expect(target.scope.worldRevision).not.toBe(f.combat.getCombatScope().worldRevision);
    const before = f.enemy.getHp();
    f.fire();
    expect(f.enemy.getHp()).toBeLessThan(before);
    expect(f.facts).toHaveLength(1);
    expect(f.facts[0]).toMatchObject({ worldRevision: 7340, runtimeGeneration: 5, activityRevision: 82,
      creatorId: 'p1', target: { kind: 'enemy', id: f.enemy.id, scope: target.scope },
      source: { authoredSourceId: 'GLOCK', sourceSlot: 'weapon1' } });
    expect(f.facts[0].resolvedValue).toBeGreaterThan(0);
    f.destroy();
  });

  it('retains the damage receipt but suppresses reward if the Activity ends inside the damage reaction', () => {
    const f = glockEnemyFixture();
    f.combat.addDamageDealtObserver(() => f.detachReward());
    const before = f.enemy.getHp();
    f.fire();
    expect(f.enemy.getHp()).toBeLessThan(before);
    expect(f.facts).toEqual([]);
    f.destroy();
  });

  it('publishes real DecoySystem damage despite its independent target-owner scope', () => {
    const f = glockEnemyFixture();
    const decoy = f.addDecoyTarget();
    expect(decoy.target.scope.worldRevision).not.toBe(f.combat.getCombatScope().worldRevision);
    const before = decoy.hp();
    f.fire();
    expect(decoy.hp()).toBeLessThan(before);
    expect(f.facts).toHaveLength(1);
    expect(f.facts[0]).toMatchObject({ worldRevision: 7340, activityRevision: 82, target: decoy.target });
    f.destroy();
  });
});
