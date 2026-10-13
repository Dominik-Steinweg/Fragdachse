import { describe, expect, it, vi } from 'vitest';

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
import { resolveCoopDefenseWorldMetrics, type WorldMetrics } from '../../src/world/WorldMetrics';
import { WorldWeaponExecutionRuntime } from '../../src/world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../../src/world/AutomatedWeaponExecutionAdapter';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../../src/projectile/ProjectileIdentityScope';
import { ProjectileReplicationAdapter } from '../../src/projectile/ProjectileReplicationAdapter';
import { ProjectilePhysicsBinding } from '../../src/projectile/ProjectilePhysicsBinding';
import { WEAPON_CONFIGS, UTILITY_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { resolveConstructionPlacementRange } from '../../src/config/coopDefenseConstructions';
import { createTechnicalPhysicsBinding, createPresentation } from '../ProjectileRuntimeTestHelper';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';

/**
 * Smallest real automatic-fire composition: no TurretSystem target selection or player
 * loadout/resource lifecycle. The fire options are those of bindHostSystems for a player
 * construction with neutral buffs. Only rendering, network and technical physics are fake.
 */
function fixture(spec: BaseSpec, metrics: WorldMetrics) {
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
  const bases = new BaseManager(scene, [spec], metrics, {}, false, true);
  bases.setSecondaryObjectiveStateProvider(() => 'active');
  const base = bases.getBase(spec.id)!;
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
  const geometry = Object.assign(Object.create(WorldCombatGameplayBinding.prototype), {
    options: { baseManager: bases }, projectileBaseGeometry: [], projectileBaseGeometryGeneration: -1,
  }) as { ensureProjectileBaseGeometry(): void; projectileBaseGeometry: { base: typeof base; x: number; y: number;
    radius: number; left: number; top: number; right: number; bottom: number }[] };
  projectiles.setProjectileCollisionTargetQueryPort({
    readCollisionTargets: sink => combat.readCollisionTargets(sink),
    queryWorldCollisionTargets: (_region, sink) => {
      geometry.ensureProjectileBaseGeometry();
      for (const g of geometry.projectileBaseGeometry) if (!g.base.isInert())
        sink('base', g.base.id, '__world__', g.x, g.y, g.radius, g.left, g.top, g.right, g.bottom);
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
  cloud.syncVisuals = () => {};
  cloud.syncPlagueVisuals = () => {};
  cloud.clientUpdate = () => {};
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
  host.setWorldFramePort({ getWorldRuntime: () => ({ context: { descriptor: { definitionId: 'world:lobby' } } }),
    getEnemyManager: () => null, getWorldMutationRuntime: () => mutation, getTrainRuntime: () => null,
    getProjectileRuntime: () => projectiles, getShootingRange: () => null,
  } as never);
  const execution = new AutomatedWeaponExecutionAdapter(new WorldWeaponExecutionRuntime({ projectileSpawn: projectiles, combatSystem: combat }), projectiles);
  const advance = (duration: number) => {
    for (let elapsed = 0; elapsed < duration; elapsed += 16) {
      const step = Math.min(16, duration - elapsed);
      clock.now += step;
      for (const [id, handle] of physics.handles) {
        if (!handle.sprite.active || !handle.body.enable) continue;
        const vx = handle.body.velocity.x, vy = handle.body.velocity.y;
        const x = handle.sprite.x + vx * step / 1000, y = handle.sprite.y + vy * step / 1000;
        handle.body.reset(x, y);
        physics.observe(id, x, y, vx, vy);
      }
      host.runHostUpdate(step);
    }
  };
  return { base, bases, combat, mutation, advance, damageOwners, projectiles, physics, execution,
    destroy() { projectiles.destroy(); cloud.destroyAll(); fire.destroyAll(); mutation.destroy(); bases.destroy(); vitals.destroy(); dateNow.mockRestore(); } };
}


import { WorldMgTurretBinding } from '../../src/world/WorldMgTurretBinding';
import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../src/config';
import { resolveCoopDefenseActivityBases, type BaseSpec } from '../../src/arena/BaseRegistry';
import { ArenaGenerator, resolveArenaGenerationInput } from '../../src/arena/ArenaGenerator';
import { COOP_DEFENSE_MAP_CONFIGS } from '../../src/config/coopDefenseMaps';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { PlacementSystem } from '../../src/systems/PlacementSystem';
import { RockGridIndex } from '../../src/arena/RockGridIndex';
import { TurretSystem, type AutomatedTurret, type TurretFireSource } from '../../src/systems/TurretSystem';
import { ExposedBaseFaceCache, type BaseAimPoint } from '../../src/systems/TurretBaseTargeting';
import { WorldCombatGameplayBinding } from '../../src/world/WorldCombatGameplayBinding';
import { resolveMgTurretStats } from '../../src/config/mgTurret';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS, getCoopDefenseResolvedEffectTotals } from '../../src/utils/coopDefenseUpgrades';
import { HeadlessSingleTargetWorld } from '../../src/debug/coopDefenseBalance/HeadlessSingleTargetWorld';
import { runStaticTargetBenchmarkCore } from '../../src/debug/coopDefenseBalance/staticTargetBenchmarkCore';
import { isSingleTargetTriggerReady, calculateSingleTargetTriggerReadyTime } from '../../src/debug/coopDefenseBalance/triggerDiscipline';
import { runWeaponSingleTargetBenchmark } from '../../src/debug/coopDefenseBalance/weaponBenchmark';
import { FireControlRuntime } from '../../src/systems/fireControl/FireControlRuntime';
import type { ResolvedFireControlRelayConfig } from '../../src/world/FireControlUtilityPort';
// Versioned diagnostic, no balance-value assertions. 16 ms is also the technical physics step.
const SEED = 19464, DT = 16;
const groups = {
  '1R': ['rocket_turret'], '3R': Array(3).fill('rocket_turret'),
  '3MG': Array(3).fill('machine_gun_turret'), '2F': Array(2).fill('flame_turret'),
  '2R2MG1F': ['rocket_turret', 'rocket_turret', 'machine_gun_turret', 'machine_gun_turret', 'flame_turret'],
} as const;
type TurretKind = 'rocket_turret' | 'machine_gun_turret' | 'flame_turret';
const maxProfile = { upgrades: Object.fromEntries(Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)
  .map(d => [d.id, { unlocked: true, level: d.maxLevel }])) };
const totals = getCoopDefenseResolvedEffectTotals(maxProfile, 'inspector_gadachs');
const mgStats = (end: boolean) => resolveMgTurretStats(s => end ? totals.additive[s] ?? 0 : 0,
  s => end ? totals.percentage[s] ?? 0 : 0);

/** Invoke the real binding's selector, without constructing unrelated world systems. */
function targeting(bases: BaseManager, combat: WorldCombatCore, metrics: WorldMetrics) {
  const owner = Object.assign(Object.create(WorldCombatGameplayBinding.prototype), {
    options: { baseManager: bases, combatSystem: combat, worldMetrics: metrics, isCoopDefense: () => true },
    turretBaseFaces: new ExposedBaseFaceCache(),
  }) as { getHostileBaseAimCandidates(s: TurretFireSource, x: number, y: number, range: number): readonly (BaseAimPoint & { id: string })[] };
  return owner.getHostileBaseAimCandidates.bind(owner);
}

function runAssault(spec: BaseSpec, metrics: WorldMetrics, poses: AutomatedTurret[], durationMs = 360000,
  relay?: { count: number; parallel: boolean; duration: number; originalsInRange?: boolean }, end = false) {
  const f = fixture(spec, metrics), time = new HeadlessSingleTargetWorld(150, SEED, false);
  f.combat.setWorldMetrics(metrics);
  const mg = new WorldMgTurretBinding({ combat: f.combat, bases: f.bases, getEnemies: () => null,
    getMutation: () => f.mutation, owners: () => [{ id: 'p1', group: 'team', stats: mgStats(end) }] });
  const selector = targeting(f.bases, f.combat, metrics);
  const turret = new TurretSystem({ getAllPlayers: () => [] } as never, f.combat);
  const copies = new FireControlRuntime({ readConstructions: () => poses.map(p => ({ ...p, id: Number(p.id),
    baseOwned: false, constructionId: 'rocket_turret', weaponFireType: 'projectile', combatReady: true, manned: false })),
    readSlotOrder: () => ['rocket_turret'], isPointFree: () => true, onDeploymentEnded() {} });
  turret.setTurretProvider(() => poses, (s, angle) => {
    if (s.id !== s.identityId) copies.setCopyAngle(String(s.id), angle);
    else Object.assign(poses.find(p => p.id === s.id)!, { angle });
  });
  turret.setBaseTargetCandidateProvider(selector);
  turret.setLineOfFireChecker((sx, sy, ex, ey) => f.combat.hasClearLineOfFire(sx, sy, ex, ey));
  let shots = 0;
  turret.setFireHandler((ownerId, ownerColor, weaponId, x, y, angle, targetX, targetY, damage = 1, range = 1, sourceId) => {
    shots++;
    f.execution.fire({ ...WEAPON_CONFIGS[weaponId], range: WEAPON_CONFIGS[weaponId].range * range }, {
      ownerId, ownerColor, x, y, angle, targetX, targetY,
      options: { sourceSlot: 'utility', sourceTurretId: String(sourceId), personalMgOwnerId: weaponId === 'TURRET_MG' ? ownerId : undefined,
        personalMgScope: weaponId === 'TURRET_MG' ? f.combat.getCombatScope() : undefined, directDamageMultiplier: damage,
        payloadDamageMultiplier: damage, payloadSourceDamageFactors: [{ kind: 'automated-source', multiplier: damage, resolvedAt: 'execution' }] },
    });
  });
  if (relay) {
    const cfg = UTILITY_CONFIGS.FIRE_CONTROL_RELAY;
    if (cfg.type !== 'fire_control_relay') throw Error('Expected relay');
    const config: ResolvedFireControlRelayConfig = { ...cfg, buildRangePx: resolveConstructionPlacementRange(), durationMs: relay.duration,
      maxCopies: relay.count, parallel: relay.parallel, cooldownMs: cfg.cooldown };
    const point = { x: poses[0].x, y: poses[0].y };
    // Original is remote; only copies can reach this base. Neutral free deployment pocket.
    if (!relay.originalsInRange) for (const pose of poses) Object.assign(pose, { x: pose.x - 1400 });
    expect(copies.activateCopies({ ownerId: 'p1', ownerColor: 1, playerX: point.x - 100, playerY: point.y,
      pointX: point.x, pointY: point.y, nowMs: clock.now, config }).ok).toBe(true);
    turret.setFireSourceProvider(() => copies.deriveFireSources(poses, clock.now));
  }
  const hp = f.base.getHp();
  try {
    while (time.getTime() < durationMs && f.base.getHp() > 0) {
      mg.advance(clock.now); copies.update(clock.now);
      turret.hostUpdate(clock.now, UTILITY_CONFIGS.SPORE_TURRET as never, WEAPON_CONFIGS.SPORES, DT);
      f.advance(DT); time.step(DT);
    }
    return { ttkSec: f.base.getHp() <= 0 ? time.getTime() / 1000 : null,
      damage: hp - f.base.getHp(), shots, elapsedMs: time.getTime() };
  } finally { mg.destroy(); copies.clear(); f.destroy(); }
}

function pose(kind: TurretKind, id: number, x: number, y: number, end: boolean): AutomatedTurret {
  const config = COOP_DEFENSE_CONSTRUCTIONS[kind];
  if (config.kind !== 'turret') throw Error('Expected turret');
  return { ...config, id, x, y, angle: 0, ownerId: 'p1', ownerColor: 1, targetMode: 'enemies',
    ...(kind === 'machine_gun_turret' ? mgStats(end) : {}) };
}

const maps = COOP_DEFENSE_MAP_CONFIGS.filter(m => m.mapId !== '0' && m.bases.some(b => b.faction === 'hostile'));

describe('fire-control-base-assault.v1: diagnostic production runtime', () => {
  it('reports campaign TTK from legal forward pockets at the nearest exposed surface', async () => {
    for (const map of maps) {
      const metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
      const specs = resolveCoopDefenseActivityBases(map, 1, metrics);
      const layout = ArenaGenerator.generate(SEED, resolveArenaGenerationInput('coop_defense', metrics), map);
      for (const spec of specs.filter(s => s.faction === 'hostile')) {
        for (const end of [false, true]) for (const [group, kinds] of Object.entries(groups)) {
          const placement = new PlacementSystem(layout, new RockGridIndex(layout.rocks, { cols: metrics.gridCols, rows: metrics.gridRows }),
            { getAllPlayers: () => [] } as never, metrics, specs);
          const f = fixture(spec, metrics);
          f.combat.setWorldMetrics(metrics);
          // Real LOS against generated terrain; technical rectangles contain no rendering.
          f.combat.setArenaObstacles([...layout.rocks, ...layout.trees].map(c => {
            const x = metrics.offsetX + (c.gridX + .5) * CELL_SIZE, y = metrics.offsetY + (c.gridY + .5) * CELL_SIZE;
            return fakeEntity({ x, y, active: true, obstacleClass: 'veryHigh',
              getBounds: () => new Phaser.Geom.Rectangle(x - CELL_SIZE/2, y - CELL_SIZE/2, CELL_SIZE, CELL_SIZE) });
          }) as never, null);
          const choose = targeting(f.bases, f.combat, metrics);
          const positions: AutomatedTurret[] = [];
          try {
            for (const kind of kinds as TurretKind[]) {
              const options: { p: AutomatedTurret; distance: number; gx: number; gy: number }[] = [];
              for (let gy = Math.max(0, spec.region.minGridY - 8); gy <= Math.min(metrics.gridRows - 1, spec.region.maxGridY + 8); gy++) {
                for (let gx = Math.max(0, spec.region.minGridX - 8); gx <= Math.min(metrics.gridCols - 1, spec.region.maxGridX + 8); gx++) {
                  const x = metrics.offsetX + (gx + .5) * CELL_SIZE, y = metrics.offsetY + (gy + .5) * CELL_SIZE;
                  const p = pose(kind, positions.length + 1, x, y, end);
                  const cfg = COOP_DEFENSE_CONSTRUCTIONS[kind];
                  // Builder stands at the same free cell before leaving; placement uses real range/occupancy rules.
                  const preview = placement.getConstructionPlacementPreview(cfg, x, y, x, y);
                  if (!preview?.isValid) continue;
                  const points = choose({ ...p, identityId: p.id, sequenceKey: p.id, visualId: p.id, fireState: 'active' }, x, y, p.targetRange!);
                  const aim = points.find(a => a.distance >= 80 && f.combat.hasClearLineOfFire(x, y, a.x, a.y));
                  if (aim) options.push({ p, distance: aim.distance, gx, gy });
                }
              }
              options.sort((a, b) => a.distance - b.distance || a.gx - b.gx || a.gy - b.gy);
              const selected = options[0];
              if (!selected) break;
              expect(placement.materializePersistentPlaceable(COOP_DEFENSE_CONSTRUCTIONS[kind], selected.gx, selected.gy, 0, 'p1', 1)).toBeTruthy();
              positions.push(selected.p);
            }
          } finally { f.destroy(); }
          const result = positions.length === kinds.length ? runAssault(spec, metrics, positions, 360000, undefined, end) : null;
          if (result) expect(Number.isFinite(result.damage)).toBe(true);
          console.info('FC_ASSAULT ' + JSON.stringify({ map: map.mapId, base: spec.id, role: spec.role,
            hp: spec.startHp ?? spec.hpMax, hp4: resolveCoopDefenseActivityBases(map, 4, metrics).find(b => b.id === spec.id)!.hpMax,
            referenceSec: map.balanceReferenceDurationSec, group, end, positions: positions.map(p => [p.x, p.y]), ...result }));
          await new Promise<void>(resolve => setImmediate(resolve));
        }
      }
      const manager = new BaseManager(healthBarTestScene().scene, specs, metrics, {}, false, true);
      manager.setSecondaryObjectiveStateProvider(() => 'active');
      const friendly = manager.getTurrets().filter(t => t.faction === 'friendly').map(t => ({
        id: t.id, weapon: t.weaponId, range: t.targetRange,
        hostileDistances: manager.getBasesByFaction('hostile').map(b => ({ id: b.id,
          distance: b.getNearestSurfacePoint(t.x, t.y)?.distance,
          inRange: (b.getNearestSurfacePoint(t.x, t.y)?.distance ?? Infinity) <= t.targetRange })) }));
      manager.destroy();
      console.info('FC_MAP ' + JSON.stringify({ map: map.mapId, friendlyTurrets: friendly,
        encounters: map.encounters, spawns: map.persistentSpawns }));
    }
  }, 300000);

  it('compares real relay deployments and inspector primary fire in the same finite window', () => {
    const metrics = resolveCoopDefenseWorldMetrics(80, 40);
    const spec: BaseSpec = { id: 'remote-objective', faction: 'hostile', role: 'main', hpMax: 1000000, startHp: 1000000,
      cells: [{ gridX: 40, gridY: 20 }, { gridX: 40, gridY: 21 }, { gridX: 40, gridY: 22 }],
      region: { minGridX: 40, maxGridX: 40, minGridY: 20, maxGridY: 22 }, turrets: [], powerUpPedestals: [] };
    const cfg = UTILITY_CONFIGS.FIRE_CONTROL_RELAY;
    if (cfg.type !== 'fire_control_relay') throw Error('Expected relay');
    const measure = (count: number, parallel: boolean, duration: number, originalsInRange = false) => runAssault(spec, metrics,
      Array.from({ length: count }, (_, i) => pose('rocket_turret', i + 1,
        metrics.offsetX + 40 * CELL_SIZE - 150, metrics.offsetY + 21.5 * CELL_SIZE, false)), duration,
      { count, parallel, duration, originalsInRange });
    const first = measure(1, false, cfg.durationMs);
    expect(measure(1, false, cfg.durationMs)).toEqual(first);
    expect(first.damage).toBeGreaterThan(0);
    for (const duration of [cfg.durationMs, cfg.durationMs + COOP_DEFENSE_UPGRADE_DEFINITIONS.fire_control_relay_duration.effects[0].value * COOP_DEFENSE_UPGRADE_DEFINITIONS.fire_control_relay_duration.maxLevel]) {
      for (const count of [1, 2, 3]) for (const parallel of [false, true]) {
        console.info('FC_COPY ' + JSON.stringify({ count, parallel, duration, cooldown: cfg.cooldown,
          ...measure(count, parallel, duration) }));
      }
      for (const parallel of [false, true]) console.info('FC_PARALLEL ' + JSON.stringify({ duration, count: 3, parallel,
        ...measure(3, parallel, duration, true) }));
      for (const weaponId of ['GLOCK']) {
        const result = runWeaponSingleTargetBenchmark({ weaponId, durationMs: duration,
          targetDistance: 150, stepDeltaMs: DT, seed: SEED, recordEvents: false });
        expect(result.primaryMetricComplete).toBe(true);
        const f = fixture(spec, metrics), world = new HeadlessSingleTargetWorld(150, SEED, false);
        const sx = metrics.offsetX + 40 * CELL_SIZE - 150, sy = metrics.offsetY + 21.5 * CELL_SIZE;
        world.spawnProjectile = request => f.projectiles.spawnProjectile({ ...request,
          origin: { ...request.origin, x: request.origin.x + sx, y: request.origin.y + sy },
          provenance: f.combat.captureProjectileProvenance({ ...request.provenance, attributionId: 'p1', sourceSlot: 'weapon1' }) });
        const step = world.step.bind(world);
        world.step = delta => { f.advance(delta); step(delta); };
        try {
          runStaticTargetBenchmarkCore({ config: WEAPON_CONFIGS[weaponId], sourceSlot: 'weapon1', world,
            measurementStartMs: 0, measurementEndMs: duration, stepDeltaMs: DT, maxSettleMs: 0,
            controller: {
              resolveAim: () => ({ aimAngle: 0, targetX: 150, targetY: 0, triggerTargetDistance: 150, triggerTargetRadius: 16 }),
              isTriggerReady: (c, spread, a) => isSingleTargetTriggerReady('spread_coverage_and_recovery', c, spread, a.triggerTargetDistance, a.triggerTargetRadius),
              calculateTriggerReadyTime: (c, spread, used, now, a) => calculateSingleTargetTriggerReadyTime('spread_coverage_and_recovery', c, spread, used, now, a.triggerTargetDistance, a.triggerTargetRadius),
            } });
          console.info('FC_PLAYER ' + JSON.stringify({ weaponId, duration, figureDamage: result.totalDamage,
            baseDamage: spec.hpMax - f.base.getHp(), shots: world.getShotsFired(), figureShots: result.shotsFired }));
        } finally { f.destroy(); }
      }
    }
    console.info('FC_STATS ' + JSON.stringify({ start: mgStats(false), end: mgStats(true),
      upgrades: Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS).filter(d => d.effects.some(e => e.stat.startsWith('construction.')))
        .map(d => ({ id: d.id, max: d.maxLevel, effects: d.effects })) }));
  }, 30000);
});
