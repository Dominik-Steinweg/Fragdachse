import { describe, expect, it } from 'vitest';
import { MAX_ENEMY_SLOW_FRACTION, mergeEnemySlow } from '../src/utils/enemySlow';

/**
 * Ein Gegner traegt nur einen Verlangsamungs-Slot. Diese Datei haelt fest, wie zwei Quellen
 * darin zusammenfinden – die Regel, an der Unterdrueckungsmunition und die
 * Schrotflinten-Bremsladung gemeinsam haengen.
 */

describe('Zusammenfuehrung von Verlangsamungen', () => {
  it('setzt ohne aktiven Slow einfach den neuen Wert', () => {
    expect(mergeEnemySlow(undefined, 0.2, 2_000, 1_000))
      .toEqual({ movementFactor: 0.8, expiresAt: 3_000 });
  });

  it('laesst eine schwaechere Anwendung eine staerkere nicht verdraengen', () => {
    // Bremsladung: 50 % fuer 3 s. Danach Unterdrueckungsmunition: 20 % fuer 2 s.
    const strong = mergeEnemySlow(undefined, 0.5, 3_000, 0);
    const merged = mergeEnemySlow(strong, 0.2, 2_000, 500);

    // Der staerkere Faktor bleibt …
    expect(merged.movementFactor).toBeCloseTo(0.5, 10);
    // … und die laengere der beiden Restlaufzeiten ebenfalls.
    expect(merged.expiresAt).toBe(3_000);
  });

  it('uebernimmt den staerkeren Faktor und verlaengert bei Bedarf', () => {
    const weak = mergeEnemySlow(undefined, 0.2, 2_000, 0);
    const merged = mergeEnemySlow(weak, 0.5, 5_000, 500);
    expect(merged.movementFactor).toBeCloseTo(0.5, 10);
    expect(merged.expiresAt).toBe(5_500);
  });

  it('erneuert bei gleicher Staerke nur die Dauer', () => {
    const first = mergeEnemySlow(undefined, 0.2, 2_000, 0);
    const second = mergeEnemySlow(first, 0.2, 2_000, 1_000);
    expect(second.movementFactor).toBeCloseTo(0.8, 10);
    expect(second.expiresAt).toBe(3_000);
  });

  it('behandelt einen abgelaufenen Slow wie keinen', () => {
    const expired = mergeEnemySlow(undefined, 0.9, 1_000, 0);
    const merged = mergeEnemySlow(expired, 0.2, 2_000, 5_000);
    expect(merged.movementFactor).toBeCloseTo(0.8, 10);
    expect(merged.expiresAt).toBe(7_000);
  });

  it('laesst einen Gegner nie vollstaendig stehen', () => {
    const merged = mergeEnemySlow(undefined, 5, 1_000, 0);
    expect(merged.movementFactor).toBeCloseTo(1 - MAX_ENEMY_SLOW_FRACTION, 10);
    expect(merged.movementFactor).toBeGreaterThan(0);
  });
});
