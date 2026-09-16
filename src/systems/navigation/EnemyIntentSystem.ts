import type { EnemyEntity } from '../../entities/EnemyEntity';
import { getCoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';
import type { EnemyAiTargetCatalog, EnemyAiTargetCandidate } from '../EnemyAiTargetCatalog';
import type { DecoyTargetPort } from '../CoopDefenseDecoyTargetSystem';
import { EnemyFlowFieldService } from '../EnemyFlowFieldService';
import type { FlowFieldCoordinator, FlowFieldSnapshot } from '../flowfield/FlowFieldCoordinator';
import type { BreachPlan, EnemyIntent, NavigationResult } from './NavigationContracts';
import { NavigationGeometry, type NavigationPoint } from './NavigationGeometry';
import { navigationPoint } from './NavigationGraph';
import { navigationAttackPoint } from './NavigationAttackPoint';
import { BreachPlanner } from './BreachPlanner';
import { AttackPositionReservations } from './AttackPositionReservations';
import { NavigationDensity } from './NavigationDensity';

type Target = NonNullable<EnemyIntent['target']> & NavigationPoint & { radius?: number; objectId?: string };
interface SharedField { readonly id: string; readonly field: EnemyFlowFieldService; signature: string; usedAt: number;
  sealedGoals: readonly number[]; acceptsOpenedGoal: ((index: number, opened: ReadonlySet<string>) => boolean) | undefined }
interface Decision {
  intent: EnemyIntent; field: EnemyFlowFieldService; target: Target; breach: BreachPlan | null; enemy: EnemyEntity;
  readonly queryX: number; readonly queryY: number; readonly querySnapshot: FlowFieldSnapshot | null;
}

/** Activity-owned target binding and attack authority. Field identity includes the actual target. */
export class EnemyIntentSystem {
  private readonly decisions = new Map<string, Decision>();
  private readonly nextDecisionAt = new Map<string, number>();
  private readonly fieldEntries = new WeakMap<EnemyFlowFieldService, SharedField>();
  private readonly fields = new Map<string, SharedField>();
  private readonly planner = new BreachPlanner();
  private readonly goalRegions = new WeakMap<readonly number[], string>();
  private readonly positions = new AttackPositionReservations();
  private readonly lastSeen = new Map<string, Target>();
  private perception: ((enemy: EnemyEntity, x: number, y: number, range: number) => boolean) | null = null;
  setPerception(perception: (enemy: EnemyEntity, x: number, y: number, range: number) => boolean): void { this.perception = perception; }
  private baseGeometry: NavigationGeometry | null = null;
  private baseSignature = '';
  private baseTargets: Target[] = [];
  private frame = 0;
  private scanCursor = 0;
  private now = 0;
  private density: NavigationDensity | null = null;
  private decoys: DecoyTargetPort | null = null;
  private obstacleHp: ((enemy: EnemyEntity, id: string) => number | null) | null = null;
  constructor(private readonly coordinator: FlowFieldCoordinator, private readonly catalog: EnemyAiTargetCatalog) {}
  setDecoys(decoys: DecoyTargetPort | null): void { this.decoys = decoys; }
  setDensityEnabled(enabled: boolean): void {
    if (enabled === !!this.density) return;
    this.density = enabled ? new NavigationDensity(this.coordinator.metrics) : null;
    if (!enabled) this.coordinator.setDensityCosts(new Float32Array(this.coordinator.metrics.cols * this.coordinator.metrics.rows));
  }
  setObstacleIntegrityResolver(resolver: (enemy: EnemyEntity, id: string) => number | null): void { this.obstacleHp = resolver; }
  get(enemyId: string): EnemyIntent | null { return this.decisions.get(enemyId)?.intent ?? null; }
  getField(enemyId: string): EnemyFlowFieldService | null { return this.decisions.get(enemyId)?.field ?? null; }
  getBreach(enemyId: string): BreachPlan | null { return this.decisions.get(enemyId)?.breach ?? null; }
  getWorkCounters() { return this.planner.getWorkCounters(); }

  routeTo(key: string, x: number, y: number, radius: number, destination: NavigationPoint, range: number): NavigationResult | null {
    const geometry = this.coordinator.getGeometry();
    if (!geometry) return null;
    const field = this.fieldFor({ kind: 'player', id: key, ...destination }, radius, range, geometry);
    return this.continueMovement(field.queryNavigation(x, y), field, x, y, destination, radius, range, geometry);
  }

  routeAlly(enemy: EnemyEntity, key: string, destination: NavigationPoint, range: number): NavigationResult | null {
    const geometry = this.coordinator.getGeometry();
    if (!geometry) return null;
    const target: Target = { kind: 'ally', id: key, ...destination };
    const field = this.fieldFor(target, enemy.getSize() / 2, range, geometry);
    const navigation = this.continueMovement(field.queryNavigation(enemy.sprite.x, enemy.sprite.y), field,
      enemy.sprite.x, enemy.sprite.y, destination, enemy.getSize() / 2, range, geometry);
    const decision: Decision = { enemy, target, field, breach: null,
      queryX: enemy.sprite.x, queryY: enemy.sprite.y, querySnapshot: field.getNavigationSnapshot(),
      intent: { target, point: destination, reason: 'follow', selectedAt: this.now, navigation,
        attackContext: this.hasFreeApproach(navigation) ? 'primary' : 'none' } };
    if (navigation.status === 'unreachable' || navigation.status === 'invalid-goal') this.prepareBreach(enemy, decision, geometry);
    this.decisions.set(enemy.id, decision);
    return decision.intent.navigation;
  }

  getBreachAttackPoint(enemyId: string): (NavigationPoint & { objectId: string }) | null {
    const decision = this.decisions.get(enemyId), geometry = this.coordinator.getGeometry();
    const plan = decision?.breach;
    if (!decision || !geometry || plan?.status !== 'ready' || !plan.nextBlocker
      || plan.version.topology !== this.coordinator.getTopologyVersion()
      || this.obstacleHp?.(decision.enemy, plan.nextBlocker) == null) return null;
    let best: (NavigationPoint & { objectId: string }) | null = null, distance = Infinity;
    const sx = decision.enemy.sprite.x, sy = decision.enemy.sprite.y;
    for (const shape of geometry.getObject(plan.nextBlocker)) {
      const { x, y } = navigationAttackPoint(shape, sx, sy);
      const d = Math.hypot(x - sx, y - sy);
      if (d >= distance || !geometry.canMove(sx, sy, x, y, 0, new Set([shape.id]))) continue;
      best = { x, y, objectId: shape.id }; distance = d;
    }
    return best;
  }

  update(enemies: readonly EnemyEntity[], now: number): void {
    this.now = now;
    this.frame++; this.planner.beginFrame();
    const geometry = this.coordinator.getGeometry();
    if (!geometry) return;
    const density = this.density?.sample(enemies.map(enemy => enemy.sprite), now);
    if (density) this.coordinator.setDensityCosts(density);
    const baseIds = this.coordinator.getBaseTargetIds(), baseSignature = baseIds.join('|');
    if (geometry !== this.baseGeometry || baseSignature !== this.baseSignature) {
      this.baseGeometry = geometry; this.baseSignature = baseSignature; this.baseTargets = [];
      const shapes = new Map(geometry.snapshot.obstacles.filter(shape => shape.kind === 'base').map(shape => [shape.id, shape]));
      for (const id of baseIds) {
        const shape = shapes.get(`base:${id}`);
        if (shape) this.baseTargets.push({ kind: 'base', id, objectId: `base:${id}`,
          x: shape.shape === 'rect' ? (shape.left + shape.right) / 2 : shape.x,
          y: shape.shape === 'rect' ? (shape.top + shape.bottom) / 2 : shape.y });
      }
    }
    const baseTargets = this.baseTargets;
    const visibilityRange = Math.hypot(geometry.snapshot.right - geometry.snapshot.left, geometry.snapshot.bottom - geometry.snapshot.top) + 1;
    const active = new Set<string>();
    let ordinaryScans = 0;
    const scanBudget = 12;
    for (let offset = 0; offset < enemies.length; offset++) {
      const enemy = enemies[(this.scanCursor + offset) % enemies.length];
      if (!enemy.sprite.active) continue;
      active.add(enemy.id);
      if (enemy.faction !== 'hostile') continue;
      const config = getCoopDefenseEnemyConfig(enemy.kind), decoy = this.decoys?.getTarget(enemy.id);
      let reason: EnemyIntent['reason'] = decoy ? 'decoy' : config.movementTarget === 'bases' ? 'siege'
        : config.movementTarget === 'players' ? 'player' : 'strategic';
      const prior = this.decisions.get(enemy.id);
      // Cheap live validation precedes candidate construction. Blocked/pending routes still
      // refresh their bound target each frame without rescanning every strategic alternative.
      const resolved = prior && prior.target.kind !== 'base' && prior.target.kind !== 'ally'
        ? this.catalog.resolve(prior.target) : null;
      const bound: Target | null = decoy ? (prior?.target.id === decoy.id ? decoy : null)
        : prior?.target.kind === 'base' ? baseTargets.find(target => target.id === prior.target.id) ?? null
        : resolved && (!this.perception || this.perception(enemy, resolved.x, resolved.y, visibilityRange)) ? this.catalogTarget(resolved) : null;
      const topologyChanged = prior?.intent.navigation.topology !== this.coordinator.getTopologyVersion();
      const scan = !prior || !bound || prior.intent.reason !== reason
        || (ordinaryScans < scanBudget && (topologyChanged || now >= (this.nextDecisionAt.get(enemy.id) ?? 0)));
      if (!scan && prior && (prior.intent.navigation.status === 'ready'
        || (prior.intent.navigation.status === 'pending' && prior.intent.navigation.continuation
          && prior.field.getNavigationSnapshot()?.goalVersion !== prior.intent.navigation.goal))
        && !prior.breach && !topologyChanged) {
        const entry = this.fieldEntries.get(prior.field);
        if (entry) entry.usedAt = this.frame;
        continue;
      }
      const candidates: Target[] = !scan && bound ? [bound] : decoy ? [decoy]
        : config.movementTarget === 'bases' && baseTargets.length ? baseTargets
        : this.catalog.getCandidates(config.movementTarget === 'players-and-armed-constructs' ? 'players-and-armed-constructs' : 'player-threats')
          .filter(target => !this.perception || this.perception(enemy, target.x, target.y, visibilityRange))
          .map(target => this.catalogTarget(target));
      if (scan) {
        ordinaryScans++;
        const phase = [...enemy.id].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % 5;
        this.nextDecisionAt.set(enemy.id, now + 80 + phase * 8);
      }
      let chosen = this.choose(enemy, candidates, geometry, now, prior);
      if (!decoy && config.movementTarget !== 'bases'
        && !chosen) {
        const canAttackBase = enemy.getAttackWeapons().some(attack => attack.targetMode !== 'players' && attack.targetMode !== 'rocks'
          && attack.weapon.config.damage > 0 && (attack.weapon.config.baseDamageMult ?? 1) > 0
          && (attack.weapon.config.fire.type !== 'melee' || !attack.weapon.config.fire.damageTargets
            || attack.weapon.config.fire.damageTargets.includes('bases')));
        const fallback = canAttackBase ? this.choose(enemy, baseTargets, geometry, now, prior) : null;
        if (fallback?.navigation.status === 'ready' || (!chosen && fallback)) { chosen = fallback; reason = 'fallback-base'; }
      }
      if (!chosen && !decoy && config.movementTarget !== 'bases') {
        const memory = this.lastSeen.get(enemy.id);
        // Target removal (death, lost targetability, Activity teardown) erases ordinary pursuit memory.
        // Obscured but still valid targets retain only a previously observed position.
        if (memory?.kind === 'player' && this.catalog.isTargetValid(memory)
          && Math.hypot(enemy.sprite.x - memory.x, enemy.sprite.y - memory.y) > 24) {
          const target: Target = { ...memory, id: `memory:${memory.id}:${Math.round(memory.x / 8)}:${Math.round(memory.y / 8)}` };
          const field = this.fieldFor(target, enemy.getSize() / 2, 16, geometry);
          chosen = { target, field, navigation: field.queryNavigation(enemy.sprite.x, enemy.sprite.y) }; reason = 'memory';
        } else this.lastSeen.delete(enemy.id);
      }
      if (!chosen) { this.decisions.delete(enemy.id); continue; }
      if (chosen.target.kind === 'player' && reason !== 'memory') this.lastSeen.set(enemy.id, { ...chosen.target });
      const retained = prior?.target.kind === chosen.target.kind && prior.target.id === chosen.target.id;
      const intent: EnemyIntent = { target: reason === 'memory' ? null : { kind: chosen.target.kind, id: chosen.target.id }, point: chosen.target,
        reason, selectedAt: retained ? prior.intent.selectedAt : now,
        attackContext: reason !== 'memory' && this.hasFreeApproach(chosen.navigation) ? 'primary' : 'none', navigation: chosen.navigation };
      const decision: Decision = { enemy, intent, field: chosen.field, target: chosen.target, breach: null,
        queryX: enemy.sprite.x, queryY: enemy.sprite.y, querySnapshot: chosen.field.getNavigationSnapshot() };
      if ((chosen.navigation.status === 'unreachable' || chosen.navigation.status === 'invalid-goal') && reason !== 'memory') this.prepareBreach(enemy, decision, geometry);
      else if (chosen.navigation.status === 'ready' && reason !== 'memory') {
        const snapshot = chosen.field.getNavigationSnapshot();
        const point = snapshot && this.positions.select(enemy.id, `${chosen.target.kind}:${chosen.target.id}`,
          enemy.sprite.x, enemy.sprite.y, enemy.getSize() / 2, chosen.navigation.region, now,
          snapshot, this.coordinator.metrics, geometry);
        if (point) decision.intent = { ...decision.intent, navigation: { ...chosen.navigation, waypoint: point } };
      }
      this.decisions.set(enemy.id, decision);
    }
    this.scanCursor = enemies.length ? (this.scanCursor + scanBudget) % enemies.length : 0;
    this.planner.advance();
    for (const id of this.decisions.keys()) if (!active.has(id)) { this.decisions.delete(id); this.nextDecisionAt.delete(id); this.lastSeen.delete(id); }
    for (const id of this.lastSeen.keys()) if (!active.has(id)) this.lastSeen.delete(id);
    for (const id of this.nextDecisionAt.keys()) if (!active.has(id)) this.nextDecisionAt.delete(id);
    this.positions.retain(active, now);
    for (const [key, entry] of this.fields) if (entry.usedAt < this.frame - 120) {
      entry.field.destroy(); this.coordinator.unregisterField(entry.id); this.fields.delete(key);
    }
  }

  private catalogTarget(target: EnemyAiTargetCandidate): Target {
    return { kind: target.kind, id: target.id, x: target.x, y: target.y, radius: target.radius ?? 12,
      objectId: target.kind === 'armed-construct' ? `rock:${target.id}`
        : target.kind === 'armed-base' || target.kind === 'armed-outpost' ? `base:${target.id}` : undefined };
  }
  private range(enemy: EnemyEntity, target: Target): number {
    let range = 0;
    for (const weapon of enemy.getAttackWeapons()) {
      if (weapon.weapon.config.damage <= 0) continue;
      const eligible = target.kind === 'base' ? weapon.targetMode !== 'players' && weapon.targetMode !== 'rocks'
        : target.kind === 'armed-construct' || weapon.targetMode === 'players' || weapon.targetMode === 'all';
      if (!eligible) continue;
      range = Math.max(range, weapon.weapon.config.range);
    }
    const positioning = getCoopDefenseEnemyConfig(enemy.kind).combatPositioning;
    return Math.max(enemy.getSize() / 2 + 1, Math.min(range || 32, positioning?.preferredDistancePx ?? Infinity));
  }

  private choose(enemy: EnemyEntity, candidates: readonly Target[], geometry: NavigationGeometry,
    now: number, prior?: Decision): { target: Target; field: EnemyFlowFieldService; navigation: NavigationResult } | null {
    let best: { target: Target; field: EnemyFlowFieldService; navigation: NavigationResult; score: number } | null = null;
    for (const target of candidates) {
      const field = this.fieldFor(target, enemy.getSize() / 2, this.range(enemy, target), geometry);
      const unchanged = prior?.field === field && prior.intent.navigation.status === 'ready'
        && prior.intent.navigation.topology === this.coordinator.getTopologyVersion()
        && prior.querySnapshot === field.getNavigationSnapshot()
        && prior.queryX === enemy.sprite.x && prior.queryY === enemy.sprite.y
        && prior.target.x === target.x && prior.target.y === target.y;
      const navigation = unchanged ? prior.intent.navigation
        : this.continueMovement(field.queryNavigation(enemy.sprite.x, enemy.sprite.y), field,
          enemy.sprite.x, enemy.sprite.y, target, enemy.getSize() / 2, this.range(enemy, target), geometry);
      const cost = navigation.status === 'ready' ? navigation.cost
        : (this.hasFreeApproach(navigation) ? 0 : 1e12) + Math.hypot(enemy.sprite.x - target.x, enemy.sprite.y - target.y);
      const retained = prior?.target.kind === target.kind && prior.target.id === target.id;
      const score = retained ? cost * 0.85 - (now - prior.intent.selectedAt < 1500 ? 64 : 0) : cost;
      const rank = (route: NavigationResult) => this.hasFreeApproach(route) ? 0
        : ({ ready: 0, pending: 1, 'invalid-start': 2, unreachable: 3, 'invalid-goal': 4 })[route.status];
      if (!best || rank(navigation) < rank(best.navigation)
        || (rank(navigation) === rank(best.navigation) && score < best.score)) best = { target, field, navigation, score };
    }
    return best;
  }

  private hasFreeApproach(route: NavigationResult): boolean {
    return route.status === 'ready' || (route.status === 'pending' && route.directGoalConnection === true);
  }

  private continueMovement(route: NavigationResult, field: EnemyFlowFieldService, x: number, y: number,
    target: NavigationPoint, radius: number, range: number, geometry: NavigationGeometry): NavigationResult {
    if (route.status !== 'pending') return route;
    // A safe direct approach follows the current position immediately. Around corners we keep
    // following the last activated route for this exact target while its replacement computes.
    const dx = target.x - x, dy = target.y - y, distance = Math.hypot(dx, dy);
    const travel = Math.max(0, distance - Math.max(radius + 1, range - 16));
    const approach = distance ? { x: x + dx * travel / distance, y: y + dy * travel / distance } : { x, y };
    if (geometry.canMove(x, y, approach.x, approach.y, radius)
      && geometry.canMove(approach.x, approach.y, target.x, target.y, 0)) {
      return { ...route, continuation: approach, directGoalConnection: true };
    }
    const continuation = field.querySteeringContinuation(x, y);
    return continuation ? { ...route, continuation } : route;
  }

  /** Goal regions represent valid attack positions; a blocked center is not evidence for demolition. */
  private fieldFor(target: Target, radius: number, range: number, geometry: NavigationGeometry): EnemyFlowFieldService {
    const key = `${target.kind}:${target.id}:r${radius}:a${range}`;
    let entry = this.fields.get(key);
    if (!entry) {
      const id = `intent:${key}`;
      entry = { id, field: EnemyFlowFieldService.fromView(this.coordinator.registerField(id,
        { goalMode: 'dynamic', bodyRadius: radius })), signature: '', usedAt: this.frame, sealedGoals: [], acceptsOpenedGoal: undefined };
      this.fields.set(key, entry); this.fieldEntries.set(entry.field, entry);
    }
    entry.usedAt = this.frame;
    const signature = `${this.coordinator.getTopologyVersion()}:${Math.round(target.x / 8)}:${Math.round(target.y / 8)}`;
    if (signature === entry.signature) return entry.field;
    entry.signature = signature;
    const m = this.coordinator.metrics, goals = new Set<number>(), potential = new Set<number>();
    const shapes = target.objectId ? geometry.getObject(target.objectId) : [];
    const opened = new Set(target.objectId ? [target.objectId] : []);
    const centers = shapes.length && target.kind !== 'armed-construct' ? shapes.map(shape => shape.shape === 'rect'
      ? { left: shape.left, top: shape.top, right: shape.right, bottom: shape.bottom }
      : { left: shape.x, top: shape.y, right: shape.x, bottom: shape.y })
      : [{ left: target.x, top: target.y, right: target.x, bottom: target.y }];
    for (const box of centers) {
      const minX = Math.max(0, Math.floor((box.left - range - m.arenaOffsetX) / m.cellSize));
      const maxX = Math.min(m.cols - 1, Math.ceil((box.right + range - m.arenaOffsetX) / m.cellSize));
      const minY = Math.max(0, Math.floor((box.top - range - m.arenaOffsetY) / m.cellSize));
      const maxY = Math.min(m.rows - 1, Math.ceil((box.bottom + range - m.arenaOffsetY) / m.cellSize));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const index = y * m.cols + x;
        if (goals.has(index)) continue;
        const point = navigationPoint(m, index);
        const tx = Math.max(box.left, Math.min(box.right, point.x)), ty = Math.max(box.top, Math.min(box.bottom, point.y));
        if (Math.hypot(point.x - tx, point.y - ty) > range || !geometry.contains(point.x, point.y, radius)) continue;
        potential.add(index);
        if (!geometry.isFree(point.x, point.y, radius)
          || !geometry.canMove(point.x, point.y, tx, ty, 0, opened)) continue;
        goals.add(index);
      }
    }
    // A live target in a cramped pocket is different from an invalid/out-of-world target.
    const validTarget = shapes.length > 0 || geometry.isFree(target.x, target.y, target.radius ?? 0);
    entry.sealedGoals = !goals.size && validTarget ? [...potential] : [];
    entry.acceptsOpenedGoal = entry.sealedGoals.length ? (index, removed) => {
      const point = navigationPoint(m, index);
      if (!geometry.isFree(point.x, point.y, radius, removed)) return false;
      const transparent = target.objectId ? new Set([...removed, target.objectId]) : removed;
      return centers.some(box => {
        const tx = Math.max(box.left, Math.min(box.right, point.x)), ty = Math.max(box.top, Math.min(box.bottom, point.y));
        return Math.hypot(point.x - tx, point.y - ty) <= range && geometry.canMove(point.x, point.y, tx, ty, 0, transparent);
      });
    } : undefined;
    this.coordinator.setGoalCells(entry.id, Int32Array.from(goals));
    return entry.field;
  }

  private prepareBreach(enemy: EnemyEntity, decision: Decision, geometry: NavigationGeometry): void {
    let route = decision.intent.navigation;
    const entry = this.fieldEntries.get(decision.field);
    const sealed = route.status === 'invalid-goal' && !!entry?.sealedGoals.length;
    if (sealed) {
      const region = decision.field.getStartRegion(enemy.sprite.x, enemy.sprite.y);
      if (!region) return;
      route = { ...route, status: 'unreachable', region };
      decision.intent = { ...decision.intent, navigation: route };
    }
    if (route.status !== 'unreachable') return;
    const snapshot = decision.field.getNavigationSnapshot(), cell = decision.field.worldToGrid(enemy.sprite.x, enemy.sprite.y);
    const goals = sealed ? entry!.sealedGoals : decision.field.getCurrentGoalIndexes();
    if (!snapshot || !cell || !goals?.length) return;
    const m = this.coordinator.metrics;
    let startIndex = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cell.gridX + dx, y = cell.gridY + dy;
      if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
      const index = y * m.cols + x, p = navigationPoint(m, index);
      if (snapshot.regions?.[index] === route.region && geometry.canMove(enemy.sprite.x, enemy.sprite.y, p.x, p.y, enemy.getSize() / 2)) startIndex = index;
    }
    if (startIndex < 0) return;
    const weapons = enemy.getAttackWeapons().filter(weapon => weapon.targetMode !== 'players');
    const rights = `${enemy.faction}:${enemy.ownerId ?? ''}:${weapons.map(attack => {
      const config = attack.weapon.config;
      return `${config.id}:${attack.targetMode}:${config.damage}:${config.cooldown}:${config.baseDamageMult ?? 1}:${config.rockDamageMult ?? 1}`;
    }).sort().join(',')}`;
    let goalRegions = sealed ? 'sealed' : this.goalRegions.get(goals);
    if (goalRegions === undefined) {
      goalRegions = [...new Set(goals.map(index => snapshot.regions?.[index] ?? 0))].sort((a, b) => a - b).join(',');
      this.goalRegions.set(goals, goalRegions);
    }
    // Within an unchanged body-connected goal region, the previous endpoint still has a free
    // continuation to a current attack position. Moving targets must not starve the shared search.
    const key = `${decision.target.kind}:${decision.target.id}:${route.region}:${route.profile}:${route.topology}:goals:${goalRegions}:${rights}`;
    decision.breach = this.planner.request(key, { version: route, startIndex, startRegion: route.region,
      goals, radius: enemy.getSize() / 2, speed: enemy.getMoveSpeed(),
      acceptsGoal: sealed ? entry!.acceptsOpenedGoal : undefined,
      attackRangeFor: id => Math.max(0, ...weapons.filter(attack => {
        const config = attack.weapon.config;
        return config.damage > 0 && !(id.startsWith('base:') && attack.targetMode === 'rocks')
          && (id.startsWith('base:') ? config.baseDamageMult ?? 1 : config.rockDamageMult ?? 1) > 0
          && !(config.fire.type === 'melee' && config.fire.damageTargets
            && !config.fire.damageTargets.includes(id.startsWith('base:') ? 'bases' : 'rocks'));
      }).map(attack => attack.weapon.config.range)),
      destructionSeconds: id => {
        const hp = this.obstacleHp?.(enemy, id);
        if (hp == null || hp <= 0) return null;
        let dps = 0;
        for (const attack of weapons) {
          if (id.startsWith('base:') && attack.targetMode === 'rocks') continue;
          const config = attack.weapon.config;
          if (config.fire.type === 'melee' && config.fire.damageTargets
            && !config.fire.damageTargets.includes(id.startsWith('base:') ? 'bases' : 'rocks')) continue;
          const factor = id.startsWith('base:') ? config.baseDamageMult ?? 1 : config.rockDamageMult ?? 1;
          dps = Math.max(dps, config.damage * factor * 1000 / Math.max(1, config.cooldown));
        }
        return dps > 0 ? hp / dps : null;
      } }, m, geometry);
    if (decision.breach.status === 'ready' && decision.breach.approach) {
      const point = decision.breach.approach;
      const field = this.fieldFor({ kind: 'base', id: `breach:${key}`, x: point.x, y: point.y }, enemy.getSize() / 2, 1, geometry);
      decision.field = field;
      decision.intent = { ...decision.intent, attackContext: 'breach', navigation: field.queryNavigation(enemy.sprite.x, enemy.sprite.y) };
    }
  }

  allowsAttack(enemyId: string, kind: string, id: string, mode: string): boolean {
    const decision = this.decisions.get(enemyId);
    if (!decision) return false;
    if (decision.intent.attackContext === 'breach'
      && (decision.breach?.version.topology !== this.coordinator.getTopologyVersion()
        || !decision.breach.nextBlocker || this.obstacleHp?.(decision.enemy, decision.breach.nextBlocker) == null)) return false;
    const target = decision.intent.target;
    const free = decision.intent.attackContext === 'primary';
    if (kind === 'obstacle') return (free && target?.kind === 'armed-construct' && target.id === id)
      || (decision.intent.attackContext === 'breach' && decision.breach?.nextBlocker === `rock:${id}`);
    if (kind === 'base') return (free && target?.id === id && ['base', 'armed-base', 'armed-outpost'].includes(target.kind))
      || (decision.intent.attackContext === 'breach' && decision.breach?.nextBlocker === `base:${id}`);
    if (mode === 'players' && decision.intent.reason === 'siege') return true;
    return free && target?.kind === kind && target.id === id;
  }

  clear(): void {
    this.scanCursor = 0;
    for (const entry of this.fields.values()) { entry.field.destroy(); this.coordinator.unregisterField(entry.id); }
    this.fields.clear(); this.decisions.clear(); this.nextDecisionAt.clear(); this.lastSeen.clear(); this.planner.clear(); this.positions.clear(); this.baseGeometry = null; this.baseTargets = [];
  }
}
