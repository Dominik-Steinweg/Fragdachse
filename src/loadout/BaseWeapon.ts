import type { WeaponConfig } from './LoadoutConfig';
import { BaseLoadoutItem } from './BaseLoadoutItem';
import { addDynamicSpread, decayDynamicSpread } from './SpreadMath';

/** Basisklasse für Waffen. Verwaltet Cooldown + dynamischen Spread (Bloom). */
export abstract class BaseWeapon extends BaseLoadoutItem<WeaponConfig> {
  private dynamicSpread = 0; // aktueller Bloom-Wert in Grad (0 = kein Spread)

  constructor(config: WeaponConfig) { super(config); }

  // ── Spread-State (Lesen) ──────────────────────────────────────────────────

  /** Aktuellen dynamischen Spread-Wert in Grad zurückgeben (0 = kein Bloom). */
  getDynamicSpread(): number {
    return this.dynamicSpread;
  }

  // ── Spread-Mutation (nach Schuss) ─────────────────────────────────────────

  /**
   * Nach einem Schuss aufrufen: Erhöht den Bloom um spreadPerShot,
   * gedeckelt auf maxDynamicSpread.
   */
  addSpread(): void {
    this.dynamicSpread = addDynamicSpread(this.dynamicSpread, this.config);
  }

  // ── Spread-Decay (jeden Frame, nur Host) ──────────────────────────────────

  /**
   * Jeden Frame aufrufen. Baut den dynamischen Spread sanft ab,
   * sobald spreadRecoveryDelay seit dem letzten Schuss vergangen ist.
   *
   * @param delta  Frame-Zeit in ms
   * @param now    Aktueller Timestamp (Date.now())
   */
  decaySpread(delta: number, now: number): void {
    this.dynamicSpread = decayDynamicSpread(
      this.dynamicSpread,
      this.config,
      delta,
      now - this.lastUsedAt,
    );
  }
}
