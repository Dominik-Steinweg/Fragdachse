import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());

import { CELL_SIZE, DEPTH } from '../../src/config';
import { MAX_PERSISTENT_BASE_RADIUS_CELLS } from '../../src/config/persistentBase';
import { AutoTiler, GRAVEL_AUTOTILE } from '../../src/arena/AutoTiler';
import { ChunkedRenderSurface } from '../../src/arena/chunks/ChunkedRenderSurface';
import {
  GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID,
  GroundSurfaceStreamer,
} from '../../src/arena/chunks/GroundSurfaceStreamer';
import {
  createPersistentBaseGravelState,
  getPersistentBaseGravelCells,
  persistentBaseGravelCellKey,
} from '../../src/arena/PersistentBaseGravelField';
import {
  DEFAULT_PERSISTENT_BASE_BUILD_AREA,
  resolvePersistentBaseBuildAreaForStage,
} from '../../src/persistentBase/PersistentBaseCore';
import { GRAVEL_BLOB_SURFACE_PROFILE } from '../../src/arena/BlobSurfaceProfile';
import { isCellInsidePersistentBaseZone } from '../../src/persistentBase/PersistentBaseZone';
import {
  PERSISTENT_BASE_GRAVEL_ASSET_PATH,
  PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG,
  preloadPersistentBaseGravelAssets,
} from '../../src/arena/PersistentBaseGravelConfig';
import type { ArenaLayout } from '../../src/types';
import { createFakeArenaScene } from '../fakeArenaRenderScene';

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
  it('uses exactly the resolved 3x3 build area and never the reservation radius', () => {
    const anchor = { gridX: 20, gridY: 12 };
    const cells = getPersistentBaseGravelCells(anchor, DEFAULT_PERSISTENT_BASE_BUILD_AREA, 40, 30);
    const expected = [];
    for (let gridY = 0; gridY < 30; gridY += 1) {
      for (let gridX = 0; gridX < 40; gridX += 1) {
        if (isCellInsidePersistentBaseZone(
          gridX - anchor.gridX,
          gridY - anchor.gridY,
          DEFAULT_PERSISTENT_BASE_BUILD_AREA,
        )) {
          expected.push({ gridX, gridY });
        }
      }
    }

    expect(cells).toEqual(expected);
    expect(cells).toHaveLength(9);
    expect(cells.length).toBeLessThan(
      getPersistentBaseGravelCells(
        anchor,
        { kind: 'radius', radiusCells: MAX_PERSISTENT_BASE_RADIUS_CELLS },
        40,
        30,
      ).length,
    );
  });

  it('supports a future radius-based build area through the same generic rule', () => {
    const anchor = { gridX: 20, gridY: 12 };
    const buildArea = { kind: 'radius', radiusCells: 2 } as const;
    const cells = getPersistentBaseGravelCells(anchor, buildArea, 40, 30);
    const expected = [];
    for (let gridY = 0; gridY < 30; gridY += 1) {
      for (let gridX = 0; gridX < 40; gridX += 1) {
        if (isCellInsidePersistentBaseZone(
          gridX - anchor.gridX,
          gridY - anchor.gridY,
          buildArea,
        )) {
          expected.push({ gridX, gridY });
        }
      }
    }

    expect(cells).toEqual(expected);
    expect(cells).toHaveLength(13);
  });

  it('renders the resolved Stage-1 radius without a separate visual path', () => {
    const anchor = { gridX: 20, gridY: 12 };
    const buildArea = resolvePersistentBaseBuildAreaForStage(1);
    const cells = getPersistentBaseGravelCells(anchor, buildArea, 40, 30);

    expect(buildArea).toEqual({ kind: 'radius', radiusCells: 5 });
    expect(cells).toHaveLength(81);
    expect(cells).toContainEqual({ gridX: anchor.gridX + 5, gridY: anchor.gridY });
    expect(cells).not.toContainEqual({ gridX: anchor.gridX + 6, gridY: anchor.gridY });
  });

  it('keeps complete 47-blob neighbour context across a 128-px chunk boundary', () => {
    const state = createPersistentBaseGravelState({
      seed: 23,
      anchor: { gridX: 4, gridY: 1 },
      buildArea: { kind: 'radius', radiusCells: 2 },
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
    const first = createPersistentBaseGravelState({ ...options, buildArea: { kind: 'radius', radiusCells: 3 } });
    const reload = createPersistentBaseGravelState({ ...options, buildArea: { kind: 'radius', radiusCells: 3 } });
    const expanded = createPersistentBaseGravelState({ ...options, buildArea: { kind: 'radius', radiusCells: 4 } });
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
        buildArea: DEFAULT_PERSISTENT_BASE_BUILD_AREA,
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
    const initialState = streamer.getPersistentBaseGravelState();
    expect(initialState?.buildArea).toEqual(DEFAULT_PERSISTENT_BASE_BUILD_AREA);
    expect(initialState?.cells).toHaveLength(9);
    expect(streamer.getChunkTexture(GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID, 0, 0)).not.toBeNull();
    expect(sceneImageCalls).toBe(0);

    const initialKey = initialState?.key;
    const changedRuleWithSameCells = streamer.setPersistentBaseGravel({
      seed: 17,
      anchor: { gridX: 4, gridY: 3 },
      // Same nine integer cells as the square, but a different area rule and therefore a
      // deliberately different state identity.
      buildArea: { kind: 'radius', radiusCells: 1.5 },
    });
    expect(changedRuleWithSameCells).toBe(true);
    expect(streamer.getPersistentBaseGravelState()?.cells).toHaveLength(9);
    expect(streamer.getPersistentBaseGravelState()?.key).not.toBe(initialKey);
    expect(streamer.getStats().pendingRegions).toBeGreaterThan(0);
    drain(scene);

    const changed = streamer.setPersistentBaseGravel({
      seed: 17,
      anchor: { gridX: 4, gridY: 3 },
      buildArea: { kind: 'radius', radiusCells: 4 },
    });
    expect(changed).toBe(true);
    expect(streamer.getPersistentBaseGravelState()?.key).not.toBe(initialKey);
    expect(streamer.getStats().pendingRegions).toBeGreaterThan(0);
    drain(scene);
    expect(streamer.getPersistentBaseGravelState()?.buildArea).toEqual({ kind: 'radius', radiusCells: 4 });

    streamer.destroy();
    nonPersistent.destroy();
  });
});

describe('persistent-base gravel assets and overlay ownership', () => {
  it('loads four processed production assets and leaves no raw generator filenames', () => {
    const assetDir = fileURLToPath(new URL('../../public/assets/sprites/persistent-base/', import.meta.url));
    const tmpDir = fileURLToPath(new URL('../../public/assets/sprites/tmp/', import.meta.url));
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
      fileURLToPath(new URL('../../src/scenes/arena/PersistentBaseVisuals.ts', import.meta.url)),
      'utf8',
    );
    expect(visualsSource).not.toContain('scene.add.image');
    expect(visualsSource).not.toContain("'kies'");
    expect(visualsSource).toContain('overlay');
  });
});
