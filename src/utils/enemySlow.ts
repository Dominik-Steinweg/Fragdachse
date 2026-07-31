/**
 * Zusammenfuehrung zweier Verlangsamungen auf demselben Gegner.
 *
 * Es gibt bewusst nur einen Slot je Gegner statt einer Liste je Quelle – bei hunderten Gegnern
 * waere Letzteres reiner Verwaltungsaufwand. Damit dabei nichts verloren geht, gewinnen beide
 * Bestandteile getrennt: der **staerkere Faktor** und der **spaetere Ablauf**.
 *
 * Frueher wurde die Dauer bedingungslos ueberschrieben. Dadurch konnte eine schwache spaete
 * Anwendung – etwa Unterdrueckungsmunition neben einer ausgebauten Bremsladung – einen starken
 * laufenden Slow verkuerzen.
 */

export interface EnemySlowState {
  movementFactor: number;
  expiresAt: number;
}

/** Obergrenze der Verlangsamung: ein Gegner darf nie vollstaendig stehen bleiben. */
export const MAX_ENEMY_SLOW_FRACTION = 0.95;

export function mergeEnemySlow(
  existing: EnemySlowState | undefined,
  slowFraction: number,
  durationMs: number,
  now: number,
): EnemySlowState {
  const clamped = Math.min(Math.max(slowFraction, 0), MAX_ENEMY_SLOW_FRACTION);
  const movementFactor = 1 - clamped;
  const active = existing && existing.expiresAt > now ? existing : null;
  return {
    movementFactor: active ? Math.min(active.movementFactor, movementFactor) : movementFactor,
    expiresAt: Math.max(active?.expiresAt ?? 0, now + durationMs),
  };
}
