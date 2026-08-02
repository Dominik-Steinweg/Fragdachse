import type { SyncedReinforcementMatrix } from '../types';

export interface TargetFootprint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Optional exact collision pieces for concave structures such as bases. */
  readonly parts?: readonly TargetFootprint[];
}

function circleIntersectsFootprint(
  circleX: number,
  circleY: number,
  radius: number,
  footprint: TargetFootprint,
): boolean {
  if (footprint.parts && footprint.parts.length > 0) {
    return footprint.parts.some((part) => circleIntersectsFootprint(circleX, circleY, radius, part));
  }
  const halfWidth = Math.max(0, footprint.width) / 2;
  const halfHeight = Math.max(0, footprint.height) / 2;
  const closestX = Math.max(footprint.x - halfWidth, Math.min(circleX, footprint.x + halfWidth));
  const closestY = Math.max(footprint.y - halfHeight, Math.min(circleY, footprint.y + halfHeight));
  const dx = circleX - closestX;
  const dy = circleY - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Hostautoritativer Flaechenstatus der Verstärkungsmatrix.
 *
 * Die Abfragen arbeiten auf Ziel-Footprints statt auf Mittelpunkten. Das ist wichtig fuer
 * Basen und andere grosse Strukturen, deren Rand ein Feld bereits beruehren kann.
 */
export class ReinforcementMatrixSystem {
  private fields: SyncedReinforcementMatrix[] = [];
  private nextFieldId = 1;

  spawnMatrix(
    ownerId: string,
    x: number,
    y: number,
    radius: number,
    durationMs: number,
    damageReduction: number,
    vulnerabilityBonus: number,
    color: number,
    now: number,
  ): SyncedReinforcementMatrix {
    const field: SyncedReinforcementMatrix = {
      id: this.nextFieldId++,
      ownerId,
      x,
      y,
      radius: Math.max(0, radius),
      color,
      damageReduction: Math.max(0, Math.min(1, damageReduction)),
      vulnerabilityBonus: Math.max(0, vulnerabilityBonus),
      startedAt: now,
      expiresAt: now + Math.max(0, durationMs),
    };
    this.fields.push(field);
    return { ...field };
  }

  update(now: number): SyncedReinforcementMatrix[] {
    const expired: SyncedReinforcementMatrix[] = [];
    this.fields = this.fields.filter((field) => {
      if (now < field.expiresAt) return true;
      expired.push({ ...field });
      return false;
    });
    return expired;
  }

  getNetSnapshot(): SyncedReinforcementMatrix[] {
    return this.fields.map((field) => ({ ...field }));
  }

  syncFromSnapshot(snapshot: readonly SyncedReinforcementMatrix[]): void {
    this.fields = snapshot.map((field) => ({ ...field }));
    this.nextFieldId = Math.max(1, ...this.fields.map((field) => field.id + 1));
  }

  getActiveMatrices(): readonly SyncedReinforcementMatrix[] {
    return this.fields;
  }

  /** Staerkster aktiver Schutz; identische Effekte werden nicht multipliziert. */
  getDamageReductionForFootprint(
    footprint: TargetFootprint,
    now = Date.now(),
    fieldFilter?: (field: SyncedReinforcementMatrix) => boolean,
  ): number {
    let strongest = 0;
    for (const field of this.fields) {
      if (now >= field.expiresAt || !circleIntersectsFootprint(field.x, field.y, field.radius, footprint)) continue;
      if (fieldFilter && !fieldFilter(field)) continue;
      strongest = Math.max(strongest, field.damageReduction);
    }
    return strongest;
  }

  getDamageMultiplierForFootprint(
    footprint: TargetFootprint,
    now = Date.now(),
    fieldFilter?: (field: SyncedReinforcementMatrix) => boolean,
  ): number {
    return 1 - this.getDamageReductionForFootprint(footprint, now, fieldFilter);
  }

  getOverlappingMatrices(footprint: TargetFootprint, now = Date.now()): readonly SyncedReinforcementMatrix[] {
    return this.fields.filter((field) => (
      now < field.expiresAt && circleIntersectsFootprint(field.x, field.y, field.radius, footprint)
    ));
  }

  clear(): void {
    this.fields = [];
    this.nextFieldId = 1;
  }
}
