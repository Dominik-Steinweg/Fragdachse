import { describe, expect, it } from 'vitest';
import { SHADOW_PROFILES } from '../src/effects/ShadowConfig';
import {
  DEFAULT_TIME_OF_DAY_MINUTES,
  MINUTES_PER_DAY,
  NEUTRAL_AMBIENT_COLOR,
  formatTimeOfDay,
  normalizeTimeOfDay,
  parseTimeOfDay,
  resolveSkyState,
} from '../src/effects/TimeOfDay';

function shadowTuple(minutes: number): { opacityMult: number; lengthMult: number; softnessMult: number } {
  const sky = resolveSkyState(minutes);
  return {
    opacityMult: sky.shadowOpacityMult,
    lengthMult: sky.shadowLengthMult,
    softnessMult: sky.shadowSoftnessMult,
  };
}

describe('time of day parsing', () => {
  it('round-trips every minute of the day', () => {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
      expect(parseTimeOfDay(formatTimeOfDay(minute))).toBe(minute);
    }
  });

  it('rejects malformed input instead of guessing', () => {
    for (const value of ['', '24:00', '12:60', '12', '12:5', 'noon', '-1:00', '12:00:00']) {
      expect(parseTimeOfDay(value)).toBeNull();
    }
  });

  it('accepts a single-digit hour and surrounding whitespace', () => {
    expect(parseTimeOfDay('3:05')).toBe(185);
    expect(parseTimeOfDay(' 17:00 ')).toBe(17 * 60);
  });

  it('wraps out-of-range minutes cyclically', () => {
    expect(normalizeTimeOfDay(MINUTES_PER_DAY)).toBe(0);
    expect(normalizeTimeOfDay(MINUTES_PER_DAY + 90)).toBe(90);
    expect(normalizeTimeOfDay(-30)).toBe(MINUTES_PER_DAY - 30);
    expect(normalizeTimeOfDay(Number.NaN)).toBe(DEFAULT_TIME_OF_DAY_MINUTES);
  });
});

describe('sky state', () => {
  // Diese beiden Tests halten die Zusage fest, dass die Umstellung auf eine
  // kontinuierliche Uhrzeit Mittag und Mitternacht optisch nicht verändert.
  it('pins noon to the former day profile', () => {
    const sky = resolveSkyState(DEFAULT_TIME_OF_DAY_MINUTES);

    // Exakt weiß: nur dann ist das MULTIPLY-Composite ein bit-exakter No-Op und der
    // Renderpass darf entfallen.
    expect(sky.ambientColor).toBe(NEUTRAL_AMBIENT_COLOR);
    expect(sky.lightFactor).toBe(0);
    expect(sky.canopyLightFactor).toBe(0);
    expect(sky.artificialLightFactor).toBe(0);
    expect(shadowTuple(DEFAULT_TIME_OF_DAY_MINUTES)).toEqual(SHADOW_PROFILES.day);
  });

  it('pins midnight to the former night profile', () => {
    const sky = resolveSkyState(0);

    expect(sky.ambientColor).toBe(0x161a24);
    expect(sky.lightFactor).toBe(1);
    expect(sky.canopyLightFactor).toBe(0.45);
    expect(sky.artificialLightFactor).toBe(1);
    expect(sky.emissiveScale).toBe(1);
    expect(shadowTuple(0)).toEqual(SHADOW_PROFILES.night);
  });

  it('interpolates across the midnight wrap without a jump', () => {
    // 23:30 und 00:00 tragen dieselben Werte; alles dazwischen muss darauf liegen.
    for (const minute of [23 * 60 + 40, 23 * 60 + 50, MINUTES_PER_DAY - 1]) {
      expect(resolveSkyState(minute).ambientColor).toBe(0x161a24);
      expect(resolveSkyState(minute).lightFactor).toBe(1);
    }
  });

  it('stays continuous across every keyframe boundary', () => {
    // Kein sichtbarer Sprung: benachbarte Minuten dürfen sich nur minimal unterscheiden.
    let previous = resolveSkyState(0);
    for (let minute = 1; minute < MINUTES_PER_DAY; minute += 1) {
      const current = resolveSkyState(minute);
      const channelStep = Math.max(
        Math.abs((current.ambientColor >> 16 & 0xff) - (previous.ambientColor >> 16 & 0xff)),
        Math.abs((current.ambientColor >> 8 & 0xff) - (previous.ambientColor >> 8 & 0xff)),
        Math.abs((current.ambientColor & 0xff) - (previous.ambientColor & 0xff)),
      );
      expect(channelStep).toBeLessThanOrEqual(3);
      expect(Math.abs(current.lightFactor - previous.lightFactor)).toBeLessThan(0.02);
      previous = current;
    }
  });

  it('keeps every derived factor inside its valid range', () => {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
      const sky = resolveSkyState(minute);
      for (const value of [
        sky.lightFactor,
        sky.canopyLightFactor,
        sky.artificialLightFactor,
        sky.shadowOpacityMult,
        sky.emissiveScale,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(sky.bleedFactor).toBe(0);
      expect(sky.shadowLengthMult).toBeGreaterThan(0);
      expect(sky.shadowSoftnessMult).toBeGreaterThan(0);
    }
  });

  // Nur bei exakt weißem Ambient darf `LightingSystem` den Renderpass überspringen. Die
  // Rundung auf 8 Bit macht daraus ein schmales Plateau um den Mittag statt einer
  // einzelnen Minute – optisch identisch, und eine Map bei 12:02 bekommt den freien Pfad
  // gratis mit. Wichtig ist nur, dass es genau ein zusammenhängendes Plateau ist: sonst
  // spränge irgendwo am Tag unerwartet der Renderpass an und wieder aus.
  it('reaches the neutral ambient in exactly one contiguous band around noon', () => {
    const neutral: number[] = [];
    for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
      if (resolveSkyState(minute).ambientColor === NEUTRAL_AMBIENT_COLOR) neutral.push(minute);
    }

    expect(neutral).toContain(DEFAULT_TIME_OF_DAY_MINUTES);
    expect(neutral[neutral.length - 1] - neutral[0]).toBe(neutral.length - 1);
    // Kurz genug, dass "Mittag" nicht versehentlich eine Viertelstunde abdeckt.
    expect(neutral.length).toBeLessThanOrEqual(15);
  });
});
