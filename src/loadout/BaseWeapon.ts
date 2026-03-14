import type { WeaponConfig } from './LoadoutConfig';
import { BaseLoadoutItem } from './BaseLoadoutItem';

/** Basisklasse für Projektilwaffen. Verwaltet Cooldown + dynamischen Spread (Bloom). */
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
    this.dynamicSpread = Math.min(
      this.config.maxDynamicSpread,
      this.dynamicSpread + this.config.spreadPerShot,
    );
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
    if (this.dynamicSpread <= 0) return;
    if (now - this.lastUsedAt < this.config.spreadRecoveryDelay) return;

    // Anteil der Recovery-Rate, der in diesem Frame anfällt
    const ticks = delta / this.config.spreadRecoverySpeed;
    this.dynamicSpread = Math.max(0, this.dynamicSpread - ticks * this.config.spreadRecoveryRate);
  }
}
