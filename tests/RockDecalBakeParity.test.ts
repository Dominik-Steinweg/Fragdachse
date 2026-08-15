import { describe, expect, it, vi } from 'vitest';

// Phaser braucht beim Laden ein DOM. Die Bake-Pfade rufen davon nichts auf; die Attrappe stellt nur
// so viel bereit, dass die Modulkette von `ArenaBuilder` importierbar bleibt.
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, MULTIPLY: 1, ADD: 2, ERASE: 17 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Between: (min: number) => min,
    FloatBetween: () => 0.5,
    RND: { pick: <T>(items: readonly T[]) => items[0] },
  },
  Geom: { Rectangle: class {} },
  GameObjects: {
    Image: class {
      originX = 0.5;
      originY = 0.5;
      constructor(public scene: unknown, public x: number, public y: number, public key: string) {}
      setOrigin(x = 0.5, y = x): this {
        this.originX = x;
        this.originY = y;
        return this;
      }
      setPosition(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
      }
      destroy(): void {}
    },
  },
}));

import { ArenaBuilder } from '../src/arena/ArenaBuilder';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import { CELL_SIZE } from '../src/config';
import type { ArenaLayout, DecalCell } from '../src/types';
import { ROCK_DECAL_LARGE_SIZE, ROCK_DECAL_SIZE, isEnclosedRockDecal } from '../src/arena/DecalConfig';
import { createRockOverlaySource } from '../src/arena/RockOverlayRegions';
import { createFakeArenaScene, fakeRockImage, FakeRenderTexture } from './fakeArenaRenderScene';

/**
 * Vollbake und lokaler Chunk-Neubau der Fels-Decals muessen dieselbe Darstellungslogik benutzen.
 *
 * Weichen sie ab, faellt das nicht bei jeder Zerstoerung auf, sondern **einmalig** beim ersten
 * Neubau eines 128er-Bereichs: Danach steht dort das Ergebnis des Chunk-Pfads, und jeder weitere
 * Neubau bestaetigt es nur noch. Im Spiel liest sich das als mittelgrosser Nachbarbereich, der beim
 * ersten zerstoerten Fels sichtbar umspringt und danach stabil bleibt.
 */

const FRAME = { offsetX: 37, offsetY: 12, width: 256, height: 256 };

/** Alle Felsen und Decals liegen in Chunk 0:0 (0..127 px), damit der Vergleich vollstaendig ist. */
const ROCKS = [
  { gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }, { gridX: 2, gridY: 0 },
  { gridX: 0, gridY: 1 }, { gridX: 1, gridY: 1 }, { gridX: 2, gridY: 1 },
  { gridX: 0, gridY: 2 }, { gridX: 1, gridY: 2 }, { gridX: 2, gridY: 2 },
];
const CENTER_ROCK_ID = ROCKS.findIndex((cell) => cell.gridX === 1 && cell.gridY === 1);

const LARGE_CORE_DECAL = 'rock_moss_carpet';
const SMALL_EDGE_DECAL = 'rock_moss_fringe';

function decal(textureKey: string, gridX: number, gridY: number, displaySize: number): DecalCell {
  return {
    gridX,
    gridY,
    textureKey,
    offsetX: 0,
    offsetY: 0,
    terrain: 'rock',
    surface: 'rock',
    displaySize,
    rotation: 0.25,
  } as unknown as DecalCell;
}

function buildFixture() {
  const decals: DecalCell[] = [
    decal(SMALL_EDGE_DECAL, 0, 0, ROCK_DECAL_SIZE),
    // Die grosse Matte sitzt auf der Zelle, die der Test spaeter zerstoert.
    decal(LARGE_CORE_DECAL, 1, 1, ROCK_DECAL_LARGE_SIZE),
    decal(SMALL_EDGE_DECAL, 1, 1, ROCK_DECAL_SIZE),
    decal(SMALL_EDGE_DECAL, 2, 2, ROCK_DECAL_SIZE),
  ];
  const layout = { seed: 7, rocks: ROCKS, trees: [], decals } as unknown as ArenaLayout;

  const rockObjects: Array<ReturnType<typeof fakeRockImage> | null> =
    ROCKS.map((cell) => fakeRockImage(cell.gridX, cell.gridY, CELL_SIZE, FRAME.offsetX, FRAME.offsetY));

  const result = {
    rockObjects,
    rockStateTints: ROCKS.map(() => 0xffffff),
    rockDecalLayer: null,
    rockDecalCutout: null,
    rockOverlaySource: createRockOverlaySource(),
    rockMossLayer: null,
    rockMossCutout: null,
    rockMossPlacements: [{
      textureKey: 'rock_moss_01',
      worldX: FRAME.offsetX + 48,
      worldY: FRAME.offsetY + 48,
      sizePx: 32,
      rotation: 0.25,
      alpha: 0.8,
      mirrorX: false,
      mirrorY: true,
    }],
    rockVegetationLayer: null,
    rockVegetationCutout: null,
    rockVegetationPlacements: [{
      textureKey: 'rock_vegetation_01_small',
      worldX: FRAME.offsetX + 64,
      worldY: FRAME.offsetY + 32,
      lengthPx: 48,
      bandPx: 24,
      rotation: 0,
      alpha: 0.9,
      mirrorX: true,
    }],
    rockMottleLayers: [],
    rockSilhouetteCutout: null,
    rockOverlayScratch: null,
  } as unknown as ArenaBuilderResult;

  const scene = createFakeArenaScene();
  // Rundenaufbau: der Vollbake, wie ihn `buildDynamic` ausloest.
  ArenaBuilder.rebuildRockOverlays(scene as never, result, layout, FRAME);
  const decalLayer = result.rockDecalLayer as unknown as FakeRenderTexture;

  return { scene, layout, result, rockObjects, decalLayer };
}

describe('rock decal bake parity', () => {
  it('marks the large mats as enclosed and the small edge decals as not', () => {
    // Auf dieser Unterscheidung ruht die ganze Regel: Nur eine `core`-Matte liegt vollstaendig auf
    // Fels und darf deshalb rein geometrisch beschnitten werden.
    expect(isEnclosedRockDecal(LARGE_CORE_DECAL)).toBe(true);
    expect(isEnclosedRockDecal(SMALL_EDGE_DECAL)).toBe(false);
  });

  it('reproduces the full bake exactly when nothing was destroyed', () => {
    const { scene, layout, result, decalLayer } = buildFixture();
    const fullBake = [...decalLayer.content];
    expect(fullBake).toHaveLength(4);

    // Eine Aenderungswelle ohne Zerstoerung – genau der "erste Kontakt" mit dem Chunk.
    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([CENTER_ROCK_ID]),
      FRAME,
    );

    const blit = decalLayer.blits.at(-1);
    expect(blit?.localX).toBe(0);
    expect(blit?.content).toEqual(fullBake);
  });

  it('keeps every unchanged overlay pixel- and coordinate-equal with non-null arena offsets', () => {
    const { scene, layout, result } = buildFixture();
    const mottleLayers = result.rockMottleLayers as unknown as FakeRenderTexture[];
    for (const layer of mottleLayers) {
      expect(layer.camera.scrollY).toBe(0);
      expect(layer.renderCameraScrollYs.every((scrollY) => scrollY === 0)).toBe(true);
    }
    const surfaceLayers = [result.rockMossLayer, result.rockVegetationLayer]
      .filter((layer) => layer !== null) as unknown as FakeRenderTexture[];
    expect(surfaceLayers).toHaveLength(2);
    for (const layer of surfaceLayers) {
      expect(layer.camera.scrollY).toBe(0);
      expect(layer.renderCameraScrollYs.every((scrollY) => scrollY === 0)).toBe(true);
    }
    const layers = [
      ...result.rockMottleLayers,
      result.rockMossLayer,
      result.rockVegetationLayer,
      result.rockDecalLayer,
    ].filter((layer) => layer !== null);
    const fullBake = layers.map((layer) => [...(layer as unknown as FakeRenderTexture).content]);
    const fullBakePixels = layers.map((layer) =>
      (layer as unknown as FakeRenderTexture).snapshotPixels());

    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([CENTER_ROCK_ID]),
      FRAME,
    );

    expect(FRAME.offsetX).toBeGreaterThan(0);
    expect(FRAME.offsetY).toBe(12);
    expect(layers).toHaveLength(5);
    layers.forEach((layer, index) => {
      const blit = (layer as unknown as FakeRenderTexture).blits.at(-1);
      expect(blit).toMatchObject({
        localX: 0,
        localY: 0,
        drawX: 0,
        drawY: 0,
        method: 'stamp',
        originX: 0,
        originY: 0,
      });
      expect(blit?.content).toEqual(fullBake[index]);
      expect((layer as unknown as FakeRenderTexture).snapshotPixels()).toEqual(fullBakePixels[index]);
    });

    const scratch = result.rockOverlayScratch as unknown as {
      cutout: FakeRenderTexture;
      decal: FakeRenderTexture;
      mossCutout: FakeRenderTexture;
      vegetationCutout: FakeRenderTexture;
    };
    expect(scratch.cutout.camera.scrollY).toBe(0);
    expect(scratch.decal.camera.scrollY).toBe(0);
    expect(scratch.mossCutout.camera.scrollY).toBe(0);
    expect(scratch.vegetationCutout.camera.scrollY).toBe(0);
  });

  it('changes pixels only inside the destroyed rock geometry on the first regional rebuild', () => {
    const { scene, layout, result, rockObjects } = buildFixture();
    const layers = [
      ...result.rockMottleLayers,
      result.rockMossLayer,
      result.rockVegetationLayer,
      result.rockDecalLayer,
    ].filter((layer) => layer !== null) as unknown as FakeRenderTexture[];
    const before = layers.map((layer) => layer.snapshotPixels());
    const textureLocalLayerCount = result.rockMottleLayers.length + 2;

    rockObjects[CENTER_ROCK_ID] = null;
    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([CENTER_ROCK_ID]),
      FRAME,
    );

    let changedPixels = 0;
    layers.forEach((layer, layerIndex) => {
      expect(layer.renderCameraScrollYs.at(-1)).toBe(0);
      expect(layer.camera.scrollY).toBe(
        layerIndex < textureLocalLayerCount ? 0 : FRAME.offsetY,
      );
      const after = layer.snapshotPixels();
      const margin = layerIndex === 3 ? CELL_SIZE / 2 : 0;
      for (let index = 0; index < after.length; index += 1) {
        if (after[index] === before[layerIndex][index]) continue;
        changedPixels += 1;
        const x = index % FRAME.width;
        const y = Math.floor(index / FRAME.width);
        expect(x).toBeGreaterThanOrEqual(CELL_SIZE - margin);
        expect(x).toBeLessThan(CELL_SIZE * 2 + margin);
        expect(y).toBeGreaterThanOrEqual(CELL_SIZE - margin);
        expect(y).toBeLessThan(CELL_SIZE * 2 + margin);
      }
    });
    expect(changedPixels).toBeGreaterThan(0);
  });

  it('models RenderTexture GameObject draws through the target camera', () => {
    const source = new FakeRenderTexture('camera_regression_source');
    source.stamp('pixel', undefined, 0, 0).render();
    const target = new FakeRenderTexture('camera_regression_target');
    target.camera.setScroll(FRAME.offsetX, FRAME.offsetY);

    target.clear(0, 0);
    target.draw(source, 0, 0);
    target.render();

    expect(target.blits.at(-1)).toMatchObject({
      drawX: -FRAME.offsetX,
      drawY: -FRAME.offsetY,
      method: 'draw',
      content: [`pixel@${-FRAME.offsetX},${-FRAME.offsetY}`],
    });
  });

  it('cuts nothing while every source cell still carries a rock', () => {
    const { scene, layout, result } = buildFixture();
    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([CENTER_ROCK_ID]),
      FRAME,
    );
    const scratchCutout = (result.rockOverlayScratch as never as { decalCutout: FakeRenderTexture }).decalCutout;
    expect(scratchCutout.fills).toEqual([]);
  });

  it('keeps a large mat whose anchor cell fell and drops the small decal on it', () => {
    const { scene, layout, result, rockObjects, decalLayer } = buildFixture();

    rockObjects[CENTER_ROCK_ID] = null;
    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([CENTER_ROCK_ID]),
      FRAME,
    );

    const drawn = decalLayer.blits.at(-1)?.content ?? [];
    // Die Matte reicht ueber die gefallene Zelle hinaus auf stehenden Fels und bleibt deshalb.
    expect(drawn.filter((entry) => entry.startsWith(LARGE_CORE_DECAL))).toHaveLength(1);
    // Das kleine Kanten-Decal darf die Felskante ueberragen und muss mit seiner Zelle verschwinden.
    expect(drawn.some((entry) => entry.startsWith(`${SMALL_EDGE_DECAL}@48,48`))).toBe(false);
    // Die uebrigen kleinen Decals auf unveraenderten Felsen bleiben unberuehrt.
    expect(drawn.some((entry) => entry.startsWith(`${SMALL_EDGE_DECAL}@16,16`))).toBe(true);
    expect(drawn.some((entry) => entry.startsWith(`${SMALL_EDGE_DECAL}@80,80`))).toBe(true);
  });

  it('cuts exactly the square of the fallen cell, nothing else', () => {
    const { scene, layout, result, rockObjects } = buildFixture();

    rockObjects[CENTER_ROCK_ID] = null;
    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([CENTER_ROCK_ID]),
      FRAME,
    );

    const scratchCutout = (result.rockOverlayScratch as never as { decalCutout: FakeRenderTexture }).decalCutout;
    // Genau ein Quadrat. Waeren hier die uebrigen acht Zellen dabei, blieben nach dem
    // Silhouettenschnitt ihre 47-Blob-Ecken als Stanzform stehen und raeumten Decal-Pixel auf
    // unveraenderten Felsen weg – der einmalige Sprung beim ersten Neubau eines Chunks.
    expect(scratchCutout.fills).toEqual([
      { x: CELL_SIZE, y: CELL_SIZE, width: CELL_SIZE, height: CELL_SIZE },
    ]);
  });
});
