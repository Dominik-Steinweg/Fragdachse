import * as Phaser from 'phaser';
import { PLAYER_SIZE } from '../../config';
import type { ProjectileSpawnConfig } from '../../types';
import type {
  HitscanShotRequest,
  MeleeSwingRequest,
  WeaponFireSink,
} from '../../loadout/WeaponFireExecutor';
import { CombatGeometry } from '../../systems/CombatGeometry';
import { findNearestCircleHit } from '../../utils/geometry';
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

  // Wiederverwendbare Scratch-Objekte für geometrische Schnittprüfungen
  private readonly scratchLine = new Phaser.Geom.Line();
  private readonly scratchCircle = new Phaser.Geom.Circle();
  private readonly scratchPoints: Phaser.Math.Vector2[] = [];

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

  /**
   * Führt einen Simulationsschritt für alle aktiven Projektile aus.
   * Prüft kontinuierliche Liniensegment-Kollision (Anti-Tunneling) gegen das Ziel.
   */
  step(deltaMs: number): void {
    for (let index = this.activeProjectiles.length - 1; index >= 0; index -= 1) {
      const proj = this.activeProjectiles[index];
      proj.lastX = proj.x;
      proj.lastY = proj.y;
      proj.x += proj.vx * (deltaMs / 1000);
      proj.y += proj.vy * (deltaMs / 1000);
      proj.ageMs += deltaMs;

      const sweptLine = this.scratchLine.setTo(proj.lastX, proj.lastY, proj.x, proj.y);
      const collisionRadius = this.target.radius + proj.size * 0.5;
      const inside = Math.hypot(this.target.x - sweptLine.x1, this.target.y - sweptLine.y1) <= collisionRadius;
      const hit = inside
        ? { distance: 0, x: sweptLine.x1, y: sweptLine.y1 }
        : findNearestCircleHit(
            sweptLine,
            this.target.x,
            this.target.y,
            collisionRadius,
            this.scratchCircle,
            this.scratchPoints,
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
  spawnProjectile(x: number, y: number, angle: number, ownerId: string, cfg: ProjectileSpawnConfig): void {
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
  }

  /** Löst einen Hitscan-Strahl über Geometrie-Schnittprüfung gegen das Ziel auf. */
  resolveHitscan(request: HitscanShotRequest): boolean {
    const dirX = Math.cos(request.angle);
    const dirY = Math.sin(request.angle);
    const endX = request.startX + dirX * request.range;
    const endY = request.startY + dirY * request.range;
    const line = this.scratchLine.setTo(request.startX, request.startY, endX, endY);

    const collisionRadius = this.target.radius + request.traceThickness * 0.5;
    const inside = Math.hypot(this.target.x - line.x1, this.target.y - line.y1) <= collisionRadius;
    const hit = inside
      ? { distance: 0, x: line.x1, y: line.y1 }
      : findNearestCircleHit(
          line,
          this.target.x,
          this.target.y,
          collisionRadius,
          this.scratchCircle,
          this.scratchPoints,
        );

    if (hit && hit.distance <= request.range) {
      this.hits += 1;
      this.recordDamage(this.target.id, request.damage, request.sourceId, 'direct');
      if (request.adrenalinGain > 0) {
        this.recordAdrenalineGain(request.adrenalinGain, request.sourceId);
      }
      return true;
    }
    return false;
  }

  /** Löst einen Nahkampfschlag über Bogen- und Reichweitenprüfung gegen das Ziel auf. */
  resolveMelee(request: MeleeSwingRequest): boolean {
    const halfArcRad = (request.arcDegrees * Math.PI / 180) / 2;
    const dx = this.target.x - request.x;
    const dy = this.target.y - request.y;
    const distance = Math.hypot(dx, dy);

    if (distance > request.range + this.target.radius) {
      return false;
    }
    if (!CombatGeometry.isWithinArc(dx, dy, request.angle, halfArcRad)) {
      return false;
    }

    this.hits += 1;
    this.recordDamage(this.target.id, request.damage, request.sourceId, 'direct');
    if (request.adrenalinGain > 0) {
      this.recordAdrenalineGain(request.adrenalinGain, request.sourceId);
    }
    return true;
  }

  // ── Recording-Hilfsmethoden ────────────────────────────────────────────────

  recordShotFired(): void {
    this.shotsFired += 1;
  }

  recordDamage(
    targetId: string,
    damage: number,
    sourceId: string,
    damageKind: 'direct' | 'burn' | 'chain' | 'radial' | 'reflected' = 'direct',
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
