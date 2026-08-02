import { describe, expect, it } from 'vitest';
import {
  NUKE_AFTERGLOW_MS,
  NUKE_COUNTDOWN_TENSION_START,
  NUKE_DETONATION_MS,
  NUKE_PRESSURE_WAVE_MS,
  NUKE_VARIANT_PROFILES,
  NukeChoreography,
  type NukeChoreographyFrame,
  resolveNukeCountdownFrame,
  resolveNukeVariantProfile,
} from '../src/effects/nuke/NukeChoreography';

function makeSequence(variant: 'normal' | 'void' = 'normal') {
  return new NukeChoreography(NUKE_VARIANT_PROFILES[variant], 7, 900, 500, 300);
}

/** Spielt die gesamte Sequenz in festen Schritten ab und sammelt alle Frames. */
function runToEnd(sequence: NukeChoreography, stepMs = 20): NukeChoreographyFrame[] {
  const frames = [sequence.start()];
  let guard = 0;
  while (!sequence.isFinished() && guard < 1000) {
    frames.push(sequence.step(stepMs));
    guard += 1;
  }
  return frames;
}

describe('resolveNukeCountdownFrame', () => {
  it('bleibt vor der Spannungsphase vollstaendig still', () => {
    const frame = resolveNukeCountdownFrame(1, NUKE_COUNTDOWN_TENSION_START - 0.01, 0, 0);
    expect(frame.phase).toBe('idle');
    expect(frame.cameraRequests).toHaveLength(0);
    expect(frame.telegraphBoost).toBe(0);
  });

  it('fordert genau eine Dauerquelle an, egal wie oft es pro Frame laeuft', () => {
    for (const progress of [0.75, 0.85, 0.95, 1]) {
      const frame = resolveNukeCountdownFrame(1, progress, 0, 0);
      expect(frame.cameraRequests).toHaveLength(1);
      expect(frame.cameraRequests[0].id).toBe('nuke:1');
      expect(frame.cameraRequests[0].channel).toBe('rumble');
    }
  });

  it('laesst das Rumpeln zum Einschlag hin anschwellen', () => {
    const early = resolveNukeCountdownFrame(1, 0.75, 0, 0).cameraRequests[0].amplitudePx;
    const late = resolveNukeCountdownFrame(1, 0.99, 0, 0).cameraRequests[0].amplitudePx;
    expect(late).toBeGreaterThan(early);
  });

  /**
   * Der entscheidende Punkt der Phase A: ein kameraweiter ColorMatrix entsaettigt die
   * Warnringe **mit**. Der Telegraph-Boost muss deshalb schneller wachsen als die
   * Entsaettigung, sonst wird die Warnzone schlechter lesbar statt besser.
   */
  it('hebt die Telegraphen staerker an als es die Welt entsaettigt', () => {
    for (const progress of [0.8, 0.9, 1]) {
      const frame = resolveNukeCountdownFrame(1, progress, 0, 0);
      const desaturation = Math.abs(frame.postFxPulses[0].grade?.saturation ?? 0);
      expect(frame.telegraphBoost).toBeGreaterThan(desaturation);
    }
  });
});

describe('NukeChoreography', () => {
  it('durchlaeuft die Phasen in der vorgesehenen Reihenfolge', () => {
    const sequence = makeSequence();
    const phases = [...new Set(runToEnd(sequence).map((frame) => frame.phase))];
    expect(phases).toEqual(['detonation', 'pressureWave', 'afterglow', 'idle']);
  });

  it('haelt die Phasengrenzen exakt ein', () => {
    const sequence = makeSequence();
    expect(sequence.start().phase).toBe('detonation');
    expect(sequence.step(NUKE_DETONATION_MS - 1).phase).toBe('detonation');
    expect(sequence.step(2).phase).toBe('pressureWave');
    expect(sequence.step(NUKE_PRESSURE_WAVE_MS).phase).toBe('afterglow');
    expect(sequence.step(NUKE_AFTERGLOW_MS).phase).toBe('idle');
    expect(sequence.isFinished()).toBe(true);
  });

  /** Ein Einschlag ist ein Ereignis, kein Zustand – zweimal angefordert waere er doppelt. */
  it('fordert den Kameraeinschlag genau einmal an', () => {
    const impacts = runToEnd(makeSequence())
      .flatMap((frame) => frame.cameraRequests)
      .filter((request) => request.channel === 'impact');
    expect(impacts).toHaveLength(1);
    expect(impacts[0].priority).toBe(100);
  });

  it('fordert genau einen Zoom-Puls und genau einen Detonationspuls an', () => {
    const frames = runToEnd(makeSequence());
    expect(frames.flatMap((f) => f.cameraRequests).filter((r) => r.channel === 'zoom')).toHaveLength(1);
    expect(frames.flatMap((f) => f.postFxPulses).filter((p) => p.id === 'nukeBlast:7')).toHaveLength(1);
  });

  it('gibt die Countdown-Quelle beim Einschlag frei', () => {
    expect(makeSequence().start().cameraReleases).toContain('nuke:7');
  });

  it('laesst den Bildschirmblitz aufblitzen und wieder verschwinden', () => {
    const alphas = runToEnd(makeSequence()).map((frame) => frame.skyFlashAlpha);
    expect(Math.max(...alphas)).toBeCloseTo(1, 1);
    expect(alphas[alphas.length - 1]).toBe(0);
  });

  /** Die Druckwelle laeuft als Ring nach aussen und ist die einzige Verzerrungsquelle. */
  it('erzeugt in der Druckwellenphase einen nach aussen laufenden Ring', () => {
    const distortions = runToEnd(makeSequence())
      .map((frame) => frame.distortion)
      .filter((source): source is NonNullable<typeof source> => source !== null);
    expect(distortions.length).toBeGreaterThan(0);
    for (const source of distortions) expect(source.profile).toBe('ring');
    expect(distortions[distortions.length - 1].radiusPx).toBeGreaterThan(distortions[0].radiusPx);
  });

  it('endet vollstaendig neutral und gibt alles frei', () => {
    const sequence = makeSequence();
    const frames = runToEnd(sequence);
    const last = frames[frames.length - 1];
    expect(last.phase).toBe('idle');
    expect(last.distortion).toBeNull();
    expect(last.skyFlashAlpha).toBe(0);
    expect(last.telegraphBoost).toBe(0);
    expect(last.postFxPulses).toHaveLength(0);
    expect(last.cameraReleases).toContain('nuke:7');
  });

  /** Beide Varianten teilen die Grammatik und unterscheiden sich nur im Farbprofil. */
  it('gibt Normal- und Void-Nuke dieselbe Sequenzform mit anderer Farbe', () => {
    const normalFrames = runToEnd(makeSequence('normal'));
    const voidFrames = runToEnd(makeSequence('void'));

    expect(voidFrames.map((f) => f.phase)).toEqual(normalFrames.map((f) => f.phase));

    const normalTint = normalFrames.flatMap((f) => f.postFxPulses).map((p) => p.grade?.tint).find(Boolean);
    const voidTint = voidFrames.flatMap((f) => f.postFxPulses).map((p) => p.grade?.tint).find(Boolean);
    expect(normalTint).toBeDefined();
    expect(voidTint).toBeDefined();
    expect(voidTint).not.toBe(normalTint);
  });

  it('waehlt das Farbprofil anhand des Explosionsstils', () => {
    expect(resolveNukeVariantProfile('void_nuke').variant).toBe('void');
    expect(resolveNukeVariantProfile('nuke').variant).toBe('normal');
  });
});
