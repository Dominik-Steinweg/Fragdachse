import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyMortarConfig } from '../config/coopDefenseEnemies';
import { getCoopDefenseConstructionDefinition } from '../config/coopDefenseConstructions';
import type { CombatActorStatePort } from '../combat/CombatCapabilities';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyDeathInfo, EnemyManager, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { BaseManager } from '../entities/BaseManager';
import type { PlacementSystem } from './PlacementSystem';
import type { EnemyAiTargetCatalog } from './EnemyAiTargetCatalog';
import type { SyncedMortarStrike } from '../types';
import { CoopDefenseMortarStrikeSystem, type MortarStrike } from './CoopDefenseMortarStrikeSystem';

interface MortarBehavior {
  windup: MortarStrike | null;
  windupAngle: number;
  readyAt: number;
  evaluateAt: number;
}

/** Host-only target selection and interruptible windup; navigation remains EnemyManager-owned. */
export class CoopDefenseMortarSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, MortarBehavior>();

  constructor(
    private readonly enemies: Pick<EnemyManager, 'getAllEnemies'>,
    private readonly players: Pick<PlayerManager, 'getAllPlayers'>,
    private readonly combat: Pick<CombatActorStatePort, 'isAlive'>,
    private readonly catalog: EnemyAiTargetCatalog,
    private readonly bases: Pick<BaseManager, 'getBasesByFaction'> | null,
    private readonly placement: Pick<PlacementSystem, 'getAllRuntimeRocks' | 'getWorldPointForCell'>,
    private readonly strikes: CoopDefenseMortarStrikeSystem,
  ) {}

  hostUpdate(nowMs: number): void {
    const live = new Set<string>();
    for (const enemy of this.enemies.getAllEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).mortar;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      const state = this.states.get(enemy.id) ?? { windup: null, windupAngle: 0, readyAt: 0, evaluateAt: 0 };
      this.states.set(enemy.id, state);
      if (state.windup) {
        enemy.faceAngle(state.windupAngle);
        if (nowMs >= state.windup.snapshot.launchAt) this.commit(state);
        else enemy.stopMovement();
        continue;
      }
      // Gate 1: resurrected allies retain their regular attack behavior only.
      if (enemy.faction !== 'hostile' || nowMs < state.readyAt || nowMs < state.evaluateAt) continue;
      state.evaluateAt = nowMs + config.reevaluateIntervalMs;
      if (this.players.getAllPlayers().some(player => player.active && this.combat.isAlive(player.id)
        && Math.hypot(player.x - enemy.sprite.x, player.y - enemy.sprite.y) < config.minRangePx)) continue;
      const target = this.chooseTarget(enemy, config, nowMs);
      if (!target) continue;
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
    return this.blocksRegularAttacks(enemy.id) ? { vx: 0, vy: 0 } : null;
  }

  getSnapshot(): SyncedMortarStrike[] {
    return [...this.states.values()].flatMap(state => state.windup ? [{ ...state.windup.snapshot }] : []);
  }

  clear(): void { this.states.clear(); }

  private commit(state: MortarBehavior): void {
    if (!state.windup) return;
    this.strikes.launch(state.windup);
    state.windup = null;
  }

  private chooseTarget(enemy: EnemyEntity, config: CoopDefenseEnemyMortarConfig, nowMs: number): { x: number; y: number } | null {
    let best: { x: number; y: number; score: number } | null = null;
    const occupied = [...this.getSnapshot(), ...this.strikes.getSnapshot()].filter(strike => strike.impactAt > nowMs);
    const consider = (point: { x: number; y: number } | null, weight: number): void => {
      if (!point) return;
      const distance = Math.hypot(point.x - enemy.sprite.x, point.y - enemy.sprite.y);
      if (distance < config.minRangePx || distance > config.maxRangePx) return;
      const overlaps = occupied.filter(strike => strike.sourceEnemyId !== enemy.id
        && Math.hypot(strike.targetX - point.x, strike.targetY - point.y)
          < strike.radius + config.impactRadiusPx + config.overlapMarginPx).length;
      const rangePreference = Math.min(1, distance / config.preferredRangeMinPx);
      const score = weight * rangePreference / (1 + config.overlapPenalty * overlaps);
      if (!best || score > best.score) best = { ...point, score };
    };
    for (const base of this.bases?.getBasesByFaction('friendly') ?? []) {
      if (base.getHp() > 0 && !base.isInert()) consider(base.getNearestSurfacePoint(enemy.sprite.x, enemy.sprite.y), config.targetWeights.base);
    }
    for (const construction of this.placement.getAllRuntimeRocks()) {
      if (construction.hp <= 0 || construction.indestructible) continue;
      if (construction.constructionId && getCoopDefenseConstructionDefinition(construction.constructionId).indestructible) continue;
      // Placement's runtime rocks are authored/player constructs; natural terrain is never listed here.
      const point = this.placement.getWorldPointForCell(construction.gridX, construction.gridY);
      const armed = construction.turretWeaponId !== undefined || construction.kind === 'drone_station';
      consider(point, armed ? config.targetWeights.armedConstruct
        : construction.kind === 'rock' ? config.targetWeights.barrier : config.targetWeights.construct);
    }
    this.catalog.forEachTarget('player-like', target => {
      if (target.kind === 'player' && this.catalog.getPlayerReplacement(target.id)) return;
      consider(this.catalog.getPosition(target, enemy.sprite.x, enemy.sprite.y), config.targetWeights.player);
    });
    return best;
  }
}
