import { describe, expect, it } from 'vitest';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import {
  predictPortalThrow, resolvePortalLandingPoint, resolvePortalThrowSpeed, type FireControlPortalFlightConfig,
} from '../src/systems/fireControl/FireControlPortalThrow';

const authored = UTILITY_CONFIGS.FIRE_CONTROL_PORTAL;
if (authored.type !== 'fire_control_portal' || authored.activation.type !== 'charged_throw') throw Error('portal');
const config: FireControlPortalFlightConfig = { ...authored, minThrowSpeed: authored.activation.minThrowSpeed };
const open = { blocksFlight: () => false, isLandingFree: () => true };

describe('Portal throw rule (D33/D34/D39/D43)', () => {
  it('keeps a free rest point and walks an invalid one back along the straight flight', () => {
    expect(resolvePortalLandingPoint(0, 0, 100, 0, () => true)).toEqual({ x: 100, y: 0, moved: false });
    const moved = resolvePortalLandingPoint(0, 0, 100, 0, x => x <= 61);
    expect(moved.moved).toBe(true);
    expect(moved.y).toBe(0);
    expect(moved.x).toBeLessThanOrEqual(61);
    expect(moved.x).toBeGreaterThan(55);
    // No valid point on the flight: the release point (a throw never consumes into nothing).
    expect(resolvePortalLandingPoint(10, 20, 100, 0, () => false)).toEqual({ x: 10, y: 20, moved: true });
  });

  it('is deterministic, comes to rest by friction before the safety fuse and grows with the charge', () => {
    const throwAt = (chargeFraction: number) => predictPortalThrow({ x: 0, y: 0, angle: 0, chargeFraction, config, ...open });
    const full = throwAt(1);
    expect(throwAt(1)).toEqual(full);
    expect(full.flightMs).toBeLessThan(config.fuseTime);
    expect(full.restY).toBeCloseTo(0);
    expect(throwAt(0.5).restX).toBeLessThan(full.restX);
    expect(throwAt(0).restX).toBeLessThan(throwAt(0.5).restX);
    expect(resolvePortalThrowSpeed(config, 2)).toBe(config.projectileSpeed);
  });

  it('stops before its first contact without reflection and keeps the throw direction', () => {
    const wall = 120;
    const result = predictPortalThrow({ x: 0, y: 0, angle: 0, chargeFraction: 1, config, isLandingFree: () => true,
      blocksFlight: (_x0, _y0, x1) => x1 >= wall });
    expect(result.restX).toBeLessThan(wall);
    expect(result.restX).toBeGreaterThan(wall - 20);
    const diagonal = predictPortalThrow({ x: 0, y: 0, angle: Math.PI / 4, chargeFraction: 1, config, ...open });
    expect(diagonal.restX).toBeCloseTo(diagonal.restY, 6);
  });

  it('moves an invalid landing (e.g. water) back to the last valid point of the flight', () => {
    const result = predictPortalThrow({ x: 0, y: 0, angle: 0, chargeFraction: 1, config, blocksFlight: () => false,
      isLandingFree: x => x < 200 });
    expect(result.restX).toBeGreaterThan(200);
    expect(result).toMatchObject({ moved: true, landingY: 0 });
    expect(result.landingX).toBeLessThan(200);
  });
});
