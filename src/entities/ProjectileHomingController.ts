import * as Phaser from 'phaser';
import type { ProjectileHomingConfig, HomingTargetType, TrackedProjectile } from '../types';

/** Ein vom Host gemeldetes mögliches Ziel für ein zielsuchendes Projektil. */
export interface HomingTargetCandidate {
  id: string;
  type: HomingTargetType;
  x: number;
  y: number;
}

/**
 * Nimmt einen Zielkandidaten entgegen. Der Controller schreibt in einen eigenen Pool –
 * der Provider darf sich das übergebene Objekt deshalb **nicht** merken.
 */
export type HomingTargetSink = (id: string, type: HomingTargetType, x: number, y: number) => void;

/**
 * Meldet alle Zielkandidaten für ein Projektil.
 *
 * `originX`/`originY`/`searchRadius` beschreiben den Suchkreis: Kandidaten außerhalb darf
 * der Provider weglassen. Der Controller prüft den Radius selbst noch einmal, ein Provider
 * ohne Vorauswahl bleibt also korrekt – nur teurer.
 */
export type HomingTargetProvider = (
  config: ProjectileHomingConfig,
  ownerId: string,
  originX: number,
  originY: number,
  searchRadius: number,
  emit: HomingTargetSink,
) => void;

/**
 * Prüft, ob ein Kandidat vom Projektil aus tatsächlich erreichbar ist.
 *
 * Bewusst die Schuss- und nicht die Sichtlinie: ein Ziel hinter einem beweglichen Blocker (Zug)
 * ist sichtbar, das Projektil würde aber im Blocker einschlagen. Weil dieselbe Prüfung auch für
 * das bereits gelockte Ziel läuft, verliert ein Projektil seinen Lock, sobald der Zug dazwischen
 * fährt.
 */
export type HomingLineOfFireChecker = (sx: number, sy: number, ex: number, ey: number) => boolean;
export type HomingTargetValidityChecker = (id: string, type: HomingTargetType, ownerId: string) => boolean;

const DEFAULT_HOMING_TARGET_TYPES: readonly HomingTargetType[] = ['players'];

/**
 * Host-seitige Zielsuche und Lenkung für zielsuchende Projektile.
 * Hält die von der Szene injizierten Provider (Zielkandidaten + Line-of-Fire) und
 * dreht die Projektil-Velocity pro Schritt Richtung des gewählten Ziels.
 */
export class ProjectileHomingController {
  private targetProvider: HomingTargetProvider | null = null;
  private lineOfFireChecker: HomingLineOfFireChecker | null = null;
  private targetValidityChecker: HomingTargetValidityChecker | null = null;

  // Kandidaten-Pool: bei vielen zielsuchenden Projektilen läuft die Zielsuche mehrfach
  // pro Frame, ein frisches Array mit einem Objekt je Gegner wäre reiner GC-Druck.
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

  setTargetProvider(provider: HomingTargetProvider | null): void {
    this.targetProvider = provider;
  }

  setLineOfFireChecker(checker: HomingLineOfFireChecker | null): void {
    this.lineOfFireChecker = checker;
  }

  setTargetValidityChecker(checker: HomingTargetValidityChecker | null): void {
    this.targetValidityChecker = checker;
  }

  /** Lenkt ein zielsuchendes Projektil pro Host-Schritt Richtung seines (ggf. neu gewählten) Ziels. */
  update(proj: TrackedProjectile, simulatedAgeMs: number, forceSearch = false): boolean {
    const homing = proj.homing;
    if (!homing || !this.targetProvider) return false;
    if (
      proj.lockedTargetId !== null
      && proj.lockedTargetId !== undefined
      && proj.lockedTargetType
      && !this.isTargetCurrentlyValid(proj.lockedTargetId, proj.lockedTargetType, proj.ownerId)
    ) {
      proj.lockedTargetId = null;
      proj.lockedTargetType = undefined;
      forceSearch = true;
    }
    if (!forceSearch && simulatedAgeMs < homing.acquireDelayMs) return proj.lockedTargetId != null;

    const lastSearchAt = proj.lastHomingSearchAt ?? 0;
    if (!forceSearch && lastSearchAt > 0 && simulatedAgeMs - lastSearchAt < homing.retargetIntervalMs) {
      return proj.lockedTargetId != null;
    }
    proj.lastHomingSearchAt = simulatedAgeMs;

    const target = this.selectTarget(proj, homing);
    if (!target) {
      proj.lockedTargetId = null;
      proj.lockedTargetType = undefined;
      return false;
    }

    proj.lockedTargetId = target.id;
    proj.lockedTargetType = target.type;

    const currentSpeed = proj.body.velocity.length();
    if (currentSpeed <= 0.001) return true;

    const currentAngle = Math.atan2(proj.body.velocity.y, proj.body.velocity.x);
    const targetAngle = Phaser.Math.Angle.Between(proj.sprite.x, proj.sprite.y, target.x, target.y);
    const maxTurn = Phaser.Math.DegToRad(homing.maxTurnDegreesPerStep);
    const angleDelta = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    const nextAngle = currentAngle + Phaser.Math.Clamp(angleDelta, -maxTurn, maxTurn);

    proj.body.setVelocity(
      Math.cos(nextAngle) * currentSpeed,
      Math.sin(nextAngle) * currentSpeed,
    );
    return true;
  }

  /**
   * Wählt das Ziel mit der besten Bewertung, das eine freie Schusslinie hat.
   *
   * Die Schusslinienprüfung ist der mit Abstand teuerste Teil des Host-Frames, deshalb wird
   * sie so selten wie möglich ausgeführt: zuerst nur für das bereits gelockte Ziel, und
   * danach entlang der Bewertungsreihenfolge, bis das erste Ziel besteht. Das Ergebnis ist
   * dasselbe wie "alle Kandidaten filtern, dann den besten nehmen" – nur ohne die Prüfungen
   * für Kandidaten, die ohnehin nicht gewinnen.
   */
  private selectTarget(proj: TrackedProjectile, homing: ProjectileHomingConfig): HomingTargetCandidate | null {
    if (!this.targetProvider) return null;

    const targetTypes = homing.targetTypes ?? DEFAULT_HOMING_TARGET_TYPES;
    const requireLineOfFire = homing.requireLineOfSight === true && this.lineOfFireChecker !== null;
    const excludeOwner = homing.excludeOwner !== false;
    const searchRadius = Math.max(1, homing.searchRadius);
    const searchRadiusSq = searchRadius * searchRadius;
    const distanceWeight = Math.max(0, homing.distanceWeight ?? 1);
    const forwardWeight = Math.max(0, homing.forwardWeight ?? 1);
    const originX = proj.sprite.x;
    const originY = proj.sprite.y;
    const velocity = proj.body.velocity;
    const speed = velocity.length();
    const dirX = speed > 0.001 ? velocity.x / speed : 0;
    const dirY = speed > 0.001 ? velocity.y / speed : 0;

    this.candidateCount = 0;
    this.targetProvider(homing, proj.ownerId, originX, originY, searchRadius, this.emitCandidate);
    const count = this.candidateCount;
    if (count === 0) return null;

    if (this.rejected.length < count) this.rejected = new Uint8Array(count);
    // Kandidaten, die schon an einer der billigen Prüfungen scheitern, gelten sofort als
    // erledigt – der Auswahlschleife bleibt dann nur noch die Bewertung.
    let eligible = 0;
    for (let i = 0; i < count; i += 1) {
      const candidate = this.candidatePool[i];
      const dx = candidate.x - originX;
      const dy = candidate.y - originY;
      const ineligible = !targetTypes.includes(candidate.type)
        || (excludeOwner && candidate.id === proj.ownerId)
        || dx * dx + dy * dy > searchRadiusSq
        || proj.multiExplosionExcludedTargetKeys?.has(`${candidate.type}:${candidate.id}`) === true
        || !this.isTargetCurrentlyValid(candidate.id, candidate.type, proj.ownerId);
      this.rejected[i] = ineligible ? 1 : 0;
      if (!ineligible) eligible += 1;
    }
    if (eligible === 0) return null;

    // Gelocktes Ziel zuerst: bleibt es gültig, kostet die Suche genau eine Schusslinienprüfung.
    if (proj.lockedTargetId) {
      for (let i = 0; i < count; i += 1) {
        if (this.rejected[i]) continue;
        const candidate = this.candidatePool[i];
        if (candidate.id !== proj.lockedTargetId || candidate.type !== proj.lockedTargetType) continue;
        if (!requireLineOfFire || this.lineOfFireChecker!(originX, originY, candidate.x, candidate.y)) {
          return candidate;
        }
        this.rejected[i] = 1;
        eligible -= 1;
        break;
      }
    }

    // Immer den bestbewerteten verbleibenden Kandidaten prüfen; fällt er an der Schusslinie
    // durch, rückt der nächstbeste nach.
    while (eligible > 0) {
      let bestIndex = -1;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let i = 0; i < count; i += 1) {
        if (this.rejected[i]) continue;
        const candidate = this.candidatePool[i];
        const dx = candidate.x - originX;
        const dy = candidate.y - originY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const distanceScore = 1 - Phaser.Math.Clamp(distance / searchRadius, 0, 1);
        let forwardScore = 0.5;

        if (speed > 0.001 && distance > 0) {
          forwardScore = Phaser.Math.Clamp((dirX * (dx / distance) + dirY * (dy / distance) + 1) * 0.5, 0, 1);
        }

        const score = distanceScore * distanceWeight + forwardScore * forwardWeight;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) return null;
      const best = this.candidatePool[bestIndex];
      if (!requireLineOfFire || this.lineOfFireChecker!(originX, originY, best.x, best.y)) return best;
      this.rejected[bestIndex] = 1;
      eligible -= 1;
    }

    return null;
  }

  private isTargetCurrentlyValid(id: string, type: HomingTargetType, ownerId: string): boolean {
    return this.targetValidityChecker?.(id, type, ownerId) ?? true;
  }
}
