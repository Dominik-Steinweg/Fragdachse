import type { ProjectileDamageSourceFactor, SmokeGrenadeEffect, SyncedSmokeCloud, SyncedSmokeTargetStatus } from '../types';
import type { CombatSource, CombatTargetRef } from '../combat/CombatScope';
import { combatTargetInstanceKey } from '../combat/CombatScope';
import type { TargetDamageAppliedOutcome } from '../combat/CombatMutation';
import type { ProjectileSpawnRequest } from '../projectile/ProjectileSpawnRequest';
import { clamp01, smoothSmokeGrowth, type SmokeBehaviorConfig, type SmokeConfusionInfluence, type SmokePerceptionPort } from './SmokeRules';

export interface SmokeTarget {
  readonly ref: CombatTargetRef;
  readonly x: number;
  readonly y: number;
  readonly boss: boolean;
}
export interface SmokeCloud {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly createdAt: number;
  readonly config: SmokeGrenadeEffect;
  readonly source: CombatSource;
  activeUntil: number;
  lastTickAt: number;
  growthCount: number;
  growthFromRadius: number;
  growthStartedAt: number;
}
interface Exposure {
  readonly cloud: SmokeCloud;
  readonly boss: boolean;
  exitAt: number | null;
  expiresAt: number;
}
interface Charge {
  readonly cloud: SmokeCloud;
  expiresAt: number;
}
interface TargetState {
  target: SmokeTarget;
  readonly exposures: Map<number, Exposure>;
  charge: Charge | null;
  nextDischargeAt: number;
  readonly processedOutcomes: Set<string>;
}
export interface SmokeRuntimePorts {
  readonly hasVisibleSegment: (cx: number, cy: number, ax: number, ay: number, bx: number, by: number) => boolean;
  readonly hasClearLine: (sx: number, sy: number, ex: number, ey: number) => boolean;
  readonly setVulnerability: (target: CombatTargetRef, expiresAt: number | null) => void;
  readonly spawnProjectile: (request: ProjectileSpawnRequest) => void;
  readonly isFriendlySource: (source: CombatSource, smokeSource: CombatSource) => boolean;
  readonly random?: () => number;
}

/** Sole host authority for clouds, exposure and electric combos. No Phaser or wall clock. */
export class SmokeRuntime implements SmokePerceptionPort {
  private readonly clouds = new Map<number, SmokeCloud>();
  private readonly targets = new Map<string, TargetState>();
  private readonly enemyKeys = new Map<string, string>();
  private nextId = 0;
  private destroyed = false;

  constructor(private readonly ports: SmokeRuntimePorts) {}

  createCloud(x: number, y: number, config: SmokeGrenadeEffect, source: CombatSource, now: number): number {
    if (this.destroyed) throw new Error('Smoke runtime has ended');
    const id = this.nextId++;
    this.clouds.set(id, {
      id, x, y, config: structuredClone(config), source: structuredClone(source), createdAt: now,
      activeUntil: now + config.spreadDuration + config.lingerDuration, lastTickAt: now,
      growthCount: 0, growthFromRadius: config.radius, growthStartedAt: now,
    });
    return id;
  }

  updateExposure(targets: readonly SmokeTarget[], now: number): void {
    if (this.destroyed) return;
    for (const [id, cloud] of this.clouds) {
      if (now >= cloud.activeUntil + cloud.config.dissipateDuration) this.clouds.delete(id);
    }
    const live = new Set<string>();
    for (const target of targets) {
      const key = combatTargetInstanceKey(target.ref);
      live.add(key);
      let state = this.targets.get(key);
      if (!state) {
        state = { target, exposures: new Map(), charge: null, nextDischargeAt: 0, processedOutcomes: new Set() };
        this.targets.set(key, state);
      }
      state.target = target;
      this.enemyKeys.set(String(target.ref.id), key);
      for (const cloud of this.clouds.values()) {
        if (!this.contains(cloud, target.x, target.y, now)) continue;
        const duration = this.aftereffect(cloud.config.behavior, target.boss);
        state.exposures.set(cloud.id, { cloud, boss: target.boss, exitAt: null, expiresAt: cloud.activeUntil + duration });
      }
      let vulnerableUntil = 0;
      for (const [id, exposure] of state.exposures) {
        if (!this.contains(exposure.cloud, target.x, target.y, now)) {
          if (exposure.exitAt === null) {
            // At natural expiry the transition belongs to the precise field end, not this frame.
            exposure.exitAt = Math.min(now, exposure.cloud.activeUntil);
            exposure.expiresAt = exposure.exitAt + this.aftereffect(exposure.cloud.config.behavior, target.boss);
          }
          if (now >= exposure.expiresAt) { state.exposures.delete(id); continue; }
        }
        if (exposure.cloud.config.behavior.vulnerabilityEnabled > 0) vulnerableUntil = Math.max(vulnerableUntil, exposure.expiresAt);
      }
      if (state.charge && now >= state.charge.expiresAt) state.charge = null;
      this.ports.setVulnerability(target.ref, vulnerableUntil > now ? vulnerableUntil : null);
    }
    for (const [key, state] of this.targets) if (!live.has(key)) this.removeTarget(state.target.ref);
  }

  /** Ticks are processed one by one: a confirmed kill can grow the next tick's area. */
  advanceStorm(now: number, apply: (cloud: SmokeCloud, target: SmokeTarget, damage: number, source: CombatSource) => void): void {
    for (const cloud of this.clouds.values()) {
      const interval = cloud.config.dotTickIntervalMs ?? 0;
      const damage = cloud.config.dotDamagePerTick ?? 0;
      if (now >= cloud.activeUntil || interval <= 0 || damage <= 0) continue;
      // A stalled frame causes one current tick, never an unbounded catch-up burst.
      if (now - cloud.lastTickAt < interval) continue;
      cloud.lastTickAt = now - ((now - cloud.lastTickAt) % interval);
      const source: CombatSource = { ...cloud.source, authoredSourceId: 'utility.smoke_storm', origin: 'ground',
        lineage: { ...cloud.source.lineage, smokeCloudId: cloud.id, smokeKind: 'storm' } };
      for (const state of [...this.targets.values()]) {
        const target = state.target;
        if (this.contains(cloud, target.x, target.y, now)) apply(cloud, target,
          damage * (cloud.config.sourceDamageMultiplier ?? 1) * (cloud.config.sourceOutgoingDamage?.damageMultiplier ?? 1), source);
        if (this.destroyed) return;
      }
    }
  }

  /** Called after damage commits but before target status cleanup or death callbacks. */
  onDamage(outcome: TargetDamageAppliedOutcome, x: number, y: number, now: number): void {
    if (this.destroyed || outcome.actualDamage <= 0 || outcome.target.kind !== 'enemy') return;
    const state = this.targets.get(combatTargetInstanceKey(outcome.target));
    if (!state) return;
    if (state.processedOutcomes.has(outcome.outcomeId)) return;
    state.processedOutcomes.add(outcome.outcomeId);
    if (state.charge && now >= state.charge.expiresAt) state.charge = null;
    const lineage = outcome.source.lineage;
    if (lineage?.smokeKind === 'storm' && lineage.smokeCloudId !== undefined) {
      const cloud = this.clouds.get(lineage.smokeCloudId);
      if (cloud && now < cloud.activeUntil && (!state.charge || state.charge.cloud.id === cloud.id)) {
        state.charge = { cloud, expiresAt: now + cloud.config.behavior.chargeDurationMs };
      }
    }
    const charge = state.charge;
    if (!charge || !this.ports.isFriendlySource(outcome.source, charge.cloud.source)) return;
    const cloud = charge.cloud;
    const config = cloud.config.behavior;
    if (!lineage?.smokeKind && config.dischargeCount > 0 && now >= state.nextDischargeAt) {
      state.nextDischargeAt = now + config.dischargeCooldownMs;
      for (let i = 0; i < config.dischargeCount; i++) this.spawnDischarge(cloud, outcome.target, x, y);
    }
    if (outcome.transition.kind === 'dead') {
      if (now < cloud.activeUntil && this.clouds.has(cloud.id) && cloud.growthCount < config.growthMaxProcs) {
        cloud.growthFromRadius = this.radius(cloud, now);
        cloud.growthStartedAt = now;
        cloud.growthCount += 1;
        cloud.activeUntil += config.growthDurationMs;
      }
      this.removeTarget(outcome.target);
    }
  }

  getConfusion(enemyId: string, now: number): SmokeConfusionInfluence | null {
    const exposure = this.dominantExposure(this.stateForId(enemyId), now);
    if (!exposure) return null;
    const c = exposure.cloud, b = c.config.behavior;
    return { cloudId: c.id, x: c.x, y: c.y, radius: this.radius(c, now), fraction: this.exposureFraction(exposure, now),
      retentionBias: exposure.boss || exposure.exitAt !== null ? 0 : b.retentionBias,
      edgeFraction: b.retentionEdgeFraction, directionMinMs: b.directionMinMs, directionMaxMs: b.directionMaxMs };
  }

  canSee(enemyId: string, x: number, y: number, tx: number, ty: number, range: number, now: number): boolean {
    const state = this.stateForId(enemyId);
    const boss = state?.target.boss ?? false;
    let visibleRange = range;
    const e = this.dominantExposure(state, now);
    if (e) {
      const b = e.cloud.config.behavior;
      const near = boss ? b.bossNearSightPx : b.nearSightPx;
      const recovery = e.exitAt === null ? 0 : clamp01((now - e.exitAt) / Math.max(1, e.expiresAt - e.exitAt));
      visibleRange = Math.min(visibleRange, near + Math.max(0, range - near) * recovery);
    }
    for (const cloud of this.clouds.values()) {
      if (now >= cloud.activeUntil) continue;
      const dx = tx - x, dy = ty - y, lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0 ? clamp01(((cloud.x - x) * dx + (cloud.y - y) * dy) / lengthSq) : 0;
      const px = x + t * dx, py = y + t * dy;
      const radius = this.radius(cloud, now);
      if (Math.hypot(px - cloud.x, py - cloud.y) > radius) continue;
      let crossesVisibleSmoke = this.ports.hasClearLine(cloud.x, cloud.y, px, py);
      if (!crossesVisibleSmoke && lengthSq > 0) {
        const projection = ((cloud.x - x) * dx + (cloud.y - y) * dy) / lengthSq;
        const qx = x + projection * dx - cloud.x, qy = y + projection * dy - cloud.y;
        const half = Math.sqrt(Math.max(0, radius * radius - qx * qx - qy * qy) / lengthSq);
        const start = clamp01(projection - half), end = clamp01(projection + half);
        crossesVisibleSmoke = this.ports.hasVisibleSegment(cloud.x, cloud.y, x + start * dx, y + start * dy, x + end * dx, y + end * dy);
      }
      if (crossesVisibleSmoke) {
        const b = cloud.config.behavior;
        visibleRange = Math.min(visibleRange, boss ? b.bossNearSightPx : b.nearSightPx);
      }
    }
    return Math.hypot(tx - x, ty - y) <= visibleRange;
  }

  getSnapshots(now: number): SyncedSmokeCloud[] {
    return [...this.clouds.values()].filter(c => now < c.activeUntil + c.config.dissipateDuration).map(c => {
      const active = now < c.activeUntil;
      const spread = clamp01((now - c.createdAt) / Math.max(1, c.config.spreadDuration));
      const fade = active ? 1 : 1 - clamp01((now - c.activeUntil) / Math.max(1, c.config.dissipateDuration));
      return { id: c.id, x: c.x, y: c.y, radius: this.radius(c, now), alpha: c.config.maxAlpha * fade,
        density: (0.35 + 0.65 * spread) * fade, storm: active && (c.config.dotDamagePerTick ?? 0) > 0,
        stormTickMs: c.config.dotTickIntervalMs, activeUntil: c.activeUntil, expiresAt: c.activeUntil + c.config.dissipateDuration,
        phase: active ? 'active' as const : 'dissipating' as const, growthSequence: c.growthCount,
        growthFromRadius: c.growthFromRadius, growthTargetRadius: this.targetRadius(c),
        growthStartedAt: c.growthStartedAt, growthDurationMs: c.config.behavior.growthTransitionMs };
    });
  }

  getTargetSnapshots(now: number): SyncedSmokeTargetStatus[] {
    const result: SyncedSmokeTargetStatus[] = [];
    for (const state of this.targets.values()) {
      const confusedUntil = Math.max(0, ...[...state.exposures.values()].map(e => e.expiresAt));
      const chargedUntil = state.charge?.expiresAt ?? 0;
      if (confusedUntil > now || chargedUntil > now) result.push({ enemyId: String(state.target.ref.id), confusedUntil, chargedUntil });
    }
    return result;
  }

  removeTarget(target: CombatTargetRef): void {
    const key = combatTargetInstanceKey(target);
    this.targets.delete(key);
    if (this.enemyKeys.get(String(target.id)) === key) this.enemyKeys.delete(String(target.id));
    this.ports.setVulnerability(target, null);
  }
  clearTargets(): void {
    for (const state of this.targets.values()) this.ports.setVulnerability(state.target.ref, null);
    this.targets.clear(); this.enemyKeys.clear();
  }
  clear(): void { this.clearTargets(); this.clouds.clear(); }
  destroy(): void { this.clear(); this.destroyed = true; }

  private stateForId(id: string): TargetState | undefined { const key = this.enemyKeys.get(id); return key === undefined ? undefined : this.targets.get(key); }
  private exposureFraction(e: Exposure, now: number): number {
    const b = e.cloud.config.behavior;
    const fade = e.exitAt === null ? 1 : clamp01((e.expiresAt - now) / Math.max(1, b.recoveryFadeMs));
    return b.confusionFraction * (e.boss ? b.bossConfusionFactor : 1) * fade;
  }
  private dominantExposure(state: TargetState | undefined, now: number): Exposure | null {
    let best: Exposure | null = null;
    for (const e of state?.exposures.values() ?? []) {
      if (now >= e.expiresAt) continue;
      const fraction = this.exposureFraction(e, now), previous = best ? this.exposureFraction(best, now) : -1;
      if (fraction > previous || (fraction === previous && e.expiresAt > best!.expiresAt)) best = e;
    }
    return best;
  }
  private aftereffect(b: SmokeBehaviorConfig, boss: boolean): number { return b.aftereffectMs * (boss ? b.bossAftereffectFactor : 1); }
  private targetRadius(c: SmokeCloud): number { return c.config.radius * (1 + c.growthCount * c.config.behavior.growthRadiusFraction); }
  private radius(c: SmokeCloud, now: number): number {
    const spread = 1 - Math.pow(1 - clamp01((now - c.createdAt) / Math.max(1, c.config.spreadDuration)), 3);
    if (!c.growthCount) return c.config.radius * spread;
    return c.growthFromRadius + (this.targetRadius(c) - c.growthFromRadius) * smoothSmokeGrowth((now - c.growthStartedAt) / Math.max(1, c.config.behavior.growthTransitionMs));
  }
  private contains(c: SmokeCloud, x: number, y: number, now: number): boolean {
    return now >= c.createdAt && now < c.activeUntil && Math.hypot(x - c.x, y - c.y) <= this.radius(c, now)
      && this.ports.hasClearLine(c.x, c.y, x, y);
  }
  private spawnDischarge(cloud: SmokeCloud, origin: CombatTargetRef, x: number, y: number): void {
    const b = cloud.config.behavior, s = cloud.source;
    const outgoing = cloud.config.sourceOutgoingDamage;
    const critical = outgoing && (this.ports.random?.() ?? Math.random()) < outgoing.criticalChance;
    const criticalMultiplier = critical ? outgoing.criticalDamageMultiplier : 1;
    const factors: ProjectileDamageSourceFactor[] = [
      { kind: 'runtime-power', multiplier: cloud.config.sourceDamageMultiplier ?? 1, resolvedAt: 'execution' },
      { kind: 'outgoing-modifier', multiplier: (outgoing?.damageMultiplier ?? 1) * criticalMultiplier, resolvedAt: 'execution' },
    ];
    if (critical) factors.push({ kind: 'critical', multiplier: criticalMultiplier, resolvedAt: 'execution' });
    if (s.gameplaySource.kind === 'decoy') throw new Error('A decoy cannot create a smoke discharge');
    this.ports.spawnProjectile({
      origin: { x, y, angle: (this.ports.random?.() ?? Math.random()) * Math.PI * 2 },
      flight: { speed: b.dischargeSpeed, size: b.dischargeSize, lifetimeMs: b.dischargeRange / b.dischargeSpeed * 1000,
        maxBounces: 0, isGrenade: false, remainingRangePx: b.dischargeRange,
        homing: { ...b.dischargeHoming, targetTypes: ['enemies'], requireLineOfSight: true },
        collisionFilter: { initialTargetProtection: { targetId: String(origin.id), durationMs: b.dischargeHoming.acquireDelayMs } } },
      provenance: { gameplaySourceId: String(s.gameplaySource.id), gameplaySourceKind: s.gameplaySource.kind,
        portalDamage: s.portalDamage,
        attributionId: s.attribution.id, attributionKind: s.attribution.kind, allegiance: { ...s.allegiance },
        weaponSourceId: 'utility.smoke_discharge', sourceSlot: 'utility', lineage: { smokeCloudId: cloud.id, smokeKind: 'discharge' } },
      interaction: { directHit: { damage: b.dischargeDamage * (cloud.config.sourceDamageMultiplier ?? 1) * (outgoing?.damageMultiplier ?? 1) * criticalMultiplier,
        appliedSourceDamageFactors: factors, rockDamageMult: 0, baseDamageMult: 0, trainDamageMult: 0 } },
      presentation: { style: 'tesla_bolt', color: 0x94ddff, ownerColor: 0x94ddff, suppressSpawnFx: true },
    });
  }
}
