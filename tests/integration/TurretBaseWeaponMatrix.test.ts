import { afterEach, describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ now: 1000 }));
vi.mock('../../src/network/bridge', () => ({ bridge: {
  getSynchronizedNow: () => clock.now, isArenaCountdownActive: () => false,
  getActivityDescriptor: () => null, getActiveGameMode: () => 'coop_defense',
  getConnectedPlayers: () => [], getLocalPlayerId: () => 'headless',
  getPlayerHeldItemId: () => null, getPlayerInput: () => null, flushEffects() {},
  getPlayerColor: () => 0xffffff, broadcastExplosionEffect() {}, broadcastBlackHoleEffect() {},
  consumeFullGameStateRequest: () => false, publishAdrSyringeActive() {}, publishActiveBuffs() {},
  publishShieldBuffHud() {}, getWeapon2PredictionAck: () => undefined, getArenaStartTime: () => 0,
  publishGameState() {},
} }));
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule() as unknown as typeof import('phaser');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  const Line = require(root + 'src/geom/line/Line.js');
  return { ...phaser, Math: { ...phaser.Math, Distance: { ...phaser.Math.Distance,
    Squared: (x: number, y: number, tx: number, ty: number) => (tx - x) ** 2 + (ty - y) ** 2,
  } }, Geom: { ...phaser.Geom,
    Intersects: require(root + 'src/geom/intersects/index.js'),
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Circle: require(root + 'src/geom/circle/Circle.js'),
    Line: Object.assign(Line, { Length: (l: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }),
  } };
});

import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { BaseManager } from '../../src/entities/BaseManager';
import { StinkCloudSystem } from '../../src/effects/StinkCloudSystem';
import { FireSystem } from '../../src/effects/FireSystem';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { WorldObjectMutationRuntime } from '../../src/world/WorldObjectMutationRuntime';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';
import { WorldWeaponExecutionRuntime } from '../../src/world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../../src/world/AutomatedWeaponExecutionAdapter';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../../src/projectile/ProjectileIdentityScope';
import { ProjectileReplicationAdapter } from '../../src/projectile/ProjectileReplicationAdapter';
import { ProjectilePhysicsBinding } from '../../src/projectile/ProjectilePhysicsBinding';
import { WEAPON_CONFIGS, type WeaponConfig } from '../../src/loadout/LoadoutConfig';
import { canWeaponDamageBases } from '../../src/systems/TurretBaseTargeting';
import { createTechnicalPhysicsBinding, createPresentation } from '../ProjectileRuntimeTestHelper';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';

/**
 * Smallest real automatic-fire composition: no TurretSystem target selection or player
 * loadout/resource lifecycle. The fire options are those of bindHostSystems for a player
 * construction with neutral buffs. Only rendering, network and technical physics are fake.
 */
function fixture() {
  clock.now = 1000;
  const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const scene = healthBarTestScene().scene;
  const player = fakeEntity({ id: 'p1', x: 0, y: 100, active: true, color: 0xffffff,
    body: { enable: true, velocity: { x: 0, y: 0 } }, getHitRadius: () => 10 });
  for (const name of ['updateHP', 'updateArmor', 'updateBurnStacks', 'setVisible', 'setTurretMounted',
    'setWalking', 'setRageTint', 'setDecoyStealth', 'setHeldItemId', 'syncBar', 'setMovementDashPhase', 'setBurrowPhase', 'updateMolotovFirewalker']) {
    player[name] = () => {};
  }
  const players = { getPlayer: (id: string) => id === 'p1' ? player : undefined, getAllPlayers: () => [player] };
  const combat = new WorldCombatCore(players as never, { isHost: () => true,
    getPlayerProfile: players.getPlayer, getLocalPlayerId: () => 'p1', areTeammates: () => false,
    isEnemyPair: () => true, broadcastEffect() {}, broadcastAudioFeedback() {}, broadcastHitscanTracer() {},
  } as never);
  const vitals = combat.bindPlayerVitalsScope({ worldRevision: 72, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => clock.now, random: () => 0.5 });
  combat.initPlayer('p1');
  const metrics = { ...resolveCoopDefenseWorldMetrics(20, 20), offsetX: 100, offsetY: 80 };
  const bases = new BaseManager(scene, [{ id: 'hostile-base', faction: 'hostile', role: 'main',
    hpMax: 1_000_000, startHp: 1_000_000, cells: [{ gridX: 0, gridY: 0 }],
    region: { minGridX: 0, maxGridX: 0, minGridY: 0, maxGridY: 0 }, turrets: [], powerUpPedestals: [],
  }], metrics, {}, false, true);
  const base = bases.getBase('hostile-base')!;
  for (const cell of base.getCellBodies()) Object.assign(cell, { getData: (key: string) => key === 'baseId' ? base.id : undefined, getBounds: () => ({
    left: cell.x - cell.width / 2, right: cell.x + cell.width / 2,
    top: cell.y - cell.height / 2, bottom: cell.y + cell.height / 2,
  }) });
  combat.setBaseManager(bases);
  combat.setBaseObstacles(base.getCellBodies());
  const mutation = new WorldObjectMutationRuntime({ scope: combat.getCombatScope(), metrics, bases, train: null } as never);
  const damageOwners: { owner: string; slot: string | undefined }[] = [];
  combat.setBaseDamageCallback((id, damage, owner, slot, source) => {
    damageOwners.push({ owner, slot });
    return mutation.applyResolvedDamage('base', id, damage, owner, source?.authoredSourceId ?? 'test',
      source?.origin === 'ground' ? 'ground' : 'direct', slot, source);
  });
  const physics = createTechnicalPhysicsBinding();
  // Ordinary bullets use the production base/rock sweep, while growing flames use
  // canonical overlaps. Reuse the actual sweep geometry against BaseManager's bodies.
  const geometryBinding = new ProjectilePhysicsBinding(scene);
  geometryBinding.setBaseGroup({ getChildren: () => base.getCellBodies() } as never);
  physics.binding.findNearestRockSweep = geometryBinding.findNearestRockSweep.bind(geometryBinding);
  const projectiles = new WorldProjectileRuntime({ physicsBinding: physics.binding, presentation: createPresentation(),
    identityScope: new ProjectileIdentityScope(72), hostNowMs: () => clock.now,
    resolveProvenance: source => combat.captureProjectileProvenance(source) });
  projectiles.setProjectileReplicationAdapter(new ProjectileReplicationAdapter(projectiles));
  projectiles.setProjectileCombatPort(combat);
  projectiles.setProjectileCollisionTargetQueryPort({
    readCollisionTargets: sink => combat.readCollisionTargets(sink),
    queryWorldCollisionTargets: (_region, sink) => {
      const cell = base.getCellBodies()[0], b = cell.getBounds();
      sink('base', base.id, '__world__', cell.x, cell.y, Math.hypot(cell.width, cell.height) / 2,
        b.left, b.top, b.right, b.bottom);
    },
  });
  projectiles.setProjectileTargetabilityPort({
    canDamage: (source, target, team) => target.kind === 'base'
      ? combat.canDamageStructure(combat.captureWorldDamageSource('p1', source.weaponSourceId ?? 'test', 'direct', source), undefined, base.faction)
      : combat.canProjectileDamageTarget(source, String(target.id), team),
    canDamageOwner: (source, id, team) => combat.canProjectileDamageTarget(source, id, team),
    isTargetCurrentlyValid: () => false,
  });
  projectiles.setBaseHitCallback((id, _damage, _owner, impact) => {
    if (impact) combat.applyProjectileBaseDamage(id, impact);
  });
  const textures = vi.spyOn(StinkCloudSystem.prototype as unknown as { ensureTextures(): void }, 'ensureTextures').mockImplementation(() => {});
  const cloud = new StinkCloudSystem(scene);
  textures.mockRestore();
  vi.spyOn(cloud, 'syncVisuals').mockImplementation(() => {});
  vi.spyOn(cloud, 'syncPlagueVisuals').mockImplementation(() => {});
  vi.spyOn(cloud, 'clientUpdate').mockImplementation(() => {});
  const fire = new FireSystem(scene);
  // Same impact-cloud bridge as ArenaWorldCombatComposition, preserving utility provenance.
  projectiles.setProjectileImpactCallback(impact => {
    const c = impact.impactCloud;
    if (!c) return;
    cloud.hostCreateStationaryCloud(impact.ownerId, impact.ownerColor ?? impact.color, impact.x, impact.y,
      c.radius, c.duration, c.damagePerTick, c.tickInterval, c.rockDamageMult ?? 1, c.trainDamageMult ?? 1,
      c.baseDamageMult ?? 1, c.visualVariant, clock.now,
      combat.captureWorldDamageSource(impact.ownerId, impact.sourceId, 'ground', impact.provenance, impact.projectileId));
  });
  const host = new HostUpdateCoordinator(scene, {
    getWorldCombatCore: () => combat, playerManager: players, stinkCloudSystem: cloud, fireSystem: fire,
    decoySystem: { hostUpdateLifecycle() {}, hostPostPhysics() {}, createHostSnapshots: () => [], isStealthed: () => false,
      getStealthRemainingFrac: () => 0, getStealthBuff: () => null },
    hostPhysics: { applyRadialImpulse() {}, update() {}, getDashPhase: () => 0, isBurrowDash: () => false,
      getMovementPredictionState: () => undefined },
    smokeSystem: { syncVisuals() {}, syncTargetVisuals() {} },
  } as never, {} as never, {} as never, {} as never);
  host.setPresentationActive(false);
  const explosions = vi.spyOn(host, 'resolveProjectileExplosion');
  host.setWorldFramePort({ getWorldRuntime: () => ({ context: { descriptor: { definitionId: 'world:lobby' } } }),
    getEnemyManager: () => null, getWorldMutationRuntime: () => mutation, getTrainRuntime: () => null,
    getProjectileRuntime: () => projectiles, getShootingRange: () => null,
  } as never);
  const execution = new AutomatedWeaponExecutionAdapter(new WorldWeaponExecutionRuntime({ projectileSpawn: projectiles, combatSystem: combat }), projectiles);
  const shot = (weapon: WeaponConfig) => {
    const surface = base.getNearestSurfacePoint(0, 100)!;
    expect(surface.distance).toBeLessThan(weapon.range);
    return execution.fire(weapon, { x: 0, y: 100, angle: 0, targetX: surface.x, targetY: surface.y,
      ownerId: 'p1', ownerColor: 0xffffff, options: {
        sourceSlot: 'utility', sourceTurretId: 'player-turret', directDamageMultiplier: 1, payloadDamageMultiplier: 1,
        payloadSourceDamageFactors: [
          { kind: 'automated-source', multiplier: 1, resolvedAt: 'execution' },
          { kind: 'runtime-power', multiplier: 1, resolvedAt: 'execution' },
        ],
      } });
  };
  const advance = (duration: number) => {
    for (let elapsed = 0; elapsed < duration; elapsed += 16) {
      clock.now += 16;
      for (const [id, handle] of physics.handles) {
        if (!handle.sprite.active || !handle.body.enable) continue;
        const vx = handle.body.velocity.x, vy = handle.body.velocity.y;
        const x = handle.sprite.x + vx * .016, y = handle.sprite.y + vy * .016;
        handle.body.reset(x, y);
        physics.observe(id, x, y, vx, vy);
      }
      host.runHostUpdate(16);
    }
  };
  return { base, shot, advance, damageOwners, projectiles, physics, execution, explosions,
    destroy() { projectiles.destroy(); cloud.destroyAll(); fire.destroyAll(); mutation.destroy(); bases.destroy(); vitals.destroy(); dateNow.mockRestore(); } };
}

const turretWeapons = Object.entries(WEAPON_CONFIGS)
  .filter(([id]) => id.startsWith('TURRET_') || id === 'SPORE_TURRET_PLASMA');

describe('player-owned utility turret attacks against hostile bases', () => {
  afterEach(() => vi.restoreAllMocks());
  for (const [id, weapon] of turretWeapons) {
    if (weapon.fire.type === 'tesla_dome') {
      it(`${id}: field weapon is rejected by automated fire (TeslaDomeSystem owns base callbacks)`, () => {
        const f = fixture();
        try {
          expect(f.execution.fire(weapon, { x: 0, y: 100, angle: 0, targetX: 100, targetY: 100,
            ownerId: 'p1', ownerColor: 0xffffff, options: { sourceSlot: 'utility', sourceTurretId: 'player-turret' } })).toBe(false);
          f.advance(5000);
          expect(f.damageOwners).toEqual([]);
          expect(f.physics.specs).toHaveLength(0);
          expect(canWeaponDamageBases(weapon)).toBe(false);
          console.info(`${id}: base damage=no (automatic fire rejected; separate Tesla field)`);
        } finally { f.destroy(); }
      });
      continue;
    }
    it(`${id}: observed base damage agrees with the complete attack capability`, () => {
      const f = fixture();
      try {
        const hp = f.base.getHp();
        expect(f.shot(weapon)).toBe(true);
        // Advance well past flight, cloud life, burn and control-field expiry. New authored
        // flight/cloud durations extend the window rather than silently losing late ticks.
        const flightMs = weapon.fire.type === 'projectile' ? weapon.range / weapon.fire.projectileSpeed * 1000 : 3000;
        const cloudMs = weapon.fire.type === 'projectile' ? weapon.fire.impactCloud?.duration ?? 0 : 0;
        f.advance(flightMs + cloudMs + 5000);
        const observedBaseDamage = hp - f.base.getHp();
        console.info(`${id}: base damage=${observedBaseDamage > 0 ? 'yes' : 'no'} (${observedBaseDamage})`);
        if (weapon.fire.type === 'projectile' && weapon.fire.impactExplosion) {
          // A harmless control shot must actually arrive, not pass because it missed.
          expect(f.explosions).toHaveBeenCalled();
          const impact = f.explosions.mock.calls[0][0];
          expect(f.base.getNearestSurfacePoint(impact.x, impact.y)!.distance).toBeLessThanOrEqual(weapon.fire.projectileSize);
          expect(impact.provenance).toMatchObject({ attributionId: 'p1', sourceSlot: 'utility', sourceTurretId: 'player-turret' });
        }
        expect(observedBaseDamage > 0).toBe(canWeaponDamageBases(weapon));
        for (const source of f.damageOwners) expect(source).toEqual({ owner: 'p1', slot: 'utility' });
      } finally { f.destroy(); }
    });
  }
});
