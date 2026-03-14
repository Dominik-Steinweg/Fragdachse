/**
 * Abstrakte Basisklasse für alle Loadout-Items.
 * Verwaltet den zeitbasierten Cooldown.
 * Ultimates überschreiben canUse() für Rage-basierte Logik.
 */
export abstract class BaseLoadoutItem<T extends { cooldown: number }> {
  abstract readonly config: T;

  private lastUsedAt = -Infinity;

  /** True wenn der Cooldown noch nicht abgelaufen ist. */
  isOnCooldown(now: number): boolean {
    return now - this.lastUsedAt < this.config.cooldown;
  }

  /** Zeitstempel des letzten Einsatzes setzen. */
  recordUse(now: number): void {
    this.lastUsedAt = now;
  }

  /**
   * Cooldown-Fraktion: 0 = bereit, 1 = gerade benutzt.
   * Für HUD-Darstellung.
   */
  getCooldownFrac(now: number): number {
    const cd = this.config.cooldown;
    if (cd <= 0) return 0;
    const elapsed = now - this.lastUsedAt;
    return Math.max(0, Math.min(1, (cd - elapsed) / cd));
  }
}
