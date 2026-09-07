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
  return { combat, enemy, enemies, facts, detachReward, resource,
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
      Object.assign(target.sprite, { getBounds: () => ({ left: 284, top: 84, right: 316, bottom: 116 }) });
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

describe('Glock reward with independently scoped target owners', () => {
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
