import { PLAYER_SIZE } from '../../config';
import type { CombatDamageKind, GroundFireVisualStyle } from '../../types';
import type {
  HitscanShotRequest,
  MeleeSwingRequest,
  WeaponFireSink,
} from '../../loadout/WeaponFireExecutor';
import type { ProjectileSpawnResult } from '../../projectile/ProjectileSpawnPort';
import type { ProjectileSpawnRequest } from '../../projectile/ProjectileSpawnRequest';
import { toProjectileSpawnConfig } from '../../projectile/projectileSpawnPayloadAdapter';
import { getHitscanRequestRange } from '../../loadout/WeaponFireExecutor';
import {
  checkHitscanRayCircleHit,
  checkMeleeArcHit,
} from '../../combat/rules/DirectCombatHitResolver';
import { resolveProjectileTargetImpact } from '../../combat/rules/ProjectileImpactResolver';
import { resolveChainLightning, type ChainLightningTarget } from '../../combat/rules/ChainLightningResolver';
import { BurnStateMachine } from '../../combat/rules/BurnStateMachine';
import {
  validateProjectileSpawnPayload,
  validateHitscanShotPayload,
  validateMeleeSwingPayload,
} from './headlessPayloadGuard';
import type { DamageEventRecord, ResourceEventRecord } from './weaponBenchmarkTypes';
import type { WeaponBalanceScenario } from './scenarioTypes';

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
 * Gemeinsame Headless-Simulationsumgebung fuer statische Ziel-Benchmarks.
 *
 * Implementiert {@link WeaponFireSink} und verarbeitet Projektile, Hitscan-Strahlen,
 * Nahkampfschwünge und Brand-Ticks mit virtueller Zeit und deterministischem RNG gegen ein
 * statische, unsterbliche Ziele in Spielergröße (`PLAYER_SIZE / 2`).
 *
 * Verwendet exaktes Sub-Step Event-Scheduling, dieselben mathematischen Resolver und dieselbe
 * Brand-State-Machine wie die Runtime. Frei von Rendering, Audio, Netzwerk und Wandzeit.
 */
export class HeadlessStaticTargetWorld implements WeaponFireSink {
  readonly targets: readonly HeadlessTarget[];
  /** Kompatibilitaetszugriff fuer die bisherige Single-Target-API. */
  readonly target: HeadlessTarget;
  readonly scenario: WeaponBalanceScenario;
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
  private chainDamage = 0;
  private measurementWindow: { startMs: number; endMs: number } | null = null;
  private measurementTotalDamage = 0;
  private measurementDirectDamage = 0;
  private measurementBurnDamage = 0;
  private measurementChainDamage = 0;
  private tailDamage = 0;
  private tailDirectDamage = 0;
  private tailBurnDamage = 0;
  private tailChainDamage = 0;
  private hits = 0;
  private projectileHits = 0;
  private shotsFired = 0;
  private adrenalineGenerated = 0;
  private adrenalineSpent = 0;
  private measurementShotsFired = 0;
  private measurementTargetHits = 0;
  private measurementProjectileHits = 0;
  private measurementAdrenalineGenerated = 0;
  private measurementAdrenalineSpent = 0;

  /** Falls true, schlägt jede Schussannahme fehl (für Tests). */
  failingSink = false;
  readonly recordEvents: boolean;

  constructor(
    targetsOrDistance: readonly HeadlessTarget[] | number,
    seed = 1,
    recordEvents = true,
    targetRadius = PLAYER_SIZE * 0.5,
    scenario: WeaponBalanceScenario = 'single_target_static',
  ) {
    const targets = typeof targetsOrDistance === 'number'
      ? [{
        id: 'dummy_target',
        x: targetsOrDistance,
        y: 0,
        radius: targetRadius,
      }]
      : targetsOrDistance.map((target) => ({ ...target }));
    if (targets.length === 0) {
      throw new Error('[WeaponBalanceLab] HeadlessStaticTargetWorld benoetigt mindestens ein Ziel.');
    }
    this.targets = Object.freeze(targets);
    this.target = this.targets[0];
    this.scenario = scenario;
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

  /**
   * Setzt das Messfenster als halboffenes Intervall [startMs, endMs).
   * Treffer am Start gehoeren zur Messung; Treffer exakt am Ende sind Tail-Damage.
   */
  setDamageMeasurementWindow(startMs: number, endMs: number): void {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      throw new Error('[WeaponBalanceLab] Ungueltiges Schadens-Messfenster.');
    }
    this.measurementWindow = { startMs, endMs };
    this.measurementTotalDamage = 0;
    this.measurementDirectDamage = 0;
    this.measurementBurnDamage = 0;
    this.measurementChainDamage = 0;
    this.tailDamage = 0;
    this.tailDirectDamage = 0;
    this.tailBurnDamage = 0;
    this.tailChainDamage = 0;
    this.measurementShotsFired = 0;
    this.measurementTargetHits = 0;
    this.measurementProjectileHits = 0;
    this.measurementAdrenalineGenerated = 0;
    this.measurementAdrenalineSpent = 0;
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
        readonly target?: HeadlessTarget;
      }

      const pendingImpactByProjectile = new Map<HeadlessActiveProjectile, ProjectileImpactInfo>();

      for (const proj of this.activeProjectiles) {
        const remainingLifetime = Math.max(0, proj.lifetimeMs - proj.ageMs);
        // Die Lebensdauer ist ein harter Suchhorizont. Ein Treffer hinter dem Ablaufzeitpunkt
        // darf nicht mehr aus einem Sweep bis zum Step-Ende rekonstruiert werden.
        const searchDurationMs = Math.min(remainingMs, remainingLifetime);
        const destX = proj.x + proj.vx * (searchDurationMs / 1000);
        const destY = proj.y + proj.vy * (searchDurationMs / 1000);
        const collisionRadiusOffset = proj.size * 0.5;
        let bestHit: { readonly target: HeadlessTarget; readonly distance: number } | undefined;

        if (searchDurationMs > TIME_EPSILON) {
          const singleTarget = this.targets.length === 1 ? this.targets[0] : undefined;
          if (singleTarget) {
            const hit = resolveProjectileTargetImpact({
              startX: proj.x,
              startY: proj.y,
              endX: destX,
              endY: destY,
              targetX: singleTarget.x,
              targetY: singleTarget.y,
              radius: singleTarget.radius + collisionRadiusOffset,
            });
            if (hit) {
              bestHit = { target: singleTarget, distance: hit.distance };
            }
          } else {
            for (const target of this.targets) {
              const hit = resolveProjectileTargetImpact({
                startX: proj.x,
                startY: proj.y,
                endX: destX,
                endY: destY,
                targetX: target.x,
                targetY: target.y,
                radius: target.radius + collisionRadiusOffset,
              });
              if (!hit) continue;
              if (
                !bestHit
                || hit.distance < bestHit.distance - TIME_EPSILON
                || (Math.abs(hit.distance - bestHit.distance) <= TIME_EPSILON
                  && target.id.localeCompare(bestHit.target.id) < 0)
              ) {
                bestHit = { target, distance: hit.distance };
              }
            }
          }
        }

        const expireTime = this.now + remainingLifetime;
        if (bestHit) {
          const stepDist = Math.hypot(destX - proj.x, destY - proj.y);
          const hitFraction = stepDist > 1e-6
            ? Math.max(0, Math.min(1, bestHit.distance / stepDist))
            : 0;
          const impactTime = this.now + hitFraction * searchDurationMs;
          const expiresAtImpact = remainingLifetime <= remainingMs + TIME_EPSILON
            && Math.abs(impactTime - expireTime) <= TIME_EPSILON;

          // Projectile lifetime uses a half-open validity interval [spawn, expire): at an exact
          // impact/expiration tie expiration wins deterministically.
          if (!expiresAtImpact && impactTime < expireTime - TIME_EPSILON) {
            if (impactTime < nextEventTime - TIME_EPSILON) {
              nextEventTime = impactTime;
            }
            // Keep candidates at the current earliest event as well. This preserves simultaneous
            // projectile hits (and hits coincident with burn ticks) instead of dropping them when
            // another event selected nextEventTime first.
            const impactInfo = {
              proj,
              impactTime,
              isHit: true,
              target: bestHit.target,
            } satisfies ProjectileImpactInfo;
            pendingImpactByProjectile.set(proj, impactInfo);
            continue;
          }
        }

        if (remainingLifetime <= remainingMs + TIME_EPSILON) {
          if (expireTime < nextEventTime - TIME_EPSILON) {
            nextEventTime = expireTime;
          }
          const expirationInfo = { proj, impactTime: expireTime, isHit: false } satisfies ProjectileImpactInfo;
          pendingImpactByProjectile.set(proj, expirationInfo);
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
        const match = pendingImpactByProjectile.get(proj);

        if (match && Math.abs(match.impactTime - nextEventTime) <= 1e-6) {
          if (match.isHit && match.target) {
            this.recordHit('projectile', this.now);
            this.recordDamage(match.target.id, proj.damage, proj.sourceId, 'direct', false, this.now);
            if (proj.adrenalinGain > 0) {
              this.recordAdrenalineGain(proj.adrenalinGain, proj.sourceId, this.now);
            }

            if (proj.burnDurationMs && proj.burnDurationMs > 0 && proj.burnDamagePerTick && proj.burnDamagePerTick > 0) {
              this.burnStateMachine.applyHit({
                targetId: match.target.id,
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
  spawnProjectile(request: ProjectileSpawnRequest): ProjectileSpawnResult {
    if (this.failingSink) return null;

    const { x, y, angle } = request.origin;
    const ownerId = request.provenance.attributionId;
    // Der Benchmark prüft die aufgelöste Payload weiterhin in ihrer Wirkungsform.
    const cfg = toProjectileSpawnConfig(request);

    // Zweite Sicherheitsgrenze auf empfangene Projektil-Payloads
    validateProjectileSpawnPayload(cfg, this.scenario);

    const vx = Math.cos(angle) * cfg.speed;
    const vy = Math.sin(angle) * cfg.speed;
    const id = this.nextProjectileId++;
    this.activeProjectiles.push({
      id,
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
    return id;
  }

  /** Löst einen Hitscan-Strahl über den gemeinsamen Schnitt-Resolver auf. */
  resolveHitscan(request: HitscanShotRequest): boolean {
    if (this.failingSink) return false;

    // Zweite Sicherheitsgrenze auf empfangene Hitscan-Payloads
    validateHitscanShotPayload(request, this.scenario);
    const range = getHitscanRequestRange(request, request.startX, request.startY, request.angle);

    let bestHit: { readonly target: HeadlessTarget; readonly distance: number; readonly x: number; readonly y: number } | undefined;
    for (const target of this.targets) {
      const hit = checkHitscanRayCircleHit(
        request.startX,
        request.startY,
        request.angle,
        range,
        request.traceThickness,
        target.x,
        target.y,
        target.radius,
      );
      if (!hit) continue;
      if (
        !bestHit
        || hit.distance < bestHit.distance - 1e-9
        || (Math.abs(hit.distance - bestHit.distance) <= 1e-9
          && target.id.localeCompare(bestHit.target.id) < 0)
      ) {
        bestHit = { target, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }

    if (bestHit) {
      this.recordHit('hitscan', this.now);
      this.recordDamage(bestHit.target.id, request.damage, request.sourceId, 'direct', false, this.now);
      if (request.adrenalinGain > 0) {
        this.recordAdrenalineGain(request.adrenalinGain, request.sourceId, this.now);
      }

      if (request.burnOnHit && request.burnOnHit.durationMs > 0 && request.burnOnHit.damagePerTick > 0) {
        this.burnStateMachine.applyHit({
          targetId: bestHit.target.id,
          attackerId: request.shooterId,
          durationMs: request.burnOnHit.durationMs,
          damagePerTick: request.burnOnHit.damagePerTick,
          sourceKey: `weapon:${request.sourceId}`,
          sourceId: request.sourceId,
          origin: 'generic',
          now: this.now,
        });
      }

      if (request.chainLightning && request.chainLightning.maxJumps > 0) {
        const chainKind = request.chainLightning.targetEnemies
          ? 'enemy'
          : request.chainLightning.targetPlayers
            ? 'player'
            : null;
        const chainTargets: readonly ChainLightningTarget[] = chainKind
          ? this.targets.map((target) => ({
            id: target.id,
            kind: chainKind,
            x: target.x,
            y: target.y,
          }))
          : [];
        resolveChainLightning({
          originX: bestHit.x,
          originY: bestHit.y,
          baseDamage: request.damage,
          config: request.chainLightning,
          visitedTargetIds: new Set([bestHit.target.id]),
          getCandidates: () => chainTargets,
          // Das kanonische statische 5T-Szenario besitzt keine LoS-Blocker.
          hasLineOfSight: () => true,
          onJump: (jump) => {
            this.recordDamage(jump.target.id, jump.damage, request.sourceId, 'chain', false, this.now);
            // Runtime-Regel: Chain-Treffer vergüten denselben Adrenalin-Gewinn pro
            // tatsächlich getroffenen Enemy/Player; Decoys/Detonables sind hier nicht modelliert.
            if (request.adrenalinGain > 0) {
              this.recordAdrenalineGain(request.adrenalinGain, request.sourceId, this.now);
            }
          },
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
    validateMeleeSwingPayload(request, this.scenario);

    let didHit = false;
    for (const target of this.targets) {
      const hit = checkMeleeArcHit(
        request.x,
        request.y,
        request.angle,
        request.range,
        request.arcDegrees,
        target.x,
        target.y,
        target.radius,
      );
      if (!hit) continue;

      didHit = true;
      this.recordHit('melee', this.now);
      this.recordDamage(target.id, request.damage, request.sourceId, 'direct', false, this.now);

      // Runtime-Regel: Basis-Adrenalin und hitAdrenaline werden pro getroffenem Ziel vergeben.
      const totalAdrenaline = (request.adrenalinGain ?? 0) + (request.hitAdrenaline ?? 0);
      if (totalAdrenaline > 0) {
        this.recordAdrenalineGain(totalAdrenaline, request.sourceId, this.now);
      }

      if (request.burnOnHit && request.burnOnHit.durationMs > 0 && request.burnOnHit.damagePerTick > 0) {
        this.burnStateMachine.applyHit({
          targetId: target.id,
          attackerId: request.shooterId,
          durationMs: request.burnOnHit.durationMs,
          damagePerTick: request.burnOnHit.damagePerTick,
          sourceKey: `weapon:${request.sourceId}`,
          sourceId: request.sourceId,
          origin: 'generic',
          now: this.now,
        });
      }
    }
    return didHit;
  }

  // ── Recording-Hilfsmethoden ────────────────────────────────────────────────

  private isMeasurementTimestamp(timestampMs: number): boolean {
    return !this.measurementWindow
      || (
        timestampMs >= this.measurementWindow.startMs
        && timestampMs < this.measurementWindow.endMs
      );
  }

  private recordHit(kind: 'projectile' | 'hitscan' | 'melee', timestampMs: number): void {
    this.hits += 1;
    if (kind === 'projectile') this.projectileHits += 1;
    if (!this.isMeasurementTimestamp(timestampMs)) return;
    this.measurementTargetHits += 1;
    if (kind === 'projectile') this.measurementProjectileHits += 1;
  }

  recordShotFired(timestampMs = this.now): void {
    this.shotsFired += 1;
    if (this.isMeasurementTimestamp(timestampMs)) this.measurementShotsFired += 1;
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
    } else if (damageKind === 'chain') {
      this.chainDamage += damage;
    } else {
      this.directDamage += damage;
    }

    if (!this.measurementWindow) {
      // Direkte World-Tests ohne Benchmark-Fenster behalten ihre bisherige Semantik.
      this.measurementTotalDamage += damage;
      if (damageKind === 'burn') this.measurementBurnDamage += damage;
      else if (damageKind === 'chain') this.measurementChainDamage += damage;
      else this.measurementDirectDamage += damage;
    } else if (
      timestampMs >= this.measurementWindow.startMs
      && timestampMs < this.measurementWindow.endMs
    ) {
      this.measurementTotalDamage += damage;
      if (damageKind === 'burn') this.measurementBurnDamage += damage;
      else if (damageKind === 'chain') this.measurementChainDamage += damage;
      else this.measurementDirectDamage += damage;
    } else {
      this.tailDamage += damage;
      if (damageKind === 'burn') this.tailBurnDamage += damage;
      else if (damageKind === 'chain') this.tailChainDamage += damage;
      else this.tailDirectDamage += damage;
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
    if (this.isMeasurementTimestamp(timestampMs)) this.measurementAdrenalineGenerated += amount;
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
    if (this.isMeasurementTimestamp(timestampMs)) this.measurementAdrenalineSpent += amount;
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

  getChainDamage(): number {
    return this.chainDamage;
  }

  /** Schaden innerhalb des konfigurierten Measurement Windows. */
  getMeasurementTotalDamage(): number {
    return this.measurementTotalDamage;
  }

  getMeasurementDirectDamage(): number {
    return this.measurementDirectDamage;
  }

  getMeasurementBurnDamage(): number {
    return this.measurementBurnDamage;
  }

  getMeasurementChainDamage(): number {
    return this.measurementChainDamage;
  }

  /** Schaden ausserhalb des Measurement Windows (Warmup-/Settle-Tail). */
  getTailDamage(): number {
    return this.tailDamage;
  }

  getTailDirectDamage(): number {
    return this.tailDirectDamage;
  }

  getTailBurnDamage(): number {
    return this.tailBurnDamage;
  }

  getTailChainDamage(): number {
    return this.tailChainDamage;
  }

  getHits(): number {
    return this.hits;
  }

  getProjectileHits(): number {
    return this.projectileHits;
  }

  getShotsFired(): number {
    return this.shotsFired;
  }

  getMeasurementShotsFired(): number {
    return this.measurementShotsFired;
  }

  getMeasurementTargetHits(): number {
    return this.measurementTargetHits;
  }

  getMeasurementProjectileHits(): number {
    return this.measurementProjectileHits;
  }

  getAdrenalineGenerated(): number {
    return this.adrenalineGenerated;
  }

  getMeasurementAdrenalineGenerated(): number {
    return this.measurementAdrenalineGenerated;
  }

  getAdrenalineSpent(): number {
    return this.adrenalineSpent;
  }

  getMeasurementAdrenalineSpent(): number {
    return this.measurementAdrenalineSpent;
  }

  getDamageEvents(): readonly DamageEventRecord[] {
    return this.damageEvents;
  }

  getResourceEvents(): readonly ResourceEventRecord[] {
    return this.resourceEvents;
  }
}
