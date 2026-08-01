import { describe, expect, it } from 'vitest';
import {
  composePostFx,
  postFxEnvelope,
  PostFxPulseSet,
} from '../src/effects/postfx/PostFxComposer';
import { NEUTRAL_WORLD_GRADE, WORLD_GRADE_CLAMPS, type WorldGrade } from '../src/effects/postfx/worldGrade';
import { getPostFxPreset, POST_FX_EVENTS } from '../src/effects/postfx/postFxPresets';

const BASE: WorldGrade = {
  ...NEUTRAL_WORLD_GRADE,
  saturation: 0.96,
  contrast: 1.02,
  vignetteStrength: 0.14,
  bloomAmount: 0.18,
};

function compose(set: PostFxPulseSet, nowMs: number, base: WorldGrade = BASE) {
  return composePostFx(base, set.prune(nowMs), nowMs);
}

describe('postFxEnvelope', () => {
  it('erreicht bei Ablauf exakt null', () => {
    for (const ease of ['impulse', 'linear', 'expo'] as const) {
      expect(postFxEnvelope(ease, 1)).toBe(0);
      expect(postFxEnvelope(ease, 2)).toBe(0);
    }
  });
});

describe('composePostFx', () => {
  it('meldet ohne Pulse und ohne Basisabweichung einen neutralen Zustand', () => {
    const state = composePostFx(NEUTRAL_WORLD_GRADE, [], 0);
    expect(state.neutral).toBe(true);
    expect(state.barrel).toBe(1);
    expect(state.activePulses).toBe(0);
  });

  it('gibt die Basis unveraendert zurueck, solange kein Puls laeuft', () => {
    const state = compose(new PostFxPulseSet(), 0);
    expect(state.saturation).toBe(BASE.saturation);
    expect(state.contrast).toBe(BASE.contrast);
    expect(state.vignetteStrength).toBe(BASE.vignetteStrength);
    expect(state.neutral).toBe(false); // Basis ist nicht neutral, aber es laeuft nichts.
    expect(state.activePulses).toBe(0);
  });

  it('legt Pulse als Delta auf die Basis', () => {
    const set = new PostFxPulseSet();
    set.request({ priority: 50, durationMs: 400, ease: 'linear', grade: { vignetteStrength: 0.2 } }, 0);
    const state = compose(set, 0);
    expect(state.vignetteStrength).toBeGreaterThan(BASE.vignetteStrength);
    expect(state.activePulses).toBe(1);
  });

  /** Der zentrale Vertrag: ein Ereignis darf nie einen Rest hinterlassen. */
  it('kehrt nach Ablauf aller Pulse exakt auf die Basis zurueck', () => {
    const set = new PostFxPulseSet();
    set.request({ priority: 100, durationMs: 300, grade: { brightness: 0.06, bloomAmount: 0.3 }, barrel: 1.2 }, 0);
    compose(set, 100);

    const after = compose(set, 400);
    expect(after.activePulses).toBe(0);
    expect(after.saturation).toBe(BASE.saturation);
    expect(after.contrast).toBe(BASE.contrast);
    expect(after.brightness).toBe(BASE.brightness);
    expect(after.vignetteStrength).toBe(BASE.vignetteStrength);
    expect(after.bloomAmount).toBe(BASE.bloomAmount);
    expect(after.barrel).toBe(1);
    expect(set.size).toBe(0);
  });

  it('addiert mehrere gleichzeitige Pulse in den Deltafeldern', () => {
    const set = new PostFxPulseSet();
    set.request({ id: 'a', priority: 40, durationMs: 400, ease: 'linear', grade: { vignetteStrength: 0.1 } }, 0);
    const single = compose(set, 0).vignetteStrength;
    set.request({ id: 'b', priority: 40, durationMs: 400, ease: 'linear', grade: { vignetteStrength: 0.1 } }, 0);
    const both = compose(set, 0).vignetteStrength;
    expect(both).toBeGreaterThan(single);
  });

  /** Zwei Farbprofile zu mitteln ergaebe eine dritte Farbe, die kein Ereignis meint. */
  it('laesst absolute Felder dem Puls mit der hoechsten Prioritaet', () => {
    const set = new PostFxPulseSet();
    set.request({ id: 'low', priority: 10, durationMs: 400, ease: 'linear', grade: { tint: 0x00ff00, tintStrength: 0.1 } }, 0);
    set.request({ id: 'high', priority: 90, durationMs: 400, ease: 'linear', grade: { tint: 0xff0000, tintStrength: 0.1 } }, 0);
    expect(compose(set, 0).tint).toBe(0xff0000);
  });

  it('aktualisiert einen Puls mit gleicher Kennung, statt ihn zu stapeln', () => {
    const set = new PostFxPulseSet();
    for (let i = 0; i < 30; i += 1) {
      set.request({ id: 'nukeDetonation', priority: 100, durationMs: 400, grade: { brightness: 0.05 } }, i * 16);
    }
    expect(set.size).toBe(1);
  });

  it('nimmt einen freigegebenen Puls sofort heraus', () => {
    const set = new PostFxPulseSet();
    set.request({ id: 'boss', priority: 60, durationMs: 4000, ease: 'linear', grade: { contrast: 0.05 } }, 0);
    expect(compose(set, 100).activePulses).toBe(1);
    set.release('boss');
    expect(compose(set, 200).activePulses).toBe(0);
  });

  /** Die Klemmungen schuetzen Telegraphen und Spielerfarben vor jeder spaeteren Abstimmung. */
  it('haelt jedes Feld innerhalb der Grenzen, auch bei absurd starken Pulsen', () => {
    const set = new PostFxPulseSet();
    for (let i = 0; i < 12; i += 1) {
      set.request({
        id: `p${i}`,
        priority: 90,
        durationMs: 800,
        ease: 'linear',
        grade: { saturation: 5, contrast: 5, brightness: 5, vignetteStrength: 5, tintStrength: 5, bloomAmount: 5 },
      }, 0);
    }
    const state = compose(set, 0);
    expect(state.saturation).toBeLessThanOrEqual(WORLD_GRADE_CLAMPS.saturation[1]);
    expect(state.contrast).toBeLessThanOrEqual(WORLD_GRADE_CLAMPS.contrast[1]);
    expect(state.brightness).toBeLessThanOrEqual(WORLD_GRADE_CLAMPS.brightness[1]);
    expect(state.vignetteStrength).toBeLessThanOrEqual(WORLD_GRADE_CLAMPS.vignetteStrength[1]);
    expect(state.tintStrength).toBeLessThanOrEqual(WORLD_GRADE_CLAMPS.tintStrength[1]);
    expect(state.bloomAmount).toBeLessThanOrEqual(WORLD_GRADE_CLAMPS.bloomAmount[1]);
  });

  it('leert alle Pulse bei clear()', () => {
    const set = new PostFxPulseSet();
    set.request({ priority: 50, durationMs: 4000, grade: { contrast: 0.05 } }, 0);
    set.clear();
    expect(compose(set, 0).activePulses).toBe(0);
  });
});

describe('postFxPresets', () => {
  it('verzerrt die Bildgeometrie in keinem Dauerpreset', () => {
    for (const event of POST_FX_EVENTS) {
      const preset = getPostFxPreset(event);
      expect(preset.barrel ?? 1).toBe(1);
    }
  });

  it('haelt jedes Preset kurz genug, um kein Dauerbild zu erzeugen', () => {
    for (const event of POST_FX_EVENTS) {
      expect(getPostFxPreset(event).durationMs).toBeLessThanOrEqual(1500);
    }
  });

  it('gibt der Nuke die hoechste Prioritaet aller Ereignisse', () => {
    const nuke = getPostFxPreset('nukeDetonation').priority;
    for (const event of POST_FX_EVENTS) {
      expect(getPostFxPreset(event).priority).toBeLessThanOrEqual(nuke);
    }
  });

  /** Normale und Void-Nuke teilen die Grammatik und unterscheiden sich nur im Farbprofil. */
  it('gibt beiden Nuke-Varianten dieselbe Sequenzform', () => {
    const normal = getPostFxPreset('nukeDetonation');
    const voidVariant = getPostFxPreset('voidNukeDetonation');
    expect(voidVariant.durationMs).toBe(normal.durationMs);
    expect(voidVariant.ease).toBe(normal.ease);
    expect(voidVariant.priority).toBe(normal.priority);
    expect(voidVariant.grade?.tint).not.toBe(normal.grade?.tint);
  });
});
