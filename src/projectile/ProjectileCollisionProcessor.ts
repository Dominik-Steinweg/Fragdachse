import type { ProjectileRuntimeRecord } from './ProjectileRuntimeRecord';
import { advanceProjectileDistance } from './ProjectileDistanceScaling';
import { usesRockSweep } from './ProjectileRockSweep';
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
  projectileTargetKey,
  type ProjectileCollisionTargetQueryPort,
  type ProjectileCollisionTargetKind,
  type ProjectileCollisionRegion,
  type ProjectileImpactCandidate,
  type ProjectileTargetRef,
  type ProjectileTargetabilityPort,
  type ProjectileWorldBlockerPort,
} from './ProjectileTargetPort';

/** Zieltypen, die über die Collision-Kandidatenerzeugung laufen. */
type CollisionTargetKind = ProjectileCollisionTargetKind;
type CollisionTargetRef = Exclude<ProjectileTargetRef, { kind: 'projectile' }>;
type CollisionCandidate = Omit<ProjectileImpactCandidate, 'target'> & { readonly target: CollisionTargetRef };

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
  ref: CollisionTargetRef;
  key: string;
  physicalKey: string;
  exclusionKey: string | null;
}

interface SweepCandidate {
  slot: CollisionTargetSlot;
  x: number;
  y: number;
  distance: number;
}

/** Was der Owner für die Kandidatenverarbeitung bereitstellt. */
export interface ProjectileCollisionDependencies {
  shotOptions?(record: ProjectileRuntimeRecord): import('../systems/ObstacleRules').ObstacleShotOptions;
  allowsWorldContact?(record: ProjectileRuntimeRecord, target: ProjectileTargetRef): boolean;
  worldTargetHit?(record: ProjectileRuntimeRecord, target: ProjectileTargetRef,
    sx: number, sy: number, ex: number, ey: number): { x: number; y: number; distance: number } | null | undefined;
  onGrenadeContact?(record: ProjectileRuntimeRecord, candidate: ProjectileImpactCandidate): void;
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
  /** Resolves a canonical world target without exposing its domain owner to this processor. */
  resolveWorldImpact?(
    record: ProjectileRuntimeRecord,
    candidate: ProjectileImpactCandidate,
  ): ProjectileCollisionOutcome;
}

export type ProjectileCollisionOutcome = 'ignored' | 'passed' | 'consumed';

/** Unterhalb dieser Streckenlänge bleibt es beim Overlap-Test. */
const MIN_SWEEP_TRAVEL_PX = 0.5;

/** Inflated footprint sweep, returning the actual target surface as the contact anchor. */
function grenadeRectangleContact(sx: number, sy: number, ex: number, ey: number,
  slot: CollisionTargetSlot, radius: number): { x: number; y: number; distance: number } | null {
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 2; axis++) {
    const start = axis === 0 ? sx : sy;
    const delta = axis === 0 ? ex - sx : ey - sy;
    const min = (axis === 0 ? slot.left : slot.top) - radius;
    const max = (axis === 0 ? slot.right : slot.bottom) + radius;
    if (Math.abs(delta) < 0.000001) { if (start < min || start > max) return null; continue; }
    const a = (min - start) / delta, b = (max - start) / delta;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return null;
  }
  const x = sx + (ex - sx) * enter, y = sy + (ey - sy) * enter;
  return { x: Math.max(slot.left, Math.min(slot.right, x)), y: Math.max(slot.top, Math.min(slot.bottom, y)),
    distance: Math.hypot(ex - sx, ey - sy) * enter };
}

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
  private readonly overlapCandidates: CollisionTargetSlot[] = [];
  private readonly sweepCandidates: SweepCandidate[] = [];
  private readonly sweepCandidatePool: SweepCandidate[] = [];
  private overlapBounds: ReturnType<ProjectileRuntimeRecord['physics']['sprite']['getBounds']> | undefined;
  private readonly region: ProjectileCollisionRegion = {
    startX: 0, startY: 0, endX: 0, endY: 0, padding: 0, sweepCircles: false,
  };
  private snapshotTargetCount = 0;
  private targetCount = 0;
  private batchingTargets = false;
  private targetsRead = false;

  /** Portal prefixes share one frame view; live targetability is still checked at impact. */
  withTargetSnapshot(action: () => void): void {
    this.batchingTargets = true;
    this.targetsRead = false;
    try { action(); } finally { this.batchingTargets = false; this.targetsRead = false; }
  }

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
    const normalizedId = kind === 'rock' || kind === 'decoy' ? String(Number(id)) : String(id);
    const physicalKey = (kind === 'rock' || kind === 'construction' ? 'obstacle:' : kind + ':') + normalizedId;
    let slot = this.targetSlotsByPhysicalKey.get(physicalKey);
    if (!slot) {
      slot = this.acquireSlot(kind, id, obstacleKind);
      this.targetSlotsByPhysicalKey.set(physicalKey, slot);
      this.targetCount += 1;
    } else if (targetKindRank(kind) < targetKindRank(slot.kind)) {
      // A shared runtime rock is canonical even if a construction adapter reported it first.
      this.replaceSlotRef(slot, createTargetRef(kind, id, obstacleKind));
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
    if (!this.batchingTargets) this.targetsRead = false;
    // Deliberately live iteration: collision interactions can add same-stage projectiles.
    for (const record of records) {
      if (record.pendingDestroy) continue;
      if (record.spec.flight.isGrenade) {
        const effect = record.spec.interaction.grenadeEffect;
        if (effect?.type !== 'damage' || effect.role === 'cluster' || effect.role === 'demolition'
          || !effect.impactFuse) continue;
      } else {
        if (record.miniRocket.deferredExplosion || record.miniRocket.spent) continue;
        const mode = record.spec.flight.collisionMode ?? 'overlap';
        if (mode === 'none' || mode === 'physics') continue;
      }
      if (!this.targetsRead) {
        this.readTargets(deps.targetQuery);
        this.targetsRead = true;
      }
      if (record.spec.flight.isGrenade) this.processGrenadeContacts(record, deps);
      else this.processRecord(record, nowMs, deps);
    }
  }

  /** Gibt die gepoolte Frame-Sicht frei. */
  reset(): void {
    this.targetPool.length = 0;
    this.targetSlotsByPhysicalKey.clear();
    this.overlapCandidates.length = 0;
    this.sweepCandidates.length = 0;
    this.targetCount = 0;
    this.snapshotTargetCount = 0;
    this.targetsRead = false;
    this.sweepCandidatePool.length = 0;
    this.overlapBounds = undefined;
  }

  private processGrenadeContacts(record: ProjectileRuntimeRecord, deps: ProjectileCollisionDependencies): void {
    const effect = record.spec.interaction.grenadeEffect;
    if (effect?.type !== 'damage' || effect.role === 'cluster' || effect.role === 'demolition'
      || !effect.impactFuse) return;
    const sx = record.lastX, sy = record.lastY;
    const ex = record.physics.sprite.x, ey = record.physics.sprite.y;
    const radius = record.hitboxSize! * 0.5;
    this.prepareWorldTargets(deps, sx, sy, ex, ey, radius, false);
    let blocker = deps.worldBlocker?.getNearestBlockerDistance(sx, sy, ex, ey, false, { purpose: 'physical' }) ?? Infinity;
    const candidates = this.sweepCandidates;
    candidates.length = 0;
    for (let i = 0; i < this.targetCount; i++) {
      const slot = this.targetPool[i];
      if (!this.inSearchRegion(slot)) continue;
      const character = slot.kind === 'player' || slot.kind === 'enemy';
      if (slot.kind === 'decoy') continue;
      const hit = character
        ? resolveProjectileTargetImpact({ startX: sx, startY: sy, endX: ex, endY: ey,
          targetX: slot.x, targetY: slot.y, radius: slot.radius + radius, ignoreStartingOverlap: false })
        : grenadeRectangleContact(sx, sy, ex, ey, slot, radius);
      if (!hit) continue;
      // Base AABBs can contain empty cells. Their exact blockers come from World geometry;
      // BR1 is admitted only by actual physical/cell-sweep contacts in the owner.
      if (!character && (slot.kind === 'rock' || !deps.worldBlocker)) blocker = Math.min(blocker, hit.distance);
      const role = deps.targetability?.getGrenadeContactRole?.(record.provenance, slot.ref);
      if (role === 'character') {
        this.pushSweepCandidate(slot, hit.x, hit.y, hit.distance);
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || compareTargetKeys(a.slot, b.slot));
    for (const candidate of candidates) {
      if (candidate.distance > blocker + 0.000001 || record.pendingDestroy) break;
      deps.onGrenadeContact?.(record, { projectileId: record.id, target: candidate.slot.ref,
        x: candidate.x, y: candidate.y, distanceAlongTravel: candidate.distance, source: 'sweep' });
    }
  }

  private readTargets(port: ProjectileCollisionTargetQueryPort): void {
    this.targetCount = 0;
    this.targetSlotsByPhysicalKey.clear();
    port.readCollisionTargets(this.emitTarget);
    this.snapshotTargetCount = this.targetCount;
  }

  private acquireSlot(kind: CollisionTargetKind, id: string | number,
    obstacleKind?: import('../types').PlaceableKind): CollisionTargetSlot {
    let slot = this.targetPool[this.targetCount];
    if (!slot) {
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
        ref: createTargetRef(kind, id, obstacleKind),
        key: '', physicalKey: '', exclusionKey: null,
      };
      this.targetPool[this.targetCount] = slot;
    }
    const normalizedId = kind === 'rock' || kind === 'decoy' ? Number(id) : id;
    if (!slot.key || slot.kind !== kind || slot.ref.id !== normalizedId
      || (kind === 'rock' && slot.ref.kind === 'rock' && slot.ref.obstacleKind !== obstacleKind)) {
      this.replaceSlotRef(slot, createTargetRef(kind, id, obstacleKind));
    }
    return slot;
  }

  private replaceSlotRef(slot: CollisionTargetSlot, ref: CollisionTargetRef): void {
    slot.key = projectileTargetKey(ref);
    slot.physicalKey = (ref.kind === 'rock' || ref.kind === 'construction' ? 'obstacle:' : ref.kind + ':') + ref.id;
    slot.exclusionKey = projectileExclusionKey(ref);
    slot.kind = ref.kind;
    slot.ref = ref;
    slot.id = String(ref.id);
    slot.numericId = Number(ref.id);
    slot.obstacleKind = ref.kind === 'rock' ? ref.obstacleKind : undefined;
  }

  private prepareWorldTargets(deps: ProjectileCollisionDependencies,
    sx: number, sy: number, ex: number, ey: number, padding: number, sweepCircles: boolean): void {
    const region = this.region;
    region.startX = sx; region.startY = sy; region.endX = ex; region.endY = ey;
    region.padding = padding; region.sweepCircles = sweepCircles;
    // Keep the dynamic dedupe table for the whole snapshot; discard only the previous local query.
    for (let i = this.snapshotTargetCount; i < this.targetCount; i++) {
      this.targetSlotsByPhysicalKey.delete(this.targetPool[i].physicalKey);
    }
    this.targetCount = this.snapshotTargetCount;
    deps.targetQuery?.queryWorldCollisionTargets?.(region, this.emitTarget);
  }

  private inSearchRegion(slot: CollisionTargetSlot): boolean {
    const r = this.region;
    // Circle/AABB union admits both generic circles and exact World-cell callbacks.
    return Math.max(slot.right, slot.x + slot.radius) >= Math.min(r.startX, r.endX) - r.padding
      && Math.min(slot.left, slot.x - slot.radius) <= Math.max(r.startX, r.endX) + r.padding
      && Math.max(slot.bottom, slot.y + slot.radius) >= Math.min(r.startY, r.endY) - r.padding
      && Math.min(slot.top, slot.y - slot.radius) <= Math.max(r.startY, r.endY) + r.padding;
  }

  private pushSweepCandidate(slot: CollisionTargetSlot, x: number, y: number, distance: number): void {
    const index = this.sweepCandidates.length;
    const candidate = this.sweepCandidatePool[index] ??= { slot, x, y, distance };
    candidate.slot = slot; candidate.x = x; candidate.y = y; candidate.distance = distance;
    this.sweepCandidates.push(candidate);
  }

  private processRecord(
    record: ProjectileRuntimeRecord,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    const mode = record.spec.flight.collisionMode ?? 'overlap';
    if (mode === 'none' || mode === 'physics') return;
    if (mode === 'sweep') {
      const travelX = record.physics.sprite.x - record.lastX;
      const travelY = record.physics.sprite.y - record.lastY;
      if (Math.hypot(travelX, travelY) > MIN_SWEEP_TRAVEL_PX) {
        // Ein Sweep-Frame verarbeitet alle zulässigen Kandidaten entlang des Segments; ein
        // nicht-penetrativer Kontakt beendet ihn im Ergebnis, statt auf Overlap zurückzufallen.
        this.processSweep(record, nowMs, deps);
        this.advanceSwarmOriginExit(record);
        return;
      }
    }
    this.processOverlap(record, nowMs, deps);
    this.advanceSwarmOriginExit(record);
  }

  /** Release only after the whole contact segment, including its exit face, was processed. */
  private advanceSwarmOriginExit(record: ProjectileRuntimeRecord): void {
    const lineage = record.provenance.lineage;
    if (!lineage?.plasmaSwarmChild || !lineage.plasmaSwarmOriginEnemyId || record.contacts.swarmOriginExited) return;
    const origin = this.targetSlotsByPhysicalKey.get(`enemy:${lineage.plasmaSwarmOriginEnemyId}`);
    const sprite = record.physics.sprite;
    // Both collision paths must be clear: overlap uses bounds, sweep an expanded circle.
    const radius = (origin?.radius ?? 0) + Math.max(sprite.displayWidth, sprite.displayHeight) * 0.5;
    if (!origin || (!overlaps(sprite.getBounds(this.overlapBounds), origin)
      && Math.hypot(sprite.x - origin.x, sprite.y - origin.y) > radius)) {
      record.contacts.swarmOriginExited = true;
    }
  }

  private processSweep(
    record: ProjectileRuntimeRecord,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): void {
    const startX = record.lastX;
    const startY = record.lastY;
    const endX = record.physics.sprite.x;
    const endY = record.physics.sprite.y;
    const blockerDistance = deps.worldBlocker?.getNearestBlockerDistance(
      startX,
      startY,
      endX,
      endY,
      record.spec.flight.penetration.penetratesRocks === true,
      deps.shotOptions?.(record) ?? { purpose: record.spec.flight.isGrenade || record.spec.flight.isTranslocatorPuck ? 'physical' : 'directFire',
        sourceCarrierBaseId: record.sourceCarrierBaseId },
    ) ?? null;
    const projectileRadius = Math.max(record.physics.sprite.displayWidth, record.physics.sprite.displayHeight) * 0.5;

    this.prepareWorldTargets(deps, startX, startY, endX, endY, projectileRadius, true);
    this.sweepCandidates.length = 0;
    for (let index = 0; index < this.targetCount; index += 1) {
      const slot = this.targetPool[index];
      if (!this.inSearchRegion(slot)) {
        continue;
      }
      if (!this.isCandidateAllowed(record, slot, deps)) continue;
      const worldHit = deps.worldTargetHit?.(record, slot.ref, startX, startY, endX, endY);
      const hit = worldHit !== undefined ? worldHit : resolveProjectileTargetImpact({
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
      this.pushSweepCandidate(slot, hit.x, hit.y, hit.distance);
    }
    this.sortSweepCandidates();
    for (const candidate of this.sweepCandidates) {
      if (!this.isCandidateAllowed(record, candidate.slot, deps)) continue;
      // Das Projectile steht für jede Auflösung am tatsächlichen Trefferpunkt. Bei Penetration
      // läuft die Kandidatenliste weiter; ein normaler Treffer beendet sie im applyCandidate.
      const velocityX = record.physics.body.velocity.x;
      const velocityY = record.physics.body.velocity.y;
      record.physics.body.reset(candidate.x, candidate.y);
      record.physics.body.setVelocity(velocityX, velocityY);
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
      // A candidate is resolved at its impact point, but a non-terminal outcome does not end
      // this frame. Keep the already simulated tail of the sweep unless the resolution moved the
      // projectile itself (for example through a local redirect or lifecycle transition). This
      // deliberately avoids restoring over mutations that belong to applyCandidate().
      if (!record.pendingDestroy && record.physics.body.enable
        && Math.abs(record.physics.sprite.x - candidate.x) <= 0.000001
        && Math.abs(record.physics.sprite.y - candidate.y) <= 0.000001) {
        const nextVelocityX = record.physics.body.velocity.x;
        const nextVelocityY = record.physics.body.velocity.y;
        record.physics.body.reset(endX, endY);
        record.physics.body.setVelocity(nextVelocityX, nextVelocityY);
      }
    }
  }

  private sortSweepCandidates(): void {
    // Seed only actual candidates in key order. The epsilon relation below is non-transitive;
    // preserving its canonical input also preserves near-equal distance chains across providers.
    this.sweepCandidates.sort((a, b) => compareTargetKeys(a.slot, b.slot));
    for (let index = 1; index < this.sweepCandidates.length; index += 1) {
      const current = this.sweepCandidates[index];
      let insertAt = index - 1;
      while (insertAt >= 0) {
        const previous = this.sweepCandidates[insertAt];
        if (previous.distance < current.distance - 0.000001
          || (Math.abs(previous.distance - current.distance) <= 0.000001
            && previous.slot.key <= current.slot.key)) break;
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
    const bounds = record.physics.sprite.getBounds(this.overlapBounds);
    this.overlapBounds = bounds;
    this.prepareWorldTargets(deps, (bounds.left + bounds.right) * 0.5,
      (bounds.top + bounds.bottom) * 0.5, (bounds.left + bounds.right) * 0.5,
      (bounds.top + bounds.bottom) * 0.5,
      Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.5, false);
    this.overlapCandidates.length = 0;
    for (let index = 0; index < this.targetCount; index += 1) {
      const slot = this.targetPool[index];
      if (!this.inSearchRegion(slot)) {
        continue;
      }
      if (!this.isCandidateAllowed(record, slot, deps)) continue;
      if (!overlaps(bounds, slot)) continue;
      if (deps.worldTargetHit?.(record, slot.ref, record.physics.sprite.x, record.physics.sprite.y,
        record.physics.sprite.x, record.physics.sprite.y) === null) continue;
      this.overlapCandidates.push(slot);
    }
    this.sortOverlapCandidates(record);
    for (const slot of this.overlapCandidates) {
      if (!this.isCandidateAllowed(record, slot, deps)) continue;
      const outcome = this.applyCandidate(
        record,
        {
          projectileId: record.id,
          target: slot.ref,
          x: record.physics.sprite.x,
          y: record.physics.sprite.y,
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
    // See sortSweepCandidates: canonical input is required even for epsilon-distance chains.
    this.overlapCandidates.sort(compareTargetKeys);
    for (let index = 1; index < this.overlapCandidates.length; index += 1) {
      const current = this.overlapCandidates[index];
      const currentDistance = overlapDistanceAlongTravel(record, current);
      let insertAt = index - 1;
      while (insertAt >= 0) {
        const previous = this.overlapCandidates[insertAt];
        const previousDistance = overlapDistanceAlongTravel(record, previous);
        if (previousDistance < currentDistance - 0.000001
          || (Math.abs(previousDistance - currentDistance) <= 0.000001
            && previous.key <= current.key)) break;
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
  ): boolean {
    if (slot.kind !== 'base' && slot.kind !== 'rock' && record.provenance.allegiance.ownerId === slot.ownerId) return false;
    if (deps.allowsWorldContact?.(record, slot.ref) === false) return false;
    const excluded = record.spec.flight.collisionFilter.excludedTarget;
    if (excluded && excluded.id === slot.id && excluded.kind === slot.kind
      && (deps.targetability?.isCurrentTargetInstance?.(excluded) ?? true)) return false;
    const protection = record.spec.flight.collisionFilter.initialTargetProtection;
    if (slot.kind === 'enemy' && protection?.targetId === slot.id
      && (record.simulatedAgeMs ?? 0) < protection.durationMs) return false;
    // Rock and base cells share the rectangular body sweep. Their target circles
    // must not reset the projectile before that sweep resolves the exterior face.
    if ((slot.kind === 'rock' || slot.kind === 'base') && usesRockSweep(record.spec.flight)) return false;

    if (slot.kind === 'rock'
      && record.spec.flight.penetration.penetratesRocks === true
      && (slot.obstacleKind === undefined || slot.obstacleKind === 'rock')) return false;
    if (slot.kind === 'rock' && record.spec.flight.collisionFilter.ignoreRockIndex !== undefined
      && record.spec.flight.collisionFilter.ignoreRockIndex === slot.numericId) return false;
    if (hasPersistentWorldContact(record, slot)) return false;

    const exclusionKey = slot.exclusionKey;
    if (exclusionKey !== null && record.interaction.multiExplosionExcludedTargetKeys?.has(exclusionKey)) return false;

    if (slot.kind === 'enemy' && shouldIgnorePlasmaSwarmOriginHit(
        { plasmaSwarmProjectile: record.provenance.lineage?.plasmaSwarmChild },
        record.provenance.lineage?.plasmaSwarmOriginEnemyId,
        slot.id,
        record.contacts.swarmOriginExited === true,
      )) return false;

    // Köder sind reine Ablenkziele und kennen keine Beziehungsprüfung.
    if (isCombatTarget(slot.kind) && deps.targetability
      && !deps.targetability.canDamage(record.provenance, slot.ref, record.provenance.allegiance.allowTeamDamage === true)) {
      return false;
    }

    const contact = resolveContactMemory(record, slot.kind);
    if (contact.memory?.has(slot.key)) return false;
    return true;
  }

  private applyCandidate(
    record: ProjectileRuntimeRecord,
    candidate: CollisionCandidate,
    nowMs: number,
    deps: ProjectileCollisionDependencies,
  ): ProjectileCollisionOutcome {
    if (!isCombatTarget(candidate.target.kind)) {
      // World interaction is resolved by the WorldProjectileRuntime through the narrow callback.
      // The processor remains responsible only for candidate order and the terminal outcome.
      return deps.resolveWorldImpact?.(record, candidate) ?? 'consumed';
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

    if (contact.mode === 'penetration' && (record.interaction.penetrationRemaining ?? 0) > 0) {
      record.interaction.penetrationRemaining = (record.interaction.penetrationRemaining ?? 0) - 1;
      record.damage *= record.spec.flight.penetration.damageRetention ?? 1;
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
  advanceProjectileDistance(record, candidate.x, candidate.y);
  const augments: Array<ProjectileDirectImpactRequest['augments'][number]> = [];
  if ((record.spec.interaction.burn.burnDurationMs ?? 0) > 0 && (record.spec.interaction.burn.burnDamagePerTick ?? 0) > 0) {
    augments.push({
      burn: {
        durationMs: record.spec.interaction.burn.burnDurationMs ?? 0,
        damagePerTick: record.spec.interaction.burn.burnDamagePerTick ?? 0,
      },
      provenance: record.provenance,
    });
  }
  if (record.interaction.burnAugment) augments.push(record.interaction.burnAugment);
  if (record.spec.interaction.energyInjectorPayload) {
    const augment: ProjectileEnergyInjectorAugment = {
      kind: 'energy-injector',
      payload: record.spec.interaction.energyInjectorPayload,
      provenance: record.provenance,
    };
    augments.push(augment);
  }

  return {
    projectileId: record.id,
    target,
    impact: { x: candidate.x, y: candidate.y },
    velocity: { x: record.physics.body.velocity.x, y: record.physics.body.velocity.y },
    provenance: record.provenance,
    plasmaSwarmSource: record.spec.interaction.directHit.plasmaSwarmEnabled === true ? {
      normalSize: record.hitboxSize ?? record.physics.sprite.displayWidth,
      normalRange: record.spec.flight.speed * record.spec.flight.lifetimeMs / 1000,
      color: record.presentation.color,
      ownerColor: record.presentation.ownerColor,
      homing: record.spec.flight.homing,
      projectileStyle: record.presentation.projectileStyle,
      energyBallVariant: record.presentation.energyBallVariant,
      tracerConfig: record.presentation.tracerConfig,
    } : undefined,
    directHit: {
      damage: record.damage,
      appliedSourceDamageFactors: record.spec.interaction.directHit.appliedSourceDamageFactors,
      adrenalinGain: record.adrenalinGain,
      rockDamageMult: record.spec.interaction.directHit.rockDamageMult,
      trainDamageMult: record.spec.interaction.directHit.trainDamageMult,
      baseDamageMult: record.spec.interaction.directHit.baseDamageMult,
      slowFraction: record.spec.interaction.directHit.hitSlowFraction,
      slowDurationMs: record.spec.interaction.directHit.hitSlowDurationMs,
      vulnerabilityDurationMs: record.spec.interaction.directHit.hitVulnerabilityDurationMs,
      stunDurationMs: record.spec.interaction.directHit.hitStunDurationMs,
      knockback: record.spec.interaction.directHit.hitKnockback,
      knockbackDurationMs: record.spec.interaction.directHit.hitKnockbackDurationMs,
      shotgun: record.spec.interaction.directHit.shotgunOriginX === undefined || record.spec.interaction.directHit.shotgunOriginY === undefined
        || record.spec.interaction.directHit.shotgunResolvedRange === undefined
        ? undefined
        : {
          originX: record.spec.interaction.directHit.shotgunOriginX,
          originY: record.spec.interaction.directHit.shotgunOriginY,
          resolvedRange: record.spec.interaction.directHit.shotgunResolvedRange,
          proximityMaxDamageBonus: record.spec.interaction.directHit.shotgunProximityMaxDamageBonus,
          slowFraction: record.spec.interaction.directHit.shotgunSlowFraction,
          slowDurationMs: record.spec.interaction.directHit.shotgunSlowDurationMs,
        },
      gaussChain: record.spec.interaction.directHit.gaussChainRadius === undefined && record.spec.interaction.directHit.gaussChainDamageFactor === undefined
        ? undefined
        : { radius: record.spec.interaction.directHit.gaussChainRadius, damageFactor: record.spec.interaction.directHit.gaussChainDamageFactor },
      plasmaSwarm: record.spec.interaction.directHit.plasmaSwarmEnabled !== true
        ? undefined
        : {
          projectileCount: record.spec.interaction.directHit.plasmaSwarmProjectileCount,
          explosionRadius: record.spec.interaction.directHit.plasmaSwarmExplosionRadius,
          explosionDamage: record.spec.interaction.directHit.plasmaSwarmExplosionDamage,
          explosionSlowFraction: record.spec.interaction.directHit.plasmaSwarmExplosionSlowFraction,
        },
      ak47: record.provenance.correlation?.ak47ShotId === undefined
        ? undefined
        : {
          damageMultiplier: record.spec.interaction.directHit.ak47DamageMultiplier,
          fireSuperiorityShot: record.spec.interaction.directHit.ak47FireSuperiorityShot,
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
  if (record.spec.interaction.energyInjectorPayload) return { mode: 'support', memory: null };
  if (record.contacts.penetrationHitIds) return { mode: 'penetration', memory: record.contacts.penetrationHitIds };

  const proximityPiercing = kind !== 'decoy'
    && (record.spec.interaction.proximityPulse?.radius ?? 0) > 0
    && (record.spec.interaction.proximityPulse?.damage ?? 0) > 0;
  if (kind !== 'decoy' && (record.spec.flight.piercesTargets === true || proximityPiercing)) {
    const memory = record.contacts.piercingHitIds ??= new Set<string>();
    return { mode: 'pierce', memory };
  }

  if (hasGaussDischarge(record)) {
    const memory = record.contacts.gaussHitPlayers ??= new Set<string>();
    return { mode: 'pierce', memory };
  }
  if (record.spec.flight.isBfg === true) {
    const memory = record.contacts.bfgHitPlayers ??= new Set<string>();
    return { mode: 'pierce', memory };
  }

  if (kind !== 'decoy' && record.spec.flight.isFlame === true && record.contacts.flamePierceHitIds) {
    return { mode: 'flame', memory: record.contacts.flamePierceHitIds };
  }
  return { mode: 'single', memory: null };
}

function createTargetRef(
  kind: CollisionTargetKind,
  id: string | number,
  obstacleKind?: import('../types').PlaceableKind,
): CollisionTargetRef {
  switch (kind) {
    case 'player': return { kind, id: String(id) };
    case 'enemy': return { kind, id: String(id) };
    case 'decoy': return { kind, id: Number(id) };
    case 'rock': return { kind, id: Number(id), obstacleKind };
    case 'base': return { kind, id: String(id) };
    case 'train': return { kind, id: String(id) };
    case 'construction': return { kind, id: typeof id === 'number' ? id : String(id) };
  }
}

function targetKindRank(kind: CollisionTargetKind): number {
  return kind === 'rock' ? 0 : kind === 'construction' ? 1 : 2;
}

function compareTargetKeys(a: CollisionTargetSlot, b: CollisionTargetSlot): number {
  const left = a.key;
  const right = b.key;
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCombatTarget(kind: CollisionTargetKind): kind is 'player' | 'enemy' | 'decoy' {
  return kind === 'player' || kind === 'enemy' || kind === 'decoy';
}

function overlapDistanceAlongTravel(record: ProjectileRuntimeRecord, slot: CollisionTargetSlot): number {
  const dx = record.physics.sprite.x - record.lastX;
  const dy = record.physics.sprite.y - record.lastY;
  const length = Math.hypot(dx, dy);
  if (length <= 0.000001) return 0;
  return Math.max(0, Math.min(length, ((slot.x - record.lastX) * dx + (slot.y - record.lastY) * dy) / length));
}

function hasGaussDischarge(record: ProjectileRuntimeRecord): boolean {
  return (record.spec.interaction.directHit.gaussChainRadius ?? 0) > 0 && (record.spec.interaction.directHit.gaussChainDamageFactor ?? 0) > 0;
}

function hasPersistentWorldContact(
  record: ProjectileRuntimeRecord,
  slot: CollisionTargetSlot,
): boolean {
  if (slot.kind === 'rock') {
    if (record.spec.flight.isBfg === true && record.contacts.bfgHitRocks?.has(slot.numericId)) return true;
    if (hasGaussDischarge(record) && record.contacts.gaussHitRocks?.has(slot.numericId)) return true;
  }
  if (slot.kind === 'train') {
    if (record.spec.flight.isBfg === true && record.contacts.bfgHitTrain) return true;
    if (hasGaussDischarge(record) && record.contacts.gaussHitTrain) return true;
  }
  return false;
}
