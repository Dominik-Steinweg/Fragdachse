import type { SyncedOverchargeField, TurretBuff } from '../types';

/**
 * OverchargeSystem – Ueberladungsfelder des Ingenieurs.
 *
 * Round-Lifetime-System: wird in `buildArena()` erzeugt und in `tearDownArena()` verworfen.
 * Der Host haelt die aktiven Felder autoritativ; Clients bekommen sie ueber den
 * GameState-Slice `oc` und rendern sie nur.
 *
 * Der Buff wird ortsbezogen abgefragt (`getBuffAt`) statt an einzelne Tuerme gebunden.
 * Dadurch profitieren platzierte Konstruktionen, Fliegenpilze und die festen Basistuerme
 * gleichermassen, ohne dass das TurretSystem die Herkunft eines Turms kennen muss.
 */
export class OverchargeSystem {
  private fields: SyncedOverchargeField[] = [];
  private nextFieldId = 1;

  /** Host: legt ein neues Feld an. Die Zielposition ist bereits geclamped. */
  spawnField(
    ownerId: string,
    x: number,
    y: number,
    radius: number,
    durationMs: number,
    fireRateMultiplier: number,
    damageMultiplier: number,
    color: number,
    now: number,
  ): SyncedOverchargeField {
    const field: SyncedOverchargeField = {
      id: this.nextFieldId++,
      ownerId,
      x,
      y,
      radius,
      color,
      fireRateMultiplier,
      damageMultiplier,
      startedAt: now,
      expiresAt: now + durationMs,
    };
    this.fields.push(field);
    return { ...field };
  }

  /** Host: entfernt abgelaufene Felder und meldet sie zurueck. */
  update(now: number): SyncedOverchargeField[] {
    if (this.fields.length === 0) return [];
    const expired: SyncedOverchargeField[] = [];
    this.fields = this.fields.filter((field) => {
      if (now < field.expiresAt) return true;
      expired.push({ ...field });
      return false;
    });
    return expired;
  }

  getNetSnapshot(): SyncedOverchargeField[] {
    return this.fields.map((field) => ({ ...field }));
  }

  /** Client: uebernimmt den autoritativen Bestand. */
  syncFromSnapshot(snapshot: readonly SyncedOverchargeField[]): void {
    this.fields = snapshot.map((field) => ({ ...field }));
  }

  getActiveFields(): readonly SyncedOverchargeField[] {
    return this.fields;
  }

  /**
   * Kombinierter Buff an einer Position. Ueberlappende Felder wirken multiplikativ,
   * damit zwei Ingenieure ihre Verteidigung bewusst stapeln koennen.
   */
  getBuffAt(x: number, y: number): TurretBuff | null {
    let fireRateMultiplier = 1;
    let damageMultiplier = 1;
    let hit = false;
    for (const field of this.fields) {
      const dx = x - field.x;
      const dy = y - field.y;
      if (dx * dx + dy * dy > field.radius * field.radius) continue;
      fireRateMultiplier *= field.fireRateMultiplier;
      damageMultiplier *= field.damageMultiplier;
      hit = true;
    }
    return hit ? { fireRateMultiplier, damageMultiplier } : null;
  }

  clear(): void {
    this.fields = [];
  }
}
