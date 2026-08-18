import { describe, expect, it } from 'vitest';
import {
  getExplosionLightDurationMs,
  LIGHT_PRESETS,
} from '../src/effects/LightingConfig';

describe('Explosionsbeleuchtung', () => {
  it('skaliert die Lichtdauer vom kleinen Radius bis zum Nuke-Radius', () => {
    expect(getExplosionLightDurationMs(120)).toBe(1376);
    expect(getExplosionLightDurationMs(400)).toBe(2720);
    expect(getExplosionLightDurationMs(750)).toBe(4400);
  });

  it('begrenzt nur die Extremwerte und hält das flache Explosions-Falloff', () => {
    expect(getExplosionLightDurationMs(0)).toBe(900);
    expect(getExplosionLightDurationMs(2000)).toBe(5000);
    expect(LIGHT_PRESETS.explosion.decayExponent).toBeGreaterThanOrEqual(0.9);
    expect(LIGHT_PRESETS.explosion.decayExponent).toBeLessThanOrEqual(1);
  });
});
