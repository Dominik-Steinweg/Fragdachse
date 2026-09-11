import { ZeusRuntime, type ZeusTarget, type ZeusSnapshot } from '../systems/ZeusRuntime';
import { CombatStunStatusSystem } from '../systems/CombatStunStatusSystem';
import { combatTargetInstanceKey } from '../combat/CombatScope';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import { createSingleOwnerProvenance } from '../projectile/ProjectileSpawnRequest';
import { CHARGED_BOLT_SPEED_VARIATION } from '../projectile/ProjectileSpeedVariation';
import type { TaserUtilityConfig } from '../loadout/LoadoutConfig';
import type { PlayerCombatUtilityPort } from './PlayerCombatIntegrationPort';
import type { ZeusUtilityPort } from './ZeusUtilityPort';

/** World composition adapter. The electrical runtime never traverses scene or entity owners. */
export class WorldZeusBinding implements ZeusUtilityPort {
  readonly runtime: ZeusRuntime;
  private readonly stuns = new CombatStunStatusSystem();
  private readonly targets = new Map<string, ZeusTarget>();
  private readonly buckets = new Map<string, ZeusTarget[]>();
  private destroyed = false;
  constructor(private readonly combat: WorldCombatCore, private readonly players: PlayerManager,
    private readonly getEnemies: () => EnemyManager | null, private readonly physics: HostPhysicsSystem,
    projectiles: ProjectileSpawnPort, private readonly utility: PlayerCombatUtilityPort) {
    this.runtime = new ZeusRuntime({
      isOwnerActive: id => combat.isAlive(id) && !!players.getPlayer(id)?.active,
      queryTargets: (minX, minY, maxX, maxY) => {
        const found = new Map<string, ZeusTarget>();
        for (let x = Math.floor(minX / 128); x <= Math.floor(maxX / 128); x++)
          for (let y = Math.floor(minY / 128); y <= Math.floor(maxY / 128); y++)
            for (const target of this.buckets.get(`${x}:${y}`) ?? []) found.set(combatTargetInstanceKey(target.ref), target);
        return [...found.values()];
      },
      // Generic combat permits self-damage; electrical body/ground contacts never target their owner.
      canHit: (ownerId, target, x, y) => String(target.ref.id) !== ownerId && combat.isCurrentCombatantTarget(target.ref)
        && combat.canDamageTarget(ownerId, String(target.ref.id)) && combat.hasLineOfSight(x, y, target.x, target.y),
      damage: (use, target, amount, origin, ground, now) => combat.resolveZeusContact(target.ref, use.ownerId,
        amount, use.damageMultiplier, origin.x, origin.y, ground, now, use.id),
      stun: (target, duration, now) => combat.applyStun(target, duration, now),
      bolt: (use, target, angle, range) => {
        const c = use.config;
        projectiles.spawnProjectile({
          origin: { x: target.x, y: target.y, angle },
          flight: { speed: c.boltSpeed, size: c.boltSize, remainingRangePx: range,
            lifetimeMs: range / (c.boltSpeed * (1 - CHARGED_BOLT_SPEED_VARIATION.maxDeviation)) * 1000 + 100,
            speedVariation: 'charged_bolt', maxBounces: 0, isGrenade: false, piercesTargets: false,
            homing: { ...c.boltHoming, targetTypes: ['enemies', 'players'] },
            collisionFilter: { excludedTarget: target.ref } },
          provenance: { ...createSingleOwnerProvenance(use.ownerId, { weaponSourceId: 'ZEUS_TASER', sourceSlot: 'utility' }),
            lineage: { zeusUseId: use.id, zeusRole: 'bolt' } },
          interaction: { directHit: { damage: c.boltDamage * use.damageMultiplier,
            appliedSourceDamageFactors: [{ kind: 'runtime-power', multiplier: use.damageMultiplier, resolvedAt: 'execution' }],
            stunDurationMs: c.stunDurationMs, rockDamageMult: 0, baseDamageMult: 0, trainDamageMult: 0 } },
          presentation: { style: 'tesla_bolt', color: use.color, ownerColor: use.color, suppressSpawnFx: true },
        });
      },
      friendlyPlayers: ownerId => players.getAllPlayers().filter(p => p.active && combat.isAlive(p.id)
        && (p.id === ownerId || !combat.canDamageTarget(ownerId, p.id)))
        .map(p => ({ id: p.id, x: p.x, y: p.y, radius: p.getCollisionRadius() })),
    });
    combat.setStunStatus(this.stuns);
    physics.setStunChecker((id, now) => combat.isStunned(id, now));
    physics.setZeusMoveBonus((id, now) => this.runtime.getMoveBonus(id, now));
    physics.setDashObserver({ start: (id, now) => utility.onZeusDashStarted?.(id, now),
      move: ({ dashId: _dashId, ...step }, now) => combat.runHostExecution(() => this.runtime.move(step, now), now),
      canApplyImpact: (id, targetId) => this.runtime.canApplyDashImpact(id, combat.getZeusTarget(targetId)),
      end: () => {} });
    utility.setZeusPort?.(this);
  }

  refresh(): void {
    this.targets.clear(); this.buckets.clear();
    const add = (id: string, x: number, y: number, radius: number) => {
      const ref = this.combat.getZeusTarget(id);
      if (!ref || !this.combat.isAlive(id)) return;
      const target = { ref, x, y, radius };
      this.targets.set(combatTargetInstanceKey(ref), target);
      for (let bx = Math.floor((x - radius) / 128); bx <= Math.floor((x + radius) / 128); bx++)
        for (let by = Math.floor((y - radius) / 128); by <= Math.floor((y + radius) / 128); by++) {
          const key = `${bx}:${by}`;
          let bucket = this.buckets.get(key); if (!bucket) this.buckets.set(key, bucket = []); bucket.push(target);
        }
    };
    for (const enemy of this.getEnemies()?.getAllEnemies() ?? [])
      if (enemy.sprite.active && !enemy.isBurrowed()) add(enemy.id, enemy.sprite.x, enemy.sprite.y, enemy.getCollisionRadius());
    for (const p of this.players.getAllPlayers()) if (p.active) add(p.id, p.x, p.y, p.getCollisionRadius());
  }
  /** Evaluate ordinary movement and stationary overlaps before general Dash Impact. */
  prepareMovement(now: number): void {
    this.refresh();
    this.combat.runHostExecution(() => {
      for (const ball of this.runtime.snapshot().balls) {
        const p = this.players.getPlayer(ball.playerId);
        if (!p?.active || !this.combat.isAlive(ball.playerId)) { this.runtime.removePlayer(ball.playerId); continue; }
        this.runtime.move({ playerId: p.id, x: p.x, y: p.y, radius: p.getCollisionRadius(), positionRevision: p.positionRevision }, now);
      }
    }, now);
  }
  activate(config: TaserUtilityConfig, ownerId: string, x: number, y: number, angle: number, color: number, now: number, charged = false): boolean {
    if (this.destroyed) return false;
    this.refresh();
    const use = this.runtime.createUse(ownerId, color, angle, config.damage,
      this.combat.captureZeusDamageMultiplier(ownerId, now), config.zeus);
    if (charged && config.zeus.ballDurationMs > 0) {
      const p = this.players.getPlayer(ownerId);
      if (!p?.active || !this.combat.isAlive(ownerId)) return false;
      const movement = { playerId: ownerId, x: p.x, y: p.y, radius: p.getCollisionRadius(), positionRevision: p.positionRevision };
      this.combat.runHostExecution(() => this.runtime.startBall(use, movement, now), now);
      return true;
    }
    // Freeze positions before mutation, including targets that terminal callbacks remove.
    const targets = new Map(this.targets);
    const result = this.combat.resolveImmediateAttack({ kind: 'melee', origin: { x, y },
      aim: { x: Math.cos(angle), y: Math.sin(angle) }, range: config.range,
      payload: { shooterId: ownerId, x, y, angle, range: config.range, arcDegrees: config.hitArcDegrees,
        damage: config.damage, adrenalinGain: 0, sourceId: config.id, sourceSlot: 'utility', color, rockDamageMult: config.rockDamageMult ?? 0,
        trainDamageMult: config.trainDamageMult ?? 1, baseDamageMult: config.baseDamageMult ?? 1,
        visualPreset: config.visualPreset, shotAudioKey: config.shotAudio?.successKey,
        hitHeal: 0, hitAdrenaline: 0, bloodEffectMultiplier: 1 } });
    const handled = new Set<string>();
    this.combat.runHostExecution(() => {
      for (const outcome of result.interactions) {
        if (outcome.kind !== 'damage-applied' || outcome.source.authoredSourceId !== config.id || outcome.damage.damageKind !== 'direct') continue;
        const key = combatTargetInstanceKey(outcome.target), target = targets.get(key);
        if (target && !handled.has(key)) { handled.add(key); this.runtime.directHit(use, target, outcome, false, now); }
      }
    }, now);
    return result.accepted;
  }
  step(now: number): void {
    this.stuns.prune(now, ref => this.combat.isCurrentCombatantTarget(ref) && this.combat.isAlive(String(ref.id)));
    this.refresh();
    for (const ball of this.runtime.snapshot().balls) if (!this.combat.isAlive(ball.playerId) || !this.players.getPlayer(ball.playerId)) this.runtime.removePlayer(ball.playerId);
    this.combat.runHostExecution(() => this.runtime.step(now), now);
  }
  snapshot(now: number): ZeusSnapshot { return this.runtime.snapshot(this.stuns.snapshot(now, ref => this.combat.isCurrentCombatantTarget(ref))); }
  removePlayer(id: string): void { this.runtime.removePlayer(id); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.utility.setZeusPort?.(null); this.physics.setDashObserver(null); this.physics.setStunChecker(null);
    this.physics.setZeusMoveBonus(null); this.combat.setStunStatus(null);
    this.runtime.destroy(); this.stuns.clear(); this.targets.clear(); this.buckets.clear();
  }
}
