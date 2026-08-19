import { PLAYER_SIZE } from '../../config';
import type { CombatDamageKind, ProjectileSpawnConfig } from '../../types';
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
 * Implementiert {@link WeaponFireSink} und verarbeitet Projektile, Hitscan-Strahlen und
 * Nahkampfschwünge mit virtueller Zeit und deterministischem RNG gegen ein statisches,
 * unsterbliches Ziel in Spielergröße (`PLAYER_SIZE / 2`).
 *
 * Verwendet dieselben mathematischen Hit-Resolver wie die Runtime.
 * Frei von Rendering, Audio, Netzwerk und Wandzeit.
 */
export class HeadlessSingleTargetWorld implements WeaponFireSink {
  readonly target: HeadlessTarget;
  readonly rng: () => number;

  private now = 0;
  private nextProjectileId = 1;
  private readonly activeProjectiles: HeadlessActiveProjectile[] = [];

  private readonly damageEvents: DamageEventRecord[] = [];
  private readonly resourceEvents: ResourceEventRecord[] = [];

  private totalDamage = 0;
  private hits = 0;
  private shotsFired = 0;
  private adrenalineGenerated = 0;
  private adrenalineSpent = 0;

  /** Falls true, schlägt jede Schussannahme fehl (für Tests). */
  failingSink = false;

  constructor(targetDistance: number, seed = 1) {
    this.target = {
      id: 'dummy_target',
      x: targetDistance,
      y: 0,
      radius: PLAYER_SIZE * 0.5,
    };
    this.rng = createMulberry32Prng(seed);
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

  /**
   * Führt einen Simulationsschritt für alle aktiven Projektile aus.
   * Prüft kontinuierliche Liniensegment-Kollision (Anti-Tunneling) über den gemeinsamen Resolver.
   */
  step(deltaMs: number): void {
    if (deltaMs <= 0) return;

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
        this.hits += 1;
        this.recordDamage(this.target.id, proj.damage, proj.sourceId, 'direct');
        if (proj.adrenalinGain > 0) {
          this.recordAdrenalineGain(proj.adrenalinGain, proj.sourceId);
        }
        this.activeProjectiles.splice(index, 1);
      } else if (proj.ageMs >= proj.lifetimeMs) {
        this.activeProjectiles.splice(index, 1);
      }
    }
  }

  // ── WeaponFireSink-Implementierung ─────────────────────────────────────────

  /** Spawnt ein fliegendes Projektil in der virtuellen Welt. */
  spawnProjectile(x: number, y: number, angle: number, _ownerId: string, cfg: ProjectileSpawnConfig): boolean {
    if (this.failingSink) return false;

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
    });
    return true;
  }

  /** Löst einen Hitscan-Strahl über den gemeinsamen Schnitt-Resolver auf. */
  resolveHitscan(request: HitscanShotRequest): boolean {
    if (this.failingSink) return false;

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
      this.recordDamage(this.target.id, request.damage, request.sourceId, 'direct');
      if (request.adrenalinGain > 0) {
        this.recordAdrenalineGain(request.adrenalinGain, request.sourceId);
      }
      return true;
    }
    return false;
  }

  /** Löst einen Nahkampfschlag über den gemeinsamen Bogen- und Reichweiten-Resolver auf. */
  resolveMelee(request: MeleeSwingRequest): boolean {
    if (this.failingSink) return false;

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
      this.recordDamage(this.target.id, request.damage, request.sourceId, 'direct');
      if (request.adrenalinGain > 0) {
        this.recordAdrenalineGain(request.adrenalinGain, request.sourceId);
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
  ): void {
    this.totalDamage += damage;
    this.damageEvents.push({
      timestampMs: this.now,
      targetId,
      damage,
      sourceId,
      damageKind,
      isCritical,
    });
  }

  recordAdrenalineGain(amount: number, sourceId?: string): void {
    this.adrenalineGenerated += amount;
    this.resourceEvents.push({
      timestampMs: this.now,
      action: 'gain',
      amount,
      resourceKind: 'adrenaline',
      sourceId,
    });
  }

  recordAdrenalineDrain(amount: number, sourceId?: string): void {
    this.adrenalineSpent += amount;
    this.resourceEvents.push({
      timestampMs: this.now,
      action: 'drain',
      amount,
      resourceKind: 'adrenaline',
      sourceId,
    });
  }

  // ── Metrik-Abfragen ────────────────────────────────────────────────────────

  getTotalDamage(): number {
    return this.totalDamage;
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

  getActiveProjectiles(): readonly HeadlessActiveProjectile[] {
    return this.activeProjectiles;
  }
}
