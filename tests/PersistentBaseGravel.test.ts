import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { CELL_SIZE, DEPTH } from '../src/config';
import { MAX_PERSISTENT_BASE_RADIUS_CELLS } from '../src/config/persistentBase';
import { AutoTiler, GRAVEL_AUTOTILE } from '../src/arena/AutoTiler';
import { ChunkedRenderSurface } from '../src/arena/chunks/ChunkedRenderSurface';
import {
  GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID,
  GroundSurfaceStreamer,
} from '../src/arena/chunks/GroundSurfaceStreamer';
import {
  createPersistentBaseGravelState,
  getPersistentBaseGravelCells,
  persistentBaseGravelCellKey,
} from '../src/arena/PersistentBaseGravelField';
import { GRAVEL_BLOB_SURFACE_PROFILE } from '../src/arena/BlobSurfaceProfile';
import { isCellInsidePersistentBaseZone } from '../src/persistentBase/PersistentBaseZone';
import {
  PERSISTENT_BASE_GRAVEL_ASSET_PATH,
  PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG,
  preloadPersistentBaseGravelAssets,
} from '../src/arena/PersistentBaseGravelConfig';
import type { ArenaLayout } from '../src/types';
import { createFakeArenaScene } from './fakeArenaRenderScene';

const FRAME = { offsetX: 37, offsetY: 12, width: 512, height: 256 };
const VIEW = { x: FRAME.offsetX, y: FRAME.offsetY, width: 256, height: 128 };

function createLayout(seed = 17): ArenaLayout {
  return {
    seed,
    rocks: [],
    trees: [],
    dirt: [],
    decals: [],
  } as unknown as ArenaLayout;
}

function drain(scene: object): void {
  ChunkedRenderSurface.drainBakeQueue(scene as never);
}

describe('persistent-base gravel field', () => {
  it('uses exactly the active circular radius and never the reservation radius', () => {
    const anchor = { gridX: 20, gridY: 12 };
    const radiusCells = 2;
    const cells = getPersistentBaseGravelCells(anchor, radiusCells, 40, 30);
    const expected = [];
    for (let gridY = 0; gridY < 30; gridY += 1) {
      for (let gridX = 0; gridX < 40; gridX += 1) {
        if (isCellInsidePersistentBaseZone(gridX - anchor.gridX, gridY - anchor.gridY, radiusCells)) {
          expected.push({ gridX, gridY });
        }
      }
    }

    expect(cells).toEqual(expected);
    expect(cells.every((cell) => Math.hypot(cell.gridX - anchor.gridX, cell.gridY - anchor.gridY) <= radiusCells)).toBe(true);
    expect(cells.length).toBeLessThan(
      getPersistentBaseGravelCells(anchor, MAX_PERSISTENT_BASE_RADIUS_CELLS, 40, 30).length,
    );
  });

  it('keeps complete 47-blob neighbour context across a 128-px chunk boundary', () => {
    const state = createPersistentBaseGravelState({
      seed: 23,
      anchor: { gridX: 4, gridY: 1 },
      radiusCells: 2,
      frame: { offsetX: 0, offsetY: 0, width: 512, height: 128 },
    });
    const fullSet = state.cellKeys;
    expect(fullSet.has(persistentBaseGravelCellKey(3, 1))).toBe(true);
    expect(fullSet.has(persistentBaseGravelCellKey(4, 1))).toBe(true);
    expect(Math.floor((3 * CELL_SIZE) / 128)).toBe(0);
    expect(Math.floor((4 * CELL_SIZE) / 128)).toBe(1);

    const fullMask = AutoTiler.computeMask(
      3,
      1,
      (gridX, gridY) => fullSet.has(persistentBaseGravelCellKey(gridX, gridY)),
    );
    const chunkLocalSet = new Set(
      state.cells
        .filter((cell) => Math.floor((cell.gridX * CELL_SIZE) / 128) === 0)
        .map((cell) => persistentBaseGravelCellKey(cell.gridX, cell.gridY)),
    );
    const chunkLocalMask = AutoTiler.computeMask(
      3,
      1,
      (gridX, gridY) => chunkLocalSet.has(persistentBaseGravelCellKey(gridX, gridY)),
    );

    expect(fullMask & 4).toBe(4);
    expect(chunkLocalMask & 4).toBe(0);
    expect(AutoTiler.getFrame(fullMask, GRAVEL_AUTOTILE)).not.toBe(
      AutoTiler.getFrame(chunkLocalMask, GRAVEL_AUTOTILE),
    );
  });

  it('is pixel-stable for the same seed and preserves inner placements when the radius grows', () => {
    const config = {
      ...PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG,
      coveragePercent: 100,
      variants: [{ fileName: 'gravel_patch_01.png', frequencyPercent: 100 }],
    } as const;
    const options = {
      seed: 91,
      anchor: { gridX: 8, gridY: 8 },
      frame: { offsetX: 37, offsetY: 12, width: 640, height: 640 },
      config,
    };
    const first = createPersistentBaseGravelState({ ...options, radiusCells: 3 });
    const reload = createPersistentBaseGravelState({ ...options, radiusCells: 3 });
    const expanded = createPersistentBaseGravelState({ ...options, radiusCells: 4 });
    const expandedByCell = new Map(
      expanded.decorations.map((decoration) => [
        persistentBaseGravelCellKey(decoration.gridX, decoration.gridY),
        decoration,
      ]),
    );

    expect(first.decorations).not.toHaveLength(0);
    expect(first.decorations).toEqual(reload.decorations);
    expect(GRAVEL_BLOB_SURFACE_PROFILE.mottle.passes.length).toBeGreaterThan(0);
    for (const decoration of first.decorations) {
      expect(decoration.sizePx / CELL_SIZE).toBeGreaterThanOrEqual(config.minSizeCells);
      expect(decoration.sizePx / CELL_SIZE).toBeLessThanOrEqual(config.maxSizeCells);
      expect(decoration.alpha).toBeGreaterThanOrEqual(config.minAlpha);
      expect(decoration.alpha).toBeLessThanOrEqual(config.maxAlpha);

      const centerGridX = (decoration.worldX - options.frame.offsetX) / CELL_SIZE - 0.5;
      const centerGridY = (decoration.worldY - options.frame.offsetY) / CELL_SIZE - 0.5;
      const stampRadius = decoration.sizePx / CELL_SIZE * Math.SQRT2 * 0.5;
      expect(Math.hypot(centerGridX - options.anchor.gridX, centerGridY - options.anchor.gridY) + stampRadius)
        .toBeLessThanOrEqual(3 + config.maxOverhangCells + 1e-9);
    }
    for (const decoration of first.decorations) {
      expect(expandedByCell.get(persistentBaseGravelCellKey(decoration.gridX, decoration.gridY))).toEqual(decoration);
    }
    expect(expanded.decorations.length).toBeGreaterThan(first.decorations.length);
  });
});

describe('persistent-base gravel streaming integration', () => {
  it('adds gravel only for Persistent-Base maps and does not create permanent scene images', () => {
    const scene = createFakeArenaScene();
    let sceneImageCalls = 0;
    const originalImage = scene.add.image;
    scene.add.image = (...args: Parameters<typeof originalImage>) => {
      sceneImageCalls += 1;
      return originalImage(...args);
    };
    const streamer = new GroundSurfaceStreamer({
      scene: scene as never,
      frame: FRAME,
      layout: createLayout(),
      groundCoverPlacements: [],
      enablePersistentBaseGravel: true,
      persistentBaseGravel: {
        seed: 17,
        anchor: { gridX: 4, gridY: 3 },
        radiusCells: 3,
      },
      chunkSize: 128,
    });
    const nonPersistent = new GroundSurfaceStreamer({
      scene: createFakeArenaScene() as never,
      frame: FRAME,
      layout: createLayout(),
      groundCoverPlacements: [],
      enablePersistentBaseGravel: false,
      chunkSize: 128,
    });

    expect(streamer.getStats().layers).toBe(5);
    expect(nonPersistent.getStats().layers).toBe(3);
    expect(nonPersistent.getChunkTexture(GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID, 0, 0)).toBeNull();
    expect(DEPTH.DIRT).toBeLessThan(DEPTH.PERSISTENT_BASE_GRAVEL);
    expect(DEPTH.GROUND_COVER).toBeLessThan(DEPTH.PERSISTENT_BASE_GRAVEL_DECORATION);
    expect(DEPTH.PERSISTENT_BASE_GRAVEL_DECORATION).toBeLessThan(DEPTH.TRACKS);

    streamer.updateResidency(VIEW);
    drain(scene);
    expect(streamer.getPersistentBaseGravelState()?.radiusCells).toBe(3);
    expect(streamer.getChunkTexture(GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID, 0, 0)).not.toBeNull();
    expect(sceneImageCalls).toBe(0);

    const changed = streamer.setPersistentBaseGravel({
      seed: 17,
      anchor: { gridX: 4, gridY: 3 },
      radiusCells: 4,
    });
    expect(changed).toBe(true);
    expect(streamer.getStats().pendingRegions).toBeGreaterThan(0);
    drain(scene);
    expect(streamer.getPersistentBaseGravelState()?.radiusCells).toBe(4);

    streamer.destroy();
    nonPersistent.destroy();
  });
});

describe('persistent-base gravel assets and overlay ownership', () => {
  it('loads four processed production assets and leaves no raw generator filenames', () => {
    const assetDir = fileURLToPath(new URL('../public/assets/sprites/persistent-base/', import.meta.url));
    const tmpDir = fileURLToPath(new URL('../public/assets/sprites/tmp/', import.meta.url));
    const expectedFiles = [
      'gravel_patch_01.png',
      'gravel_patch_02.png',
      'gravel_patch_03.png',
      'gravel_patch_04.png',
    ];

    expect(readdirSync(assetDir).sort()).toEqual(expectedFiles);
    const queued: Array<{ key: string; path: string }> = [];
    preloadPersistentBaseGravelAssets({
      image: (key: string, path: string) => queued.push({ key, path }),
    } as never);
    expect(queued).toEqual(expectedFiles.map((fileName) => ({
      key: fileName.replace('.png', ''),
      path: `${PERSISTENT_BASE_GRAVEL_ASSET_PATH}/${fileName}`,
    })));
    for (const fileName of expectedFiles) {
      const bytes = readFileSync(join(assetDir, fileName));
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.readUInt32BE(16)).toBeLessThanOrEqual(512);
      expect(bytes.readUInt32BE(20)).toBeLessThanOrEqual(512);
    }
    if (existsSync(tmpDir)) {
      expect(readdirSync(tmpDir).filter((fileName) => fileName.startsWith('image-gen-'))).toEqual([]);
    }

    const visualsSource = readFileSync(
      fileURLToPath(new URL('../src/scenes/arena/PersistentBaseVisuals.ts', import.meta.url)),
      'utf8',
    );
    expect(visualsSource).not.toContain('scene.add.image');
    expect(visualsSource).not.toContain("'kies'");
    expect(visualsSource).toContain('overlay');
  });
});
