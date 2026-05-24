import { ARENA_HEIGHT, ARENA_OFFSET_Y, CELL_SIZE, COLORS, FULL_ARENA_WIDTH, FULL_ARENA_WIDTH as MENU_PREVIEW_WIDTH, GAME_HEIGHT, GAME_WIDTH, GRID_ROWS } from '../config';
import type { ArenaLayout, DecalCell, DirtCell, RockCell, TrackCell, TreeCell } from '../types';
import { ARENA_DECAL_CONFIG, clampDecalOffsetPx, getDecalTextureKey } from './DecalConfig';

interface GridRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const MENU_GRID_COLS = Math.floor(MENU_PREVIEW_WIDTH / CELL_SIZE);
const MENU_PREVIEW_SEED = 20260524;

export interface MenuArenaPreviewLayerConfig {
  visible: boolean;
  alpha: number;
}

export interface MenuArenaPreviewFrameConfig {
  showSidebars: boolean;
  sidebarAlpha: number;
  leftSidebarColor: number;
  rightSidebarColor: number;
}

export interface MenuArenaPreviewOverlayConfig {
  arenaShadeColor: number;
  arenaShadeAlpha: number;
  screenShadeColor: number;
  screenShadeAlpha: number;
}

export interface MenuArenaPreviewViewConfig {
  backgroundTextureKey: 'gras_bg_dm' | 'gras_bg_ctb';
  bounds: {
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  };
  backgroundAlpha: number;
  backgroundTint: number;
  frame: MenuArenaPreviewFrameConfig;
  overlay: MenuArenaPreviewOverlayConfig;
  dirt: MenuArenaPreviewLayerConfig;
  tracks: MenuArenaPreviewLayerConfig;
  decals: MenuArenaPreviewLayerConfig;
  rocks: MenuArenaPreviewLayerConfig;
  trunks: MenuArenaPreviewLayerConfig;
  canopies: MenuArenaPreviewLayerConfig;
}

export interface MenuArenaPreviewConfig {
  view: MenuArenaPreviewViewConfig;
  layout: ArenaLayout;
}

function points<T extends RockCell | TreeCell | DirtCell | TrackCell>(
  coords: ReadonlyArray<readonly [number, number]>,
): T[] {
  return coords.map(([gridX, gridY]) => ({ gridX, gridY } as T));
}

function line(fromX: number, toX: number, gridY: number): DirtCell[] {
  const result: DirtCell[] = [];
  for (let gridX = fromX; gridX <= toX; gridX += 1) {
    result.push({ gridX, gridY });
  }
  return result;
}

function rockRow(fromX: number, toX: number, gridY: number): RockCell[] {
  const result: RockCell[] = [];
  for (let gridX = fromX; gridX <= toX; gridX += 1) {
    result.push({ gridX, gridY });
  }
  return result;
}

function rockColumn(fromY: number, toY: number, gridX: number): RockCell[] {
  const result: RockCell[] = [];
  for (let gridY = fromY; gridY <= toY; gridY += 1) {
    result.push({ gridX, gridY });
  }
  return result;
}

function cellKey(gridX: number, gridY: number): number {
  return gridY * MENU_GRID_COLS + gridX;
}

function mergeUnique<T extends RockCell | TreeCell | DirtCell | TrackCell>(...groups: T[][]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const group of groups) {
    for (const cell of group) {
      const key = `${cell.gridX}:${cell.gridY}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cell);
    }
  }
  return result;
}

function glyphRows(pattern: string): readonly string[] {
  return pattern.trim().split('\n').map((row) => row.trim());
}

const ROCK_TEXT_GLYPHS = {
  F: glyphRows(`
    ####
    #...
    ###.
    #...
    #...
  `),
  R: glyphRows(`
    ###.
    #..#
    ###.
    #.#.
    #..#
  `),
  A: glyphRows(`
    .##.
    #..#
    ####
    #..#
    #..#
  `),
  G: glyphRows(`
    .###
    #...
    #.##
    #..#
    .###
  `),
  D: glyphRows(`
    ###.
    #..#
    #..#
    #..#
    ###.
  `),
  C: glyphRows(`
    .###
    #...
    #...
    #...
    .###
  `),
  H: glyphRows(`
    #..#
    #..#
    ####
    #..#
    #..#
  `),
  S: glyphRows(`
    .###
    #...
    .##.
    ...#
    ###.
  `),
  E: glyphRows(`
    ####
    #...
    ###.
    #...
    ####
  `),
} as const;

function textRocks(text: string, startX: number, startY: number, gap = 1): RockCell[] {
  const result: RockCell[] = [];
  let cursorX = startX;

  for (const char of text) {
    const glyph = ROCK_TEXT_GLYPHS[char as keyof typeof ROCK_TEXT_GLYPHS];
    if (!glyph) {
      cursorX += gap + 1;
      continue;
    }

    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== '#') continue;
        result.push({ gridX: cursorX + col, gridY: startY + row });
      }
    }

    cursorX += glyph[0].length + gap;
  }

  return result;
}

function textWidth(text: string, gap = 1): number {
  let width = 0;
  let hasGlyph = false;

  for (const char of text) {
    const glyph = ROCK_TEXT_GLYPHS[char as keyof typeof ROCK_TEXT_GLYPHS];
    const glyphWidth = glyph ? glyph[0].length : 1;
    if (hasGlyph) width += gap;
    width += glyphWidth;
    hasGlyph = true;
  }

  return width;
}

function isInsideRect(gridX: number, gridY: number, rect: GridRect): boolean {
  return gridX >= rect.minX && gridX <= rect.maxX && gridY >= rect.minY && gridY <= rect.maxY;
}

function excludeRectCells<T extends RockCell | TreeCell | DirtCell | TrackCell>(cells: T[], rects: readonly GridRect[]): T[] {
  return cells.filter((cell) => rects.every((rect) => !isInsideRect(cell.gridX, cell.gridY, rect)));
}

function surround(cells: ReadonlyArray<RockCell | TrackCell>, margin = 1, maxCols = MENU_GRID_COLS, maxRows = GRID_ROWS): DirtCell[] {
  const keys = new Set<string>();
  for (const { gridX, gridY } of cells) {
    for (let dy = -margin; dy <= margin; dy += 1) {
      for (let dx = -margin; dx <= margin; dx += 1) {
        const nextX = gridX + dx;
        const nextY = gridY + dy;
        if (nextX < 0 || nextY < 0 || nextX >= maxCols || nextY >= maxRows) continue;
        keys.add(`${nextX}:${nextY}`);
      }
    }
  }
  return Array.from(keys, (key) => {
    const [gridX, gridY] = key.split(':').map(Number);
    return { gridX, gridY };
  });
}

function createPreviewRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function rollPercent(rng: () => number, percent: number): boolean {
  return rng() * 100 < percent;
}

function randomOffset(rng: () => number, maxOffset: number): number {
  if (maxOffset <= 0) return 0;
  return Math.floor(rng() * (maxOffset * 2 + 1)) - maxOffset;
}

function pickWeightedDecalTextureKey(
  rng: () => number,
  variants: readonly { fileName: string; frequencyPercent: number }[],
): string | null {
  const valid = variants.filter((variant) => variant.frequencyPercent > 0);
  if (valid.length === 0) return null;

  const total = valid.reduce((sum, variant) => sum + variant.frequencyPercent, 0);
  let roll = rng() * total;
  for (const variant of valid) {
    roll -= variant.frequencyPercent;
    if (roll <= 0) return getDecalTextureKey(variant.fileName);
  }

  return getDecalTextureKey(valid[valid.length - 1].fileName);
}

function expandTrackFootprint(tracks: readonly TrackCell[]): TrackCell[] {
  const result: TrackCell[] = [];
  const seen = new Set<number>();

  for (const track of tracks) {
    const cells: TrackCell[] = [track];
    if (track.gridX + 1 < MENU_GRID_COLS) {
      cells.push({ gridX: track.gridX + 1, gridY: track.gridY });
    }

    for (const cell of cells) {
      const key = cellKey(cell.gridX, cell.gridY);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cell);
    }
  }

  return result;
}

function generatePreviewDecals(
  rocks: readonly RockCell[],
  trees: readonly TreeCell[],
  tracks: readonly TrackCell[],
  dirtCells: readonly DirtCell[],
  clearZones: readonly GridRect[],
): DecalCell[] {
  const rng = createPreviewRng(MENU_PREVIEW_SEED + 17);
  const dirtSet = new Set<number>(dirtCells.map((cell) => cellKey(cell.gridX, cell.gridY)));
  const blockedCells = new Set<number>();

  for (const rock of rocks) blockedCells.add(cellKey(rock.gridX, rock.gridY));
  for (const tree of trees) blockedCells.add(cellKey(tree.gridX, tree.gridY));
  for (const trackCell of expandTrackFootprint(tracks)) blockedCells.add(cellKey(trackCell.gridX, trackCell.gridY));

  const decals: DecalCell[] = [];
  for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
    for (let gridX = 0; gridX < MENU_GRID_COLS; gridX += 1) {
      const key = cellKey(gridX, gridY);
      if (blockedCells.has(key)) continue;
      if (clearZones.some((rect) => isInsideRect(gridX, gridY, rect))) continue;

      const terrain = dirtSet.has(key) ? 'dirt' : 'grass';
      const layerConfig = ARENA_DECAL_CONFIG[terrain];
      if (!rollPercent(rng, layerConfig.coveragePercent)) continue;

      const textureKey = pickWeightedDecalTextureKey(rng, layerConfig.variants);
      if (!textureKey) continue;

      decals.push({
        gridX,
        gridY,
        textureKey,
        offsetX: randomOffset(rng, clampDecalOffsetPx(layerConfig.maxOffsetX)),
        offsetY: randomOffset(rng, clampDecalOffsetPx(layerConfig.maxOffsetY)),
        terrain,
      });
    }
  }

  return decals;
}

const TITLE_TEXT = 'FRAGDACHSE';
const TITLE_GAP = 1;
const TITLE_START_X = Math.floor((MENU_GRID_COLS - textWidth(TITLE_TEXT, TITLE_GAP)) * 0.5);
const titleRocks = textRocks(TITLE_TEXT, TITLE_START_X, 1, TITLE_GAP);
const leftOverlayBorderRocks = mergeUnique<RockCell>(
  rockRow(0, 8, 8),
  rockRow(0, 8, 27),
  rockColumn(8, 27, 8),
);

const ambientRocks = points<RockCell>([
  [13, 8], [14, 8], [15, 8], [14, 9], [15, 9], [16, 9],
  [17, 28], [18, 28], [19, 28], [18, 29], [19, 29], [20, 29],
  [43, 6], [44, 6], [45, 6], [44, 7], [45, 7], [46, 7],
  [47, 12], [48, 12], [49, 12], [48, 13], [49, 13], [50, 13],
  [44, 19], [45, 19], [46, 19], [45, 20], [46, 20], [47, 20],
  [52, 25], [53, 25], [54, 25], [53, 26], [54, 26], [55, 26],
  [56, 9], [57, 9], [58, 9], [57, 10],
  [56, 30], [57, 30], [58, 30],
  [3, 29], [4, 29], [5, 29], [4, 30],
  [8, 24], [9, 24], [10, 24], [9, 25],
]);

const trees = points<TreeCell>([
  [2, 29], [6, 23], [12, 18], [15, 31], [44, 4], [51, 17], [56, 23], [58, 31],
]);

const overlayClearZones: readonly GridRect[] = [
  { minX: 0, maxX: 7, minY: 9, maxY: 26 },
  { minX: 16, maxX: 42, minY: 7, maxY: 26 },
];

const titleTreeClearZone: GridRect = {
  minX: Math.max(0, TITLE_START_X - 1),
  maxX: Math.min(MENU_GRID_COLS - 1, TITLE_START_X + textWidth(TITLE_TEXT, TITLE_GAP)),
  minY: 0,
  maxY: 6,
};

const titleRockGapZone: GridRect = {
  minX: 0,
  maxX: MENU_GRID_COLS - 1,
  minY: 0,
  maxY: 9,
};

const leftOverlayInfoQuietZone: GridRect = {
  minX: 0,
  maxX: 7,
  minY: 9,
  maxY: 26,
};

const decalQuietZones: readonly GridRect[] = [
  leftOverlayInfoQuietZone,
  overlayClearZones[1],
];

const dirtQuietZones: readonly GridRect[] = [
  overlayClearZones[1],
];

const leftOverlayBorderReserveZone: GridRect = {
  minX: 0,
  maxX: 10,
  minY: 8,
  maxY: 27,
};

const tracks: TrackCell[] = [];
const trackFootprint = expandTrackFootprint(tracks);
const finalRocks = mergeUnique<RockCell>(
  titleRocks,
  leftOverlayBorderRocks,
  excludeRectCells(ambientRocks, [...overlayClearZones, titleRockGapZone, leftOverlayBorderReserveZone]),
).filter((cell) => !trackFootprint.some((trackCell) => trackCell.gridX === cell.gridX && trackCell.gridY === cell.gridY));
const finalTrees = excludeRectCells(trees, [...overlayClearZones, titleTreeClearZone]);
const titleFrameBlendDirt = points<DirtCell>([
  [8, 7], [9, 7], [10, 7],
  [9, 8], [10, 8], [11, 8],
  [10, 9], [11, 9],
  [11, 10],
]);
const dirt = excludeRectCells(
  mergeUnique<DirtCell>(
    line(0, MENU_GRID_COLS - 1, 0),
    line(0, MENU_GRID_COLS - 1, 1),
    line(0, MENU_GRID_COLS - 1, 2),
    line(0, MENU_GRID_COLS - 1, 3),
    line(0, MENU_GRID_COLS - 1, 4),
    line(0, MENU_GRID_COLS - 1, 5),
    line(0, MENU_GRID_COLS - 1, 6),
    titleFrameBlendDirt,
    surround([...finalRocks, ...trackFootprint], 1, MENU_GRID_COLS, GRID_ROWS),
    line(44, 59, 30),
    line(43, 59, 31),
    line(46, 59, 32),
  ),
  dirtQuietZones,
);
const decals = generatePreviewDecals(finalRocks, finalTrees, tracks, dirt, decalQuietZones);

export const MENU_ARENA_PREVIEW_CONFIG: MenuArenaPreviewConfig = {
  view: {
    backgroundTextureKey: 'gras_bg_dm',
    bounds: {
      offsetX: 0,
      offsetY: ARENA_OFFSET_Y,
      width: MENU_PREVIEW_WIDTH,
      height: ARENA_HEIGHT,
    },
    backgroundAlpha: 1,
    backgroundTint: 0xb8d49a,
    frame: {
      showSidebars: false,
      sidebarAlpha: 1,
      leftSidebarColor: COLORS.GREY_10,
      rightSidebarColor: COLORS.GREY_9,
    },
    overlay: {
      arenaShadeColor: 0x102018,
      arenaShadeAlpha: 0.14,
      screenShadeColor: 0x050709,
      screenShadeAlpha: 0.08,
    },
    dirt: { visible: true, alpha: 0.92 },
    tracks: { visible: false, alpha: 0 },
    decals: { visible: true, alpha: 0.9 },
    rocks: { visible: true, alpha: 1 },
    trunks: { visible: false, alpha: 0 },
    canopies: { visible: true, alpha: 1 },
  },
  layout: {
    seed: MENU_PREVIEW_SEED,
    rocks: finalRocks,
    trees: finalTrees,
    tracks,
    dirt,
    decals,
    powerUpPedestals: [],
  },
};

export const MENU_ARENA_PREVIEW_BOUNDS = {
  x: 0,
  y: ARENA_OFFSET_Y,
  width: FULL_ARENA_WIDTH,
  height: ARENA_HEIGHT,
};

export const MENU_ARENA_PREVIEW_SCREEN_BOUNDS = {
  x: GAME_WIDTH * 0.5,
  y: GAME_HEIGHT * 0.5,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
};
