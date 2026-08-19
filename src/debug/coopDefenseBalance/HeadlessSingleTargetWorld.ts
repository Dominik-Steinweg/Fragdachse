import { PLAYER_SIZE } from '../../config';
import type { CombatDamageKind, GroundFireVisualStyle, ProjectileSpawnConfig } from '../../types';
import type {
  HitscanShotRequest,
  MeleeSwingRequest,
  WeaponFireSink,
} from '../../loadout/WeaponFireExecutor';
import {
  checkSweptCircleHit,
  checkHitscanRayCircleHit,
  checkMeleeArcHit,
} from '../../combat/rules/DirectCombatHitResolver';
import { BurnStateMachine } from '../../combat/rules/BurnStateMachine';
import {
  validateProjectileSpawnPayload,
  validateHitscanShotPayload,
  validateMeleeSwingPayload,
} from './headlessPayloadGuard';
import type { DamageEventRecord, ResourceEventRecord } from './weaponBenchmarkTypes';

/** Interner Tracking-Zustand für ein im Flug befindliches Projektil im Headless-Modus. */
export interface HeadlessActiveProjectile {
  readonly id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  readonly vx: number;
  readonly vy: number;
  readonly size: number;
  readonly damage: number;
  readonly lifetimeMs: number;
  ageMs: number;
  readonly adrenalinGain: number;
  readonly sourceId: string;
  readonly ownerId: string;
  readonly burnDurationMs?: number;
  readonly burnDamagePerTick?: number;
  readonly projectileBurnVisualStyle?: GroundFireVisualStyle;
}

/** Ein statisches, unsterbliches Dummy-Ziel in Spielergröße. */
export interface HeadlessTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Erzeugt einen deterministischen Mulberry32-Zufallsgenerator. */
export function createMulberry32Prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Headless-Simulationsumgebung für den Single-Target-Benchmark.
 *
 * Implementiert {@link WeaponFireSink} und verarbeitet Projektile, Hitscan-Strahlen,
 * Nahkampfschwünge und Brand-Ticks mit virtueller Zeit und deterministischem RNG gegen ein
 * statisches, unsterbliches Ziel in Spielergröße (`PLAYER_SIZE / 2`).
 *
 * Verwendet exaktes Sub-Step Event-Scheduling, dieselben mathematischen Resolver und dieselbe
 * Brand-State-Machine wie die Runtime. Frei von Rendering, Audio, Netzwerk und Wandzeit.
 */
export class HeadlessSingleTargetWorld implements WeaponFireSink {
  readonly target: HeadlessTarget;
  readonly rng: () => number;
  readonly burnStateMachine = new BurnStateMachine();

  private now = 0;
  private nextProjectileId = 1;
  private readonly activeProjectiles: HeadlessActiveProjectile[] = [];

  private readonly damageEvents: DamageEventRecord[] = [];
  private readonly resourceEvents: ResourceEventRecord[] = [];

  private totalDamage = 0;
  private directDamage = 0;
  private burnDamage = 0;
  private hits = 0;
  private shotsFired = 0;
  private adrenalineGenerated = 0;
  private adrenalineSpent = 0;

  /** Falls true, schlägt jede Schussannahme fehl (für Tests). */
  failingSink = false;
  readonly recordEvents: boolean;

  constructor(targetDistance: number, seed = 1, recordEvents = true) {
    this.target = {
      id: 'dummy_target',
      x: targetDistance,
      y: 0,
      radius: PLAYER_SIZE * 0.5,
    };
    this.rng = createMulberry32Prng(seed);
    this.recordEvents = recordEvents;
  }

  // ── Zeit & Simulation ───────────────────────────────────────────────────────

  /** Setzt den aktuellen virtuellen Zeitstempel. */
  setTime(now: number): void {
    this.now = now;
  }

  /** Liefert den aktuellen virtuellen Zeitstempel. */
  getTime(): number {
    return this.now;
  }

  /** Prüft, ob sich aktuell noch Projektile im Flug befinden. */
  hasActiveProjectiles(): boolean {
    return this.activeProjectiles.length > 0;
  }

  /** Prüft, ob noch laufende Kampfeffekte (Projektile oder aktive Brand-Ticks) existieren. */
  hasPendingCombatEffects(now = this.now): boolean {
    return this.hasActiveProjectiles() || this.burnStateMachine.hasAnyActiveBurns(now);
  }

  /**
   * Führt einen Simulationsschritt mit chronologischer Sub-Step-Ereignisverarbeitung aus.
   *
   * Ereignisse innerhalb des Zeitschritts [now, now + deltaMs] (Brand-Ticks, Projektiltreffer, Expiration)
   * werden strikt in ihrer zeitlichen Reihenfolge abgearbeitet. Dies stellt sicher, dass:
   * - Ein Projektiltreffer nach einem Brandtick keinen rückwirkenden Schaden für diesen Tick erhält.
   * - Ein Projektiltreffer vor einem Brandtick pünktlich an diesem Tick teilnimmt.
   * - Der Benchmark exakt invariant gegenüber der Schrittweite (stepDeltaMs = 8, 16, 25) ist.
   */
  step(deltaMs: number): void {
    if (deltaMs <= 0) return;

    const stepEndTime = this.now + deltaMs;
    const TIME_EPSILON = 1e-9;

    while (this.now < stepEndTime - TIME_EPSILON) {
      const remainingMs = stepEndTime - this.now;

      // 1. Früheste Ereignisse im Intervall [this.now, stepEndTime] suchen
      let nextEventTime = stepEndTime;

      // a) Nächster geplanter Brand-Tick
      const nextBurnTick = this.burnStateMachine.getNextBurnTickAt();
      if (nextBurnTick > this.now + TIME_EPSILON && nextBurnTick < nextEventTime) {
        nextEventTime = nextBurnTick;
      }

      // b) Früheste Projektil-Kollision oder Expiration
      interface ProjectileImpactInfo {
        readonly proj: HeadlessActiveProjectile;
        readonly impactTime: number;
        readonly isHit: boolean;
      }

      const pendingImpacts: ProjectileImpactInfo[] = [];

      for (const proj of this.activeProjectiles) {
        const destX = proj.x + proj.vx * (remainingMs / 1000);
        const destY = proj.y + proj.vy * (remainingMs / 1000);
        const collisionRadius = this.target.radius + proj.size * 0.5;

        const hit = checkSweptCircleHit(
          proj.x,
          proj.y,
          destX,
          destY,
          this.target.x,
          this.target.y,
          collisionRadius,
        );

        if (hit) {
          const stepDist = Math.hypot(destX - proj.x, destY - proj.y);
          const hitFraction = stepDist > 1e-6 ? Math.max(0, Math.min(1, hit.distance / stepDist)) : 0;
          const impactTime = this.now + hitFraction * remainingMs;

          if (impactTime < nextEventTime - TIME_EPSILON) {
            nextEventTime = impactTime;
          }
          pendingImpacts.push({ proj, impactTime, isHit: true });
        } else {
          const remainingLifetime = proj.lifetimeMs - proj.ageMs;
          if (remainingLifetime <= remainingMs) {
            const expireTime = this.now + remainingLifetime;
            if (expireTime < nextEventTime - TIME_EPSILON) {
              nextEventTime = expireTime;
            }
            pendingImpacts.push({ proj, impactTime: expireTime, isHit: false });
          }
        }
      }

      // 2. Zeit auf nextEventTime vorrücken und alle Projektile bis zu diesem Zeitpunkt bewegen
      const subDeltaMs = Math.max(0, nextEventTime - this.now);
      for (const proj of this.activeProjectiles) {
        proj.lastX = proj.x;
        proj.lastY = proj.y;
        proj.x += proj.vx * (subDeltaMs / 1000);
        proj.y += proj.vy * (subDeltaMs / 1000);
        proj.ageMs += subDeltaMs;
      }

      this.now = nextEventTime;

      // 3. Fällige Brand-Ticks bis zum aktuellen Zeitpunkt ausführen
      const dueContributions = this.burnStateMachine.advanceTo(this.now);
      for (const contribution of dueContributions) {
        this.recordDamage(
          contribution.targetId,
          contribution.damage,
          contribution.sourceId,
          'burn',
          false,
          contribution.tickAt,
        );
      }

      // 4. Projektiltreffer verarbeiten, die genau bei nextEventTime eintreffen
      for (let i = this.activeProjectiles.length - 1; i >= 0; i -= 1) {
        const proj = this.activeProjectiles[i];
        const match = pendingImpacts.find((p) => p.proj === proj);

        if (match && Math.abs(match.impactTime - nextEventTime) <= 1e-6) {
          if (match.isHit) {
            this.hits += 1;
            this.recordDamage(this.target.id, proj.damage, proj.sourceId, 'direct', false, this.now);
            if (proj.adrenalinGain > 0) {
              this.recordAdrenalineGain(proj.adrenalinGain, proj.sourceId, this.now);
            }

            if (proj.burnDurationMs && proj.burnDurationMs > 0 && proj.burnDamagePerTick && proj.burnDamagePerTick > 0) {
              this.burnStateMachine.applyHit({
                targetId: this.target.id,
                attackerId: proj.ownerId,
                durationMs: proj.burnDurationMs,
                damagePerTick: proj.burnDamagePerTick,
                sourceKey: `weapon:${proj.sourceId}`,
                sourceId: proj.sourceId,
                origin: 'generic',
                visualStyle: proj.projectileBurnVisualStyle ?? 'normal',
                now: this.now,
              });
            }
          }
          this.activeProjectiles.splice(i, 1);
        }
      }
    }

    this.now = stepEndTime;
  }

  // ── WeaponFireSink-Implementierung ─────────────────────────────────────────

  /** Spawnt ein fliegendes Projektil in der virtuellen Welt. */
  spawnProjectile(x: number, y: number, angle: number, ownerId: string, cfg: ProjectileSpawnConfig): boolean {
    if (this.failingSink) return false;

    // Zweite Sicherheitsgrenze auf empfangene Projektil-Payloads
    validateProjectileSpawnPayload(cfg);

    const vx = Math.cos(angle) * cfg.speed;
    const vy = Math.sin(angle) * cfg.speed;
    this.activeProjectiles.push({
      id: this.nextProjectileId++,
      x,
      y,
      lastX: x,
      lastY: y,
      vx,
      vy,
      size: cfg.size,
      damage: cfg.damage,
      lifetimeMs: cfg.lifetime,
      ageMs: 0,
      adrenalinGain: cfg.adrenalinGain,
      sourceId: cfg.sourceId ?? 'weapon.unknown',
      ownerId: ownerId || 'sim_player',
      burnDurationMs: cfg.burnDurationMs,
      burnDamagePerTick: cfg.burnDamagePerTick,
      projectileBurnVisualStyle: cfg.projectileBurnVisualStyle,
    });
    return true;
  }

  /** Löst einen Hitscan-Strahl über den gemeinsamen Schnitt-Resolver auf. */
  resolveHitscan(request: HitscanShotRequest): boolean {
    if (this.failingSink) return false;

    // Zweite Sicherheitsgrenze auf empfangene Hitscan-Payloads
    validateHitscanShotPayload(request);

    const hit = checkHitscanRayCircleHit(
      request.startX,
      request.startY,
      request.angle,
      request.range,
      request.traceThickness,
      this.target.x,
      this.target.y,
      this.target.radius,
    );

    if (hit) {
      this.hits += 1;
      this.recordDamage(this.target.id, request.damage, request.sourceId, 'direct', false, this.now);
      if (request.adrenalinGain > 0) {
        this.recordAdrenalineGain(request.adrenalinGain, request.sourceId, this.now);
      }

      if (request.burnOnHit && request.burnOnHit.durationMs > 0 && request.burnOnHit.damagePerTick > 0) {
        this.burnStateMachine.applyHit({
          targetId: this.target.id,
          attackerId: request.shooterId,
          durationMs: request.burnOnHit.durationMs,
          damagePerTick: request.burnOnHit.damagePerTick,
          sourceKey: `weapon:${request.sourceId}`,
          sourceId: request.sourceId,
          origin: 'generic',
          now: this.now,
        });
      }

      return true;
    }
    return false;
  }

  /** Löst einen Nahkampfschlag über den gemeinsamen Bogen- und Reichweiten-Resolver auf. */
  resolveMelee(request: MeleeSwingRequest): boolean {
    if (this.failingSink) return false;

    // Zweite Sicherheitsgrenze auf empfangene Melee-Payloads
    validateMeleeSwingPayload(request);

    const hit = checkMeleeArcHit(
      request.x,
      request.y,
      request.angle,
      request.range,
      request.arcDegrees,
      this.target.x,
      this.target.y,
      this.target.radius,
    );

    if (hit) {
      this.hits += 1;
      this.recordDamage(this.target.id, request.damage, request.sourceId, 'direct', false, this.now);

      // Treffer-Adrenalin: Basis-adrenalinGain + zusätzliches hitAdrenaline gemäß Runtime-Regel
      const totalAdrenaline = (request.adrenalinGain ?? 0) + (request.hitAdrenaline ?? 0);
      if (totalAdrenaline > 0) {
        this.recordAdrenalineGain(totalAdrenaline, request.sourceId, this.now);
      }

      if (request.burnOnHit && request.burnOnHit.durationMs > 0 && request.burnOnHit.damagePerTick > 0) {
        this.burnStateMachine.applyHit({
          targetId: this.target.id,
          attackerId: request.shooterId,
          durationMs: request.burnOnHit.durationMs,
          damagePerTick: request.burnOnHit.damagePerTick,
          sourceKey: `weapon:${request.sourceId}`,
          sourceId: request.sourceId,
          origin: 'generic',
          now: this.now,
        });
      }

      return true;
    }
    return false;
  }

  // ── Recording-Hilfsmethoden ────────────────────────────────────────────────

  recordShotFired(): void {
    this.shotsFired += 1;
  }

  recordDamage(
    targetId: string,
    damage: number,
    sourceId: string,
    damageKind: CombatDamageKind = 'direct',
    isCritical = false,
    timestampMs = this.now,
  ): void {
    this.totalDamage += damage;
    if (damageKind === 'burn') {
      this.burnDamage += damage;
    } else {
      this.directDamage += damage;
    }

    if (this.recordEvents) {
      this.damageEvents.push({
        timestampMs,
        targetId,
        damage,
        sourceId,
        damageKind,
        isCritical,
      });
    }
  }

  recordAdrenalineGain(amount: number, sourceId?: string, timestampMs = this.now): void {
    this.adrenalineGenerated += amount;
    if (this.recordEvents) {
      this.resourceEvents.push({
        timestampMs,
        action: 'gain',
        amount,
        resourceKind: 'adrenaline',
        sourceId,
      });
    }
  }

  recordAdrenalineDrain(amount: number, sourceId?: string, timestampMs = this.now): void {
    this.adrenalineSpent += amount;
    if (this.recordEvents) {
      this.resourceEvents.push({
        timestampMs,
        action: 'drain',
        amount,
        resourceKind: 'adrenaline',
        sourceId,
      });
    }
  }

  // ── Metrik-Abfragen ────────────────────────────────────────────────────────

  getTotalDamage(): number {
    return this.totalDamage;
  }

  getDirectDamage(): number {
    return this.directDamage;
  }

  getBurnDamage(): number {
    return this.burnDamage;
  }

  getHits(): number {
    return this.hits;
  }

  getShotsFired(): number {
    return this.shotsFired;
  }

  getAdrenalineGenerated(): number {
    return this.adrenalineGenerated;
  }

  getAdrenalineSpent(): number {
    return this.adrenalineSpent;
  }

  getDamageEvents(): readonly DamageEventRecord[] {
    return this.damageEvents;
  }

  getResourceEvents(): readonly ResourceEventRecord[] {
    return this.resourceEvents;
  }
}
