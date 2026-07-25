import { describe, expect, it } from 'vitest';

import {
  sanitizeCoopDefenseUpgradeProfile,
  getCoopDefenseResolvedEffectTotals,
} from '../src/utils/coopDefenseUpgrades';

describe('coop defense profile sanitising', () => {
  it('returns the identical instance for the same input reference', () => {
    const raw = { upgrades: { SOME_UNKNOWN_ID: { level: 2, unlocked: true } } };

    const first = sanitizeCoopDefenseUpgradeProfile(raw);
    const second = sanitizeCoopDefenseUpgradeProfile(raw);

    // Der Aufbau laeuft ueber alle Upgrade-Definitionen und war der teuerste Einzelposten im
    // Client-Frame. Bei gleicher Eingabereferenz darf er nicht erneut laufen.
    expect(second).toBe(first);
  });

  it('rebuilds for a different input reference with the same content', () => {
    const a = sanitizeCoopDefenseUpgradeProfile({ upgrades: {} });
    const b = sanitizeCoopDefenseUpgradeProfile({ upgrades: {} });

    // Verschiedene Referenzen -> eigener Eintrag, aber inhaltlich gleiches Ergebnis.
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });

  it('still handles non-object input', () => {
    expect(() => sanitizeCoopDefenseUpgradeProfile(null)).not.toThrow();
    expect(() => sanitizeCoopDefenseUpgradeProfile(undefined)).not.toThrow();
    expect(sanitizeCoopDefenseUpgradeProfile(null)).toEqual(sanitizeCoopDefenseUpgradeProfile(undefined));
  });

  it('produces stable effect totals for a memoised profile', () => {
    const raw = { upgrades: {} };
    const profile = sanitizeCoopDefenseUpgradeProfile(raw);
    const totals = getCoopDefenseResolvedEffectTotals(profile);
    expect(getCoopDefenseResolvedEffectTotals(sanitizeCoopDefenseUpgradeProfile(raw))).toEqual(totals);
  });
});
