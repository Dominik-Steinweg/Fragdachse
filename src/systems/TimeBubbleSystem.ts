import type { SyncedTimeBubble, TimeBubbleEffectConfig } from '../types';
import { createSingleOwnerProvenance, type ProjectileSpawnRequest } from '../projectile/ProjectileSpawnRequest';

const FADE_IN_MS = 220;
const FADE_OUT_MS = 300;
const MAX_CATCH_UP_SHOTS = 4;

interface ActiveTimeBubble {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  effect: TimeBubbleEffectConfig;
  createdAt: number;
  nextShotIndex: number;
}

export class TimeBubbleSystem {
  private readonly activeBubbles: ActiveTimeBubble[] = [];
  private nextId = 0;
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
  ): void {
    this.activeBubbles.push({
      id: this.nextId++,
      ownerId,
      x,
      y,
      effect: structuredClone(effect),
      createdAt: now,
      nextShotIndex: 0,
    });
  }

  hostUpdate(now: number): SyncedTimeBubble[] {
    const synced: SyncedTimeBubble[] = [];

    for (let index = this.activeBubbles.length - 1; index >= 0; index--) {
      const bubble = this.activeBubbles[index];
      const elapsed = now - bubble.createdAt;
      if (elapsed >= bubble.effect.duration) {
        this.activeBubbles.splice(index, 1);
        continue;
      }

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
        ...(bubble.effect.prismEmitter?.enabled ? { prismActive: true } : {}),
      });
    }

    synced.sort((left, right) => left.id - right.id);
    return synced;
  }

  private emitPrismShots(bubble: ActiveTimeBubble, elapsed: number): void {
    const emitter = bubble.effect.prismEmitter;
    if (!emitter?.enabled || !this.prismProjectileSpawner || elapsed < 0) return;
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
            x: bubble.x, y: bubble.y, radius: bubble.effect.radius,
            expiresAt: bubble.createdAt + bubble.effect.duration,
          },
        },
        provenance: createSingleOwnerProvenance(bubble.ownerId, {
          weaponSourceId: 'TIME_BUBBLE', sourceSlot: 'utility',
        }),
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

  getProjectileMovementFactorAt(x: number, y: number, now = Date.now(), ownerId?: string): number {
    return this.getFactorAt(x, y, now, 'projectile', ownerId);
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
      if ((bubble.effect.friendlyImmunity ?? 0) > 0 && subjectId && this.friendlyResolver?.(bubble.ownerId, subjectId)) continue;
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
