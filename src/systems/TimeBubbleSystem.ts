import type { SyncedTimeBubble, TimeBubbleEffectConfig } from '../types';
import { createSingleOwnerProvenance, type ProjectileSpawnRequest, type ProjectileProvenance } from '../projectile/ProjectileSpawnRequest';
import { portalDamageMultiplier } from './PortalTraversal';
import { computeRadialDamage } from '../utils/radialDamage';
import { closestSegmentPoint, meleeCircleContact, type TimeBubbleChargePort, type TimeBubbleRelease } from './TimeBubbleChargePort';

const FADE_IN_MS = 220;
const FADE_OUT_MS = 300;
const MAX_CATCH_UP_SHOTS = 4;

interface ActiveTimeBubble {
  provenance: ProjectileProvenance;
  id: number;
  ownerId: string;
  x: number;
  y: number;
  effect: TimeBubbleEffectConfig;
  createdAt: number;
  nextShotIndex: number;
  charge: number;
  chargedProjectiles: Set<number>;
}

export class TimeBubbleSystem implements TimeBubbleChargePort {
  private releaseHandler: ((release: TimeBubbleRelease, now: number) => void) | null = null;
  private readonly pendingReleases: TimeBubbleRelease[] = [];

  setReleaseHandler(handler: ((release: TimeBubbleRelease, now: number) => void) | null): void {
    this.releaseHandler = handler;
    if (!handler) this.pendingReleases.length = 0;
  }

  /** Manual collapse drains after redirection; natural expiry drains before the new snapshots. */
  flushReleases(now: number): void {
    if (this.pendingReleases.length === 0) return;
    for (const release of this.pendingReleases.splice(0)) this.releaseHandler?.(release, now);
  }

  private canCharge(bubble: ActiveTimeBubble, damage: number, now: number): boolean {
    return Number.isFinite(damage) && damage > 0 && now >= bubble.createdAt
      && now < bubble.createdAt + bubble.effect.duration && bubble.charge < (bubble.effect.chargeCapacity ?? 0);
  }

  private addCharge(bubble: ActiveTimeBubble, damage: number): void {
    bubble.charge = Math.min(bubble.effect.chargeCapacity ?? 0, bubble.charge + damage);
  }

  observeProjectile(id: number, x: number, y: number, damage: number, now: number): void {
    for (const bubble of this.activeBubbles) {
      if (!this.canCharge(bubble, damage, now) || bubble.chargedProjectiles.has(id)) continue;
      if (Math.hypot(x - bubble.x, y - bubble.y) > bubble.effect.radius) continue;
      bubble.chargedProjectiles.add(id);
      this.addCharge(bubble, damage);
    }
  }

  observeHitscan(x: number, y: number, endX: number, endY: number, width: number, damage: number, now: number): void {
    for (const bubble of this.activeBubbles) {
      if (!this.canCharge(bubble, damage, now)) continue;
      const p = closestSegmentPoint(bubble.x, bubble.y, x, y, endX, endY);
      if (Math.hypot(p.x - bubble.x, p.y - bubble.y) <= bubble.effect.radius + Math.max(0, width) / 2) this.addCharge(bubble, damage);
    }
  }

  observeMelee(x: number, y: number, angle: number, range: number, halfArc: number, damage: number,
    now: number, isBlocked: (contactX: number, contactY: number) => boolean): void {
    for (const bubble of this.activeBubbles) {
      if (!this.canCharge(bubble, damage, now)) continue;
      const contact = meleeCircleContact(x, y, angle, range, halfArc, bubble.x, bubble.y, bubble.effect.radius);
      if (contact && !isBlocked(contact.x, contact.y)) this.addCharge(bubble, damage);
    }
  }

  observeExplosion(x: number, y: number, radius: number, damage: number, now: number,
    falloff?: import('../types').RadialDamageFalloffConfig): void {
    for (const bubble of this.activeBubbles) {
      if (!this.canCharge(bubble, damage, now) || radius <= 0) continue;
      const distance = Math.max(0, Math.hypot(x - bubble.x, y - bubble.y) - bubble.effect.radius);
      this.addCharge(bubble, computeRadialDamage(distance, radius, damage, falloff));
    }
  }
  private readonly activeBubbles: ActiveTimeBubble[] = [];
  // Delayed collapse requests and surviving prism shots must not bind to a rebuilt system's bubble.
  private static nextId = 0;
  private endListener: ((bubbleId: number, endedAt: number) => void) | null = null;

  setEndListener(listener: ((bubbleId: number, endedAt: number) => void) | null): void {
    this.endListener = listener;
  }

  isBubbleActive(id: number, now: number): boolean {
    return this.activeBubbles.some(b => b.id === id && now < b.createdAt + b.effect.duration);
  }

  /** Removal precedes notification, so downstream projectiles see the remaining time fields. */
  removeBubble(id: number, now: number, silent = false): { x: number; y: number; radius: number } | null {
    const index = this.activeBubbles.findIndex(b => b.id === id);
    if (index < 0) return null;
    const [bubble] = this.activeBubbles.splice(index, 1);
    const expiresAt = bubble.createdAt + bubble.effect.duration;
    if (!silent && bubble.charge > 0) this.pendingReleases.push(Object.freeze({
      id, ownerId: bubble.ownerId, x: bubble.x, y: bubble.y, radius: bubble.effect.radius,
      charge: bubble.charge * portalDamageMultiplier(bubble.provenance.portalDamage),
    }));
    if (!silent) this.endListener?.(id, Math.min(now, expiresAt));
    return now < expiresAt ? { x: bubble.x, y: bubble.y, radius: bubble.effect.radius } : null;
  }
  private friendlyResolver: ((ownerId: string, subjectId: string) => boolean) | null = null;
  private prismProjectileSpawner: ((request: ProjectileSpawnRequest) => void) | null = null;

  setPrismProjectileSpawner(spawner: ((request: ProjectileSpawnRequest) => void) | null): void {
    this.prismProjectileSpawner = spawner;
  }

  setFriendlyResolver(resolver: ((ownerId: string, subjectId: string) => boolean) | null): void {
    this.friendlyResolver = resolver;
  }

  hostCreateBubble(
    ownerId: string,
    x: number,
    y: number,
    effect: TimeBubbleEffectConfig,
    now = Date.now(),
    provenance?: ProjectileProvenance,
  ): number {
    const id = TimeBubbleSystem.nextId++;
    this.activeBubbles.push({
      id,
      ownerId,
      provenance: provenance ? structuredClone(provenance) : createSingleOwnerProvenance(ownerId, {
        weaponSourceId: 'TIME_BUBBLE', sourceSlot: 'utility',
      }),
      x,
      y,
      effect: structuredClone(effect),
      createdAt: now,
      nextShotIndex: 0,
      charge: 0,
      chargedProjectiles: new Set(),
    });
    return id;
  }

  hostUpdate(now: number): SyncedTimeBubble[] {
    const synced: SyncedTimeBubble[] = [];

    // Expiry membership is fixed before any discharge can charge a still-active neighbour.
    for (const bubble of [...this.activeBubbles]) {
      if (now >= bubble.createdAt + bubble.effect.duration) this.removeBubble(bubble.id, now);
    }
    this.flushReleases(now);

    for (let index = this.activeBubbles.length - 1; index >= 0; index--) {
      const bubble = this.activeBubbles[index];
      const elapsed = now - bubble.createdAt;

      this.emitPrismShots(bubble, elapsed);
      synced.push({
        id: bubble.id,
        ownerId: bubble.ownerId,
        x: Math.round(bubble.x),
        y: Math.round(bubble.y),
        radius: bubble.effect.radius,
        alpha: this.computeAlpha(elapsed, bubble.effect.duration),
        color: bubble.effect.color ?? 0x8edcff,
        distortion: bubble.effect.distortion ?? 0.75,
        ...(bubble.effect.prismEmitter ? { prismActive: true } : {}),
        ...((bubble.effect.chargeCapacity ?? 0) > 0 ? { charge: bubble.charge, chargeCapacity: bubble.effect.chargeCapacity } : {}),
      });
    }

    synced.sort((left, right) => left.id - right.id);
    return synced;
  }

  private emitPrismShots(bubble: ActiveTimeBubble, elapsed: number): void {
    const emitter = bubble.effect.prismEmitter;
    if (!emitter || !this.prismProjectileSpawner || elapsed < 0) return;
    const lastDueIndex = Math.floor(elapsed / emitter.intervalMs);
    // Keep the newest due angles without allowing a stalled frame to create an unbounded burst.
    const firstIndex = Math.max(bubble.nextShotIndex, lastDueIndex - MAX_CATCH_UP_SHOTS + 1);
    bubble.nextShotIndex = Math.max(bubble.nextShotIndex, lastDueIndex + 1);
    for (let index = firstIndex; index <= lastDueIndex; index++) {
      const angle = (index * emitter.intervalMs % emitter.rotationPeriodMs) / emitter.rotationPeriodMs * Math.PI * 2;
      this.prismProjectileSpawner({
        origin: { x: bubble.x, y: bubble.y, angle },
        flight: {
          speed: emitter.speed, size: emitter.size,
          lifetimeMs: emitter.rangePx / emitter.speed * 1000,
          remainingRangePx: emitter.rangePx, maxBounces: 0, isGrenade: false,
          homing: emitter.homing,
          homingExcludedCircle: {
            bubbleId: bubble.id,
            x: bubble.x, y: bubble.y, radius: bubble.effect.radius,
            expiresAt: bubble.createdAt + bubble.effect.duration,
          },
        },
        provenance: bubble.provenance,
        interaction: { directHit: {
          damage: emitter.damage, slowFraction: emitter.slowFraction, slowDurationMs: emitter.slowDurationMs,
        } },
        presentation: {
          style: 'bullet', bulletPreset: 'time_prism', color: 0xffc4e3,
          tracer: { profile: 'prismatic' }, suppressSpawnFx: true,
        },
      });
    }
  }

  getPlayerMovementFactorAt(x: number, y: number, now = Date.now(), playerId?: string): number {
    return this.getFactorAt(x, y, now, 'player', playerId);
  }

  getProjectileMovementFactorAt(x: number, y: number, now = Date.now()): number {
    return this.getFactorAt(x, y, now, 'projectile');
  }

  /** Passive regeneration only; ResourceSystem retains all pause, multiplier and cap rules. */
  getOwnerAdrenalineRegenMultiplier(ownerId: string, now: number): number {
    let multiplier = 1;
    for (const bubble of this.activeBubbles) {
      if (bubble.ownerId !== ownerId || now < bubble.createdAt || now >= bubble.createdAt + bubble.effect.duration) continue;
      multiplier += bubble.charge * (bubble.effect.resonanceRegenPerDamage ?? 0);
    }
    return multiplier;
  }

  getTrainMovementFactorAt(
    segmentX: number,
    segmentYs: readonly number[],
    segmentHeights: readonly number[],
    segmentWidth: number,
    now = Date.now(),
  ): number {
    let factor = 1;
    const halfWidth = segmentWidth / 2;

    for (let index = this.activeBubbles.length - 1; index >= 0; index--) {
      const bubble = this.activeBubbles[index];
      if (now - bubble.createdAt >= bubble.effect.duration) continue;

      const bubbleFactor = bubble.effect.trainSlowFactor;
      if (bubbleFactor >= factor) continue;

      for (let segmentIndex = 0; segmentIndex < segmentYs.length; segmentIndex++) {
        const centerY = segmentYs[segmentIndex];
        const halfHeight = segmentHeights[segmentIndex] / 2;
        if (this.circleIntersectsRect(
          bubble.x,
          bubble.y,
          bubble.effect.radius,
          segmentX - halfWidth,
          centerY - halfHeight,
          segmentWidth,
          segmentHeights[segmentIndex],
        )) {
          factor = bubbleFactor;
          break;
        }
      }
    }

    return factor;
  }

  destroyAll(): void {
    this.activeBubbles.length = 0;
    this.pendingReleases.length = 0;
  }

  private getFactorAt(
    x: number,
    y: number,
    now: number,
    kind: 'player' | 'projectile',
    subjectId?: string,
  ): number {
    let factor = 1;

    for (let index = this.activeBubbles.length - 1; index >= 0; index--) {
      const bubble = this.activeBubbles[index];
      if (now - bubble.createdAt >= bubble.effect.duration) continue;
      if (kind === 'player' && subjectId
        && (subjectId === bubble.ownerId || this.friendlyResolver?.(bubble.ownerId, subjectId))) continue;
      const dx = x - bubble.x;
      const dy = y - bubble.y;
      if (dx * dx + dy * dy > bubble.effect.radius * bubble.effect.radius) continue;
      const nextFactor = kind === 'player'
        ? bubble.effect.playerSlowFactor
        : bubble.effect.projectileSlowFactor;
      factor = Math.min(factor, nextFactor);
    }

    return factor;
  }

  private computeAlpha(elapsed: number, duration: number): number {
    if (elapsed < FADE_IN_MS) {
      return Math.max(0, Math.min(1, elapsed / FADE_IN_MS));
    }

    const fadeOutStart = Math.max(0, duration - FADE_OUT_MS);
    if (elapsed > fadeOutStart) {
      return Math.max(0, 1 - (elapsed - fadeOutStart) / Math.max(1, duration - fadeOutStart));
    }

    return 1;
  }

  private circleIntersectsRect(
    circleX: number,
    circleY: number,
    circleRadius: number,
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number,
  ): boolean {
    const closestX = Math.max(rectX, Math.min(circleX, rectX + rectWidth));
    const closestY = Math.max(rectY, Math.min(circleY, rectY + rectHeight));
    const dx = circleX - closestX;
    const dy = circleY - closestY;
    return dx * dx + dy * dy <= circleRadius * circleRadius;
  }
}
