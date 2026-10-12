import { WaterGeometry } from '../arena/WaterGeometry';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import type { CombatScope } from '../combat/CombatScope';
import type { CombatPartHitReceipt } from '../combat/CombatPartContact';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import type { ArenaLayout } from '../types';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import { CoopDefenseKrakenSystem } from '../systems/CoopDefenseKrakenSystem';
import { CoopDefenseKrakenBroodSystem } from '../systems/CoopDefenseKrakenBroodSystem';
import { KrakenHabitatRules } from '../systems/KrakenHabitatRules';
import type { KrakenBroodPort, KrakenState } from '../systems/KrakenState';
import type { EnemyAreaClawEvent } from '../systems/EnemyClawAttack';
import { NavigationGeometry, type NavigationGeometrySnapshot } from '../systems/navigation/NavigationGeometry';
import { ENEMY_FLOW_FIELD_IDS } from '../systems/flowfield/FlowFieldCoordinator';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { CoopMissionRuntime } from './CoopMissionRuntime';

/** Arena supplies the existing World capabilities; this binding owns no World service. */
export interface CoopMissionKrakenPorts {
  readonly combat: Pick<WorldCombatCore, 'getCombatScope' | 'bindPartContacts' | 'resolveAreaAttack' | 'isStunned' | 'readCollisionTargets'>;
  readonly resolveIntentTarget: (candidate: import('../systems/EnemyAiTargetCatalog').EnemyAiTargetCandidate) => import('../combat/CombatScope').CombatTargetRef | null;
  readonly projectiles: ProjectileSpawnPort;
  readonly cancelFlights: (ids: readonly number[]) => void;
  readonly bindBrood: (port: KrakenBroodPort | null) => void;
  readonly publish: (state: KrakenState | null) => void;
  readonly broadcastClaw: (event: EnemyAreaClawEvent) => void;
  readonly broadcastHit: (receipt: CombatPartHitReceipt) => void;
  readonly now: () => number;
  readonly diagnostic: (message: string) => void;
}

export function materializeCoopMissionKraken(runtime: CoopMissionRuntime, map: CoopDefenseMapConfig,
  layout: ArenaLayout, metrics: WorldMetrics, ports: CoopMissionKrakenPorts,
  geometryProvider: () => NavigationGeometrySnapshot): void {
  const config = map.boss && getCoopDefenseEnemyConfig(map.boss.enemyKind).krakenBoss;
  const manager = runtime.enemyManager;
  if (!config || !map.krakenHabitat || !manager) return;
  const scope: CombatScope = ports.combat.getCombatScope();
  const excluded = new Set<string>();
  let lastGeometry: NavigationGeometrySnapshot | null = null;
  let solidGeometry: NavigationGeometry;
  const solids = () => {
    const snapshot = geometryProvider();
    if (lastGeometry !== snapshot) {
      lastGeometry = snapshot;
      solidGeometry = new NavigationGeometry({ ...snapshot, obstacles: snapshot.obstacles.filter(o => o.kind !== 'water') });
    }
    return solidGeometry;
  };
  const habitat = new KrakenHabitatRules(map.krakenHabitat, new WaterGeometry(layout.water ?? [], metrics), metrics, config, {
    revisions: () => ({ worldRevision: scope.worldRevision, activityRevision: runtime.descriptor.activityRevision,
      topologyRevision: runtime.flowFieldCoordinator?.getFieldView(ENEMY_FLOW_FIELD_IDS.boss)?.version().topology ?? 0 }),
    circleFree: (x, y, radius) => solids().isFree(x, y, radius),
    segmentFree: (from, to, radius) => solids().canMove(from.x, from.y, to.x, to.y, radius),
    landConnection: point => {
      const field = runtime.enemyBossFlowFieldService;
      const reachable = field?.canReachCurrentGoals(point.x, point.y);
      return reachable === true ? 'ready' : reachable === false ? 'blocked' : 'pending';
    },
  });
  const entity = manager.getKrakenEntityPort(id => ports.combat.isStunned(id, ports.now()));
  const currentEgg = (id: string, generation: number) => manager.getCombatTargetRef(id)?.instance.entityGeneration === generation
    ? manager.getEnemy(id) : null;
  const occupied = (x: number, y: number, radius: number, ignoreId: string | null = null) => {
    if (manager.getAllEnemies().some(e => e.getHp() > 0 && e.id !== ignoreId
      && Math.hypot(e.sprite.x - x, e.sprite.y - y) < radius + e.getCollisionRadius())) return true;
    let playerOverlap = false;
    ports.combat.readCollisionTargets((kind, _id, _owner, px, py, bodyRadius) => {
      if (kind === 'player' && Math.hypot(px - x, py - y) < radius + bodyRadius) playerOverlap = true;
    });
    return playerOverlap;
  };
  const reservations = new Set<string>();
  let reservationId = 0;
  const brood = new CoopDefenseKrakenBroodSystem(config.eggs, {
    isBossAlive: boss => entity.readBoss(boss)?.alive === true,
    spawnEgg: (kind, p, originId) => {
      const egg = manager.hostSpawnKrakenEggAtWorld(p.x, p.y, kind, originId,
        (x, y, radius) => habitat.isDryBodyFree({ x, y }, radius) && !occupied(x, y, radius));
      if (!egg) return null;
      excluded.add(egg.id);
      return { id: egg.id, generation: manager.getCombatTargetRef(egg.id)!.instance.entityGeneration };
    },
    readEgg: (id, generation) => { const e = currentEgg(id, generation); return e ? { x: e.sprite.x, y: e.sprite.y, alive: e.getHp() > 0 } : null; },
    retireEgg: (id, generation) => manager.hostRetireKrakenEgg(id, generation, ports.now()),
    removeEgg: (id, generation) => { if (currentEgg(id, generation)) manager.hostRemoveWithoutKill(id); },
    landingFree: (p, radius) => habitat.isDryBodyFree(p, radius) && !occupied(p.x, p.y, radius),
    reserveChild: (kind, p) => {
      const radius = getCoopDefenseEnemyConfig(kind).size / 2;
      if (!habitat.isDryBodyFree(p, radius)) return { status: 'invalid' };
      if (occupied(p.x, p.y, radius, manager.getAllEnemies().find(e => e.isKrakenEgg() && e.sprite.x === p.x && e.sprite.y === p.y)?.id ?? null)) return { status: 'blocked' };
      const reachable = runtime.enemyPlayerFlowFieldService?.canReachCurrentGoals(p.x, p.y);
      if (reachable !== true) return { status: reachable === false ? 'blocked' : 'pending' };
      const id = `kraken-child:${++reservationId}`; reservations.add(id);
      return { status: 'valid', reservationId: id };
    },
    spawnChild: (kind, p, originId, id) => {
      if (!reservations.delete(id)) return;
      const child = manager.hostSpawnAtWorld(p.x, p.y, kind, { originId });
      excluded.add(child.id);
    },
    releaseChild: id => { reservations.delete(id); },
    cancelFlights: ports.cancelFlights, random: Math.random,
  });
  const targetPoint = (candidate: import('../systems/EnemyAiTargetCatalog').EnemyAiTargetCandidate | null) => {
    if (!candidate) return null;
    const target = ports.resolveIntentTarget(candidate);
    return target ? { target, x: candidate.x, y: candidate.y } : null;
  };
  const system = new CoopDefenseKrakenSystem(config, {
    entity, habitat, brood, combat: ports.combat, projectiles: ports.projectiles,
    intent: {
      readTarget: boss => {
        const target = runtime.enemyIntents?.get(boss.id)?.target;
        return target && target.kind !== 'base' && target.kind !== 'ally'
          ? targetPoint(runtime.enemyAiTargetCatalog?.resolve(target) ?? null) : null;
      },
      readSecondaryTargets: () => (runtime.enemyAiTargetCatalog?.getCandidates('player-like') ?? []).flatMap(c => { const p = targetPoint(c); return p ? [p] : []; }),
    },
    publish: { publish: state => { if (state) manager.applyKrakenState(state); ports.publish(state); } },
    claw: event => { manager.applyAreaClawEvent(event); ports.broadcastClaw(event); },
    waterApproach: (from, target) => habitat.waterApproach(from, target),
    canMove: (from, to, mode) => habitat.canMove(from, to, mode),
    bodyTravelLimit: (from, angle, distance) => {
      let limit = distance;
      ports.combat.readCollisionTargets((kind, _id, _owner, x, y, radius) => {
        if (kind !== 'player') return;
        const dx = x - from.x, dy = y - from.y;
        const along = dx * Math.cos(angle) + dy * Math.sin(angle);
        const across = -dx * Math.sin(angle) + dy * Math.cos(angle);
        const clearance = config.bodyRadiusPx + radius;
        if (Math.abs(across) >= clearance || along < 0) return;
        limit = Math.min(limit, Math.max(0, along - Math.sqrt(clearance * clearance - across * across)));
      });
      return limit;
    },
    eggLandings: (from, rotation, count, distance) => habitat.eggLandings(from, rotation, count, distance),
    flightFree: (from, to, radius) => solids().canMove(from.x, from.y, to.x, to.y, radius),
    diagnostic: ports.diagnostic,
  });
  runtime.setKraken({ system, brood, habitat, excluded });
  let release: (() => void) | null = null;
  runtime.bind({
    attach: () => {
      if (release) return;
      release = ports.combat.bindPartContacts({ contacts: system.contacts, status: system.contacts, policy: config.transfer,
        isBodyTargetable: target => manager.getEnemy(String(target.id))?.isBodyTargetable() ?? false, onHit: ports.broadcastHit });
      ports.bindBrood(brood);
    },
    detach: () => { release?.(); release = null; ports.bindBrood(null); system.clear(); brood.clear(); habitat.clear(); reservations.clear(); excluded.clear(); },
  });
}
