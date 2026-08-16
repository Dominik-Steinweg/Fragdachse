import { describe, expect, it } from 'vitest';
import { resolveSkyState } from '../src/effects/TimeOfDay';
import {
  isNeutralGrade,
  NEUTRAL_WORLD_GRADE,
  resolveBaseGrade,
  resolveDarkness,
  buildTintMatrix,
  smoothstep01,
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

  /**
   * Ein Farbtonwechsel bei wenig Leben wuerde Telegraph- und Teamfarben verschieben. Die
   * Verdunklung traegt den Zustand ebenfalls nicht mehr: dafuer gibt es die Blutdarstellung am
   * Bildrand. Die Vignette rahmt nur noch.
   */
  it('reagiert auf niedrige Gesundheit nur mit Entsaettigung', () => {
    const healthy = resolveBaseGrade(inputs({ localHpFraction: 1 }));
    const hurt = resolveBaseGrade(inputs({ localHpFraction: 0.1 }));
    expect(hurt.saturation).toBeLessThan(healthy.saturation);
    expect(hurt.vignetteStrength).toBe(healthy.vignetteStrength);
    expect(hurt.vignetteRadius).toBe(healthy.vignetteRadius);
    expect(hurt.tint).toBe(healthy.tint);
    expect(hurt.temperature).toBe(healthy.temperature);
  });

  /** Nachts ist die Lightmap ohnehin dunkel; ein wachsender Rand verschluckte dort Gegner. */
  it('haelt die Vignette unabhaengig von der Gesundheit', () => {
    const night = resolveBaseGrade(inputs({ skyState: MIDNIGHT, localHpFraction: 0 }));
    const nightHealthy = resolveBaseGrade(inputs({ skyState: MIDNIGHT, localHpFraction: 1 }));
    expect(night.vignetteStrength).toBe(nightHealthy.vignetteStrength);
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

  it('verwendet fuer Map 15 einen kalten Void-Boss-Look und eskaliert in Phase 2', () => {
    const normal = resolveBaseGrade(inputs({
      skyState: NOON,
      isVoidMap: true,
      bossVisualProfile: 'void-hunter',
    }));
    const phaseOne = resolveBaseGrade(inputs({
      skyState: NOON,
      isVoidMap: true,
      bossVisualProfile: 'void-hunter',
      bossPhase: 1,
      bossVisualIntensity: 1,
    }));
    const phaseTwo = resolveBaseGrade(inputs({
      skyState: NOON,
      isVoidMap: true,
      bossVisualProfile: 'void-hunter',
      bossPhase: 2,
      bossVisualIntensity: 1,
    }));

    expect(phaseOne.tint).not.toBe(normal.tint);
    expect(phaseOne.temperature).toBeLessThan(normal.temperature);
    expect(phaseOne.brightness).toBeLessThan(normal.brightness);
    expect(phaseOne.contrast).toBeGreaterThan(normal.contrast);
    expect(phaseOne.tintStrength).toBeGreaterThan(normal.tintStrength);
    expect(phaseOne.bloomAmount).toBeGreaterThan(normal.bloomAmount);
    expect(phaseOne.tintStrength).toBeGreaterThan(0.45);
    expect(phaseOne.brightness).toBeLessThan(0.94);
    expect(phaseTwo.tint).not.toBe(phaseOne.tint);
    expect(phaseTwo.temperature).toBeLessThan(phaseOne.temperature);
    expect(phaseTwo.brightness).toBeLessThan(phaseOne.brightness);
    expect(phaseTwo.contrast).toBeGreaterThan(phaseOne.contrast);
    expect(phaseTwo.tintStrength).toBeGreaterThan(phaseOne.tintStrength);
    expect(phaseTwo.bloomAmount).toBeGreaterThan(phaseOne.bloomAmount);
    expect(phaseTwo.tintStrength).toBeGreaterThan(0.55);
    expect(phaseTwo.brightness).toBeLessThan(0.90);
    expect(phaseTwo.vignetteStrength).toBeGreaterThan(phaseOne.vignetteStrength);
    expectWithinClamps(phaseOne);
    expectWithinClamps(phaseTwo);
  });

  it('laesst den generischen Boss-Tint ausserhalb von Map 15 unveraendert', () => {
    const genericBoss = resolveBaseGrade(inputs({ bossPhase: 1, bossVisualIntensity: 1 }));
    const voidBoss = resolveBaseGrade(inputs({
      isVoidMap: true,
      bossVisualProfile: 'void-hunter',
      bossPhase: 1,
      bossVisualIntensity: 1,
    }));

    expect(genericBoss.tint).toBe(0xff6a4a);
    expect(voidBoss.tint).not.toBe(genericBoss.tint);
  });

  it('blendet den Boss-Look aus dem Nacht-Look ein statt ihn hart zu ersetzen', () => {
    const normal = resolveBaseGrade(inputs({ skyState: MIDNIGHT }));
    const start = resolveBaseGrade(inputs({
      skyState: MIDNIGHT,
      bossPhase: 1,
      bossVisualIntensity: 0,
    }));
    const middle = resolveBaseGrade(inputs({
      skyState: MIDNIGHT,
      bossPhase: 1,
      bossVisualIntensity: 0.5,
    }));
    const full = resolveBaseGrade(inputs({
      skyState: MIDNIGHT,
      bossPhase: 1,
      bossVisualIntensity: 1,
    }));

    expect(start).toEqual(normal);
    expect(middle.tint).not.toBe(normal.tint);
    expect(middle.tint).not.toBe(full.tint);
    expect(middle.contrast).toBeGreaterThan(normal.contrast);
    expect(middle.contrast).toBeLessThan(full.contrast);
    expect(middle.temperature).toBeGreaterThan(normal.temperature);
    expect(middle.temperature).toBeLessThan(full.temperature);
    expect(middle.tintStrength).toBeGreaterThan(normal.tintStrength);
    expect(middle.tintStrength).toBeLessThan(full.tintStrength);
  });

  it('blendet den Map-15-Look mit demselben visuellen Faktor weich ein', () => {
    const normal = resolveBaseGrade(inputs({ isVoidMap: true, bossVisualProfile: 'void-hunter' }));
    const start = resolveBaseGrade(inputs({
      isVoidMap: true,
      bossVisualProfile: 'void-hunter',
      bossPhase: 1,
      bossVisualIntensity: 0,
    }));
    const middle = resolveBaseGrade(inputs({
      isVoidMap: true,
      bossVisualProfile: 'void-hunter',
      bossPhase: 1,
      bossVisualIntensity: 0.5,
    }));
    const full = resolveBaseGrade(inputs({
      isVoidMap: true,
      bossVisualProfile: 'void-hunter',
      bossPhase: 1,
      bossVisualIntensity: 1,
    }));

    expect(start).toEqual(normal);
    expect(middle.tint).not.toBe(normal.tint);
    expect(middle.tint).not.toBe(full.tint);
    expect(middle.temperature).toBeLessThan(normal.temperature);
    expect(middle.temperature).toBeGreaterThan(full.temperature);
    expect(middle.bloomAmount).toBeGreaterThan(normal.bloomAmount);
    expect(middle.bloomAmount).toBeLessThan(full.bloomAmount);
  });

  it('verwendet fuer den visuellen Faktor eine Smoothstep-Ease-in-out-Kurve', () => {
    expect(smoothstep01(0)).toBe(0);
    expect(smoothstep01(1)).toBe(1);
    expect(smoothstep01(0.25)).toBeLessThan(0.25);
    expect(smoothstep01(0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep01(0.75)).toBeGreaterThan(0.75);
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
