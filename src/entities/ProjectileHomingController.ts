import type {
  HomingRuntimeState,
  HomingTargetType,
  ProjectileHomingConfig,
} from '../types';

/** Ein vom Host gemeldetes mögliches Ziel für ein zielsuchendes Projektil. */
export interface HomingTargetCandidate {
  id: string;
  type: HomingTargetType;
  x: number;
  y: number;
}

/** Nimmt einen Zielkandidaten in den internen, wiederverwendeten Kandidaten-Pool auf. */
export type HomingTargetSink = (id: string, type: HomingTargetType, x: number, y: number) => void;

/**
 * Schmale Zielabfrage für Homing.
 *
 * Der Provider sieht weder Runtime-Records noch Phaser-Objekte. Die räumliche Vorauswahl darf
 * bereits an dieser Grenze erfolgen; der Controller prüft den Radius zusätzlich selbst.
 */
export type HomingTargetProvider = (
  config: ProjectileHomingConfig,
  ownerId: string,
  originX: number,
  originY: number,
  searchRadius: number,
  emit: HomingTargetSink,
) => void;

export interface ProjectileTargetQueryPort {
  readonly queryTargets: HomingTargetProvider;
}

/** Prüft die fachliche Gültigkeit eines bereits bekannten Zieles. */
export type HomingTargetValidityChecker = (id: string, type: HomingTargetType, ownerId: string) => boolean;

export interface ProjectileTargetabilityPort {
  readonly isTargetCurrentlyValid: HomingTargetValidityChecker;
}

/** Prüft die tatsächliche Projectile-Schusslinie, nicht bloß Sichtbarkeit. */
export type HomingLineOfFireChecker = (sx: number, sy: number, ex: number, ey: number) => boolean;

export interface LineOfFireReadPort {
  readonly hasClearLineOfFire: HomingLineOfFireChecker;
}

/** Kinematik-Port: der Homing-Processor kennt keine Sprite- oder Body-Instanz. */
export interface ProjectileKinematics {
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly setVelocity: (x: number, y: number) => void;
}

/** Alle Daten, die der Homing-Processor für ein einzelnes Projectile benötigt. */
export interface ProjectileHomingRequest {
  readonly ownerId: string;
  readonly homing: ProjectileHomingConfig;
  readonly kinematics: ProjectileKinematics;
  readonly state: HomingRuntimeState;
  readonly excludedTargetKeys?: ReadonlySet<string>;
}

const DEFAULT_HOMING_TARGET_TYPES: readonly HomingTargetType[] = ['players'];

/**
 * Host-seitige Zielsuche und Lenkung für zielsuchende Projectiles.
 *
 * Der Controller verarbeitet ausschließlich Kinematik, Homing-Spec, sparse Runtime-State und
 * die drei schmalen Reads. Seine Provider und sein Scratch-Pool bleiben beim Projectile-Owner.
 */
export class ProjectileHomingController {
  private targetQueryPort: ProjectileTargetQueryPort | null = null;
  private lineOfFirePort: LineOfFireReadPort | null = null;
  private targetabilityPort: ProjectileTargetabilityPort | null = null;

  // Kandidaten-Pool: wiederverwendet die Kandidatenobjekte über alle Homing-Suchen hinweg.
  private readonly candidatePool: HomingTargetCandidate[] = [];
  private candidateCount = 0;
  /** Kandidaten, deren Schusslinie in dieser Suche bereits durchgefallen ist. */
  private rejected = new Uint8Array(0);

  private readonly emitCandidate: HomingTargetSink = (id, type, x, y) => {
    const slot = this.candidatePool[this.candidateCount];
    if (slot) {
      slot.id = id;
      slot.type = type;
      slot.x = x;
      slot.y = y;
    } else {
      this.candidatePool[this.candidateCount] = { id, type, x, y };
    }
    this.candidateCount += 1;
  };

  /** Kompatibler Name für die bestehende Composition; bindet nur den schmalen Query-Port. */
  setTargetProvider(provider: HomingTargetProvider | null): void {
    this.targetQueryPort = provider ? { queryTargets: provider } : null;
  }

  setTargetQueryPort(port: ProjectileTargetQueryPort | null): void {
    this.targetQueryPort = port;
  }

  setLineOfFireChecker(checker: HomingLineOfFireChecker | null): void {
    this.lineOfFirePort = checker ? { hasClearLineOfFire: checker } : null;
  }

  setLineOfFireReadPort(port: LineOfFireReadPort | null): void {
    this.lineOfFirePort = port;
  }

  setTargetValidityChecker(checker: HomingTargetValidityChecker | null): void {
    this.targetabilityPort = checker ? { isTargetCurrentlyValid: checker } : null;
  }

  setTargetabilityPort(port: ProjectileTargetabilityPort | null): void {
    this.targetabilityPort = port;
  }

  /** Lenkt ein zielsuchendes Projektil pro Host-Schritt Richtung seines (ggf. neu gewählten) Ziels. */
  update(request: ProjectileHomingRequest, simulatedAgeMs: number, forceSearch = false): boolean {
    const { homing, ownerId, kinematics, state } = request;
    if (!this.targetQueryPort) return false;

    if (
      state.lockedTargetId !== null
      && state.lockedTargetId !== undefined
      && state.lockedTargetType
      && !this.isTargetCurrentlyValid(state.lockedTargetId, state.lockedTargetType, ownerId)
    ) {
      state.lockedTargetId = null;
      state.lockedTargetType = undefined;
      forceSearch = true;
    }
    if (!forceSearch && simulatedAgeMs < homing.acquireDelayMs) return state.lockedTargetId != null;

    const lastSearchAt = state.lastSearchAtSimulatedMs ?? 0;
    if (!forceSearch && lastSearchAt > 0 && simulatedAgeMs - lastSearchAt < homing.retargetIntervalMs) {
      return state.lockedTargetId != null;
    }
    state.lastSearchAtSimulatedMs = simulatedAgeMs;

    const target = this.selectTarget(request);
    if (!target) {
      state.lockedTargetId = null;
      state.lockedTargetType = undefined;
      return false;
    }

    state.lockedTargetId = target.id;
    state.lockedTargetType = target.type;

    const currentSpeed = Math.hypot(kinematics.velocityX, kinematics.velocityY);
    if (currentSpeed <= 0.001) return true;

    const currentAngle = Math.atan2(kinematics.velocityY, kinematics.velocityX);
    const targetAngle = Math.atan2(target.y - kinematics.y, target.x - kinematics.x);
    const maxTurn = homing.maxTurnDegreesPerStep * Math.PI / 180;
    const angleDelta = wrapAngle(targetAngle - currentAngle);
    const nextAngle = currentAngle + clamp(angleDelta, -maxTurn, maxTurn);

    kinematics.setVelocity(Math.cos(nextAngle) * currentSpeed, Math.sin(nextAngle) * currentSpeed);
    return true;
  }

  /** Wählt das bestbewertete erreichbare Ziel ohne Allokationen im normalen Suchpfad. */
  private selectTarget(request: ProjectileHomingRequest): HomingTargetCandidate | null {
    const { homing, ownerId, kinematics, state } = request;
    const targetQueryPort = this.targetQueryPort;
    if (!targetQueryPort) return null;

    const targetTypes = homing.targetTypes ?? DEFAULT_HOMING_TARGET_TYPES;
    const requireLineOfFire = homing.requireLineOfSight === true && this.lineOfFirePort !== null;
    const excludeOwner = homing.excludeOwner !== false;
    const searchRadius = Math.max(1, homing.searchRadius);
    const searchRadiusSq = searchRadius * searchRadius;
    const distanceWeight = Math.max(0, homing.distanceWeight ?? 1);
    const forwardWeight = Math.max(0, homing.forwardWeight ?? 1);
    const originX = kinematics.x;
    const originY = kinematics.y;
    const speed = Math.hypot(kinematics.velocityX, kinematics.velocityY);
    const dirX = speed > 0.001 ? kinematics.velocityX / speed : 0;
    const dirY = speed > 0.001 ? kinematics.velocityY / speed : 0;

    this.candidateCount = 0;
    targetQueryPort.queryTargets(homing, ownerId, originX, originY, searchRadius, this.emitCandidate);
    const count = this.candidateCount;
    if (count === 0) return null;

    if (this.rejected.length < count) this.rejected = new Uint8Array(count);
    let eligible = 0;
    for (let i = 0; i < count; i += 1) {
      const candidate = this.candidatePool[i];
      const dx = candidate.x - originX;
      const dy = candidate.y - originY;
      const ineligible = !targetTypes.includes(candidate.type)
        || (excludeOwner && candidate.id === ownerId)
        || dx * dx + dy * dy > searchRadiusSq
        || request.excludedTargetKeys?.has(`${candidate.type}:${candidate.id}`) === true
        || !this.isTargetCurrentlyValid(candidate.id, candidate.type, ownerId);
      this.rejected[i] = ineligible ? 1 : 0;
      if (!ineligible) eligible += 1;
    }
    if (eligible === 0) return null;

    // Gelocktes Ziel zuerst: bleibt es gültig, kostet die Suche genau eine Schusslinienprüfung.
    if (state.lockedTargetId) {
      for (let i = 0; i < count; i += 1) {
        if (this.rejected[i]) continue;
        const candidate = this.candidatePool[i];
        if (candidate.id !== state.lockedTargetId || candidate.type !== state.lockedTargetType) continue;
        if (!requireLineOfFire || this.lineOfFirePort!.hasClearLineOfFire(originX, originY, candidate.x, candidate.y)) {
          return candidate;
        }
        this.rejected[i] = 1;
        eligible -= 1;
        break;
      }
    }

    // Bestbewertete verbleibende Kandidaten in Reihenfolge der Bewertung prüfen.
    while (eligible > 0) {
      let bestIndex = -1;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let i = 0; i < count; i += 1) {
        if (this.rejected[i]) continue;
        const candidate = this.candidatePool[i];
        const dx = candidate.x - originX;
        const dy = candidate.y - originY;
        const distance = Math.hypot(dx, dy);
        const distanceScore = 1 - clamp(distance / searchRadius, 0, 1);
        let forwardScore = 0.5;

        if (speed > 0.001 && distance > 0) {
          forwardScore = clamp((dirX * (dx / distance) + dirY * (dy / distance) + 1) * 0.5, 0, 1);
        }

        const score = distanceScore * distanceWeight + forwardScore * forwardWeight;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) return null;
      const best = this.candidatePool[bestIndex];
      if (!requireLineOfFire || this.lineOfFirePort!.hasClearLineOfFire(originX, originY, best.x, best.y)) return best;
      this.rejected[bestIndex] = 1;
      eligible -= 1;
    }

    return null;
  }

  private isTargetCurrentlyValid(id: string, type: HomingTargetType, ownerId: string): boolean {
    return this.targetabilityPort?.isTargetCurrentlyValid(id, type, ownerId) ?? true;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
