import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyEnergyConeConfig } from '../config/coopDefenseEnemies';
import type { CombatActorStatePort, CombatGeometryPort } from '../combat/CombatCapabilities';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { EnergyConeAttack, EnergyConePhase } from './EnergyConeState';

interface Point { readonly x: number; readonly y: number }
/** A body the impulse can hit: player, decoy or (for allied casters) a hostile enemy. */
export interface EnergyConeTarget { readonly id: string; readonly x: number; readonly y: number; readonly radius: number }

export interface EnergyConePorts {
  readonly enemies: Pick<EnemyManager, 'getAllEnemies'>;
  readonly combat: Pick<CombatGeometryPort, 'hasClearLineOfFire'> & Pick<CombatActorStatePort, 'isStunned'>;
  /** Position of the enemy's bound target from the shared intent binding (decoys included); null without one. */
  readonly readTarget: (enemy: EnemyEntity) => Point | null;
  /** Bodies this caster may hit right now (faction rules applied by the caller). */
  readonly impulseTargets: (enemy: EnemyEntity) => readonly EnergyConeTarget[];
  /** Free reach of one cover ray (shot-blocking geometry, arena edge, train); see CombatEnergyConePort. */
  readonly measureRay: (x: number, y: number, angle: number, length: number) => number;
  /** Cover-, shield- and faction-aware impulse on one target inside the sector; true when damage landed. */
  readonly impulse: (targetId: string, casterId: string, damage: number, originX: number, originY: number,
    targetX: number, targetY: number, nowMs: number) => boolean;
}

/**
 * Activity-owned host decisions of the alien energy cone ("Energie-Fächer").
 *
 * Contract (GDD Alien-Kegelangriff V1, user decisions 2026-10-13):
 * - Start only when the caster is alive, on the surface (not burrowed), not stunned, not in another
 *   exclusive action (special action `none`, no dash), not in cooldown/lockout, its bound target is
 *   within [triggerMinDistancePx, triggerMaxDistancePx] and the line of fire to it is clear.
 * - On start: origin = body position, angle = direction to the target, range/arc from config, the
 *   timeline `startedAt = now`, `hitAt = now + windupMs`, `recoverUntil = hitAt + recoverMs`, and a
 *   cover profile of ENERGY_CONE_CLIP_RAYS rays (quantized with `quantizeEnergyConeReach`). Publish
 *   `windup` via `enemy.applyEnergyConeState` with a growing revision and face the axis.
 * - During the windup the cover profile is re-measured every `coverRefreshMs`; a changed profile is
 *   republished (new revision); origin, angle and timeline never change.
 * - At `hitAt` (once, also across large frame steps): resolve every `impulseTargets` body inside
 *   the sector (`CombatGeometry.areaContainsCircle` semantics: distance <= range + radius and the
 *   centre within the half arc) through `impulse`, at most once per target; then publish `recover`.
 *   The cooldown counts from `hitAt`.
 * - Cancel (no impulse) on stun, burrow, a special action other than `none`, displacement of the
 *   body beyond `windupDisplacementCancelPx` from the origin, a faction change, or death; publish
 *   phase `none` with attack `null`, and lock retries for `cancelLockoutMs`.
 * - Exclusive only during windup and recover: `blocksRegularAttacks`/`blocksDodge` and a zero
 *   movement override; outside these phases the regular weapons (plasma) act normally.
 * - Allied casters (necromancy) target hostile enemies only; hostile casters never hit allies'
 *   enemies. Death, removal and `clear()` leave no state, timer or published windup behind.
 */
export class CoopDefenseEnergyConeSystem implements EnemySpecialMovementSource {
  constructor(private readonly ports: EnergyConePorts) {}

  hostUpdate(_nowMs: number): void {
    throw new Error('CoopDefenseEnergyConeSystem.hostUpdate not implemented');
  }

  /** True during windup and recover. */
  blocksRegularAttacks(_enemyId: string): boolean { return false; }
  blocksDodge(enemyId: string): boolean { return this.blocksRegularAttacks(enemyId); }

  /** Zero velocity during windup and recover; null otherwise. */
  getMovementOverride(_enemy: EnemyEntity): { vx: number; vy: number } | null { return null; }

  /** Current phase for diagnostics and tests. */
  getPhase(_enemyId: string): EnergyConePhase { return 'none'; }
  /** Current host-fixed attack, if any. */
  getAttack(_enemyId: string): EnergyConeAttack | null { return null; }

  handleKilled(_death: { readonly id: string }): void {}

  clear(): void {}

  /** Config of a caster kind; undefined for enemies without the ability. */
  protected configOf(enemy: EnemyEntity): CoopDefenseEnemyEnergyConeConfig | undefined {
    return getCoopDefenseEnemyConfig(enemy.kind).energyCone;
  }
}
