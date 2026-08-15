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
      constructor(public scene: unknown, public x: number, public y: number, public key: string) {}
      setOrigin(): this { return this; }
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

const FRAME = { offsetX: 0, offsetY: 0, width: 256, height: 256 };

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
    ROCKS.map((cell) => fakeRockImage(cell.gridX, cell.gridY, CELL_SIZE));

  const result = {
    rockObjects,
    rockStateTints: ROCKS.map(() => 0xffffff),
    rockDecalLayer: null,
    rockDecalCutout: null,
    rockOverlaySource: createRockOverlaySource(),
    rockMossLayer: null,
    rockMossCutout: null,
    rockMossPlacements: [],
    rockVegetationLayer: null,
    rockVegetationCutout: null,
    rockVegetationPlacements: [],
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
