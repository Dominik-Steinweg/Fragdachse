import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyMortarConfig } from '../config/coopDefenseEnemies';
import { getCoopDefenseConstructionDefinition } from '../config/coopDefenseConstructions';
import type { CombatActorStatePort, CombatGeometryPort } from '../combat/CombatCapabilities';
import { COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, PLAYER_SIZE } from '../config';
import { ATTACK_DRONE_RULES } from '../config/attackDrone';
import { UTILITY_CONFIGS, type PlaceableTurretUtilityConfig } from '../loadout/LoadoutConfig';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyDeathInfo, EnemyManager, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { BaseManager } from '../entities/BaseManager';
import type { PlacementSystem } from './PlacementSystem';
import type { EnemyAiTargetCatalog } from './EnemyAiTargetCatalog';
import type { SyncedMortarStrike, SyncedPlaceableRock } from '../types';
import { CoopDefenseMortarStrikeSystem, type MortarStrike } from './CoopDefenseMortarStrikeSystem';
import { distance, findMortarLocalPositions, type MortarLocalPosition, type MortarNavigation, type MortarPoint } from './MortarLocalPositions';

interface MortarTarget {
  readonly id: string;
  readonly value: number;
  readonly shortlistScore: number;
  readonly resolve: (from: MortarPoint) => MortarPoint | null;
}
interface MortarThreat extends MortarPoint {
  readonly id: string;
  readonly range: number;
  readonly skipRockIndex?: number;
  readonly carrierBaseId?: string;
  readonly resolve: () => MortarPoint | null;
}

interface MortarBehavior {
  windup: MortarStrike | null;
  windupAngle: number;
  readyAt: number;
  evaluateAt: number;
  probeAt: number;
  topology: number;
  obstacles: number;
  inSiegeArea: boolean;
  target: MortarTarget | null;
  position: MortarLocalPosition | null;
  waypoint: number;
  threats: MortarThreat[];
  evaluatedThreats: MortarThreat[];
  evaluatedFrom: MortarPoint | null;
  spacing: { vx: number; vy: number } | null;
  closeThreatId: string | null;
}

/** Host-only hostile siege decisions and windup. EnemyManager still owns global navigation and movement. */
export class CoopDefenseMortarSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, MortarBehavior>();

  constructor(
    private readonly enemies: Pick<EnemyManager, 'getAllEnemies'>,
    private readonly players: Pick<PlayerManager, 'getAllPlayers'>,
    private readonly combat: Pick<CombatActorStatePort, 'isAlive'> & Pick<CombatGeometryPort, 'hasLineOfSight'>,
    private readonly catalog: EnemyAiTargetCatalog,
    private readonly bases: Pick<BaseManager, 'getBasesByFaction' | 'getObstacleGeneration' | 'getBase'> | null,
    private readonly placement: Pick<PlacementSystem, 'forEachRuntimeRockInRadius' | 'getRuntimeRock' | 'getWorldPointForCell' | 'getCarrierBaseId'>,
    private readonly strikes: CoopDefenseMortarStrikeSystem,
    private readonly navigation: MortarNavigation | null = null,
  ) {}

  hostUpdate(nowMs: number): void {
    const live = new Set<string>();
    for (const enemy of this.enemies.getAllEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).mortar;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      const state = this.states.get(enemy.id) ?? this.createState();
      this.states.set(enemy.id, state);
      if (state.windup) {
        enemy.faceAngle(state.windupAngle);
        if (nowMs >= state.windup.snapshot.launchAt) this.commit(state);
        else { enemy.stopMovement(); continue; }
      }
      const target = this.chooseFactionFiringTarget(enemy, state, config, nowMs);
      if (!target || nowMs < state.readyAt) continue;
      const angle = Math.atan2(target.y - enemy.sprite.y, target.x - enemy.sprite.x);
      state.windupAngle = angle;
      enemy.faceAngle(angle);
      const muzzleForwardPx = config.muzzleForwardPx ?? 0;
      const launchAt = nowMs + config.windupMs;
      const snapshot: SyncedMortarStrike = {
        id: this.strikes.allocateId(), sourceEnemyId: enemy.id,
        sourceX: enemy.sprite.x + Math.cos(angle) * muzzleForwardPx,
        sourceY: enemy.sprite.y + Math.sin(angle) * muzzleForwardPx,
        targetX: target.x, targetY: target.y, radius: config.impactRadiusPx,
        armedAt: nowMs, launchAt, impactAt: launchAt + config.flightMs, faction: enemy.faction,
      };
      state.windup = {
        snapshot, damage: { ...config, targetWeights: { ...config.targetWeights } },
        source: {
          gameplaySource: { kind: 'enemy', id: enemy.id }, actor: { kind: 'enemy', id: enemy.id },
          attribution: { kind: 'enemy', id: enemy.id },
          allegiance: { ownerId: enemy.id, factionId: enemy.faction },
          authoredSourceId: 'enemy.mortar', origin: 'explosion',
        },
      };
      state.readyAt = snapshot.impactAt + config.postImpactDelayMs;
      enemy.pauseAttackMovement(nowMs, 0, config.windupMs);
      enemy.stopMovement();
    }
    for (const id of this.states.keys()) if (!live.has(id)) this.states.delete(id);
  }

  /** Called synchronously by the death path, even before this frame's behavior update. */
  handleKilled(death: Pick<EnemyDeathInfo, 'id'>, nowMs: number): void {
    const state = this.states.get(death.id);
    if (state?.windup && nowMs >= state.windup.snapshot.launchAt) this.commit(state);
    this.states.delete(death.id);
  }

  blocksRegularAttacks(enemyId: string): boolean { return !!this.states.get(enemyId)?.windup; }

  getMovementOverride(enemy: EnemyEntity, _nowMs: number): { vx: number; vy: number } | null {
    const state = this.states.get(enemy.id);
    if (!state) return null;
    if (state.windup) return { vx: 0, vy: 0 };
    if (enemy.faction !== 'hostile') return null;
    if (state.closeThreatId) return state.spacing; // null inside bite range leaves AttackSystem in charge.
    if (!state.position || !state.target) return null;
    const config = getCoopDefenseEnemyConfig(enemy.kind).mortar!;
    const path = state.position.path;
    while (state.waypoint < path.length && distance(enemy.sprite, path[state.waypoint]) <= config.positionArrivalTolerancePx) state.waypoint++;
    const point = path[state.waypoint];
    // A reached firing station stays occupied during flight/recovery as well as windup.
    if (!point) return { vx: 0, vy: 0 };
    const length = distance(enemy.sprite, point);
    const speed = enemy.getMoveSpeed();
    return { vx: (point.x - enemy.sprite.x) / length * speed, vy: (point.y - enemy.sprite.y) / length * speed };
  }

  getSnapshot(): SyncedMortarStrike[] {
    return [...this.states.values()].flatMap(state => state.windup ? [{ ...state.windup.snapshot }] : []);
  }

  clear(): void { this.states.clear(); }

  private commit(state: MortarBehavior): void {
    if (!state.windup) return;
    this.strikes.launch(state.windup);
    state.windup = null;
    state.evaluateAt = 0;
  }

  private createState(): MortarBehavior {
    return { windup: null, windupAngle: 0, readyAt: 0, evaluateAt: 0, probeAt: 0, topology: -1, obstacles: -1,
      inSiegeArea: false, target: null, position: null, waypoint: 0, threats: [], evaluatedThreats: [], evaluatedFrom: null,
      spacing: null, closeThreatId: null };
  }

  /** Integration seam: allied target selection plugs in here, outside hostile siege policy. */
  private chooseFactionFiringTarget(enemy: EnemyEntity, state: MortarBehavior, config: CoopDefenseEnemyMortarConfig, nowMs: number): MortarPoint | null {
    switch (enemy.faction) {
      case 'hostile': return this.updateHostileSiege(enemy, state, config, nowMs);
      default: return null;
    }
  }

  private updateHostileSiege(enemy: EnemyEntity, state: MortarBehavior, config: CoopDefenseEnemyMortarConfig, nowMs: number): MortarPoint | null {
    const topology = this.navigation?.getTopologyVersion() ?? 0;
    const obstacles = this.bases?.getObstacleGeneration() ?? 0;
    const changed = topology !== state.topology || obstacles !== state.obstacles;
    if (changed) { state.evaluateAt = 0; state.probeAt = 0; state.position = null; }
    if (state.target && !state.target.resolve(enemy.sprite)) { state.target = null; state.position = null; state.evaluateAt = 0; }
    const probe = changed || nowMs >= state.probeAt;
    if (probe) {
      state.probeAt = nowMs + config.threatCheckIntervalMs;
      const inSiegeArea = this.isInSiegeArea(enemy, config);
      if (inSiegeArea && !state.inSiegeArea) state.evaluateAt = 0;
      state.inSiegeArea = inSiegeArea;
      state.threats = this.findThreats(enemy, config, inSiegeArea ? config.threatScanRadiusPx : config.minRangePx);
      if (this.threatsChanged(enemy.sprite, state, config)) state.evaluateAt = 0;
    }
    const near = this.findCloseThreat(enemy, state, config);
    if (state.closeThreatId && !near) { state.evaluateAt = 0; state.position = null; }
    if (near && distance(enemy.sprite, near) <= this.biteRange(enemy)) state.spacing = null;
    else if (probe || (near?.id ?? null) !== state.closeThreatId || (near && !state.spacing)) state.spacing = near ? this.spacingVelocity(enemy, near, config) : null;
    state.closeThreatId = near?.id ?? null;
    state.topology = topology; state.obstacles = obstacles;
    if (near) return null;
    if (!state.inSiegeArea) { state.target = null; state.position = null; return null; }
    if (nowMs >= state.evaluateAt) {
      this.chooseHostileTargetAndPosition(enemy, state, config, nowMs);
      state.evaluateAt = nowMs + config.reevaluateIntervalMs;
      state.evaluatedThreats = state.threats.map(threat => ({ ...threat }));
      state.evaluatedFrom = { x: enemy.sprite.x, y: enemy.sprite.y };
    }
    if (!state.target || !state.position) return null;
    if (distance(enemy.sprite, state.position) > config.positionArrivalTolerancePx) return null;
    const target = state.target.resolve(enemy.sprite);
    if (!target || !this.inRange(distance(enemy.sprite, target), config)) { state.evaluateAt = 0; return null; }
    return target;
  }

  private isInSiegeArea(enemy: EnemyEntity, config: CoopDefenseEnemyMortarConfig): boolean {
    const reach = config.maxRangePx + config.coverSearchActivationMarginPx;
    const bases = (this.bases?.getBasesByFaction('friendly') ?? []).filter(base => base.getHp() > 0 && !base.isInert());
    if (bases.length) return bases.some(base => {
      const surface = base.getNearestSurfacePoint(enemy.sprite.x, enemy.sprite.y);
      return surface !== null && distance(enemy.sprite, surface) <= reach;
    });
    // Basisless worlds retain the existing player/construct fallback.
    let found = false;
    this.placement.forEachRuntimeRockInRadius(enemy.sprite.x, enemy.sprite.y, reach, rock => { if (this.isConstructionTarget(rock)) found = true; });
    this.catalog.forEachTarget('player-like', target => {
      const point = this.catalog.getPosition(target, enemy.sprite.x, enemy.sprite.y);
      if (point && distance(enemy.sprite, point) <= reach) found = true;
    });
    return found;
  }

  private chooseHostileTargetAndPosition(enemy: EnemyEntity, state: MortarBehavior, config: CoopDefenseEnemyMortarConfig, nowMs: number): void {
    const targets = this.hostileTargetShortlist(enemy, config, nowMs);
    if (!targets.length) { state.target = null; state.position = null; return; }
    const positions = findMortarLocalPositions(enemy.sprite, enemy.getCollisionRadius(), config, this.navigation);
    // Retain the actual destination between evaluations; moving rings must not keep pushing it away.
    if (state.position && state.waypoint < state.position.path.length) {
      const path = state.position.path.slice(state.waypoint);
      let from: MortarPoint = enemy.sprite, travelDistance = 0, valid = true;
      for (const point of path) {
        if (!this.navigation?.hasWalkableCircleLine(from.x, from.y, point.x, point.y, enemy.getCollisionRadius())) { valid = false; break; }
        travelDistance += distance(from, point); from = point;
      }
      if (valid && distance(enemy.sprite, state.position) <= config.localSearchRadiusPx) positions.push({ ...state.position, path, travelDistance });
    }
    type Choice = { target: MortarTarget; position: MortarLocalPosition; score: number };
    let current: Choice | null = null, best: Choice | null = null;
    for (const position of positions) {
      let cover = 0;
      for (const threat of state.threats) {
        if (distance(position, threat) > threat.range) continue; // irrelevant is neither exposure nor cover.
        cover += this.threatHasLine(threat, position) ? -config.exposurePenaltyWeight : config.coverQualityWeight;
      }
      for (const target of targets) {
        const point = target.resolve(position);
        if (!point) continue;
        const range = distance(position, point);
        if (!this.inRange(range, config)) continue;
        const quality = range < config.preferredRangeMinPx
          ? (range - config.minRangePx) / (config.preferredRangeMinPx - config.minRangePx)
          : range <= config.preferredRangeMaxPx ? 1
            : (config.maxRangePx - range) / Math.max(1, config.maxRangePx - config.preferredRangeMaxPx);
        const score = target.value + quality * config.rangeQualityWeight + cover - position.travelDistance * config.movementCostPerPx;
        const choice = { target, position, score };
        if (!position.travelDistance && (!current || score > current.score)) current = choice;
        if (!best || score > best.score) best = choice;
      }
    }
    const selected = best && (!current || best.score >= current.score + config.minRepositionImprovement) ? best : current;
    state.target = selected?.target ?? null; state.position = selected?.position ?? null; state.waypoint = 0;
  }

  private hostileTargetShortlist(enemy: EnemyEntity, config: CoopDefenseEnemyMortarConfig, nowMs: number): MortarTarget[] {
    const targets: MortarTarget[] = [];
    const occupied = [...this.getSnapshot(), ...this.strikes.getSnapshot()].filter(strike => strike.impactAt > nowMs);
    const consider = (id: string, resolve: MortarTarget['resolve'], weight: number): void => {
      const point = resolve(enemy.sprite);
      if (!point) return;
      const distance = Math.hypot(point.x - enemy.sprite.x, point.y - enemy.sprite.y);
      if (distance > config.maxRangePx + config.localSearchRadiusPx) return;
      const overlaps = occupied.filter(strike => strike.sourceEnemyId !== enemy.id
        && Math.hypot(strike.targetX - point.x, strike.targetY - point.y)
          < strike.radius + config.impactRadiusPx + config.overlapMarginPx).length;
      const value = weight / (1 + config.overlapPenalty * overlaps);
      const approach = Math.max(0, distance - config.maxRangePx, config.minRangePx - distance);
      targets.push({ id, resolve, value, shortlistScore: value - approach * config.movementCostPerPx });
      targets.sort((a, b) => b.shortlistScore - a.shortlistScore || a.id.localeCompare(b.id));
      if (targets.length > config.topTargetCandidates) targets.pop();
    };
    for (const base of this.bases?.getBasesByFaction('friendly') ?? []) {
      consider(`base:${base.id}`, from => base.getHp() > 0 && !base.isInert() ? base.getNearestSurfacePoint(from.x, from.y) : null, config.targetWeights.base);
    }
    this.placement.forEachRuntimeRockInRadius(enemy.sprite.x, enemy.sprite.y, config.maxRangePx + config.localSearchRadiusPx, construction => {
      if (!this.isConstructionTarget(construction)) return;
      // Placement's runtime rocks are authored/player constructs; natural terrain is never listed here.
      const armed = construction.kind === 'turret' || construction.kind === 'drone_station';
      consider(`construction:${construction.id}`, () => {
        const current = this.placement.getRuntimeRock(construction.id);
        return current && this.isConstructionTarget(current) ? this.placement.getWorldPointForCell(current.gridX, current.gridY) : null;
      }, armed ? config.targetWeights.armedConstruct
        : construction.kind === 'rock' ? config.targetWeights.barrier : config.targetWeights.construct);
    });
    this.catalog.forEachTarget('player-like', target => {
      if (target.kind === 'player' && this.catalog.getPlayerReplacement(target.id)) return;
      consider(`${target.kind}:${target.id}`, from => this.catalog.getPosition(target, from.x, from.y), config.targetWeights.player);
    });
    return targets;
  }

  private isConstructionTarget(rock: SyncedPlaceableRock): boolean {
    return rock.hp > 0 && rock.ownerId !== COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID && !rock.indestructible
      && !(rock.constructionId && getCoopDefenseConstructionDefinition(rock.constructionId).indestructible);
  }

  private inRange(range: number, config: CoopDefenseEnemyMortarConfig): boolean { return range > config.minRangePx && range <= config.maxRangePx; }

  private findThreats(enemy: EnemyEntity, config: CoopDefenseEnemyMortarConfig, scanRadius: number): MortarThreat[] {
    const threats: MortarThreat[] = [];
    const relevance = (threat: MortarThreat) => {
      const range = distance(enemy.sprite, threat);
      return range < config.minRangePx && range <= threat.range ? -1 + range / config.minRangePx : range / threat.range;
    };
    const consider = (threat: MortarThreat): void => {
      const range = distance(enemy.sprite, threat);
      if (threat.range <= 0 || range > scanRadius || range > threat.range + config.localSearchRadiusPx) return;
      threats.push(threat);
      threats.sort((a, b) => relevance(a) - relevance(b) || a.id.localeCompare(b.id));
      if (threats.length > config.maxCoverThreats) threats.pop();
    };
    for (const player of this.players.getAllPlayers()) {
      if (!player.active || !this.combat.isAlive(player.id)) continue;
      consider({ id: `player:${player.id}`, x: player.x, y: player.y, range: config.playerThreatRangePx,
        resolve: () => player.active && this.combat.isAlive(player.id) ? { x: player.x, y: player.y } : null });
    }
    this.placement.forEachRuntimeRockInRadius(enemy.sprite.x, enemy.sprite.y, scanRadius, rock => {
      if (rock.hp <= 0 || rock.ownerId === COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID) return;
      const definition = rock.constructionId ? getCoopDefenseConstructionDefinition(rock.constructionId) : null;
      const range = rock.targetRange ?? (definition?.kind === 'turret' ? definition.targetRange
        : rock.kind === 'drone_station' ? ATTACK_DRONE_RULES.targetSearchRadius
          : rock.kind === 'turret' ? (UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig).placeable.targetRange : 0);
      const carrierBaseId = this.placement.getCarrierBaseId(rock.id);
      const resolve = () => {
        const current = this.placement.getRuntimeRock(rock.id);
        const carrier = carrierBaseId ? this.bases?.getBase(carrierBaseId) : null;
        return current && current.hp > 0 && (!carrierBaseId || (carrier && carrier.faction === 'friendly' && carrier.getHp() > 0 && !carrier.isInert()))
          ? this.placement.getWorldPointForCell(current.gridX, current.gridY) : null;
      };
      const point = resolve();
      if (point) consider({ ...point, id: `construction:${rock.id}`, range, skipRockIndex: rock.id, carrierBaseId, resolve });
    });
    const baseRange = (UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig).placeable.targetRange;
    for (const base of this.bases?.getBasesByFaction('friendly') ?? []) {
      if (base.getHp() <= 0 || base.isInert()) continue;
      for (const turret of base.getTurrets()) consider({ id: `turret:${turret.id}`, x: turret.x, y: turret.y,
        range: baseRange, carrierBaseId: base.id, resolve: () => base.getHp() > 0 && !base.isInert() ? turret : null });
    }
    return threats;
  }

  private threatsChanged(from: MortarPoint, state: MortarBehavior, config: CoopDefenseEnemyMortarConfig): boolean {
    return state.threats.length !== state.evaluatedThreats.length || state.threats.some(threat => {
      const previous = state.evaluatedThreats.find(entry => entry.id === threat.id);
      return !previous || previous.range !== threat.range || distance(previous, threat) >= config.threatChangeDistancePx
        || (state.evaluatedFrom !== null
          && (distance(from, threat) <= threat.range) !== (distance(state.evaluatedFrom, previous) <= previous.range));
    });
  }

  private threatHasLine(threat: MortarThreat, position: MortarPoint): boolean {
    return this.combat.hasLineOfSight(threat.x, threat.y, position.x, position.y,
      threat.skipRockIndex, threat.carrierBaseId, 0, 'directFire');
  }

  private findCloseThreat(enemy: EnemyEntity, state: MortarBehavior, config: CoopDefenseEnemyMortarConfig): (MortarPoint & { id: string }) | null {
    let closest: (MortarPoint & { id: string }) | null = null;
    let nearest = config.minRangePx;
    const consider = (id: string, point: MortarPoint | null, range: number) => {
      if (!point) return;
      const delta = distance(enemy.sprite, point);
      if (delta < nearest && delta <= range) { nearest = delta; closest = { ...point, id }; }
    };
    // The bounded player roster is cheap enough for exact min-range entry between threat probes.
    for (const player of this.players.getAllPlayers()) {
      if (player.active && this.combat.isAlive(player.id)) consider(`player:${player.id}`, player, config.playerThreatRangePx);
    }
    for (const threat of state.threats) consider(threat.id, threat.resolve(), threat.range);
    return closest;
  }

  private spacingVelocity(enemy: EnemyEntity, threat: MortarPoint, config: CoopDefenseEnemyMortarConfig): { vx: number; vy: number } | null {
    const length = distance(enemy.sprite, threat);
    if (length <= this.biteRange(enemy)) return null;
    const dx = (enemy.sprite.x - threat.x) / length, dy = (enemy.sprite.y - threat.y) / length;
    const to = { x: enemy.sprite.x + dx * config.spacingProbeDistancePx, y: enemy.sprite.y + dy * config.spacingProbeDistancePx };
    if (this.navigation && !this.navigation.hasWalkableCircleLine(enemy.sprite.x, enemy.sprite.y, to.x, to.y, enemy.getCollisionRadius())) return { vx: 0, vy: 0 };
    const speed = enemy.getMoveSpeed() * config.spacingSpeedFactor;
    return { vx: dx * speed, vy: dy * speed };
  }

  private biteRange(enemy: EnemyEntity): number {
    return Math.max(0, ...enemy.getAttackWeapons().filter(attack => attack.weapon.config.fire.type === 'melee')
      .map(attack => attack.weapon.config.range)) + PLAYER_SIZE * 0.5;
  }
}
