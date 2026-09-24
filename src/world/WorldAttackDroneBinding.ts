import { CELL_SIZE } from '../config';
import { ATTACK_DRONE_RULES as R, ATTACK_DRONE_SOURCE as SOURCE, resolveAttackDroneStats } from '../config/attackDrone';
import { combatTargetInstanceKey, isSameCombatTargetInstance, type CombatSource, type CombatTargetRef } from '../combat/CombatScope';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import type { EnemyManager } from '../entities/EnemyManager';
import type { BaseManager } from '../entities/BaseManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { EnergyInjectorSystem } from '../systems/EnergyInjectorSystem';
import { AttackDroneSystem, type AttackDroneAttack, type AttackDroneStation } from '../systems/AttackDroneSystem';
import type { AttackDroneTarget } from '../systems/AttackDroneTargeting';
import type { RemoteControlSource } from '../systems/CoopDefenseItemRuntimeSystem';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import type { ProjectileProvenance } from '../projectile/ProjectileSpawnRequest';
import type { PlayerCombatIntegrationPort } from './PlayerCombatIntegrationPort';
import type { WorldObjectMutationRuntime } from './WorldObjectMutationRuntime';
import type { WorldMetrics } from './WorldMetrics';
import type { ProjectileDamageSourceFactor, ProjectileExplosionConfig, SyncedAttackDroneBomb } from '../types';

interface Target extends AttackDroneTarget { readonly ref: CombatTargetRef }
interface PendingBomb {
  readonly snapshot: SyncedAttackDroneBomb; readonly attack: AttackDroneAttack;
  readonly source: CombatSource; readonly multiplier: number; readonly factors: readonly ProjectileDamageSourceFactor[];
}
export interface WorldAttackDroneOptions {
  readonly combat: WorldCombatCore; readonly players: PlayerManager; readonly placement: PlacementSystem;
  readonly bases: BaseManager | null; readonly metrics: WorldMetrics; readonly projectiles: ProjectileSpawnPort;
  readonly playerCombat: PlayerCombatIntegrationPort;
  readonly enemies: () => EnemyManager | null;
  readonly mutation: () => WorldObjectMutationRuntime | null;
  readonly available: (ownerId: string) => boolean;
  readonly enabled: () => boolean;
  readonly injector: () => EnergyInjectorSystem | null;
  readonly remoteSources: () => readonly RemoteControlSource[];
  readonly explosionFx: (x: number, y: number, radius: number, sourceId: string) => void;
}

/** World adapter: station/target projection and captured attacks; no renderer is required. */
export class WorldAttackDroneBinding {
  readonly system: AttackDroneSystem;
  private readonly targets = new Map<string, Target>();
  private readonly bombs = new Map<string, PendingBomb>();
  private readonly baseGeometry = new Map<string, Target>();
  private baseRevision = -1;
  private stationView: AttackDroneStation[] = [];
  constructor(private readonly options: WorldAttackDroneOptions) {
    const m = options.metrics;
    this.system = new AttackDroneSystem({
      bounds: { left: m.offsetX, top: m.offsetY, right: m.maxX, bottom: m.maxY },
      stations: () => this.stationView,
      owner: id => {
        const player = options.players.getPlayer(id);
        return player ? { x: player.x, y: player.y, alive: options.combat.isAlive(id), available: options.available(id) } : null;
      },
      targets: () => this.refreshTargets(), readTarget: key => this.readTarget(key),
      canTarget: (ownerId, target) => {
        const ref = this.targets.get(target.key)?.ref;
        if (!ref) return false;
        const source = options.combat.captureWorldDamageSource(ownerId, SOURCE.gun);
        return ref.kind === 'base' ? options.combat.canDamageStructure(source, undefined, 'hostile')
          : options.combat.resolveCombatRelationship(source, ref).canDamage;
      },
      fire: shot => this.fire(shot), dropBomb: bomb => this.drop(bomb),
    });
  }
  advance(now: number, deltaMs: number): void {
    this.stationView = this.options.enabled() ? this.readStations() : [];
    this.system.update(now, deltaMs);
    for (const [id, bomb] of this.bombs) {
      if (bomb.snapshot.landsAt > now) continue;
      this.bombs.delete(id);
      this.options.combat.runHostExecution(() => this.explode(bomb), bomb.snapshot.landsAt);
    }
  }
  getBombSnapshot(): SyncedAttackDroneBomb[] { return [...this.bombs.values()].map(b => b.snapshot); }
  getStationSources(): readonly RemoteControlSource[] { return this.readStations(); }
  clearActivity(): void { this.targets.clear(); this.baseGeometry.clear(); this.bombs.clear(); this.system.invalidateActivity(); }
  destroy(): void { this.clearActivity(); this.stationView = []; this.system.clear(); }

  private readStations(): AttackDroneStation[] {
    const o = this.options, m = o.metrics;
    return o.placement.getAllRuntimeRocks().filter(r => r.constructionId === 'attack_drone_station' && r.hp > 0)
      .map(r => ({ id: r.id, ownerId: r.ownerId, ownerColor: r.ownerColor,
        x: m.offsetX + (r.gridX + 0.5) * CELL_SIZE, y: m.offsetY + (r.gridY + 0.5) * CELL_SIZE,
        stats: resolveAttackDroneStats(stat => o.playerCombat.modifier.getNumericStat(r.ownerId, stat)) }));
  }
  private refreshTargets(): readonly Target[] {
    this.targets.clear();
    const o = this.options, enemies = o.enemies();
    for (const enemy of enemies?.getHostileEnemies() ?? []) {
      if (enemy.getHp() <= 0 || !enemy.sprite.active || enemy.isBurrowed()) continue;
      const ref = enemies!.getCombatTargetRef(enemy.id);
      if (!ref) continue;
      const key = combatTargetInstanceKey(ref);
      this.targets.set(key, { key, ref, x: enemy.sprite.x, y: enemy.sprite.y, radius: enemy.getCollisionRadius(), weight: enemy.isBoss() ? 3 : 1 });
    }
    const generation = o.bases?.getObstacleGeneration() ?? 0;
    if (this.baseRevision !== generation) { this.baseRevision = generation; this.baseGeometry.clear(); }
    for (const base of o.bases?.getBasesByFaction('hostile') ?? []) {
      if (base.isInert() || base.getHp() <= 0) continue;
      const ref = o.mutation()?.resolveTarget('base', base.id);
      if (!ref) continue;
      const key = combatTargetInstanceKey(ref);
      let target = this.baseGeometry.get(key);
      if (!target) {
        const rectangles = base.getCellBodies().map(body => {
          const b = body.getBounds(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        });
        if (!rectangles.length) continue;
        target = { key, ref, rectangles, radius: 0, weight: 3,
          x: (Math.min(...rectangles.map(r => r.left)) + Math.max(...rectangles.map(r => r.right))) / 2,
          y: (Math.min(...rectangles.map(r => r.top)) + Math.max(...rectangles.map(r => r.bottom))) / 2 };
        this.baseGeometry.set(key, target);
      }
      this.targets.set(key, target);
    }
    return [...this.targets.values()];
  }
  private readTarget(key: string): Target | null {
    const t = this.targets.get(key);
    if (!t) return null;
    if (t.ref.kind === 'enemy') {
      const enemies = this.options.enemies(), current = enemies?.getCombatTargetRef(String(t.ref.id));
      const e = enemies?.getEnemy(String(t.ref.id));
      return current && isSameCombatTargetInstance(current, t.ref) && e && e.sprite.active && e.getHp() > 0 && !e.isBurrowed()
        ? { ...t, x: e.sprite.x, y: e.sprite.y } : null;
    }
    const current = this.options.mutation()?.resolveTarget('base', t.ref.id);
    const base = this.options.bases?.getBase(String(t.ref.id));
    return current && isSameCombatTargetInstance(current, t.ref) && base && !base.isInert() && base.getHp() > 0 ? t : null;
  }
  private provenance(a: AttackDroneAttack, sourceId: string): ProjectileProvenance {
    return this.options.combat.captureProjectileProvenance({
      gameplaySourceId: a.droneId, gameplaySourceKind: 'turret', attributionId: a.ownerId, attributionKind: 'player',
      allegiance: { ownerId: a.ownerId, kind: 'player', allowTeamDamage: false },
      weaponSourceId: sourceId, sourceSlot: 'utility', sourceTurretId: String(a.stationId),
      correlation: { executionId: a.attackId },
    });
  }
  private capture(a: AttackDroneAttack) {
    const o = this.options, station = this.stationView.find(s => s.id === a.stationId);
    const effect = o.injector()?.getEffect(String(a.stationId), a.at)?.effect;
    const injector = effect?.type === 'damage_turret' ? effect.damageMultiplier : 1;
    const remote = station ? o.playerCombat.item.getRemoteControlDamageMultiplier(a.ownerId, station, o.remoteSources()) : 1;
    const automated = injector * remote, runtime = o.combat.getPlayerRuntimeDamageMultiplier(a.ownerId, 'utility');
    const factors: ProjectileDamageSourceFactor[] = [
      { kind: 'automated-source', multiplier: automated, resolvedAt: 'execution' },
      { kind: 'runtime-power', multiplier: runtime, resolvedAt: 'execution' },
    ];
    return { multiplier: automated * runtime, factors };
  }
  private fire(a: AttackDroneAttack & { angle: number }): void {
    const o = this.options;
    o.combat.runHostExecution(() => {
      const captured = this.capture(a);
      o.projectiles.spawnProjectile({ origin: { x: a.x, y: a.y, angle: a.angle },
        flight: { speed: R.projectileSpeed, size: R.projectileWidth, lifetimeMs: R.range / R.projectileSpeed * 1000,
          remainingRangePx: R.range, maxBounces: 0, isGrenade: false, collisionMode: 'sweep',
          collisionFilter: { airborne: true }, penetration: { count: a.stats.penetration, damageRetention: 1 } },
        provenance: this.provenance(a, SOURCE.gun),
        interaction: { directHit: { damage: R.damage * captured.multiplier, appliedSourceDamageFactors: captured.factors,
          adrenalinGain: 0, rockDamageMult: 0, trainDamageMult: 0, baseDamageMult: 1, knockback: 0 } },
        presentation: { color: 0xffd08a, ownerColor: a.ownerColor, style: 'bullet', bulletPreset: 'p90', suppressSpawnFx: true },
      });
    }, a.at);
  }
  private drop(a: AttackDroneAttack): void {
    this.options.combat.runHostExecution(() => {
      const captured = this.capture(a), provenance = this.provenance(a, SOURCE.bomb);
      const source = this.options.combat.captureWorldDamageSource(a.ownerId, SOURCE.bomb, 'explosion', provenance);
      this.bombs.set(a.attackId, { attack: a, source, ...captured,
        snapshot: { id: a.attackId, stationId: a.stationId, ownerId: a.ownerId, x: a.x, y: a.y,
          droppedAt: a.at, landsAt: a.at + R.bombFallMs } });
    }, a.at);
  }
  private explode(b: PendingBomb): void {
    const o = this.options, a = b.attack;
    const effect: ProjectileExplosionConfig = { radius: R.bombRadius, maxDamage: R.bombMaxDamage * b.multiplier,
      minDamage: R.bombMinDamage * b.multiplier, appliedSourceDamageFactors: b.factors,
      knockback: 0, selfDamageMult: 0, excludeFriendlyPlayers: true, damageTarget: 'enemies',
      baseDamageMult: 1, rockDamageMult: 0, trainDamageMult: 0, useTargetSurfaceDistance: true };
    o.combat.applyExplosionDamage(a.x, a.y, effect, a.ownerId, 'utility', SOURCE.bomb, b.source);
    o.explosionFx(a.x, a.y, effect.radius, SOURCE.bomb);
    if (a.stats.chunksPerBomb <= 0) return;
    let randomSeed = 2166136261;
    for (const char of a.attackId) randomSeed = Math.imul(randomSeed ^ char.charCodeAt(0), 16777619);
    o.playerCombat.fireChunks?.hostCreateFireChunkBurst(a.ownerId, a.x, a.y, {
      randomSeed,
      count: a.stats.chunksPerBomb, searchRadius: R.chunkRadius, flightMs: R.chunkFlightMs,
      requireLineOfSight: true, igniteCenter: false, durationMs: R.groundDurationMs,
      burnDurationMs: R.burnDurationMs, burnDamagePerTick: R.burnDamagePerTick * b.multiplier,
      sourceId: SOURCE.fire, damageTarget: 'enemies', baseDamageMult: 0,
      landingExplosion: { ...effect, radius: R.chunkExplosionRadius, maxDamage: R.chunkMaxDamage * b.multiplier,
        minDamage: R.chunkMinDamage * b.multiplier, audioSourceId: SOURCE.chunk, visualStyle: 'rocket' },
    }, a.attackId, b.snapshot.landsAt, { ...b.source, authoredSourceId: SOURCE.fire, origin: 'ground',
      lineage: { ...b.source.lineage, parentEffectId: a.attackId } });
  }
}
