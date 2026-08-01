import { describe, expect, it } from 'vitest';
import { resolveSkyState } from '../src/effects/TimeOfDay';
import {
  isNeutralGrade,
  NEUTRAL_WORLD_GRADE,
  resolveBaseGrade,
  resolveDarkness,
  buildTintMatrix,
  type WorldGrade,
  type WorldGradeInputs,
  WORLD_GRADE_CLAMPS,
} from '../src/effects/postfx/worldGrade';

const NOON = resolveSkyState(12 * 60);
const MIDNIGHT = resolveSkyState(0);
const DUSK = resolveSkyState(20 * 60);

function inputs(overrides: Partial<WorldGradeInputs> = {}): WorldGradeInputs {
  return {
    skyState: NOON,
    isVoidMap: false,
    bossPhase: 0,
    localHpFraction: 1,
    gamePhase: 'ARENA',
    ...overrides,
  };
}

const CLAMPED_FIELDS = [
  'saturation', 'contrast', 'brightness', 'temperature',
  'tintStrength', 'vignetteRadius', 'vignetteStrength', 'bloomThreshold', 'bloomAmount',
] as const;

function expectWithinClamps(grade: WorldGrade): void {
  for (const field of CLAMPED_FIELDS) {
    const [min, max] = WORLD_GRADE_CLAMPS[field];
    expect(grade[field]).toBeGreaterThanOrEqual(min);
    expect(grade[field]).toBeLessThanOrEqual(max);
  }
}

describe('resolveDarkness', () => {
  it('ist am Mittag null und nachts deutlich groesser', () => {
    expect(resolveDarkness(NOON)).toBeCloseTo(0, 5);
    expect(resolveDarkness(MIDNIGHT)).toBeGreaterThan(0.4);
    expect(resolveDarkness(DUSK)).toBeGreaterThan(resolveDarkness(NOON));
  });
});

describe('resolveBaseGrade', () => {
  /**
   * Die harte Zusicherung des Auftrags: keine spaetere Abstimmung darf Telegraphen,
   * Spielerfarben oder Gefahrenhinweise unleserlich machen.
   */
  it('haelt jeden Zustand innerhalb der Grenzen', () => {
    const cases: WorldGradeInputs[] = [
      inputs(),
      inputs({ skyState: DUSK }),
      inputs({ skyState: MIDNIGHT }),
      inputs({ isVoidMap: true }),
      inputs({ isVoidMap: true, skyState: MIDNIGHT }),
      inputs({ bossPhase: 1 }),
      inputs({ bossPhase: 2, skyState: MIDNIGHT }),
      inputs({ localHpFraction: 0 }),
      inputs({ localHpFraction: 0, bossPhase: 2, isVoidMap: true, skyState: MIDNIGHT }),
    ];
    for (const input of cases) expectWithinClamps(resolveBaseGrade(input));
  });

  it('komponiert in der Lobby gar nicht', () => {
    const grade = resolveBaseGrade(inputs({ gamePhase: 'LOBBY', skyState: MIDNIGHT, localHpFraction: 0 }));
    expect(grade).toEqual(NEUTRAL_WORLD_GRADE);
    expect(isNeutralGrade(grade)).toBe(true);
  });

  it('entsaettigt und kuehlt zur Nacht hin', () => {
    const day = resolveBaseGrade(inputs());
    const night = resolveBaseGrade(inputs({ skyState: MIDNIGHT }));
    expect(night.saturation).toBeLessThan(day.saturation);
    expect(night.temperature).toBeLessThan(day.temperature);
    expect(night.contrast).toBeGreaterThanOrEqual(day.contrast);
  });

  /**
   * Der Bloom sieht die beleuchtete Welt. Eine feste Schwelle bluehte tagsueber ueberall und
   * nachts nirgends – sie muss der Bildhelligkeit folgen.
   */
  it('senkt die Bloom-Schwelle mit zunehmender Dunkelheit', () => {
    expect(resolveBaseGrade(inputs({ skyState: MIDNIGHT })).bloomThreshold)
      .toBeLessThan(resolveBaseGrade(inputs()).bloomThreshold);
  });

  /** Ein Farbtonwechsel bei wenig Leben wuerde Telegraph- und Teamfarben verschieben. */
  it('reagiert auf niedrige Gesundheit nur mit Vignette und Entsaettigung', () => {
    const healthy = resolveBaseGrade(inputs({ localHpFraction: 1 }));
    const hurt = resolveBaseGrade(inputs({ localHpFraction: 0.1 }));
    expect(hurt.vignetteStrength).toBeGreaterThan(healthy.vignetteStrength);
    expect(hurt.saturation).toBeLessThan(healthy.saturation);
    expect(hurt.tint).toBe(healthy.tint);
    expect(hurt.temperature).toBe(healthy.temperature);
  });

  it('gibt Void-Map und Bossphase je ein eigenes Farbprofil', () => {
    const plain = resolveBaseGrade(inputs());
    const voidMap = resolveBaseGrade(inputs({ isVoidMap: true }));
    const boss = resolveBaseGrade(inputs({ bossPhase: 2 }));
    expect(voidMap.tint).not.toBe(plain.tint);
    expect(boss.tint).not.toBe(plain.tint);
    expect(boss.tint).not.toBe(voidMap.tint);
    expect(voidMap.tintStrength).toBeGreaterThan(0);
  });

  it('verstaerkt die Toenung mit steigender Bossphase', () => {
    expect(resolveBaseGrade(inputs({ bossPhase: 2 })).tintStrength)
      .toBeGreaterThan(resolveBaseGrade(inputs({ bossPhase: 1 })).tintStrength);
  });
});

describe('buildTintMatrix', () => {
  it('liefert die 20-Werte-Form, die ColorMatrix.multiply erwartet', () => {
    expect(buildTintMatrix(0, 0xffffff, 0)).toHaveLength(20);
  });

  it('ist ohne Toenung und ohne Farbtemperatur die Identitaet', () => {
    const m = buildTintMatrix(0, 0xffffff, 0);
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[6]).toBeCloseTo(1, 6);
    expect(m[12]).toBeCloseTo(1, 6);
  });

  /** Additive Farbstiche wuerden Schwarz aufhellen und den Schwarzwert zerstoeren. */
  it('bleibt rein multiplikativ, ohne additiven Anteil', () => {
    const m = buildTintMatrix(1, 0xff0000, WORLD_GRADE_CLAMPS.tintStrength[1]);
    expect(m[4]).toBe(0);
    expect(m[9]).toBe(0);
    expect(m[14]).toBe(0);
  });

  it('hebt bei Waerme Rot und senkt Blau', () => {
    const warm = buildTintMatrix(1, 0xffffff, 0);
    const cold = buildTintMatrix(-1, 0xffffff, 0);
    expect(warm[0]).toBeGreaterThan(cold[0]);
    expect(warm[12]).toBeLessThan(cold[12]);
  });
});
