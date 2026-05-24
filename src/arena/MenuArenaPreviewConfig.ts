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

interface RockClusterAnchor {
  gridX: number;
  gridY: number;
  radiusX: number;
  radiusY: number;
  lobeCount?: number;
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

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
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

function ellipseCells(centerX: number, centerY: number, radiusX: number, radiusY: number): RockCell[] {
  const result: RockCell[] = [];
  const minX = Math.max(0, Math.floor(centerX - radiusX - 1));
  const maxX = Math.min(MENU_GRID_COLS - 1, Math.ceil(centerX + radiusX + 1));
  const minY = Math.max(0, Math.floor(centerY - radiusY - 1));
  const maxY = Math.min(GRID_ROWS - 1, Math.ceil(centerY + radiusY + 1));

  for (let gridY = minY; gridY <= maxY; gridY += 1) {
    for (let gridX = minX; gridX <= maxX; gridX += 1) {
      const dx = (gridX - centerX) / Math.max(radiusX, 0.75);
      const dy = (gridY - centerY) / Math.max(radiusY, 0.75);
      if (dx * dx + dy * dy <= 1.05) {
        result.push({ gridX, gridY });
      }
    }
  }

  return result;
}

function createOrganicRockCluster(anchor: RockClusterAnchor, seed: number): RockCell[] {
  const rng = createPreviewRng(seed);
  const lobes: RockClusterAnchor[] = [anchor];
  const extraLobes = anchor.lobeCount ?? (anchor.radiusX + anchor.radiusY >= 5.5 ? 3 : 2);

  for (let index = 1; index < extraLobes; index += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = 0.35 + rng() * 0.75;
    lobes.push({
      gridX: anchor.gridX + Math.cos(angle) * Math.max(anchor.radiusX - 0.5, 1) * distance,
      gridY: anchor.gridY + Math.sin(angle) * Math.max(anchor.radiusY - 0.35, 0.9) * distance,
      radiusX: Math.max(1, anchor.radiusX * (0.45 + rng() * 0.4)),
      radiusY: Math.max(1, anchor.radiusY * (0.45 + rng() * 0.4)),
    });
  }

  const rawCluster = mergeUnique<RockCell>(...lobes.map((lobe) => ellipseCells(lobe.gridX, lobe.gridY, lobe.radiusX, lobe.radiusY)));
  const rawSet = new Set<string>(rawCluster.map((cell) => `${cell.gridX}:${cell.gridY}`));

  return rawCluster.filter((cell) => {
    const orthogonalNeighbors = [
      `${cell.gridX - 1}:${cell.gridY}`,
      `${cell.gridX + 1}:${cell.gridY}`,
      `${cell.gridX}:${cell.gridY - 1}`,
      `${cell.gridX}:${cell.gridY + 1}`,
    ].filter((key) => rawSet.has(key)).length;
    if (orthogonalNeighbors >= 3) return true;
    if (orthogonalNeighbors <= 1) return false;
    return rng() > 0.18;
  });
}

function createOrganicRockClusters(anchors: readonly RockClusterAnchor[], seed: number): RockCell[] {
  return mergeUnique<RockCell>(
    ...anchors.map((anchor, index) => createOrganicRockCluster(anchor, seed + index * 97)),
  );
}

function createOrganicTopDirtBand(seed: number, titleStartX: number, titleWidth: number): DirtCell[] {
  const rng = createPreviewRng(seed);
  const result: DirtCell[] = [];
  let depth = 5;
  const titleCenterX = titleStartX + titleWidth * 0.5;

  for (let gridX = 0; gridX < MENU_GRID_COLS; gridX += 1) {
    const drift = rng();
    if (drift < 0.28) depth -= 1;
    else if (drift > 0.72) depth += 1;
    depth = clampInt(depth, 4, 7);

    const distanceToTitle = Math.abs(gridX - titleCenterX);
    const withinTitleBand = gridX >= titleStartX - 3 && gridX <= titleStartX + titleWidth + 2;
    const titleSag = withinTitleBand
      ? clampInt(2.8 - distanceToTitle / 5 + (rng() - 0.5) * 1.2, 0, 3)
      : 0;
    const edgeWeight = gridX < 5 || gridX > MENU_GRID_COLS - 6 ? 1 : 0;
    const columnDepth = clampInt(depth + titleSag + edgeWeight, 4, 9);

    for (let gridY = 0; gridY <= columnDepth; gridY += 1) {
      result.push({ gridX, gridY });
    }
  }

  return result;
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

const ambientRockAnchors: readonly RockClusterAnchor[] = [
  { gridX: 13.8, gridY: 10.4, radiusX: 2.8, radiusY: 1.8 },
  { gridX: 18.2, gridY: 28.8, radiusX: 3.2, radiusY: 2.1 },
  { gridX: 48.3, gridY: 12.9, radiusX: 3.4, radiusY: 2.2, lobeCount: 4 },
  { gridX: 45.2, gridY: 19.7, radiusX: 3.1, radiusY: 2.1 },
  { gridX: 53.7, gridY: 25.9, radiusX: 3.6, radiusY: 2.3, lobeCount: 4 },
  { gridX: 56.8, gridY: 10.8, radiusX: 2.4, radiusY: 1.7 },
  { gridX: 56.4, gridY: 29.7, radiusX: 2.8, radiusY: 1.6 },
  { gridX: 4.3, gridY: 29.8, radiusX: 2.9, radiusY: 1.9 },
  { gridX: 9.1, gridY: 24.4, radiusX: 3.1, radiusY: 2.2 },
  { gridX: 36.4, gridY: 30.6, radiusX: 2.8, radiusY: 1.7 },
  { gridX: 41.8, gridY: 6.8, radiusX: 2.5, radiusY: 1.5 },
  { gridX: 59.0, gridY: 6.4, radiusX: 2.2, radiusY: 1.4 },
  { gridX: 2.4, gridY: 12.5, radiusX: 2.2, radiusY: 1.5 },
  { gridX: 58.2, gridY: 16.8, radiusX: 2.6, radiusY: 1.8 },
];

const ambientRocks = createOrganicRockClusters(ambientRockAnchors, MENU_PREVIEW_SEED + 101);

const trees = points<TreeCell>([
  [1, 4], [7, 5], [2, 29], [6, 23], [12, 18], [15, 31], [44, 4], [54, 5], [51, 17], [56, 23], [58, 31],
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
const topDirtBand = createOrganicTopDirtBand(MENU_PREVIEW_SEED + 211, TITLE_START_X, textWidth(TITLE_TEXT, TITLE_GAP));
const rockBorderDirt = surround([...finalRocks, ...trackFootprint], 1, MENU_GRID_COLS, GRID_ROWS);
const dirt = excludeRectCells(
  mergeUnique<DirtCell>(
    topDirtBand,
    titleFrameBlendDirt,
    line(44, 59, 30),
    line(43, 59, 31),
    line(46, 59, 32),
  ),
  dirtQuietZones,
);
const finalDirt = mergeUnique<DirtCell>(dirt, rockBorderDirt);
const decals = generatePreviewDecals(finalRocks, finalTrees, tracks, finalDirt, decalQuietZones);

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
    dirt: finalDirt,
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
