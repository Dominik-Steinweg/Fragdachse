import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import { GpuVfxEase } from '../src/effects/gpu/GpuVfxEase';
import { writeGpuVfxMember } from '../src/effects/gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from '../src/effects/gpu/GpuVfxSpawnSpec';

/**
 * `gravityFactor` ist der einzige Grund, warum sich Effekte mit unterschiedlicher Beschleunigung
 * eine Lane teilen duerfen. Phaser kodiert ihn in den Nachkommaanteil der Amplitude, der Shader
 * liest ihn ueber `v = floor(a)` wieder heraus – geht diese Kodierung kaputt, faellt es sonst
 * nirgends auf, weil die Partikel weiter fliegen, nur falsch.
 */

const FRAME = { name: 'flame-core' } as never;

function spec(overrides: Partial<GpuVfxSpawnSpec> = {}): GpuVfxSpawnSpec {
  return {
    effect: 0,
    lane: 0,
    frame: 0,
    lifeMs: 500,
    x: 0,
    y: 100,
    vx: 0,
    vy: -46,
    yMode: GpuVfxEase.Gravity,
    gravityFactor: 1,
    rotation: 0,
    angularVelocity: 0,
    scaleStart: 1,
    scaleEnd: 0,
    scaleEase: GpuVfxEase.Linear,
    alphaStart: 1,
    alphaEnd: 0,
    alphaEase: GpuVfxEase.Linear,
    tint: 0xffffff,
    ...overrides,
  } as GpuVfxSpawnSpec;
}

/** Phasers `_setMemberData` fuer die Gravity-Ease (SpriteGPULayer.js). */
function encodeAmplitude(velocity: number, gravityFactor: number): number {
  const clamped = gravityFactor >= 1 ? 0 : (gravityFactor < -1 ? -0.999 : gravityFactor);
  return Math.floor(velocity) + (clamped + 1) / 2;
}

/** Der Umkehrschritt aus `SpriteGPULayer.vert`. */
function decode(amplitude: number): { velocity: number; gravityFactor: number } {
  const velocity = Math.floor(amplitude);
  const factor = (amplitude - velocity) * 2 - 1;
  return { velocity, gravityFactor: factor === 0 ? 1 : factor };
}

describe('gpu vfx member: gravityFactor', () => {
  it('hands the spec factor through to the member animation', () => {
    const member = writeGpuVfxMember(spec({ gravityFactor: 0.5 }), FRAME);
    const y = member.y as { velocity: number; gravityFactor: number; ease: string };

    expect(y.ease).toBe('Gravity');
    expect(y.gravityFactor).toBe(0.5);
    // Die Geschwindigkeit ist ganzzahlig gerundet – sonst frisst Phasers `Math.floor` beim
    // Kodieren einen Teil des Nachkommaanteils, in dem der Faktor steckt.
    expect(y.velocity).toBe(-46);
    expect(Number.isInteger(y.velocity)).toBe(true);
  });

  it('survives Phasers amplitude packing for every factor the fire lanes use', () => {
    // Bodenfeuer teilt sich eine Lane mit -36 px/s²: outer -10, core -18, spark -36.
    // Projektilbrand teilt sich eine Lane mit -30: outer -24, spark -30.
    for (const factor of [10 / 36, 18 / 36, 24 / 30, 1]) {
      const member = writeGpuVfxMember(spec({ gravityFactor: factor, vy: -105 }), FRAME);
      const y = member.y as { velocity: number; gravityFactor: number };

      const decoded = decode(encodeAmplitude(y.velocity, y.gravityFactor));
      expect(decoded.velocity, `velocity bei Faktor ${factor}`).toBe(-105);
      expect(decoded.gravityFactor, `Faktor ${factor}`).toBeCloseTo(factor, 6);
    }
  });

  it('keeps the default factor of 1 at full lane gravity', () => {
    const member = writeGpuVfxMember(spec(), FRAME);
    const y = member.y as { velocity: number; gravityFactor: number };

    // Phaser kodiert 1 als 0 und der Shader liest 0 wieder als 1 – die Runde muss geschlossen sein.
    expect(decode(encodeAmplitude(y.velocity, y.gravityFactor)).gravityFactor).toBe(1);
  });

  it('ignores the factor on a linear y axis', () => {
    const member = writeGpuVfxMember(
      spec({ yMode: GpuVfxEase.Linear, gravityFactor: 0.5, vy: -40, lifeMs: 500 }),
      FRAME,
    );
    const y = member.y as { base: number; amplitude: number; ease: string };

    expect(y.ease).toBe('Linear');
    // Reine Strecke ueber die Lebenszeit, keine Beschleunigung.
    expect(y.base).toBe(100);
    expect(y.amplitude).toBeCloseTo(-20, 6);
  });
});
