import type { TrackedProjectile } from '../types';
import { resolveProjectileTargetImpact } from '../combat/rules/ProjectileImpactResolver';
import { shouldIgnorePlasmaSwarmOriginHit } from '../systems/PlasmaCharge';
import type { ProjectileId } from './ProjectileSpawnPort';
import type {
  ProjectileContactMode,
  ProjectileDefenseResolution,
  ProjectileDirectImpactPort,
} from './ProjectileInteractionPorts';
import {
  projectileExclusionKey,
  projectileTargetKey,
  type ProjectileCollisionTargetQueryPort,
  type ProjectileImpactCandidate,
  type ProjectileTargetRef,
  type ProjectileTargetabilityPort,
  type ProjectileWorldBlockerPort,
} from './ProjectileTargetPort';

/** Zieltypen, die über die Collision-Kandidatenerzeugung laufen. */
type CollisionTargetKind = 'player' | 'enemy' | 'decoy';

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
  ref: ProjectileTargetRef;
}

/** Was der Owner für die Kandidatenverarbeitung bereitstellt. */
export interface ProjectileCollisionDependencies {
  readonly targetQuery: ProjectileCollisionTargetQueryPort | null;
  readonly targetability: ProjectileTargetabilityPort | null;
  readonly worldBlocker: ProjectileWorldBlockerPort | null;
  readonly directImpact: ProjectileDirectImpactPort | null;
  /** Entfernt ein verbrauchtes Projectile über den Owner. */
  destroyProjectile(id: ProjectileId): void;
  /** Wendet eine target-lokale Defense an (Absorption oder Reflexion). */
  applyDefense(
    record: TrackedProjectile,
    defense: ProjectileDefenseResolution,
    candidate: ProjectileImpactCandidate,
  ): void;
}

type CandidateOutcome = 'ignored' | 'passed' | 'consumed';

/** Startüberlappung wird beim Sweep ignoriert; ein näherer Weltblocker gewinnt. */
const BLOCKER_TOLERANCE_PX = 0.75;
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
  ): void => {
    const slot = this.acquireSlot(kind, id);
    slot.ownerId = ownerId;
    slot.x = x;
    slot.y = y;
    slot.radius = radius;
    slot.left = left;
    slot.top = top;
    slot.right = right;
    slot.bottom = bottom;
    this.targetCount += 1;
  };

  /** Verarbeitet alle wirksamen Projectiles dieses Frames gegen die aktuelle Zielsicht. */
  run(
    records: Iterable<TrackedProjectile>,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    if (!deps.directImpact || !deps.targetQuery) return;
    this.readTargets(deps.targetQuery);
    if (this.targetCount === 0) return;

    for (const record of records) {
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
    this.targetCount = 0;
  }

  private readTargets(port: ProjectileCollisionTargetQueryPort): void {
    this.targetCount = 0;
    port.readCollisionTargets(this.emitTarget);
  }

  private acquireSlot(kind: CollisionTargetKind, id: string | number): CollisionTargetSlot {
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
        ref: (kind === 'decoy' ? { kind, id: 0 } : { kind, id: '' }) as ProjectileTargetRef,
      };
      this.targetPool[this.targetCount] = slot;
    }
    slot.id = String(id);
    slot.numericId = Number(id);
    if (slot.kind === 'decoy') (slot.ref as { id: number }).id = slot.numericId;
    else (slot.ref as { id: string }).id = slot.id;
    return slot;
  }

  private processRecord(
    record: TrackedProjectile,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    if (usesContinuousCollision(record)) {
      const travelX = record.sprite.x - record.lastX;
      const travelY = record.sprite.y - record.lastY;
      if (Math.hypot(travelX, travelY) > MIN_SWEEP_TRAVEL_PX) {
        // Ein Sweep-Frame löst höchstens einen Treffer auf und fällt nicht auf Overlap zurück.
        this.processSweep(record, nowMs, deps);
        return;
      }
    }
    this.processOverlap(record, nowMs, deps);
  }

  private processSweep(
    record: TrackedProjectile,
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

    let bestSlot: CollisionTargetSlot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;
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
      // Ein näherer Weltblocker verhindert den Treffer.
      if (blockerDistance !== null && blockerDistance < hit.distance - BLOCKER_TOLERANCE_PX) continue;
      if (hit.distance >= bestDistance) continue;
      bestSlot = slot;
      bestDistance = hit.distance;
      bestX = hit.x;
      bestY = hit.y;
    }
    if (!bestSlot) return;

    // Das Projectile steht für die Auflösung am tatsächlichen Trefferpunkt.
    const velocityX = record.body.velocity.x;
    const velocityY = record.body.velocity.y;
    record.body.reset(bestX, bestY);
    record.body.setVelocity(velocityX, velocityY);

    this.applyCandidate(
      record,
      { projectileId: record.id, target: bestSlot.ref, x: bestX, y: bestY, distanceAlongTravel: bestDistance, source: 'sweep' },
      nowMs,
      deps,
    );
  }

  private processOverlap(
    record: TrackedProjectile,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    const bounds = record.sprite.getBounds();
    for (let index = 0; index < this.targetCount; index += 1) {
      const slot = this.targetPool[index];
      if (!this.isCandidateAllowed(record, slot, deps, bounds)) continue;
      if (!overlaps(bounds, slot)) continue;
      const outcome = this.applyCandidate(
        record,
        { projectileId: record.id, target: slot.ref, x: record.sprite.x, y: record.sprite.y, source: 'overlap' },
        nowMs,
        deps,
      );
      if (outcome === 'consumed') return;
    }
  }

  /**
   * Fachliche Zulässigkeit eines Ziels: Selbsttreffer, laufender Explosionsausschluss,
   * Kontaktgedächtnis, Schwarmursprung und Beziehung.
   */
  private isCandidateAllowed(
    record: TrackedProjectile,
    slot: CollisionTargetSlot,
    deps: ProjectileCollisionDependencies,
    overlapBounds?: { left: number; right: number; top: number; bottom: number },
  ): boolean {
    if (record.provenance.allegiance.ownerId === slot.ownerId) return false;

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
    if (slot.kind !== 'decoy' && deps.targetability
      && !deps.targetability.canDamage(record.provenance, slot.ref, record.allowTeamDamage === true)) {
      return false;
    }

    const contact = resolveContactMemory(record, slot.kind);
    if (contact.memory?.has(projectileTargetKey(slot.ref))) return false;
    return true;
  }

  private applyCandidate(
    record: TrackedProjectile,
    candidate: ProjectileImpactCandidate,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): CandidateOutcome {
    const impactPort = deps.directImpact;
    if (!impactPort) return 'ignored';
    const kind = candidate.target.kind as CollisionTargetKind;
    const contact = resolveContactMemory(record, kind);

    const resolution = impactPort.resolveDirectImpact({ candidate, contact: contact.mode, nowMs });
    if (resolution.kind === 'ignored') return 'ignored';
    if (resolution.kind === 'defended') {
      deps.applyDefense(record, resolution.defense, candidate);
      return 'consumed';
    }
    // Die Wirkung hat das Projectile bereits beendet (Explosion oder Direktentfernung).
    if (resolution.kind === 'consumed') return 'consumed';

    contact.memory?.add(projectileTargetKey(candidate.target));

    if (contact.mode === 'penetration' && (record.penetrationRemaining ?? 0) > 0) {
      record.penetrationRemaining = (record.penetrationRemaining ?? 0) - 1;
      record.damage *= record.penetrationDamageRetention ?? 1;
      return 'passed';
    }
    if (contact.mode === 'pierce' || contact.mode === 'flame') return 'passed';

    deps.destroyProjectile(record.id);
    return 'consumed';
  }
}

/** Nur die geraden, schnellen Flugbahnen lösen kontinuierlich auf. */
function usesContinuousCollision(record: TrackedProjectile): boolean {
  return record.projectileStyle === 'bullet' || record.projectileStyle === 'awp';
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
  record: TrackedProjectile,
  kind: CollisionTargetKind,
): { readonly mode: ProjectileContactMode; readonly memory: Set<string> | null } {
  if (record.energyInjectorPayload) return { mode: 'support', memory: null };
  if (record.penetrationHitIds) return { mode: 'penetration', memory: record.penetrationHitIds };

  const asmdProximityPiercing = kind === 'enemy'
    && record.projectileStyle === 'energy_ball'
    && (record.proximityPulse?.radius ?? 0) > 0
    && (record.proximityPulse?.damage ?? 0) > 0;
  if (kind !== 'decoy' && (record.piercesTargets === true || asmdProximityPiercing)) {
    const memory = record.piercingHitIds ??= new Set<string>();
    return { mode: 'pierce', memory };
  }

  if (record.projectileStyle === 'gauss') {
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
