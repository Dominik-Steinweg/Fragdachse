import { describe, expect, it } from 'vitest';
import { BLOOD_HIT_VFX, HIT_FEEDBACK_VFX } from '../src/config';
import {
  type HitBand,
  hitBandRank,
  mixFlashColor,
  resolveFlashAction,
  resolveHitBand,
  resolveHitFlashProfile,
  strongerBand,
} from '../src/effects/hitFeedbackModel';

// Schwellen werden aus der Konfiguration abgeleitet, nie als Literal gespiegelt.
const LIGHT_MAX = BLOOD_HIT_VFX.bands.light.maxDamage;
const MEDIUM_MAX = BLOOD_HIT_VFX.bands.medium.maxDamage;

describe('resolveHitBand', () => {
  it('folgt den Schadensbaendern des Blutspritzers', () => {
    expect(resolveHitBand(LIGHT_MAX, LIGHT_MAX, 0, false, false)).toBe('light');
    expect(resolveHitBand(LIGHT_MAX + 1, LIGHT_MAX + 1, 0, false, false)).toBe('medium');
    expect(resolveHitBand(MEDIUM_MAX, MEDIUM_MAX, 0, false, false)).toBe('medium');
    expect(resolveHitBand(MEDIUM_MAX + 1, MEDIUM_MAX + 1, 0, false, false)).toBe('heavy');
  });

  it('stuft einen toedlichen Treffer immer auf lethal', () => {
    expect(resolveHitBand(1, 1, 0, true, false)).toBe('lethal');
  });

  it('stuft einen kritischen Treffer um ein Band hoch', () => {
    expect(resolveHitBand(LIGHT_MAX, LIGHT_MAX, 0, false, true)).toBe('medium');
    expect(resolveHitBand(MEDIUM_MAX, MEDIUM_MAX, 0, false, true)).toBe('heavy');
  });

  /** Ein von der Ruestung geschluckter Treffer hat den Koerper nicht erreicht. */
  it('deckelt einen rein von Ruestung absorbierten Treffer auf medium', () => {
    expect(resolveHitBand(MEDIUM_MAX + 40, 0, MEDIUM_MAX + 40, false, false)).toBe('medium');
    // Sobald Lebenspunkte verloren gehen, gilt der Deckel nicht mehr.
    expect(resolveHitBand(MEDIUM_MAX + 40, 5, MEDIUM_MAX + 35, false, false)).toBe('heavy');
  });

  it('bleibt bei unbrauchbaren Zahlen im schwaechsten Band', () => {
    expect(resolveHitBand(Number.NaN, 0, 0, false, false)).toBe('light');
  });
});

describe('resolveHitFlashProfile', () => {
  const bands: readonly HitBand[] = ['light', 'medium', 'heavy', 'lethal'];

  it('steigert alle Kennwerte monoton mit dem Band', () => {
    for (let i = 1; i < bands.length; i += 1) {
      const weaker = resolveHitFlashProfile(bands[i - 1]);
      const stronger = resolveHitFlashProfile(bands[i]);
      expect(stronger.alpha).toBeGreaterThanOrEqual(weaker.alpha);
      expect(stronger.durationMs).toBeGreaterThanOrEqual(weaker.durationMs);
      expect(stronger.scaleBoost).toBeGreaterThanOrEqual(weaker.scaleBoost);
      expect(stronger.joltPx).toBeGreaterThanOrEqual(weaker.joltPx);
      expect(stronger.cameraKickPx).toBeGreaterThanOrEqual(weaker.cameraKickPx);
    }
  });

  it('stoesst die Kamera nur bei schweren und toedlichen Treffern an', () => {
    expect(resolveHitFlashProfile('light').cameraKickPx).toBe(0);
    expect(resolveHitFlashProfile('medium').cameraKickPx).toBe(0);
    expect(resolveHitFlashProfile('heavy').cameraKickPx).toBeGreaterThan(0);
  });

  it('haelt den visuellen Impuls unter dem globalen Deckel', () => {
    for (const band of bands) {
      expect(resolveHitFlashProfile(band).joltPx).toBeLessThanOrEqual(HIT_FEEDBACK_VFX.maxJoltPx);
    }
  });
});

describe('mixFlashColor', () => {
  it('behaelt die Materialfarbe ohne Beimischung', () => {
    expect(mixFlashColor(0x3366cc, 0)).toBe(0x3366cc);
  });

  it('ergibt bei voller Beimischung reines Weiss', () => {
    expect(mixFlashColor(0x3366cc, 1)).toBe(0xffffff);
  });

  it('klemmt Werte ausserhalb des Bereichs', () => {
    expect(mixFlashColor(0x3366cc, -1)).toBe(0x3366cc);
    expect(mixFlashColor(0x3366cc, 5)).toBe(0xffffff);
  });
});

describe('resolveFlashAction', () => {
  it('startet ohne laufenden Blitz einen neuen', () => {
    expect(resolveFlashAction(null, 'light')).toBe('spawn');
  });

  it('gibt einem staerkeren Treffer immer einen frischen Blitz', () => {
    const existing = { band: 'light' as const, ageMs: 5, totalLifeMs: 5 };
    expect(resolveFlashAction(existing, 'heavy')).toBe('spawn');
  });

  it('frischt innerhalb des Refraktaerfensters nur auf', () => {
    const existing = { band: 'light' as const, ageMs: HIT_FEEDBACK_VFX.refractoryMs - 1, totalLifeMs: 20 };
    expect(resolveFlashAction(existing, 'light')).toBe('rearm');
  });

  it('startet nach Ablauf des Refraktaerfensters wieder neu', () => {
    const existing = { band: 'light' as const, ageMs: HIT_FEEDBACK_VFX.refractoryMs, totalLifeMs: 60 };
    expect(resolveFlashAction(existing, 'light')).toBe('spawn');
  });

  /**
   * Schaden ueber Zeit liefert viele winzige Treffer. Ohne Lebenszeitdeckel bliebe die
   * Silhouette dauerhaft erleuchtet, statt zu pulsieren.
   */
  it('laesst einen dauerhaft aufgefrischten Blitz irgendwann ausklingen', () => {
    const existing = {
      band: 'light' as const,
      ageMs: 1,
      totalLifeMs: HIT_FEEDBACK_VFX.maxRearmLifetimeMs,
    };
    expect(resolveFlashAction(existing, 'light')).toBe('skip');
  });

  it('haelt einen Dauerschaden-Strom unter dem Lebenszeitdeckel', () => {
    // 200 Ticks in zwei Sekunden: es darf nie zu einem dauerhaft gehaltenen Blitz kommen.
    let ageMs = 0;
    let totalLifeMs = 0;
    let held = 0;
    for (let tick = 0; tick < 200; tick += 1) {
      const action = resolveFlashAction({ band: 'light', ageMs, totalLifeMs }, 'light');
      if (action === 'spawn') {
        ageMs = 0;
        totalLifeMs = 0;
        held = 0;
      } else if (action === 'rearm') {
        ageMs = 0;
        held += 1;
      }
      expect(held).toBeLessThanOrEqual(HIT_FEEDBACK_VFX.maxRearmLifetimeMs / 10);
      ageMs += 10;
      totalLifeMs += 10;
    }
  });
});

describe('strongerBand', () => {
  it('waehlt das hoehere Band', () => {
    expect(strongerBand('light', 'heavy')).toBe('heavy');
    expect(strongerBand('lethal', 'medium')).toBe('lethal');
    expect(hitBandRank('lethal')).toBeGreaterThan(hitBandRank('light'));
  });
});
