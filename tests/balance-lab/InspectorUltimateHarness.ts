import { vi } from 'vitest';
import { createFireControlWorldFixture } from '../FireControlTestHelper';
import type { WorldCombatGameplayBindingOptions } from '../../src/world/WorldCombatGameplayBinding';
import { WorldPlayerGameplayRuntime } from '../../src/world/WorldPlayerGameplayRuntime';
import { WorldBomberSquadronBinding } from '../../src/world/WorldBomberSquadronBinding';
import { FireSystem } from '../../src/effects/FireSystem';
import { BurnStateMachine } from '../../src/combat/rules/BurnStateMachine';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';
import { BaseManager } from '../../src/entities/BaseManager';
import { WorldObjectMutationRuntime } from '../../src/world/WorldObjectMutationRuntime';
import { ProjectilePhysicsBinding } from '../../src/projectile/ProjectilePhysicsBinding';
import { healthBarTestScene } from '../healthBarTestScene';
import { CELL_SIZE, ACTIVE_ARENA_METRICS_PROFILE, applyArenaWorldMetrics, getAuthoredWorldMetricsProfile } from '../../src/config';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import type { NetworkBridge } from '../../src/network/NetworkBridge';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import type { CombatSource } from '../../src/combat/CombatScope';

export const START = 1000, STEP = 25;
export const FORMATIONS = ['spread', 'dense', 'boss', 'base'] as const;
export type Formation = typeof FORMATIONS[number];
export type Arsenal = 'single' | 'mixed';

const service = (values: Record<string, unknown> = {}): any => new Proxy(values, {
  get(target, key) { if (!(key in target)) target[key as string] = vi.fn(); return target[key as string]; },
});

/** Real host combat, deployment, projectile, chunk and burn rules; stationary durable recipients.
 * Reuses the integration fixture's composition ports, replacing only its single-player/empty-base
 * inputs. No private runtime state or damage/targeting algorithm is reconstructed here.
 */
export function ultimateHarness(formation: Formation, owners: readonly string[] = ['inspector']) {
  const previousMetrics = ACTIVE_ARENA_METRICS_PROFILE;
  applyArenaWorldMetrics(getAuthoredWorldMetricsProfile(120, 100));
  const f = createFireControlWorldFixture();
  f.stats.clear(); // Remove the identity fixture's synthetic MG-attrition upgrade.
  const ports = (f.binding as unknown as { options: WorldCombatGameplayBindingOptions }).options;
  const metrics = resolveActiveArenaWorldMetrics();
  const origin = f.point({ gridX: 20, gridY: 20 });
  const players = new Map(owners.map((id, i) => [id, { ...f.player, id,
    x: origin.x, y: origin.y + i * 500, color: 0xffffff }]));
  ports.playerManager.getPlayer = ((id: string) => players.get(id)) as typeof ports.playerManager.getPlayer;
  ports.playerManager.getAllPlayers = (() => [...players.values()]) as typeof ports.playerManager.getAllPlayers;
  Object.assign(ports.network.round, { canPlayerInitialSpawn: () => true });
  owners.forEach(id => f.combat.initPlayer(id));
  let now = START;
  const date = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
  f.combat.bindHostExecutionSources({ nowMs: () => now, random: () => .5 });
  const sourceByProjectile = new Map<number, string>();
  const spawn = f.projectile.spawn.getMockImplementation()!;
  f.projectile.spawn.mockImplementation(request => {
    const id = spawn(request);
    if (id !== null) sourceByProjectile.set(id, request.provenance.sourceTurretId ?? request.provenance.gameplaySourceId);
    return id;
  });
  const sourceKey = (source?: CombatSource) => sourceByProjectile.get(source?.correlation?.projectileId
    ?? source?.lineage?.parentProjectileId ?? -1) ?? String(source?.gameplaySource.id);
  const events: { at: number; target: string; damage: number; channel: string; source: string }[] = [];
  const record = (target: string, damage: number, channel: string, at = now, source = channel) => {
    if (damage > 0) events.push({ at, target, damage, channel, source });
  };
  const unobserve = f.combat.observeEnemyDamageCommitted((e, _x, _y, at) => record(String(e.target.id), e.actualDamage,
    e.source.authoredSourceId ?? e.damage.damageKind, at, sourceKey(e.source)));
  const enemies = formation === 'base' ? [] : [...players.values()].flatMap(p =>
    Array.from({ length: formation === 'boss' ? 1 : 16 }, (_, i) => {
      const enemy = formation === 'boss' ? f.enemies.hostSpawnAtWorld(p.x + 280, p.y, 'grave-titan')
        : f.spawnEnemy(p.x + 280 + (formation === 'spread' ? i % 4 * 100 : i % 4 * 22),
          p.y + (formation === 'spread' ? Math.floor(i / 4) * 100 - 150 : Math.floor(i / 4) * 22 - 33));
      enemy.setHp(1e9, 1e9, true);
      return enemy;
    }));
  const scene = healthBarTestScene().scene;
  const bases = new BaseManager(scene, formation === 'base' ? [{ id: 'lab-base',
    cells: Array.from({ length: 16 }, (_, i) => ({ gridX: 29 + i % 4, gridY: 19 + Math.floor(i / 4) })),
    region: { minGridX: 29, maxGridX: 32, minGridY: 19, maxGridY: 22 }, hpMax: 1e9,
    faction: 'hostile', role: 'main', turrets: [], powerUpPedestals: [],
  }] : [], metrics, {}, false, true);
  bases.setSecondaryObjectiveStateProvider(() => 'active');
  Object.assign(ports, { baseManager: bases });
  f.combat.setBaseManager(bases);
  const mutation = new WorldObjectMutationRuntime({ scope: f.combat.getCombatScope(), metrics, bases, train: null,
    placement: f.placement, rockRegistry: service(), rockRuntime: service(), construction: service() });
  f.combat.setBaseDamageCallback((id, damage, owner, slot, source) => {
    const outcome = mutation.applyResolvedDamage('base', id, damage, owner, source?.authoredSourceId ?? 'lab',
      source?.origin === 'ground' ? 'ground' : 'direct', slot, source);
    record(id, outcome?.kind === 'damage-applied' ? outcome.actualDamage : 0, source?.authoredSourceId ?? 'base', now,
      sourceKey(source));
    return outcome;
  });
  const base = bases.getBase('lab-base');
  const bodies = base?.getCellBodies() ?? [];
  for (const cell of bodies) Object.assign(cell, { getData: () => base!.id, getBounds: () => ({
    left: cell.x - cell.width / 2, right: cell.x + cell.width / 2,
    top: cell.y - cell.height / 2, bottom: cell.y + cell.height / 2,
  }) });
  f.combat.setBaseObstacles(bodies);
  const geometry = new ProjectilePhysicsBinding(scene);
  geometry.setBaseGroup({ getChildren: () => bodies } as never);
  f.projectile.physics.binding.findNearestRockSweep = geometry.findNearestRockSweep.bind(geometry);
  const projectiles = f.projectile.projectiles;
  projectiles.setProjectileCombatPort(f.combat);
  projectiles.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => f.combat.readCollisionTargets(sink),
    queryWorldCollisionTargets: (_region, sink) => {
      for (const cell of bodies) sink('base', base!.id, '__world__', cell.x, cell.y, CELL_SIZE / 2,
        cell.x - CELL_SIZE / 2, cell.y - CELL_SIZE / 2, cell.x + CELL_SIZE / 2, cell.y + CELL_SIZE / 2);
    } });
  projectiles.setProjectileTargetabilityPort({ canDamage: (source, target, team) => target.kind === 'base'
    ? f.combat.canDamageStructure(f.combat.captureWorldDamageSource(source.attributionId, source.weaponSourceId ?? 'lab'), undefined, 'hostile')
    : f.combat.canProjectileDamageTarget(source, String(target.id), team),
    canDamageOwner: (source, id, team) => f.combat.canProjectileDamageTarget(source, id, team),
    isTargetCurrentlyValid: () => true });
  projectiles.setBaseHitCallback((id, _damage, _owner, impact) => { if (impact) f.combat.applyProjectileBaseDamage(id, impact); });
  const fire = new FireSystem(scene), burn = new BurnStateMachine();
  fire.setGroundResolvers(() => false, () => true);
  const explosionBroadcast = vi.fn<NetworkBridge['broadcastExplosionEffect']>();
  const chunkFx = vi.fn<NetworkBridge['broadcastFireChunkEffect']>();
  // Empty player list disables unrelated passive equipment; the real chunk landing callback
  // in WorldPlayerGameplayRuntime retains its broadcast-suppression branch.
  const runtime = new WorldPlayerGameplayRuntime({ playerManager: service({ getAllPlayers: () => [] }),
    decoySystem: service(), stinkCloudSystem: service(), specializedWeaponExecution: service(), gaussExecution: service(),
    projectileSpawn: service(), projectileTravelReadPort: service({ getTravelSamples: () => [] }),
    projectileEnvironmentInteractionPort: service(), translocatorProjectilePort: service(), combatSystem: f.combat,
    hostPhysics: service({ observeMovementSteps: () => vi.fn() }), fireSystem: fire,
    placementSystem: service({ getAllRuntimeRocks: () => [] }), gameAudioSystem: service(), worldMetrics: metrics,
    getEnemyManager: () => f.enemies, getTargetStatusSystem: () => null, getPowerUpSystem: () => null,
    getPlayerCapabilities: () => ({ canInteract: true } as never), resetPlayerPosition: vi.fn(), dropBeer: vi.fn(),
    createLoadoutManager: () => service(), createBurrowSystem: () => service(), weaponExecution: service(),
    relationship: { isEnemyPair: () => false }, network: { input: service(),
      presentation: service({ broadcastExplosionEffect: explosionBroadcast, broadcastFireChunkEffect: chunkFx }),
      loadout: service(), roundStats: service() },
  });
  const chunks = vi.spyOn(runtime, 'hostCreateFireChunkBurst');
  const explode = vi.spyOn(f.combat, 'applyExplosionDamage');
  const bomber = new WorldBomberSquadronBinding({ combat: f.combat, metrics,
    playerCombat: { ...ports.getPlayerCombatIntegration()!, fireChunks: runtime.getPlayerFireChunkPort() },
    readOwner: id => players.get(id) ?? null });
  const addArsenal = (arsenal: Arsenal) => owners.forEach((owner, k) => {
    const types = arsenal === 'single' ? ['machine_gun_turret'] as const
      : ['machine_gun_turret', 'rocket_turret', 'flame_turret'] as const;
    types.forEach((type, i) => {
      const rock = f.add(type, owner, 18 - i * 3, 20 + k * 16);
      // The identity fixture accelerates aiming; benchmarks retain authored rotation instead.
      const definition = COOP_DEFENSE_CONSTRUCTIONS[type];
      if (definition.kind === 'turret') Object.assign(f.placement.getRuntimeRock(rock.id)!, {
        rotationSpeedDegPerSec: definition.rotationSpeedDegPerSec,
      });
    });
  });
  const advance = (at: number, originals = true) => {
    const dt = at - now; now = at;
    f.tick(at, false);
    if (!originals) f.binding.systems!.turret.setFireSourceProvider(() => f.binding.getTurretFireSources().filter(s => s.projection));
    f.binding.systems!.turret.hostUpdate(at, UTILITY_CONFIGS.SPORE_TURRET as never, WEAPON_CONFIGS.SPORES, dt);
    bomber.advance(at);
    projectiles.runHostInteractionStage(at);
    const result = f.projectile.advance(dt);
    for (const e of result.projectileExplosions) f.combat.resolveExplosionCombat(e);
    runtime.runHostPostProjectileStage(dt, at, false);
    f.combat.updateBurnEffects(at);
    for (const contribution of burn.advanceTo(at)) record(contribution.targetId, contribution.damage, 'burn', contribution.tickAt, contribution.sourceKey);
    if (fire.hostUpdate(at).damageTick) for (const e of enemies) {
      for (const contact of fire.collectContacts(e.sprite.x, e.sprite.y, e.getCollisionRadius(), at)) {
        if (contact.burn) burn.applyHit({ targetId: e.id, attackerId: contact.ownerId, sourceKey: contact.sourceKey,
          sourceId: contact.sourceId, durationMs: contact.burn.durationMs, damagePerTick: contact.burn.damagePerTick, now: at });
      }
    }
  };
  return { f, players, enemies, bomber, chunks, chunkFx, explode, explosionBroadcast, events, addArsenal, advance,
    metrics, base,
    destroy() { bomber.destroy(); runtime.destroy(); unobserve(); f.destroy(); fire.destroyAll(); mutation.destroy(); bases.destroy(); date.mockRestore(); random.mockRestore(); applyArenaWorldMetrics(previousMetrics); } };
}

/** Relief = time to 50% of the fixed virtual HP pool; recipients stay alive to measure overkill.
 * Overlap = share of hit targets reached by multiple gameplay sources (copies/bombs).
 */
export function summarize(h: ReturnType<typeof ultimateHarness>, name: string, virtualHp: number) {
  const ids = h.base ? [h.base.id] : h.enemies.map(e => e.id);
  const damageByTarget = Object.fromEntries(ids.map(id => [id, 0]));
  const hits = new Map<string, Set<string>>();
  let total = 0, reliefMs: number | null = null;
  for (const e of [...h.events].sort((a, b) => a.at - b.at)) {
    damageByTarget[e.target] = (damageByTarget[e.target] ?? 0) + e.damage;
    total += e.damage;
    if (!hits.has(e.target)) hits.set(e.target, new Set());
    hits.get(e.target)!.add(e.source);
    const relieved = Object.values(damageByTarget).reduce((sum, d) => sum + Math.min(d, virtualHp), 0);
    if (reliefMs === null && relieved >= ids.length * virtualHp / 2) reliefMs = e.at - START;
  }
  return { name, scenarioVersion: 1, stepMs: STEP, random: 'fixed-0.5; bomb-key chunk seeds', virtualHp,
    reliefDefinition: '50% of per-target-capped virtual HP pool; stationary recipients remain alive',
    overlapDefinition: 'fraction of hit targets reached by multiple copies/bombs',
    targets: h.base ? { cells: h.base.getSpec().cells } : h.enemies.map(e => ({ id: e.id, x: e.sprite.x, y: e.sprite.y, radius: e.getCollisionRadius() })),
    totalDamage: total, damageByTarget, reliefMs,
    overlap: hits.size ? [...hits.values()].filter(times => times.size > 1).length / hits.size : 0,
    sourcesPerTarget: Object.fromEntries(ids.map(id => [id, hits.get(id)?.size ?? 0])),
    targetsHit: hits.size, channels: Object.fromEntries([...new Set(h.events.map(e => e.channel))]
      .map(channel => [channel, h.events.filter(e => e.channel === channel).reduce((sum, e) => sum + e.damage, 0)])) };
}
