import type { ProjectileTurretChargePayload, SyncedTurretCharge, TurretBuff } from '../types';

/**
 * TurretChargeSystem – kurzzeitige Energieladung einzelner Tuerme (Energieinjektor).
 *
 * Round-Lifetime-System nach dem Muster von `OverchargeSystem`: der Host haelt die
 * Ladungen autoritativ, Clients uebernehmen sie ueber den GameState-Slice `tc` und rendern
 * sie nur. Im Gegensatz zum Ueberladungsfeld haengt eine Ladung an genau einem Turm; sie
 * wird trotzdem ortsbezogen abgefragt, weil das `TurretSystem` seinen Buff ausschliesslich
 * ueber die Turmposition zieht und so platzierte Konstrukte und Basistuerme gleich behandelt.
 */

/**
 * Zuordnungsradius zwischen gespeicherter Ladungsposition und abgefragter Turmposition.
 * Deutlich kleiner als eine Zelle, damit benachbarte Tuerme sich keine Ladung teilen.
 */
const CHARGE_MATCH_RADIUS = 12;

export class TurretChargeSystem {
  private charges = new Map<string, SyncedTurretCharge>();

  /**
   * Host: legt eine Ladung an oder verstaerkt die bestehende. Jeder Treffer setzt die
   * Restdauer neu, damit Dauerfeuer den Turm durchgehend verstaerkt haelt.
   */
  applyCharge(
    turretId: string,
    x: number,
    y: number,
    ownerId: string,
    payload: ProjectileTurretChargePayload,
    now: number,
  ): SyncedTurretCharge {
    const existing = this.charges.get(turretId);
    const maxStacks = Math.max(1, Math.floor(payload.maxStacks));
    const stacks = Math.min(maxStacks, (existing?.stacks ?? 0) + 1);
    const charge: SyncedTurretCharge = {
      turretId,
      ownerId,
      x,
      y,
      color: payload.color,
      stacks,
      damageMultiplier: 1 + stacks * payload.damageMultiplierPerStack,
      startedAt: existing?.startedAt ?? now,
      expiresAt: now + payload.durationMs,
    };
    this.charges.set(turretId, charge);
    return { ...charge };
  }

  /** Host: entfernt abgelaufene Ladungen. */
  update(now: number): void {
    if (this.charges.size === 0) return;
    for (const [turretId, charge] of this.charges) {
      if (now >= charge.expiresAt) this.charges.delete(turretId);
    }
  }

  getNetSnapshot(): SyncedTurretCharge[] {
    return [...this.charges.values()]
      .sort((left, right) => left.turretId.localeCompare(right.turretId))
      .map((charge) => ({ ...charge }));
  }

  /** Client: uebernimmt den autoritativen Bestand. */
  syncFromSnapshot(snapshot: readonly SyncedTurretCharge[]): void {
    this.charges = new Map(snapshot.map((charge) => [charge.turretId, { ...charge }]));
  }

  getActiveCharges(): readonly SyncedTurretCharge[] {
    return [...this.charges.values()];
  }

  /**
   * Schadensbuff an einer Turmposition. Die Feuerrate bleibt bewusst unberuehrt – das ist
   * die Rolle des Ueberladungsfeldes; der Injektor verstaerkt ausschliesslich den Schaden.
   */
  getBuffAt(x: number, y: number): TurretBuff | null {
    for (const charge of this.charges.values()) {
      const dx = x - charge.x;
      const dy = y - charge.y;
      if (dx * dx + dy * dy > CHARGE_MATCH_RADIUS * CHARGE_MATCH_RADIUS) continue;
      return { fireRateMultiplier: 1, damageMultiplier: charge.damageMultiplier };
    }
    return null;
  }

  clear(): void {
    this.charges.clear();
  }
}
