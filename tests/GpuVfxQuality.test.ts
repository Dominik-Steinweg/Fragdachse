import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
const listeners: (() => void)[] = [];
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: (listener: () => void) => {
      listeners.push(listener);
      return () => {};
    },
  }),
}));

import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GpuVfxQuality } from '../src/effects/gpu/GpuVfxQuality';

/** Die Faktoren der drei Profile aus `GRAPHICS_QUALITY_PROFILES`. */
const HIGH = 1;
const MEDIUM = 0.65;
const LOW = 0.35;

function quality(): GpuVfxQuality {
  return new GpuVfxQuality({} as never);
}

beforeEach(() => {
  qualityFactors.standard = HIGH;
  listeners.length = 0;
});

describe('gpu vfx quality', () => {
  it('reproduces the interval scaling of applyEmitterProfile', () => {
    // `max(1, round(base / factor))` – skaliert wird das Intervall, nicht zusaetzlich die
    // Quantity, sonst ginge der Faktor quadratisch ein.
    const cases: [number, number, number][] = [
      [14, HIGH, 14], [74, HIGH, 74], [92, HIGH, 92],
      [14, MEDIUM, 22], [74, MEDIUM, 114], [92, MEDIUM, 142],
      [14, LOW, 40], [74, LOW, 211], [92, LOW, 263],
    ];
    for (const [base, factor, expected] of cases) {
      qualityFactors.standard = factor;
      expect(quality().scaleFrequency(base, GpuVfxEffectId.RocketExhaust)).toBe(expected);
    }
  });

  it('never returns an interval below one millisecond', () => {
    qualityFactors.standard = 4;
    expect(quality().scaleFrequency(2, GpuVfxEffectId.RocketExhaust)).toBe(1);
  });

  it('switches the emission off entirely at factor zero', () => {
    qualityFactors.standard = 0;
    const policy = quality();
    expect(policy.scaleFrequency(14, GpuVfxEffectId.RocketExhaust)).toBe(0);
    expect(policy.scaleBurst(GpuVfxEffectId.RocketSmoke, 1)).toBe(0);
  });

  it('reproduces the fractional carry of the manual burst emission', () => {
    // Semantik des `emitParticleAt`-Wrappers: pro Aufruf waechst der Uebertrag um `factor`,
    // emittiert wird sein ganzzahliger Anteil.
    qualityFactors.standard = 0.5;
    const policy = quality();
    const emitted = [];
    for (let n = 0; n < 6; n += 1) emitted.push(policy.scaleBurst(GpuVfxEffectId.RocketSmoke, 1));
    expect(emitted).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('keeps the carry of two effects apart and resets it on teardown', () => {
    qualityFactors.standard = 0.5;
    const policy = quality();
    expect(policy.scaleBurst(GpuVfxEffectId.RocketSmoke, 1)).toBe(0);
    // Ein anderer Effekt faengt bei null an statt den halben Uebertrag zu erben.
    expect(policy.scaleBurst(GpuVfxEffectId.AirstrikeBomb, 1)).toBe(0);

    policy.resetCarry(GpuVfxEffectId.RocketSmoke);
    expect(policy.scaleBurst(GpuVfxEffectId.RocketSmoke, 1)).toBe(0);
    // Der Uebertrag des anderen Effekts ist davon unberuehrt.
    expect(policy.scaleBurst(GpuVfxEffectId.AirstrikeBomb, 1)).toBe(1);
  });

  it('caches the factor and invalidates it on a quality change', () => {
    const policy = quality();
    expect(policy.getEmissionFactor(GpuVfxEffectId.RocketExhaust)).toBe(1);

    qualityFactors.standard = 0.35;
    // Ohne Benachrichtigung bleibt der Cache stehen – so wird der Faktor nicht pro Frame und
    // Effekt neu gelesen.
    expect(policy.getEmissionFactor(GpuVfxEffectId.RocketExhaust)).toBe(1);

    for (const listener of listeners) listener();
    expect(policy.getEmissionFactor(GpuVfxEffectId.RocketExhaust)).toBe(0.35);
  });

  it('takes the importance from the effect manifest', () => {
    qualityFactors.standard = 0.5;
    qualityFactors.decorative = 0;
    const policy = quality();
    // Alle Piloteffekte sind `standard`; `decorative` wuerde auf low ganz verschwinden.
    expect(policy.getEmissionFactor(GpuVfxEffectId.AirstrikeSpark)).toBe(0.5);
    expect(policy.getFactor('decorative')).toBe(0);
    qualityFactors.decorative = 1;
  });
});
