import { describe, expect, it } from 'vitest';

import { ROCK_SURFACE_SHADING, multiplyTint, resolveRockSurfaceCornerTints } from '../src/arena/RockSurfaceShading';

/** 5x5-Block Fels; die Zelle (2,2) ist damit vollstaendig eingeschlossen. */
function blockOccupancy(minX: number, minY: number, maxX: number, maxY: number) {
  return (gridX: number, gridY: number) => gridX >= minX && gridX <= maxX && gridY >= minY && gridY <= maxY;
}

function luminance(tint: number): number {
  return 0.2126 * ((tint >> 16) & 0xff) + 0.7152 * ((tint >> 8) & 0xff) + 0.0722 * (tint & 0xff);
}

describe('Rock surface shading', () => {
  const isOccupied = blockOccupancy(0, 0, 4, 4);

  it('yields the same value at a corner shared by two cells', () => {
    // Genau diese Eigenschaft verhindert, dass sich das Zellraster als Sprung im Verlauf
    // abzeichnet: der Eckwert haengt nur an der Eckposition, nicht an der Zelle.
    for (let gridY = 0; gridY <= 4; gridY += 1) {
      for (let gridX = 0; gridX <= 3; gridX += 1) {
        const left = resolveRockSurfaceCornerTints(gridX, gridY, isOccupied);
        const right = resolveRockSurfaceCornerTints(gridX + 1, gridY, isOccupied);
        expect(right[0]).toBe(left[1]);
        expect(right[2]).toBe(left[3]);
      }
    }

    for (let gridX = 0; gridX <= 4; gridX += 1) {
      const top = resolveRockSurfaceCornerTints(gridX, 1, isOccupied);
      const bottom = resolveRockSurfaceCornerTints(gridX, 2, isOccupied);
      expect(bottom[0]).toBe(top[2]);
      expect(bottom[1]).toBe(top[3]);
    }
  });

  it('lights the north-west silhouette and shades the south-east one', () => {
    const north = resolveRockSurfaceCornerTints(2, 0, isOccupied);
    const south = resolveRockSurfaceCornerTints(2, 4, isOccupied);
    // Obere Kante der Nordzelle heller als untere Kante der Suedzelle.
    expect(luminance(north[0])).toBeGreaterThan(luminance(south[2]));

    const west = resolveRockSurfaceCornerTints(0, 2, isOccupied);
    const east = resolveRockSurfaceCornerTints(4, 2, isOccupied);
    expect(luminance(west[0])).toBeGreaterThan(luminance(east[1]));
  });

  it('keeps enclosed cells free of the directional term', () => {
    // Alle vier Ecken von (2,2) liegen im Inneren; ihr Niveau darf nur noch vom Wash
    // abweichen, nie vom Kantenlicht.
    const enclosed = resolveRockSurfaceCornerTints(2, 2, isOccupied);
    const maxLevel = (ROCK_SURFACE_SHADING.baseLevel + ROCK_SURFACE_SHADING.washValueAmount) * 255;
    const minLevel = (ROCK_SURFACE_SHADING.baseLevel - ROCK_SURFACE_SHADING.washValueAmount) * 255;
    for (const tint of enclosed) {
      const brightestChannel = Math.max((tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff);
      expect(brightestChannel).toBeLessThanOrEqual(Math.ceil(maxLevel));
      expect(brightestChannel).toBeGreaterThanOrEqual(Math.floor(minLevel * (1 - ROCK_SURFACE_SHADING.washHueAmount)));
    }
  });

  it('is deterministic for the same cell', () => {
    expect(resolveRockSurfaceCornerTints(3, 1, isOccupied)).toEqual(resolveRockSurfaceCornerTints(3, 1, isOccupied));
  });

  it('folds a state tint in multiplicatively so damage stays proportional', () => {
    expect(multiplyTint(0xffffff, 0x808080)).toBe(0x808080);
    expect(multiplyTint(0x666666, 0xffffff)).toBe(0x666666);
    // Halbe Helligkeit des Zustands halbiert auch das Ergebnis des Flaechentints.
    expect(luminance(multiplyTint(0x808080, 0xc0c0c0))).toBeCloseTo(luminance(0x606060), 0);
  });
});
