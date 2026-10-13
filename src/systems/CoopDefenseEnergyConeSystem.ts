import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyEnergyConeConfig } from '../config/coopDefenseEnemies';
import type { CombatActorStatePort, CombatGeometryPort } from '../combat/CombatCapabilities';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager, EnemySpecialMovementSource } from '../entities/EnemyManager';
import { ENERGY_CONE_CLIP_RAYS, energyConeRayAngle, quantizeEnergyConeReach,
  type EnergyConeAttack, type EnergyConePhase } from './EnergyConeState';
import { CombatGeometry } from './CombatGeometry';

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

interface ConeState {
  readonly enemy: EnemyEntity;
  phase: EnergyConePhase;
  attack: EnergyConeAttack | null;
  faction: EnemyEntity['faction'];
  revision: number;
  cooldownUntil: number;
  lockoutUntil: number;
  coverRefreshAt: number;
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
 * - Targets are opposing-faction bodies: allied casters (necromancy) hit hostile enemies only,
 *   hostile casters hit players, decoys and allied enemies. Death, removal and `clear()` leave no
 *   state, timer or published windup behind.
 */
export class CoopDefenseEnergyConeSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, ConeState>();

  constructor(private readonly ports: EnergyConePorts) {}

  hostUpdate(nowMs: number): void {
    const live = new Set<string>();
    for (const enemy of this.ports.enemies.getAllEnemies()) {
      const config = this.configOf(enemy);
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      let state = this.states.get(enemy.id);
      if (!state || state.enemy !== enemy) {
        if (state) this.release(state);
        state = { enemy, phase: 'none', attack: null, faction: enemy.faction,
          revision: enemy.getEnergyConeState().revision, cooldownUntil: nowMs, lockoutUntil: nowMs, coverRefreshAt: nowMs };
        this.states.set(enemy.id, state);
      }
      this.step(state, config, nowMs);
    }
    for (const [id, state] of this.states) if (!live.has(id)) { this.release(state); this.states.delete(id); }
  }

  /** True during windup and recover. */
  blocksRegularAttacks(enemyId: string): boolean { return this.getPhase(enemyId) !== 'none'; }
  blocksDodge(enemyId: string): boolean { return this.blocksRegularAttacks(enemyId); }

  /** Zero velocity during windup and recover; null otherwise. */
  getMovementOverride(enemy: EnemyEntity): { vx: number; vy: number } | null {
    return this.blocksRegularAttacks(enemy.id) ? { vx: 0, vy: 0 } : null;
  }

  /** Current phase for diagnostics and tests. */
  getPhase(enemyId: string): EnergyConePhase { return this.states.get(enemyId)?.phase ?? 'none'; }
  /** Current host-fixed attack, if any. */
  getAttack(enemyId: string): EnergyConeAttack | null { return this.states.get(enemyId)?.attack ?? null; }

  handleKilled(death: { readonly id: string }): void {
    const state = this.states.get(death.id);
    if (state) this.release(state);
    this.states.delete(death.id);
  }

  clear(): void {
    for (const state of this.states.values()) this.release(state);
    this.states.clear();
  }

  private step(state: ConeState, config: CoopDefenseEnemyEnergyConeConfig, now: number): void {
    const enemy = state.enemy;
    const unavailable = (this.ports.combat.isStunned?.(enemy.id, now) ?? false)
      || enemy.isBurrowed() || enemy.getSpecialAction() !== 'none';
    if (state.phase !== 'none') {
      const attack = state.attack!;
      if (unavailable || enemy.faction !== state.faction
        || Math.hypot(enemy.sprite.x - attack.originX, enemy.sprite.y - attack.originY) > config.windupDisplacementCancelPx) {
        this.cancel(state, config, now);
        return;
      }
      if (state.phase === 'windup') {
        if (now >= attack.hitAt) {
          state.cooldownUntil = attack.hitAt + config.cooldownMs;
          this.resolveImpulse(state, config, now);
          // Damage callbacks may end the Activity or kill the caster.
          if (this.states.get(enemy.id) !== state) return;
          this.publish(state, 'recover', attack);
        } else if (now >= state.coverRefreshAt) {
          state.coverRefreshAt = now + config.coverRefreshMs;
          const clip = this.measureCover(attack);
          if (clip.some((reach, i) => reach !== attack.clip[i])) this.publish(state, 'windup', { ...attack, clip });
        }
      }
      if (state.phase === 'recover' && now >= attack.recoverUntil) this.publish(state, 'none', null);
    } else if (!unavailable && (enemy.getDashPhase?.() ?? 0) === 0
      && (enemy.faction === 'hostile' || enemy.faction === 'allied')
      && now >= state.cooldownUntil && now >= state.lockoutUntil) {
      this.tryStart(state, config, now);
    }
  }

  private tryStart(state: ConeState, config: CoopDefenseEnemyEnergyConeConfig, now: number): void {
    const enemy = state.enemy, target = this.ports.readTarget(enemy);
    if (!target) return;
    const dx = target.x - enemy.sprite.x, dy = target.y - enemy.sprite.y, distance = Math.hypot(dx, dy);
    if (distance < config.triggerMinDistancePx || distance > config.triggerMaxDistancePx) return;
    if (!this.ports.combat.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, target.x, target.y)) return;
    const hitAt = now + config.windupMs;
    const attack: EnergyConeAttack = { originX: enemy.sprite.x, originY: enemy.sprite.y, angle: Math.atan2(dy, dx),
      range: config.rangePx, arcDegrees: config.arcDegrees, startedAt: now, hitAt,
      recoverUntil: hitAt + config.recoverMs, clip: [] };
    state.faction = enemy.faction;
    state.coverRefreshAt = now + config.coverRefreshMs;
    enemy.faceAngle(attack.angle);
    enemy.stopMovement();
    this.publish(state, 'windup', { ...attack, clip: this.measureCover(attack) });
  }

  private measureCover(attack: EnergyConeAttack): number[] {
    return Array.from({ length: ENERGY_CONE_CLIP_RAYS }, (_, i) => quantizeEnergyConeReach(
      this.ports.measureRay(attack.originX, attack.originY, energyConeRayAngle(attack, i), attack.range) / attack.range));
  }

  private resolveImpulse(state: ConeState, config: CoopDefenseEnemyEnergyConeConfig, now: number): void {
    const attack = state.attack!;
    const pose = { originX: attack.originX, originY: attack.originY, angle: attack.angle,
      geometry: { kind: 'sector' as const, range: attack.range, arcDegrees: attack.arcDegrees } };
    const struck = new Set<string>();
    for (const target of this.ports.impulseTargets(state.enemy)) {
      if (this.states.get(state.enemy.id) !== state) return;
      if (struck.has(target.id) || !CombatGeometry.areaContainsCircle(pose, target.x, target.y, target.radius)) continue;
      struck.add(target.id);
      this.ports.impulse(target.id, state.enemy.id, config.damage, attack.originX, attack.originY, target.x, target.y, now);
    }
  }

  private cancel(state: ConeState, config: CoopDefenseEnemyEnergyConeConfig, now: number): void {
    state.lockoutUntil = now + config.cancelLockoutMs;
    this.publish(state, 'none', null);
  }

  private publish(state: ConeState, phase: EnergyConePhase, attack: EnergyConeAttack | null): void {
    state.phase = phase;
    state.attack = attack;
    state.revision = Math.max(state.revision, state.enemy.getEnergyConeState().revision) + 1;
    state.enemy.applyEnergyConeState({ revision: state.revision, phase, attack: phase === 'none' ? null : attack });
  }

  private release(state: ConeState): void {
    if (state.phase !== 'none') this.publish(state, 'none', null);
  }

  /** Config of a caster kind; undefined for enemies without the ability. */
  protected configOf(enemy: EnemyEntity): CoopDefenseEnemyEnergyConeConfig | undefined {
    return getCoopDefenseEnemyConfig(enemy.kind).energyCone;
  }
}
