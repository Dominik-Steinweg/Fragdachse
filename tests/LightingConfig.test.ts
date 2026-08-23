import { describe, expect, it } from 'vitest';
import {
  EXPLOSION_OCCLUSION_REFRESH_MS,
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

  it('aktualisiert bewegliche Occluder in stationären Explosionslichtern mit 10 Hz', () => {
    expect(EXPLOSION_OCCLUSION_REFRESH_MS).toBe(100);
    expect(LIGHT_PRESETS.explosion.occludes).toBe(true);
  });

  it('hält das BFG-Licht kompakt, aber klar BFG-grün und verdeckend', () => {
    expect(LIGHT_PRESETS.bfgOrb.color).toBe(0xa6ff86);
    expect(LIGHT_PRESETS.bfgOrb.radiusPx).toBe(260);
    expect(LIGHT_PRESETS.bfgOrb.occludes).toBe(true);
  });
});
