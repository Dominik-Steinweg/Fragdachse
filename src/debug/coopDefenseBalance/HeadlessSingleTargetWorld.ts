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
 * Verwendet dieselben mathematischen Resolver und dieselbe Brand-State-Machine wie die Runtime.
 * Frei von Rendering, Audio, Netzwerk und Wandzeit.
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
   * Führt einen Simulationsschritt für alle aktiven Projektile und Brand-Ticks aus.
   *
   * Bei Projektiltreffern wird der exakte kontinuierliche Auftreffzeitpunkt ermittelt,
   * sodass Brand-Ablaufzeiten unabhängig vom Zeitschritt (stepDeltaMs) präzise platziert werden.
   */
  step(deltaMs: number): void {
    if (deltaMs <= 0) return;

    const stepStartTime = this.now;
    const stepEndTime = this.now + deltaMs;

    // 1. Projektil-Bewegung & Kollision
    for (let index = this.activeProjectiles.length - 1; index >= 0; index -= 1) {
      const proj = this.activeProjectiles[index];
      proj.lastX = proj.x;
      proj.lastY = proj.y;
      proj.x += proj.vx * (deltaMs / 1000);
      proj.y += proj.vy * (deltaMs / 1000);
      proj.ageMs += deltaMs;

      const collisionRadius = this.target.radius + proj.size * 0.5;
      const hit = checkSweptCircleHit(
        proj.lastX,
        proj.lastY,
        proj.x,
        proj.y,
        this.target.x,
        this.target.y,
        collisionRadius,
      );

      if (hit) {
        // Kontinuierliche Auftreffzeit innerhalb des Zeitschritts ermitteln
        const stepDist = Math.hypot(proj.x - proj.lastX, proj.y - proj.lastY);
        const hitFraction = stepDist > 1e-6 ? Math.max(0, Math.min(1, hit.distance / stepDist)) : 0;
        const impactTime = stepStartTime + hitFraction * deltaMs;

        this.hits += 1;
        this.recordDamage(this.target.id, proj.damage, proj.sourceId, 'direct', false, impactTime);
        if (proj.adrenalinGain > 0) {
          this.recordAdrenalineGain(proj.adrenalinGain, proj.sourceId, impactTime);
        }

        // Brand-Treffer registrieren
        if (proj.burnDurationMs && proj.burnDurationMs > 0 && proj.burnDamagePerTick && proj.burnDamagePerTick > 0) {
          this.burnStateMachine.applyHit({
            targetId: this.target.id,
            attackerId: 'sim_player',
            durationMs: proj.burnDurationMs,
            damagePerTick: proj.burnDamagePerTick,
            sourceKey: 'weapon',
            sourceId: proj.sourceId,
            origin: 'generic',
            visualStyle: proj.projectileBurnVisualStyle ?? 'normal',
            now: impactTime,
          });
        }

        this.activeProjectiles.splice(index, 1);
      } else if (proj.ageMs >= proj.lifetimeMs) {
        this.activeProjectiles.splice(index, 1);
      }
    }

    // 2. Zeit auf Schrittende setzen & fällige Brand-Ticks ausführen
    this.now = stepEndTime;
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
  }

  // ── WeaponFireSink-Implementierung ─────────────────────────────────────────

  /** Spawnt ein fliegendes Projektil in der virtuellen Welt. */
  spawnProjectile(x: number, y: number, angle: number, _ownerId: string, cfg: ProjectileSpawnConfig): boolean {
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
          sourceKey: 'weapon',
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
      if (request.adrenalinGain > 0) {
        this.recordAdrenalineGain(request.adrenalinGain, request.sourceId, this.now);
      }

      if (request.burnOnHit && request.burnOnHit.durationMs > 0 && request.burnOnHit.damagePerTick > 0) {
        this.burnStateMachine.applyHit({
          targetId: this.target.id,
          attackerId: request.shooterId,
          durationMs: request.burnOnHit.durationMs,
          damagePerTick: request.burnOnHit.damagePerTick,
          sourceKey: 'weapon',
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
