import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import { GpuVfxEase } from '../src/effects/gpu/GpuVfxEase';
import {
  GpuVfxFrameAnimationId,
  getGpuVfxFrameAnimation,
} from '../src/effects/gpu/GpuVfxFrameAnimations';
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
    frameAnimation: -1,
    lifeMs: 500,
    x: 0,
    y: 100,
    vx: 0,
    vy: -46,
    yMode: GpuVfxEase.Gravity,
    gravityFactor: 1,
    rotation: 0,
    angularVelocity: 0,
    rotationEase: GpuVfxEase.Linear,
    scaleStart: 1,
    scaleEnd: 0,
    scaleEase: GpuVfxEase.Linear,
    stretchStart: 1,
    stretchEnd: 1,
    alphaStart: 1,
    alphaEnd: 0,
    alphaEase: GpuVfxEase.Linear,
    tint: 0xffffff,
    tintBlendStart: 1,
    tintBlendEnd: 1,
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

describe('gpu vfx member: Streckung und Tint-Blend', () => {
  it('teilt sich ohne Streckung ein Kurvenobjekt fuer beide Achsen', () => {
    const member = writeGpuVfxMember(spec({ scaleStart: 2, scaleEnd: 0.5 }), FRAME);

    // Der uniforme Normalfall darf keinen zweiten Animationsslot beschreiben.
    expect(member.scaleX).toBe(member.scaleY);
    expect((member.scaleY as { base: number }).base).toBe(2);
    expect(member.tintBlend).toBe(1);
  });

  it('streckt die lokale X-Achse und laesst die Streckung auslaufen', () => {
    const member = writeGpuVfxMember(
      spec({ scaleStart: 2, scaleEnd: 4, stretchStart: 1.5, stretchEnd: 1 }),
      FRAME,
    );
    const scaleX = member.scaleX as { base: number; amplitude: number };
    const scaleY = member.scaleY as { base: number; amplitude: number };

    expect(member.scaleX).not.toBe(member.scaleY);
    // X traegt Groesse mal Streckung, Y nur die Groesse.
    expect(scaleX.base).toBeCloseTo(3, 6);
    expect(scaleX.base + scaleX.amplitude).toBeCloseTo(4, 6);
    expect(scaleY.base).toBeCloseTo(2, 6);
    expect(scaleY.base + scaleY.amplitude).toBeCloseTo(4, 6);
  });

  it('animiert den Tint-Blend linear ueber die Lebenszeit', () => {
    const member = writeGpuVfxMember(
      spec({ tintBlendStart: 0.2, tintBlendEnd: 1, lifeMs: 400 }),
      FRAME,
    );
    const tintBlend = member.tintBlend as { base: number; amplitude: number; ease: string; duration: number };

    expect(tintBlend.ease).toBe('Linear');
    expect(tintBlend.base).toBeCloseTo(0.2, 6);
    expect(tintBlend.amplitude).toBeCloseTo(0.8, 6);
    expect(tintBlend.duration).toBe(400);
  });
});

describe('gpu vfx member: position ease', () => {
  it('applies the generic position ease to both linear axes', () => {
    const member = writeGpuVfxMember(
      spec({
        positionEase: GpuVfxEase.QuadOut,
        yMode: GpuVfxEase.Linear,
        x: 12,
        y: 34,
        vx: 80,
        vy: -40,
        lifeMs: 500,
      }),
      FRAME,
    );
    const x = member.x as { ease: string; amplitude: number };
    const y = member.y as { ease: string; amplitude: number };

    expect(x.ease).toBe('Quad.easeOut');
    expect(y.ease).toBe('Quad.easeOut');
    expect(x.amplitude).toBeCloseTo(40, 6);
    expect(y.amplitude).toBeCloseTo(-20, 6);
  });

  it('applies the release ease to rotation without changing the static path', () => {
    const animated = writeGpuVfxMember(
      spec({
        rotation: 0.4,
        angularVelocity: 2,
        rotationEase: GpuVfxEase.CubicIn,
        lifeMs: 500,
      }),
      FRAME,
    );
    const rotation = animated.rotation as { ease: string; duration: number; amplitude: number };

    expect(rotation.ease).toBe('Cubic.easeIn');
    expect(rotation.duration).toBe(500);
    expect(rotation.amplitude).toBeCloseTo(1, 6);
    expect(writeGpuVfxMember(spec({ rotation: 0.4 }), FRAME).rotation).toBe(0.4);
  });
});

describe('gpu vfx member: frame animation', () => {
  it('writes a deterministic one-shot without affecting static members', () => {
    const animation = getGpuVfxFrameAnimation(GpuVfxFrameAnimationId.DeathDisintegration);
    const animated = writeGpuVfxMember(spec({ lifeMs: 1350 }), FRAME, animation);
    const frame = animated.animation as {
      base: string;
      amplitude: number;
      duration: number;
      loop: boolean;
      yoyo: boolean;
    };

    expect(frame.base).toBe('death-disintegration');
    expect(frame.amplitude).toBe(16);
    expect(frame.duration).toBe(1351);
    expect(frame.loop).toBe(false);
    expect(frame.yoyo).toBe(false);
    expect(writeGpuVfxMember(spec(), FRAME).animation).toBeUndefined();
  });
});
