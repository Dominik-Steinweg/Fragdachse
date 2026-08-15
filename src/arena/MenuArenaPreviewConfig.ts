import { ARENA_BACKGROUND_DETAIL_TEXTURE_KEY, ARENA_BACKGROUND_TEXTURE_KEY } from './ArenaBackground';
import { ARENA_HEIGHT, ARENA_OFFSET_Y, CELL_SIZE, COLORS, FULL_ARENA_WIDTH, FULL_ARENA_WIDTH as MENU_PREVIEW_WIDTH, GAME_HEIGHT, GAME_WIDTH, GRID_ROWS } from '../config';
import type { ArenaLayout, DecalCell, DirtCell, RockCell, TrackCell, TreeCell } from '../types';
import { ARENA_DECAL_CONFIG, ROCK_DECAL_CONFIG, clampDecalOffsetPx, getDecalTextureKey, getRockDecalMaxOffsetPx, getRockDecalVariant, getRockDecalVariantsForPlacement } from './DecalConfig';
import type { DecalPlacement } from './DecalConfig';
import { generateSolidRockFormation } from './SolidRockFormation';

interface GridRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function resolvePreviewRockDecalPlacement(
  rock: RockCell,
  rockIndexByKey: ReadonlyMap<number, number>,
): DecalPlacement {
  const isRock = (gridX: number, gridY: number) => rockIndexByKey.has(cellKey(gridX, gridY));
  const { gridX, gridY } = rock;
  if (!isRock(gridX, gridY - 1) || !isRock(gridX, gridY + 1)
    || !isRock(gridX - 1, gridY) || !isRock(gridX + 1, gridY)) {
    return 'edge';
  }
  if (!isRock(gridX - 1, gridY - 1) || !isRock(gridX + 1, gridY - 1)
    || !isRock(gridX - 1, gridY + 1) || !isRock(gridX + 1, gridY + 1)) {
    return 'interior';
  }
  return 'core';
}

const MENU_GRID_COLS = Math.floor(MENU_PREVIEW_WIDTH / CELL_SIZE);
const MENU_PREVIEW_SEED = 20260524;
const OVERLAY_BORDER_TOP_Y = 8;
const OVERLAY_BORDER_BOTTOM_Y = 28;
const LEFT_OVERLAY_BORDER_X = 10;

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
  backgroundTextureKey: typeof ARENA_BACKGROUND_TEXTURE_KEY;
  /** Feinschicht des Bodens; die Vorschau spiegelt damit den Arena-Look (siehe ArenaBackground). */
  backgroundDetailTextureKey: typeof ARENA_BACKGROUND_DETAIL_TEXTURE_KEY;
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
  groundCover: MenuArenaPreviewLayerConfig;
  tracks: MenuArenaPreviewLayerConfig;
  decals: MenuArenaPreviewLayerConfig;
  rocks: MenuArenaPreviewLayerConfig;
  rockMoss: MenuArenaPreviewLayerConfig;
  rockVegetation: MenuArenaPreviewLayerConfig;
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
        surface: 'ground',
        rotation: rng() * Math.PI * 2,
      });
    }
  }

  const rockIndexByKey = new Map<number, number>();
  rocks.forEach((rock, index) => rockIndexByKey.set(cellKey(rock.gridX, rock.gridY), index));
  for (const rock of rocks) {
    const placement = resolvePreviewRockDecalPlacement(rock, rockIndexByKey);
    const coveragePercent = placement === 'edge'
      ? ROCK_DECAL_CONFIG.edgeCoveragePercent
      : ROCK_DECAL_CONFIG.interiorCoveragePercent;
    if (!rollPercent(rng, coveragePercent)) continue;
    const textureKey = pickWeightedDecalTextureKey(rng, getRockDecalVariantsForPlacement(placement));
    if (!textureKey) continue;
    const variant = getRockDecalVariant(textureKey);
    const displaySize = variant?.displaySize;
    const maxOffset = getRockDecalMaxOffsetPx(displaySize);
    const rotation = rng() * Math.PI * 2;
    decals.push({
      gridX: rock.gridX,
      gridY: rock.gridY,
      textureKey,
      offsetX: randomOffset(rng, maxOffset),
      offsetY: randomOffset(rng, maxOffset),
      terrain: 'rock',
      surface: 'rock',
      rockIds: [rockIndexByKey.get(cellKey(rock.gridX, rock.gridY)) ?? -1],
      displaySize,
      alpha: variant?.alpha,
      rotation,
    });
  }

  return decals;
}

const TITLE_TEXT = 'FRAGDACHSE';
const TITLE_GAP = 1;
const TITLE_START_X = Math.floor((MENU_GRID_COLS - textWidth(TITLE_TEXT, TITLE_GAP)) * 0.5);
const RIGHT_OVERLAY_BORDER_X = MENU_GRID_COLS - 11;
const RIGHT_OVERLAY_INFO_MIN_X = RIGHT_OVERLAY_BORDER_X + 1;

/**
 * Weltkoordinaten der Flaeche, die der Felsrahmen fuer die Lobby-Oberflaeche freilaesst.
 *
 * Der Rahmen besteht aus Felszellen im 32-px-Raster, die Lobby rechnet in Pixeln. Frueher war
 * diese Umrechnung in jeder UI-Datei von Hand nachgebildet, weshalb Glasflaechen und Panel
 * nicht buendig am Rahmen sassen. Alle Lobby-Flaechen leiten ihre Kanten jetzt hieraus ab.
 *
 * Zwei Kantenpaare, je nachdem ob eine Flaeche **an** den Rahmen stossen oder **ueber** ihn
 * hinweg fluchten soll:
 *
 * - `top`/`bottom` liegen an der Unterkante der oberen bzw. der Oberkante der unteren Felszeile.
 *   Die Seitenspalten stossen so an den Rahmen, ohne ihn zu ueberdecken.
 * - `outerTop`/`outerBottom` liegen an den Aussenkanten derselben Felszeilen. Das Mittelpanel
 *   fluchtet damit mit der gesamten Hoehe des Rahmens statt nur mit seiner Innenflaeche.
 */
/**
 * Breite des zentralen Lobby-Panels.
 *
 * Steht hier und nicht in der Oberflaeche, weil die Felslandschaft unter dem Panel exakt
 * seinen Grundriss als Kernflaeche benutzt. Zwei getrennte Zahlen wuerden bei der naechsten
 * Aenderung auseinanderlaufen und Felsen neben statt hinter dem Panel stehen lassen.
 */
export const LOBBY_PANEL_WIDTH = 832;

/**
 * Rolle eines Lobby-Felsens.
 *
 * `structural` traegt Layout und Felsschriftzug: echtes Hindernis, unzerstoerbar, loest nie
 * Inspector-Arbeit aus. `ambient` sind normale Landschaftsfelsen einschliesslich der Felsen
 * unter dem Mittelpanel: normale Landschaftsfels-HP, real beschaedigbar und zerstoerbar,
 * danach vom Inspector wieder aufgebaut.
 */
export type LobbyRockRole = 'structural' | 'ambient';

/**
 * Gitterbezugspunkte der Lobby-Oberfläche.
 *
 * Die Ambient-Inszenierung leitet ihre Spielflächen hieraus ab, statt dieselben Spaltenzahlen
 * ein zweites Mal zu pflegen. Wer den Rahmen verschiebt, verschiebt damit automatisch auch die
 * erlaubten Kampfzonen.
 */
export const LOBBY_LAYOUT_GRID = {
  cols: MENU_GRID_COLS,
  rows: GRID_ROWS,
  /** Senkrechte Felssäule links bzw. rechts. */
  leftFrameColumn:  LEFT_OVERLAY_BORDER_X,
  rightFrameColumn: RIGHT_OVERLAY_BORDER_X,
  /** Waagerechte Rahmenzeilen. */
  frameTopRow:    OVERLAY_BORDER_TOP_Y,
  frameBottomRow: OVERLAY_BORDER_BOTTOM_Y,
} as const;


export const LOBBY_FRAME_BOUNDS = {
  top: ARENA_OFFSET_Y + (OVERLAY_BORDER_TOP_Y + 1) * CELL_SIZE,
  bottom: ARENA_OFFSET_Y + OVERLAY_BORDER_BOTTOM_Y * CELL_SIZE,
  outerTop: ARENA_OFFSET_Y + OVERLAY_BORDER_TOP_Y * CELL_SIZE,
  outerBottom: ARENA_OFFSET_Y + (OVERLAY_BORDER_BOTTOM_Y + 1) * CELL_SIZE,
  /** Innenkante der linken Spalte: dort beginnt die senkrechte Felssaeule. */
  leftColumnRight: LEFT_OVERLAY_BORDER_X * CELL_SIZE,
  /** Innenkante der rechten Spalte: dort endet die senkrechte Felssaeule. */
  rightColumnLeft: RIGHT_OVERLAY_INFO_MIN_X * CELL_SIZE,
} as const;
const titleRocks = textRocks(TITLE_TEXT, TITLE_START_X, 1, TITLE_GAP);
const leftOverlayBorderRocks = mergeUnique<RockCell>(
  rockRow(0, LEFT_OVERLAY_BORDER_X, OVERLAY_BORDER_TOP_Y),
  rockRow(0, LEFT_OVERLAY_BORDER_X, OVERLAY_BORDER_BOTTOM_Y),
  rockColumn(OVERLAY_BORDER_TOP_Y, OVERLAY_BORDER_BOTTOM_Y, LEFT_OVERLAY_BORDER_X),
);
const rightOverlayBorderRocks = mergeUnique<RockCell>(
  rockRow(RIGHT_OVERLAY_BORDER_X, MENU_GRID_COLS - 1, OVERLAY_BORDER_TOP_Y),
  rockRow(RIGHT_OVERLAY_BORDER_X, MENU_GRID_COLS - 1, OVERLAY_BORDER_BOTTOM_Y),
  rockColumn(OVERLAY_BORDER_TOP_Y, OVERLAY_BORDER_BOTTOM_Y, RIGHT_OVERLAY_BORDER_X),
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
  [1, 4],  [12, 18], [15, 31], [57, 4], [47, 17], [46, 25], [51, 31],
]);

/**
 * Freiflaechen fuer die Lobby-Oberflaeche. Die mittlere Zone traegt das Lobby-Panel und reicht
 * deshalb bis zur Aussenkante der unteren Rahmenzeile: Zeile 28 endet bei Welt-Y 940, genau der
 * Unterkante des Panels bei voller Hoehe (`LOBBY_FRAME_BOUNDS.outerBottom`). Wer das Panel
 * hoeher macht, muss diese Zone auf dem 32-px-Raster nachziehen, sonst stehen Felsen darunter.
 *
 * Nur die mittlere Zone geht so weit: links und rechts traegt Zeile 28 die Rahmenfelsen selbst.
 */
const overlayClearZones: readonly GridRect[] = [
  { minX: 0, maxX: LEFT_OVERLAY_BORDER_X - 1, minY: 9, maxY: OVERLAY_BORDER_BOTTOM_Y - 1 },
  { minX: 16, maxX: 42, minY: 7, maxY: OVERLAY_BORDER_BOTTOM_Y },
  { minX: RIGHT_OVERLAY_INFO_MIN_X, maxX: MENU_GRID_COLS - 1, minY: 9, maxY: OVERLAY_BORDER_BOTTOM_Y - 1 },
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
  maxX: LEFT_OVERLAY_BORDER_X - 1,
  minY: 9,
  maxY: OVERLAY_BORDER_BOTTOM_Y - 1,
};

const rightOverlayInfoQuietZone: GridRect = {
  minX: RIGHT_OVERLAY_INFO_MIN_X,
  maxX: MENU_GRID_COLS - 1,
  minY: 9,
  maxY: OVERLAY_BORDER_BOTTOM_Y - 1,
};

const decalQuietZones: readonly GridRect[] = [
  leftOverlayInfoQuietZone,
  rightOverlayInfoQuietZone,
  overlayClearZones[1],
];

/**
 * Flächen, die von der Lobby-Oberfläche belegt sind: die beiden Seitenmenüs und das
 * Mittelpanel.
 *
 * Dort darf **kein** Ambient-Gefecht stattfinden – es läge hinter dem Text und wäre reine
 * Unruhe. Das Mittelpanel ist zusätzlich mit Fels gefüllt; die Seitenmenüs sind offener
 * Boden und müssen deshalb ausdrücklich gesperrt werden.
 */
export const LOBBY_UI_RESERVED_ZONES: readonly GridRect[] = decalQuietZones;

/**
 * Spaltenbereich des Mittelpanels.
 *
 * Seine Freizone reicht eine Zeile über die obere Rahmenzeile hinaus; die Kampfzonen im
 * oberen Band müssen deshalb seitlich daran vorbei und dürfen nicht bis zur Bildmitte gehen.
 */
export const LOBBY_CENTER_PANEL_COLUMNS = {
  min: overlayClearZones[1].minX,
  max: overlayClearZones[1].maxX,
} as const;

/** Liegt die Zelle unter einer Oberflächenfläche? */
export function isLobbyUiReservedCell(gridX: number, gridY: number): boolean {
  return LOBBY_UI_RESERVED_ZONES.some((rect) => isInsideRect(gridX, gridY, rect));
}

const dirtQuietZones: readonly GridRect[] = [
  rightOverlayInfoQuietZone,
  overlayClearZones[1],
];

const leftOverlayBorderReserveZone: GridRect = {
  minX: 0,
  maxX: LEFT_OVERLAY_BORDER_X + 2,
  minY: OVERLAY_BORDER_TOP_Y,
  maxY: OVERLAY_BORDER_BOTTOM_Y,
};

const rightOverlayBorderReserveZone: GridRect = {
  minX: RIGHT_OVERLAY_BORDER_X - 1,
  maxX: MENU_GRID_COLS - 1,
  minY: OVERLAY_BORDER_TOP_Y,
  maxY: OVERLAY_BORDER_BOTTOM_Y,
};

/**
 * Kernfläche der Felslandschaft unter dem Mittelpanel: exakt der Panelgrundriss.
 *
 * Das Panel steht mit fester Oberkante und veränderlicher Höhe; die unteren Reihen werden
 * bei kurzer Panelhöhe also sichtbar. Genau dafür läuft der Rand organisch aus, statt an
 * einer geraden Kante zu enden.
 */
const underPanelCoreRegion = {
  minGridX: Math.ceil(( GAME_WIDTH / 2 - LOBBY_PANEL_WIDTH / 2) / CELL_SIZE),
  maxGridX: Math.floor((GAME_WIDTH / 2 + LOBBY_PANEL_WIDTH / 2) / CELL_SIZE) - 1,
  minGridY: OVERLAY_BORDER_TOP_Y,
  maxGridY: OVERLAY_BORDER_BOTTOM_Y,
} as const;

/**
 * Felslandschaft unter dem Mittelpanel. Nutzt denselben Generator wie die
 * Tutorial-Felsformation der Coop-Defense-Karte – die Lobby bekommt keine zweite
 * Felsalgorithmik.
 *
 * Nach oben wird der Rand hart abgeschnitten: dort steht der Felsschriftzug frei, und die
 * Panel-Oberkante deckt die gerade Kante ohnehin ab. Seitlich und nach unten läuft er aus und
 * lässt dabei die wenigen Öffnungen entstehen, durch die Ambient-Actors ziehen können.
 */
const underPanelRocks: RockCell[] = generateSolidRockFormation(
  createPreviewRng(MENU_PREVIEW_SEED + 307),
  {
    region: underPanelCoreRegion,
    haloCells: 3,
    haloFillChance: [0.82, 0.48, 0.2],
    outerHaloFillChance: 0.1,
    gridCols: MENU_GRID_COLS,
    gridRows: GRID_ROWS,
    // Der Schriftzug und sein Freiraum bleiben unberührt.
    isBlockedCell: (gridX, gridY) => gridY < OVERLAY_BORDER_TOP_Y
      || gridX <= LEFT_OVERLAY_BORDER_X
      || gridX >= RIGHT_OVERLAY_BORDER_X,
  },
).map(({ gridX, gridY }) => ({ gridX, gridY }));

const tracks: TrackCell[] = [];
const trackFootprint = expandTrackFootprint(tracks);
/**
 * Reihenfolge zählt: `mergeUnique` behält den ersten Treffer, und die strukturellen Gruppen
 * stehen vorn. Die Rollenzuordnung unten leitet sich aus derselben Reihenfolge ab.
 */
const finalRocks = mergeUnique<RockCell>(
  titleRocks,
  leftOverlayBorderRocks,
  rightOverlayBorderRocks,
  underPanelRocks,
  excludeRectCells(ambientRocks, [
    ...overlayClearZones,
    titleRockGapZone,
    leftOverlayBorderReserveZone,
    rightOverlayBorderReserveZone,
  ]),
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
    backgroundTextureKey: ARENA_BACKGROUND_TEXTURE_KEY,
    backgroundDetailTextureKey: ARENA_BACKGROUND_DETAIL_TEXTURE_KEY,
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
    // Bewusst unter der Arena-Deckkraft: in der Lobby liegt Menütext über dem Boden.
    groundCover: { visible: true, alpha: 0.62 },
    tracks: { visible: false, alpha: 0 },
    decals: { visible: true, alpha: 0.9 },
    rocks: { visible: true, alpha: 1 },
    // Etwas zurueckgenommen: Der Fels-Schriftzug der Lobby muss als Form lesbar bleiben.
    rockMoss: { visible: true, alpha: 0.8 },
    /**
     * Aus demselben Grund staerker zurueckgenommen als in der Arena: Die Kantenmatten sitzen genau
     * dort, wo die Buchstabenformen entstehen, und ragen ueber sie hinaus. Wird der Schriftzug
     * unleserlich, ist dieser Eintrag die Stellschraube – bis hin zu `visible: false`.
     */
    rockVegetation: { visible: true, alpha: 0.7 },
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

/**
 * Rolle je Fels, parallel zu `MENU_ARENA_PREVIEW_CONFIG.layout.rocks`.
 *
 * Strukturell sind der Felsschriftzug und die beiden Rahmenspalten – alles, was das Layout
 * der Oberflaeche traegt. Alles andere ist Landschaft und damit fuer die Ambient-Inszenierung
 * freigegeben.
 */
export const LOBBY_ROCK_ROLES: readonly LobbyRockRole[] = (() => {
  const structuralKeys = new Set<number>();
  for (const { gridX, gridY } of [...titleRocks, ...leftOverlayBorderRocks, ...rightOverlayBorderRocks]) {
    structuralKeys.add(cellKey(gridX, gridY));
  }
  return finalRocks.map(({ gridX, gridY }) => (
    structuralKeys.has(cellKey(gridX, gridY)) ? 'structural' : 'ambient'
  ));
})();

/** Indizes aller Ambient-Felsen – die einzigen, die Schaden nehmen und neu gebaut werden. */
export const LOBBY_AMBIENT_ROCK_IDS: readonly number[] = LOBBY_ROCK_ROLES
  .map((role, index) => (role === 'ambient' ? index : -1))
  .filter((index) => index >= 0);

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
