import type { ProjectileRuntimeRecord } from '../types';
import { resolveProjectileTargetImpact } from '../combat/rules/ProjectileImpactResolver';
import { shouldIgnorePlasmaSwarmOriginHit } from '../systems/PlasmaCharge';
import type { ProjectileId } from './ProjectileSpawnPort';
import type {
  ProjectileContactMode,
  ProjectileDefenseResolution,
} from './ProjectileInteractionPorts';
import type {
  ProjectileCombatPort,
  ProjectileCombatTargetRef,
  ProjectileDirectImpactOutcome,
  ProjectileDirectImpactRequest,
  ProjectileEnergyInjectorAugment,
} from './ProjectileCombatPort';
import {
  projectileExclusionKey,
  projectileTargetPhysicalKey,
  projectileTargetKey,
  type ProjectileCollisionTargetQueryPort,
  type ProjectileCollisionTargetKind,
  type ProjectileImpactCandidate,
  type ProjectileTargetRef,
  type ProjectileTargetabilityPort,
  type ProjectileWorldBlockerPort,
} from './ProjectileTargetPort';
import { PROJECTILE_STAGE_SPAWN_CONTRACT } from './ProjectileStageContract';

/** Zieltypen, die über die Collision-Kandidatenerzeugung laufen. */
type CollisionTargetKind = ProjectileCollisionTargetKind;

/** Gepoolter Slot der Frame-Zielsicht; die Runtime hält keine fremden Entity-Objekte. */
interface CollisionTargetSlot {
  kind: CollisionTargetKind;
  id: string;
  numericId: number;
  /** Entität, deren Beziehung über Selbsttreffer entscheidet (Decoy: sein Besitzer). */
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  obstacleKind?: import('../types').PlaceableKind;
  ref: ProjectileTargetRef;
}

interface SweepCandidate {
  slot: CollisionTargetSlot;
  x: number;
  y: number;
  distance: number;
}

/** Was der Owner für die Kandidatenverarbeitung bereitstellt. */
export interface ProjectileCollisionDependencies {
  readonly targetQuery: ProjectileCollisionTargetQueryPort | null;
  readonly targetability: ProjectileTargetabilityPort | null;
  readonly worldBlocker: ProjectileWorldBlockerPort | null;
  readonly directImpact: ProjectileCombatPort | null;
  /** Entfernt ein verbrauchtes Projectile über den Owner. */
  destroyProjectile(id: ProjectileId): void;
  /** Wendet eine target-lokale Defense an (Absorption oder Reflexion). */
  applyDefense(
    record: ProjectileRuntimeRecord,
    defense: ProjectileDefenseResolution,
    candidate: ProjectileImpactCandidate,
  ): void;
  /** Resolves the terminal projectile lifecycle after Combat accepted the direct effect. */
  completeDirectImpact?(
    record: ProjectileRuntimeRecord,
    target: ProjectileCombatTargetRef,
    impact: { readonly x: number; readonly y: number },
    outcome: ProjectileDirectImpactOutcome,
  ): boolean;
}

type CandidateOutcome = 'ignored' | 'passed' | 'consumed';

/** Unterhalb dieser Streckenlänge bleibt es beim Overlap-Test. */
const MIN_SWEEP_TRAVEL_PX = 0.5;

/**
 * Erzeugt und verarbeitet Trefferkandidaten eines Host-Frames.
 *
 * Der Processor besitzt Iteration, Geometrie, Reihenfolge, Kontaktgedächtnis und Verbrauch. Die
 * fachliche Wirkung eines Kandidaten bleibt hinter dem Direct-Impact-Port; Ziele, Beziehung und
 * Weltblocker kommen ausschließlich über schmale Reads herein.
 *
 * **Stage-Contract:** In dieser Stage neu entstehende Projectiles (Reflexion, Deflexion) werden
 * bewusst noch in derselben Stage verarbeitet – die Aktivmenge wird absichtlich live iteriert.
 */
export class ProjectileCollisionProcessor {
  private readonly targetPool: CollisionTargetSlot[] = [];
  private readonly targetSlotsByPhysicalKey = new Map<string, CollisionTargetSlot>();
  private readonly projectileTargetRecords: ProjectileRuntimeRecord[] = [];
  private readonly overlapCandidates: CollisionTargetSlot[] = [];
  private readonly sweepCandidates: SweepCandidate[] = [];
  private targetCount = 0;

  private readonly emitTarget = (
    kind: CollisionTargetKind,
    id: string | number,
    ownerId: string,
    x: number,
    y: number,
    radius: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    obstacleKind?: import('../types').PlaceableKind,
  ): void => {
    const requestedRef = createTargetRef(kind, id, obstacleKind);
    const physicalKey = projectileTargetPhysicalKey(requestedRef);
    let slot = this.targetSlotsByPhysicalKey.get(physicalKey);
    if (!slot) {
      slot = this.acquireSlot(requestedRef);
      this.targetSlotsByPhysicalKey.set(physicalKey, slot);
      this.targetCount += 1;
    } else if (targetKindRank(requestedRef.kind) < targetKindRank(slot.kind)) {
      // A shared runtime rock is canonical even if a construction adapter reported it first.
      this.replaceSlotRef(slot, requestedRef);
    }
    slot.ownerId = ownerId;
    slot.x = x;
    slot.y = y;
    slot.radius = radius;
    slot.left = left;
    slot.top = top;
    slot.right = right;
    slot.bottom = bottom;
    slot.obstacleKind = obstacleKind;
  };

  /** Verarbeitet alle wirksamen Projectiles dieses Frames gegen die aktuelle Zielsicht. */
  run(
    records: Iterable<ProjectileRuntimeRecord>,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    if (!deps.targetQuery) return;
    this.projectileTargetRecords.length = 0;
    for (const record of records) {
      if (!record.pendingDestroy && record.sprite.active !== false) {
        this.projectileTargetRecords.push(record);
      }
    }
    this.readTargets(deps.targetQuery);
    for (const record of this.projectileTargetRecords) this.emitProjectileTarget(record);
    this.sortTargetsDeterministically();
    if (this.targetCount === 0) return;

    // The live collection is intentional only because the named stage contract preserves the
    // existing Plasma Swarm same-frame outcome. Split/child creation uses the next-stage policy.
    const recordsForInteraction = PROJECTILE_STAGE_SPAWN_CONTRACT.collisionInteractionSpawns === 'same-stage'
      ? records
      : this.projectileTargetRecords;
    for (const record of recordsForInteraction) {
      if (record.pendingDestroy) continue;
      // Granaten wirken nur über ihre terminale Payload, nicht über Direkttreffer.
      if (record.isGrenade) continue;
      if (record.miniRocketDeferredExplosion || record.miniRocketSpent) continue;
      this.processRecord(record, nowMs, deps);
    }
  }

  /** Gibt die gepoolte Frame-Sicht frei. */
  reset(): void {
    this.targetPool.length = 0;
    this.targetSlotsByPhysicalKey.clear();
    this.projectileTargetRecords.length = 0;
    this.overlapCandidates.length = 0;
    this.sweepCandidates.length = 0;
    this.targetCount = 0;
  }

  private readTargets(port: ProjectileCollisionTargetQueryPort): void {
    this.targetCount = 0;
    this.targetSlotsByPhysicalKey.clear();
    port.readCollisionTargets(this.emitTarget);
  }

  private acquireSlot(ref: ProjectileTargetRef): CollisionTargetSlot {
    const kind = ref.kind;
    let slot = this.targetPool[this.targetCount];
    if (!slot || slot.kind !== kind) {
      slot = {
        kind,
        id: '',
        numericId: 0,
        ownerId: '',
        x: 0,
        y: 0,
        radius: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        ref,
      };
      this.targetPool[this.targetCount] = slot;
    }
    this.replaceSlotRef(slot, ref);
    return slot;
  }

  private replaceSlotRef(slot: CollisionTargetSlot, ref: ProjectileTargetRef): void {
    slot.kind = ref.kind;
    slot.ref = ref;
    slot.id = String(ref.id);
    slot.numericId = Number(ref.id);
    slot.obstacleKind = ref.kind === 'rock' ? ref.obstacleKind : undefined;
  }

  private emitProjectileTarget(record: ProjectileRuntimeRecord): void {
    const bounds = record.sprite.getBounds();
    this.emitTarget(
      'projectile',
      record.id,
      record.provenance.allegiance.ownerId,
      record.sprite.x,
      record.sprite.y,
      Math.max(record.sprite.displayWidth, record.sprite.displayHeight) * 0.5,
      bounds.left,
      bounds.top,
      bounds.right,
      bounds.bottom,
    );
  }

  private sortTargetsDeterministically(): void {
    // The provider order is an implementation detail. Stable key order makes overlap and all
    // equal-distance sweep ties deterministic even when an adapter enumerates in another order.
    for (let index = 1; index < this.targetCount; index += 1) {
      const current = this.targetPool[index];
      let insertAt = index - 1;
      while (insertAt >= 0 && projectileTargetKey(this.targetPool[insertAt].ref) > projectileTargetKey(current.ref)) {
        this.targetPool[insertAt + 1] = this.targetPool[insertAt];
        insertAt -= 1;
      }
      this.targetPool[insertAt + 1] = current;
    }
  }

  private processRecord(
    record: ProjectileRuntimeRecord,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    const mode = record.collisionMode ?? 'overlap';
    if (mode === 'none' || mode === 'physics') return;
    if (mode === 'sweep') {
      const travelX = record.sprite.x - record.lastX;
      const travelY = record.sprite.y - record.lastY;
      if (Math.hypot(travelX, travelY) > MIN_SWEEP_TRAVEL_PX) {
        // Ein Sweep-Frame verarbeitet alle zulässigen Kandidaten entlang des Segments; ein
        // nicht-penetrativer Kontakt beendet ihn im Ergebnis, statt auf Overlap zurückzufallen.
        this.processSweep(record, nowMs, deps);
        return;
      }
    }
    this.processOverlap(record, nowMs, deps);
  }

  private processSweep(
    record: ProjectileRuntimeRecord,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    const startX = record.lastX;
    const startY = record.lastY;
    const endX = record.sprite.x;
    const endY = record.sprite.y;
    const blockerDistance = deps.worldBlocker?.getNearestBlockerDistance(
      startX,
      startY,
      endX,
      endY,
      record.penetratesRocks === true,
    ) ?? null;
    const projectileRadius = Math.max(record.sprite.displayWidth, record.sprite.displayHeight) * 0.5;

    this.sweepCandidates.length = 0;
    for (let index = 0; index < this.targetCount; index += 1) {
      const slot = this.targetPool[index];
      if (!this.isCandidateAllowed(record, slot, deps)) continue;
      const hit = resolveProjectileTargetImpact({
        startX,
        startY,
        endX,
        endY,
        targetX: slot.x,
        targetY: slot.y,
        radius: slot.radius + projectileRadius,
        ignoreStartingOverlap: true,
      });
      if (!hit) continue;
      // Ein näherer Weltblocker verhindert den Treffer, gleiche Distanz bleibt durch die
      // kanonische Zielreihenfolge definiert.
      if (blockerDistance !== null && blockerDistance < hit.distance - 0.000001) continue;
      this.sweepCandidates.push({ slot, x: hit.x, y: hit.y, distance: hit.distance });
    }
    this.sortSweepCandidates();
    for (const candidate of this.sweepCandidates) {
      if (!this.isCandidateAllowed(record, candidate.slot, deps)) continue;
      // Das Projectile steht für jede Auflösung am tatsächlichen Trefferpunkt. Bei Penetration
      // läuft die Kandidatenliste weiter; ein normaler Treffer beendet sie im applyCandidate.
      const velocityX = record.body.velocity.x;
      const velocityY = record.body.velocity.y;
      record.body.reset(candidate.x, candidate.y);
      record.body.setVelocity(velocityX, velocityY);
      const outcome = this.applyCandidate(
        record,
        {
          projectileId: record.id,
          target: candidate.slot.ref,
          x: candidate.x,
          y: candidate.y,
          distanceAlongTravel: candidate.distance,
          source: 'sweep',
        },
        nowMs,
        deps,
      );
      if (outcome === 'consumed') return;
    }
  }

  private sortSweepCandidates(): void {
    for (let index = 1; index < this.sweepCandidates.length; index += 1) {
      const current = this.sweepCandidates[index];
      let insertAt = index - 1;
      while (insertAt >= 0) {
        const previous = this.sweepCandidates[insertAt];
        if (previous.distance < current.distance - 0.000001
          || (Math.abs(previous.distance - current.distance) <= 0.000001
            && projectileTargetKey(previous.slot.ref) <= projectileTargetKey(current.slot.ref))) break;
        this.sweepCandidates[insertAt + 1] = previous;
        insertAt -= 1;
      }
      this.sweepCandidates[insertAt + 1] = current;
    }
  }

  private processOverlap(
    record: ProjectileRuntimeRecord,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    const bounds = record.sprite.getBounds();
    this.overlapCandidates.length = 0;
    for (let index = 0; index < this.targetCount; index += 1) {
      const slot = this.targetPool[index];
      if (!this.isCandidateAllowed(record, slot, deps, bounds)) continue;
      if (!overlaps(bounds, slot)) continue;
      this.overlapCandidates.push(slot);
    }
    this.sortOverlapCandidates(record);
    for (const slot of this.overlapCandidates) {
      if (!this.isCandidateAllowed(record, slot, deps, bounds)) continue;
      const outcome = this.applyCandidate(
        record,
        {
          projectileId: record.id,
          target: slot.ref,
          x: record.sprite.x,
          y: record.sprite.y,
          distanceAlongTravel: overlapDistanceAlongTravel(record, slot),
          source: 'overlap',
        },
        nowMs,
        deps,
      );
      if (outcome === 'consumed') return;
    }
  }

  private sortOverlapCandidates(record: ProjectileRuntimeRecord): void {
    for (let index = 1; index < this.overlapCandidates.length; index += 1) {
      const current = this.overlapCandidates[index];
      const currentDistance = overlapDistanceAlongTravel(record, current);
      let insertAt = index - 1;
      while (insertAt >= 0) {
        const previous = this.overlapCandidates[insertAt];
        const previousDistance = overlapDistanceAlongTravel(record, previous);
        if (previousDistance < currentDistance - 0.000001
          || (Math.abs(previousDistance - currentDistance) <= 0.000001
            && projectileTargetKey(previous.ref) <= projectileTargetKey(current.ref))) break;
        this.overlapCandidates[insertAt + 1] = previous;
        insertAt -= 1;
      }
      this.overlapCandidates[insertAt + 1] = current;
    }
  }

  /**
   * Fachliche Zulässigkeit eines Ziels: Selbsttreffer, laufender Explosionsausschluss,
   * Kontaktgedächtnis, Schwarmursprung und Beziehung.
   */
  private isCandidateAllowed(
    record: ProjectileRuntimeRecord,
    slot: CollisionTargetSlot,
    deps: ProjectileCollisionDependencies,
    overlapBounds?: { left: number; right: number; top: number; bottom: number },
  ): boolean {
    if (record.provenance.allegiance.ownerId === slot.ownerId) return false;

    if (slot.kind === 'rock'
      && record.penetratesRocks === true
      && (slot.obstacleKind === undefined || slot.obstacleKind === 'rock')) return false;
    if (slot.kind === 'rock' && record.ignoreRockIndex !== undefined
      && record.ignoreRockIndex === slot.numericId) return false;

    const exclusionKey = projectileExclusionKey(slot.ref);
    if (exclusionKey !== null && record.multiExplosionExcludedTargetKeys?.has(exclusionKey)) return false;

    if (slot.kind === 'enemy' && record.plasmaSwarmOriginEnemyId === slot.id) {
      const stillInsideOrigin = overlapBounds !== undefined && overlaps(overlapBounds, slot);
      if (shouldIgnorePlasmaSwarmOriginHit(
        record,
        record.plasmaSwarmOriginEnemyId,
        slot.id,
        !stillInsideOrigin,
      )) {
        return false;
      }
      if (!stillInsideOrigin) record.plasmaSwarmOriginEnemyId = undefined;
    }

    // Köder sind reine Ablenkziele und kennen keine Beziehungsprüfung.
    if (isCombatTarget(slot.kind) && deps.targetability
      && !deps.targetability.canDamage(record.provenance, slot.ref, record.allowTeamDamage === true)) {
      return false;
    }

    if (slot.kind === 'projectile' && deps.targetability
      && !deps.targetability.canDamageOwner(record.provenance, slot.ownerId, record.allowTeamDamage === true)) {
      return false;
    }

    const contact = resolveContactMemory(record, slot.kind);
    if (contact.memory?.has(projectileTargetKey(slot.ref))) return false;
    return true;
  }

  private applyCandidate(
    record: ProjectileRuntimeRecord,
    candidate: ProjectileImpactCandidate,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): CandidateOutcome {
    // World and Projectile refs are candidate-owned here, but their domain mutation remains in
    // the existing world/external owners until their later cutover. They still claim the nearest
    // overlap so combat targets behind a world blocker cannot be hit in the same frame.
    if (!isCombatTarget(candidate.target.kind)) {
      return candidate.target.kind === 'projectile' ? 'ignored' : 'consumed';
    }
    const impactPort = deps.directImpact;
    if (!impactPort) return 'ignored';
    const target = asCombatTarget(candidate.target);
    if (!target) return 'ignored';
    const contact = resolveContactMemory(record, target.kind);
    void nowMs;
    const outcome = impactPort.resolveDirectImpact(createDirectImpactRequest(record, target, candidate));
    if (!outcome.accepted) return 'ignored';
    if (outcome.defense) {
      deps.applyDefense(record, outcome.defense, candidate);
      return 'consumed';
    }

    contact.memory?.add(projectileTargetKey(candidate.target));

    if (contact.mode === 'penetration' && (record.penetrationRemaining ?? 0) > 0) {
      record.penetrationRemaining = (record.penetrationRemaining ?? 0) - 1;
      record.damage *= record.penetrationDamageRetention ?? 1;
      return 'passed';
    }
    if (contact.mode === 'pierce' || contact.mode === 'flame') return 'passed';

    const keptAlive = deps.completeDirectImpact?.(record, target, {
      x: candidate.x,
      y: candidate.y,
    }, outcome) ?? false;
    if (!keptAlive) deps.destroyProjectile(record.id);
    return 'consumed';
  }
}

function asCombatTarget(target: ProjectileTargetRef): ProjectileCombatTargetRef | null {
  return target.kind === 'player' || target.kind === 'enemy' || target.kind === 'decoy'
    ? target
    : null;
}

function createDirectImpactRequest(
  record: ProjectileRuntimeRecord,
  target: ProjectileCombatTargetRef,
  candidate: ProjectileImpactCandidate,
): ProjectileDirectImpactRequest {
  const augments: Array<ProjectileDirectImpactRequest['augments'][number]> = [];
  if ((record.burnDurationMs ?? 0) > 0 && (record.burnDamagePerTick ?? 0) > 0) {
    augments.push({
      burn: {
        durationMs: record.burnDurationMs ?? 0,
        damagePerTick: record.burnDamagePerTick ?? 0,
      },
      provenance: record.provenance,
    });
  }
  if (record.supplementalBurnOnHit) {
    augments.push({
      burn: record.supplementalBurnOnHit,
      provenance: record.supplementalBurnProvenance ?? record.provenance,
    });
  }
  if (record.energyInjectorPayload) {
    const augment: ProjectileEnergyInjectorAugment = {
      kind: 'energy-injector',
      payload: record.energyInjectorPayload,
      provenance: record.provenance,
    };
    augments.push(augment);
  }

  return {
    projectileId: record.id,
    target,
    impact: { x: candidate.x, y: candidate.y },
    velocity: { x: record.body.velocity.x, y: record.body.velocity.y },
    provenance: record.provenance,
    directHit: {
      damage: record.damage,
      adrenalinGain: record.adrenalinGain,
      rockDamageMult: record.rockDamageMult,
      trainDamageMult: record.trainDamageMult,
      baseDamageMult: record.baseDamageMult,
      slowFraction: record.hitSlowFraction,
      slowDurationMs: record.hitSlowDurationMs,
      vulnerabilityDurationMs: record.hitVulnerabilityDurationMs,
      knockback: record.hitKnockback,
      knockbackDurationMs: record.hitKnockbackDurationMs,
      shotgun: record.shotgunOriginX === undefined || record.shotgunOriginY === undefined
        || record.shotgunResolvedRange === undefined
        ? undefined
        : {
          originX: record.shotgunOriginX,
          originY: record.shotgunOriginY,
          resolvedRange: record.shotgunResolvedRange,
          proximityMaxDamageBonus: record.shotgunProximityMaxDamageBonus,
          slowFraction: record.shotgunSlowFraction,
          slowDurationMs: record.shotgunSlowDurationMs,
        },
      gaussChain: record.gaussChainRadius === undefined && record.gaussChainDamageFactor === undefined
        ? undefined
        : { radius: record.gaussChainRadius, damageFactor: record.gaussChainDamageFactor },
      plasmaSwarm: record.plasmaSwarmEnabled !== true
        ? undefined
        : {
          projectileCount: record.plasmaSwarmProjectileCount,
          explosionRadius: record.plasmaSwarmExplosionRadius,
          explosionDamage: record.plasmaSwarmExplosionDamage,
          explosionSlowFraction: record.plasmaSwarmExplosionSlowFraction,
        },
      ak47: record.ak47ShotId === undefined
        ? undefined
        : {
          damageMultiplier: record.ak47DamageMultiplier,
          fireSuperiorityShot: record.ak47FireSuperiorityShot,
        },
    },
    augments,
  };
}

function overlaps(
  bounds: { left: number; right: number; top: number; bottom: number },
  slot: { left: number; right: number; top: number; bottom: number },
): boolean {
  return bounds.left < slot.right
    && bounds.right > slot.left
    && bounds.top < slot.bottom
    && bounds.bottom > slot.top;
}

/**
 * Kontaktmodus und zugehöriges Trefferkontakt-Gedächtnis eines Projectiles gegen einen Zieltyp.
 *
 * Die Zuordnung folgt den Fähigkeiten des Projectiles; Köder kennen weder Durchdringung noch
 * Flammenkontakt und verbrauchen das Projectile deshalb wie ein normales Ziel.
 */
export function resolveContactMemory(
  record: ProjectileRuntimeRecord,
  kind: CollisionTargetKind,
): { readonly mode: ProjectileContactMode; readonly memory: Set<string> | null } {
  if (record.energyInjectorPayload) return { mode: 'support', memory: null };
  if (record.penetrationHitIds) return { mode: 'penetration', memory: record.penetrationHitIds };

  const proximityPiercing = kind !== 'decoy'
    && (record.proximityPulse?.radius ?? 0) > 0
    && (record.proximityPulse?.damage ?? 0) > 0;
  if (kind !== 'decoy' && (record.piercesTargets === true || proximityPiercing)) {
    const memory = record.piercingHitIds ??= new Set<string>();
    return { mode: 'pierce', memory };
  }

  if (hasGaussDischarge(record)) {
    const memory = record.gaussHitPlayers ??= new Set<string>();
    return { mode: 'pierce', memory };
  }
  if (record.isBfg === true) {
    const memory = record.bfgHitPlayers ??= new Set<string>();
    return { mode: 'pierce', memory };
  }

  if (kind !== 'decoy' && record.isFlame === true && record.flamePierceHitIds) {
    return { mode: 'flame', memory: record.flamePierceHitIds };
  }
  return { mode: 'single', memory: null };
}

function createTargetRef(
  kind: CollisionTargetKind,
  id: string | number,
  obstacleKind?: import('../types').PlaceableKind,
): ProjectileTargetRef {
  switch (kind) {
    case 'player': return { kind, id: String(id) };
    case 'enemy': return { kind, id: String(id) };
    case 'decoy': return { kind, id: Number(id) };
    case 'rock': return { kind, id: Number(id), obstacleKind };
    case 'base': return { kind, id: String(id) };
    case 'train': return { kind, id: String(id) };
    case 'construction': return { kind, id: typeof id === 'number' ? id : String(id) };
    case 'projectile': return { kind, id: Number(id) };
  }
}

function targetKindRank(kind: CollisionTargetKind): number {
  return kind === 'rock' ? 0 : kind === 'construction' ? 1 : 2;
}

function isCombatTarget(kind: CollisionTargetKind): kind is 'player' | 'enemy' | 'decoy' {
  return kind === 'player' || kind === 'enemy' || kind === 'decoy';
}

function overlapDistanceAlongTravel(record: ProjectileRuntimeRecord, slot: CollisionTargetSlot): number {
  const dx = record.sprite.x - record.lastX;
  const dy = record.sprite.y - record.lastY;
  const length = Math.hypot(dx, dy);
  if (length <= 0.000001) return 0;
  return Math.max(0, Math.min(length, ((slot.x - record.lastX) * dx + (slot.y - record.lastY) * dy) / length));
}

function hasGaussDischarge(record: ProjectileRuntimeRecord): boolean {
  return (record.gaussChainRadius ?? 0) > 0 && (record.gaussChainDamageFactor ?? 0) > 0;
}
