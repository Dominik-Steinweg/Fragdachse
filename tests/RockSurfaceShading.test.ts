import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { DIRT_BLOB_SURFACE_PROFILE, getBlobSurfaceMottleTextureKey, ROCK_BLOB_SURFACE_PROFILE } from '../src/arena/BlobSurfaceProfile';
import { multiplyTint, resolveBlobSurfaceCornerTints } from '../src/arena/BlobSurfaceShading';

/** 5x5-Block Fels; die Zelle (2,2) ist damit vollstaendig eingeschlossen. */
function blockOccupancy(minX: number, minY: number, maxX: number, maxY: number) {
  return (gridX: number, gridY: number) => gridX >= minX && gridX <= maxX && gridY >= minY && gridY <= maxY;
}

function luminance(tint: number): number {
  return 0.2126 * ((tint >> 16) & 0xff) + 0.7152 * ((tint >> 8) & 0xff) + 0.0722 * (tint & 0xff);
}

describe('47-Blob surface shading', () => {
  const isOccupied = blockOccupancy(0, 0, 4, 4);

  it('yields the same value at a corner shared by two cells', () => {
    // Genau diese Eigenschaft verhindert, dass sich das Zellraster als Sprung im Verlauf
    // abzeichnet: der Eckwert haengt nur an der Eckposition, nicht an der Zelle.
    for (let gridY = 0; gridY <= 4; gridY += 1) {
      for (let gridX = 0; gridX <= 3; gridX += 1) {
        const left = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied);
        const right = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX + 1, gridY, isOccupied);
        expect(right[0]).toBe(left[1]);
        expect(right[2]).toBe(left[3]);
      }
    }

    for (let gridX = 0; gridX <= 4; gridX += 1) {
      const top = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, 1, isOccupied);
      const bottom = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, 2, isOccupied);
      expect(bottom[0]).toBe(top[2]);
      expect(bottom[1]).toBe(top[3]);
    }
  });

  it('lights the north-west silhouette and shades the south-east one', () => {
    const north = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 2, 0, isOccupied);
    const south = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 2, 4, isOccupied);
    // Obere Kante der Nordzelle heller als untere Kante der Suedzelle.
    expect(luminance(north[0])).toBeGreaterThan(luminance(south[2]));

    const west = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 0, 2, isOccupied);
    const east = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 4, 2, isOccupied);
    expect(luminance(west[0])).toBeGreaterThan(luminance(east[1]));
  });

  it('keeps enclosed cells free of the directional term', () => {
    // Alle vier Ecken von (2,2) liegen im Inneren; ihr Niveau darf nur noch vom Wash
    // abweichen, nie vom Kantenlicht.
    const enclosed = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 2, 2, isOccupied);
    const maxLevel = (ROCK_BLOB_SURFACE_PROFILE.shading.baseLevel + ROCK_BLOB_SURFACE_PROFILE.shading.washValueAmount) * 255;
    const minLevel = (ROCK_BLOB_SURFACE_PROFILE.shading.baseLevel - ROCK_BLOB_SURFACE_PROFILE.shading.washValueAmount) * 255;
    for (const tint of enclosed) {
      const brightestChannel = Math.max((tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff);
      expect(brightestChannel).toBeLessThanOrEqual(Math.ceil(maxLevel));
      expect(brightestChannel).toBeGreaterThanOrEqual(Math.floor(minLevel * (1 - ROCK_BLOB_SURFACE_PROFILE.shading.washHueAmount)));
    }
  });

  it('is deterministic for the same cell', () => {
    expect(resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 3, 1, isOccupied)).toEqual(resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 3, 1, isOccupied));
  });

  it('folds a state tint in multiplicatively so damage stays proportional', () => {
    expect(multiplyTint(0xffffff, 0x808080)).toBe(0x808080);
    expect(multiplyTint(0x666666, 0xffffff)).toBe(0x666666);
    // Halbe Helligkeit des Zustands halbiert auch das Ergebnis des Flaechentints.
    expect(luminance(multiplyTint(0x808080, 0xc0c0c0))).toBeCloseTo(luminance(0x606060), 0);
  });

  it('uses independent deterministic wash regions per profile', () => {
    const rock = resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 3, 1, isOccupied);
    expect(rock).not.toEqual(resolveBlobSurfaceCornerTints(DIRT_BLOB_SURFACE_PROFILE, 3, 1, isOccupied));
  });

  it('keeps dirt flat by disabling directional silhouette shading', () => {
    const top = resolveBlobSurfaceCornerTints(DIRT_BLOB_SURFACE_PROFILE, 2, 0, isOccupied);
    const bottom = resolveBlobSurfaceCornerTints(DIRT_BLOB_SURFACE_PROFILE, 2, 4, isOccupied);
    expect(DIRT_BLOB_SURFACE_PROFILE.shading.directional).toBeUndefined();
    expect(Math.abs(luminance(top[0]) - luminance(bottom[2]))).toBeLessThan(20);
  });

  it('keeps representative legacy rock output byte-identical', () => {
    expect(resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 3, 1, isOccupied))
      .toEqual([0xffffff, 0xfbfcfd, 0xffffff, 0xfbfcfd]);
  });

  it('gives mottle dynamic textures collision-free profile keys', () => {
    expect(getBlobSurfaceMottleTextureKey(ROCK_BLOB_SURFACE_PROFILE))
      .not.toBe(getBlobSurfaceMottleTextureKey(DIRT_BLOB_SURFACE_PROFILE));
  });

  it('uses independent alternate material sources for weak normal replacement passes', () => {
    expect(DIRT_BLOB_SURFACE_PROFILE.materialTextureKey).toBe('dirt_mottle');
    expect(DIRT_BLOB_SURFACE_PROFILE.materialTextureKey).not.toBe(DIRT_BLOB_SURFACE_PROFILE.textureKey);
    expect(ROCK_BLOB_SURFACE_PROFILE.materialTextureKey).toBe('rock_mottle');
    expect(ROCK_BLOB_SURFACE_PROFILE.materialTextureKey).not.toBe(ROCK_BLOB_SURFACE_PROFILE.textureKey);
    expect(DIRT_BLOB_SURFACE_PROFILE.mottle).toMatchObject({ blend: 'normal', materialMode: 'native' });
    expect(ROCK_BLOB_SURFACE_PROFILE.mottle).toMatchObject({ blend: 'normal', materialMode: 'native' });
    expect(ROCK_BLOB_SURFACE_PROFILE.additionalMottleLayers).toHaveLength(1);
    expect(ROCK_BLOB_SURFACE_PROFILE.additionalMottleLayers?.[0]).toMatchObject({ blend: 'multiply', materialMode: 'normalized' });
  });

  it('keeps material texture and frame choices out of the generic mottle core', () => {
    const core = readFileSync(new URL('../src/arena/BlobSurfaceMottle.ts', import.meta.url), 'utf8');
    expect(core).not.toContain("'rocks'");
    expect(core).not.toContain('materialFrame: 12');
  });
});
