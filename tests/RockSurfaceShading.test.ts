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

  it('pins representative rock output byte-exactly', () => {
    expect(resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, 3, 1, isOccupied))
      .toEqual([0xe5eff4, 0xeaf1f6, 0xe5eff4, 0xeaf1f6]);
  });

  it('fades the hue wash out where the selected hue changes', () => {
    // Der Farbanteil waehlt je Rauschband einen anderen Farbton. Wuerde er an der Bandgrenze
    // seine volle Staerke tragen, saesse der groesste Farbsprung genau auf dem Wechsel und die
    // Flaeche zerfiele in hartkantige Farbfelder – das Gegenteil des Zwecks. Der Schrittwert
    // zwischen benachbarten Ecken bleibt deshalb im Bereich des glatten Rauschgradienten
    // (gemessen 13 statt 24 bei an der Grenze maximalem Farbanteil).
    const solid = () => true;
    const channels = (tint: number) => [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
    let maxStep = 0;
    for (let gridY = -40; gridY < 40; gridY += 1) {
      for (let gridX = -40; gridX < 40; gridX += 1) {
        const here = channels(resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, solid)[0]);
        const east = channels(resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX + 1, gridY, solid)[0]);
        const south = channels(resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY + 1, solid)[0]);
        for (let channel = 0; channel < 3; channel += 1) {
          maxStep = Math.max(maxStep, Math.abs(here[channel] - east[channel]), Math.abs(here[channel] - south[channel]));
        }
      }
    }
    expect(maxStep).toBeLessThan(20);
  });

  it('gives mottle dynamic textures collision-free profile keys', () => {
    expect(getBlobSurfaceMottleTextureKey(ROCK_BLOB_SURFACE_PROFILE))
      .not.toBe(getBlobSurfaceMottleTextureKey(DIRT_BLOB_SURFACE_PROFILE));
  });

  it('names each generated mottle texture after the layer it belongs to', () => {
    // Ein Profil mischt Materialmodi ueber seine Layer; ein Schluessel, der pauschal den Modus
    // des Basis-Layers traegt, benennt die Zusatz-Layer falsch.
    const depthLayer = ROCK_BLOB_SURFACE_PROFILE.additionalMottleLayers?.[0];
    expect(depthLayer).toBeDefined();
    const base = getBlobSurfaceMottleTextureKey(ROCK_BLOB_SURFACE_PROFILE, ROCK_BLOB_SURFACE_PROFILE.mottle, 0);
    const depth = getBlobSurfaceMottleTextureKey(ROCK_BLOB_SURFACE_PROFILE, depthLayer, 1);
    expect(base).toContain('native');
    expect(depth).toContain('normalized');
    expect(base).not.toBe(depth);
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
