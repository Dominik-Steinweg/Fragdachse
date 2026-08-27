import {
  DEFAULT_ARENA_OFFSET_Y,
  CELL_SIZE,
  DEFAULT_ARENA_HEIGHT,
  FULL_ARENA_WIDTH,
} from '../config';
import type { ArenaGridRegion } from '../config';
import type { ArenaLayout, DecalCell, DirtCell, RockCell, TreeCell } from '../types';
import {
  ARENA_DECAL_CONFIG,
  ROCK_DECAL_CONFIG,
  clampDecalOffsetPx,
  getDecalTextureKey,
  getRockDecalMaxOffsetPx,
  getRockDecalVariant,
  getRockDecalVariantsForPlacement,
} from './DecalConfig';
import type { DecalPlacement } from './DecalConfig';
import { createOrganicDirtMargin } from './OrganicDirtMargin';

/**
 * Authored Geometrie der LobbyWorld.
 *
 * Die Lobby ist keine Vorschau mehr, sondern eine echte World: dieselbe WorldDefinition,
 * derselbe World-Lifecycle, derselbe Bau- und Renderpfad wie eine Match-World. Diese Datei ist
 * ausschliesslich ihr **Authoring** - sie beschreibt, was in der Lobby steht, und kennt weder
 * Phaser noch Netzwerk noch Runtime.
 *
 * Zwei Gameplay-Rollen bleiben dabei ausdruecklich unterscheidbar:
 *
 * - Der Felsrahmen um die Lobby-Oberflaeche traegt das Layout und bleibt geschuetzt
 *   ({@link RockCell.indestructible}). Er ist Struktur, kein Ziel.
 * - Der FRAGDACHSE-Schriftzug und die Landschaftsfelsen sind ganz normale Felsen. Sobald die
 *   LobbyWorld Kampf erlaubt, zerlegt sie dieselbe World-Destruction wie jede andere World.
 *
 * Die zentrale Flaeche unter dem Lobby-Panel bleibt bewusst frei: dort erscheint spaeter die
 * persistente Basis. Sie wird hier nicht vorbereitet und nicht reserviert.
 */

interface GridRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface RockClusterAnchor {
  gridX: number;
  gridY: number;
  radiusX: number;
  radiusY: number;
  lobeCount?: number;
}

/**
 * Zellmass der LobbyWorld.
 *
 * Volle Bildschirmbreite ohne Seitenbalken, als einziger nicht nutzbarer Rand die schmalen
 * Streifen oben und unten. Es ist bewusst ein authored Wert der World und keine Ableitung aus
 * der gerade global aktiven Arena - zwei Worlds duerfen gleichzeitig existieren.
 */
export const LOBBY_WORLD_WIDTH_CELLS = Math.floor(FULL_ARENA_WIDTH / CELL_SIZE);
export const LOBBY_WORLD_HEIGHT_CELLS = Math.floor(DEFAULT_ARENA_HEIGHT / CELL_SIZE);

/** Deterministischer Seed der authored Lobby-Geometrie; jeder Peer baut dieselbe World. */
const LOBBY_WORLD_SEED = 20260524;

const GRID_COLS = LOBBY_WORLD_WIDTH_CELLS;
const GRID_ROWS = LOBBY_WORLD_HEIGHT_CELLS;

const OVERLAY_BORDER_TOP_Y = 8;
const OVERLAY_BORDER_BOTTOM_Y = 28;
const LEFT_OVERLAY_BORDER_X = 10;
const TITLE_TEXT = 'FRAGDACHSE';
const TITLE_GAP = 1;

function cellKey(gridX: number, gridY: number): number {
  return gridY * GRID_COLS + gridX;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function points<T extends RockCell | TreeCell | DirtCell>(
  coords: ReadonlyArray<readonly [number, number]>,
): T[] {
  return coords.map(([gridX, gridY]) => ({ gridX, gridY } as T));
}

function line(fromX: number, toX: number, gridY: number): DirtCell[] {
  const result: DirtCell[] = [];
  for (let gridX = fromX; gridX <= toX; gridX += 1) result.push({ gridX, gridY });
  return result;
}

function rockRow(fromX: number, toX: number, gridY: number): RockCell[] {
  const result: RockCell[] = [];
  for (let gridX = fromX; gridX <= toX; gridX += 1) result.push({ gridX, gridY });
  return result;
}

function rockColumn(fromY: number, toY: number, gridX: number): RockCell[] {
  const result: RockCell[] = [];
  for (let gridY = fromY; gridY <= toY; gridY += 1) result.push({ gridX, gridY });
  return result;
}

/** Behaelt den ersten Treffer je Zelle; die Reihenfolge entscheidet damit ueber die Rolle. */
function mergeUnique<T extends RockCell | TreeCell | DirtCell>(...groups: T[][]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const group of groups) {
    for (const cell of group) {
      const key = cellKey(cell.gridX, cell.gridY);
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

function excludeRectCells<T extends RockCell | TreeCell | DirtCell>(
  cells: T[],
  rects: readonly GridRect[],
): T[] {
  return cells.filter((cell) => rects.every((rect) => !isInsideRect(cell.gridX, cell.gridY, rect)));
}

function createLobbyRng(seed: number): () => number {
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

function ellipseCells(centerX: number, centerY: number, radiusX: number, radiusY: number): RockCell[] {
  const result: RockCell[] = [];
  const minX = Math.max(0, Math.floor(centerX - radiusX - 1));
  const maxX = Math.min(GRID_COLS - 1, Math.ceil(centerX + radiusX + 1));
  const minY = Math.max(0, Math.floor(centerY - radiusY - 1));
  const maxY = Math.min(GRID_ROWS - 1, Math.ceil(centerY + radiusY + 1));

  for (let gridY = minY; gridY <= maxY; gridY += 1) {
    for (let gridX = minX; gridX <= maxX; gridX += 1) {
      const dx = (gridX - centerX) / Math.max(radiusX, 0.75);
      const dy = (gridY - centerY) / Math.max(radiusY, 0.75);
      if (dx * dx + dy * dy <= 1.05) result.push({ gridX, gridY });
    }
  }

  return result;
}

function createOrganicRockCluster(anchor: RockClusterAnchor, seed: number): RockCell[] {
  const rng = createLobbyRng(seed);
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

  const rawCluster = mergeUnique<RockCell>(
    ...lobes.map((lobe) => ellipseCells(lobe.gridX, lobe.gridY, lobe.radiusX, lobe.radiusY)),
  );
  const rawSet = new Set<number>(rawCluster.map((cell) => cellKey(cell.gridX, cell.gridY)));

  return rawCluster.filter((cell) => {
    const orthogonalNeighbors = [
      cellKey(cell.gridX - 1, cell.gridY),
      cellKey(cell.gridX + 1, cell.gridY),
      cellKey(cell.gridX, cell.gridY - 1),
      cellKey(cell.gridX, cell.gridY + 1),
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

function createOrganicTopDirtBand(seed: number): DirtCell[] {
  const rng = createLobbyRng(seed);
  const result: DirtCell[] = [];
  let depth = 5;

  for (let gridX = 0; gridX < GRID_COLS; gridX += 1) {
    const drift = rng();
    if (drift < 0.28) depth -= 1;
    else if (drift > 0.72) depth += 1;
    depth = clampInt(depth, 4, 7);

    const edgeWeight = gridX < 5 || gridX > GRID_COLS - 6 ? 1 : 0;
    const columnDepth = clampInt(depth + edgeWeight, 4, 7);
    for (let gridY = 0; gridY <= columnDepth; gridY += 1) result.push({ gridX, gridY });
  }

  return result;
}

function resolveRockDecalPlacement(
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

function generateLobbyDecals(
  rocks: readonly RockCell[],
  trees: readonly TreeCell[],
  dirtCells: readonly DirtCell[],
  clearZones: readonly GridRect[],
): DecalCell[] {
  const rng = createLobbyRng(LOBBY_WORLD_SEED + 17);
  const dirtSet = new Set<number>(dirtCells.map((cell) => cellKey(cell.gridX, cell.gridY)));
  const blockedCells = new Set<number>();

  for (const rock of rocks) blockedCells.add(cellKey(rock.gridX, rock.gridY));
  for (const tree of trees) blockedCells.add(cellKey(tree.gridX, tree.gridY));

  const decals: DecalCell[] = [];
  for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
    for (let gridX = 0; gridX < GRID_COLS; gridX += 1) {
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
    const placement = resolveRockDecalPlacement(rock, rockIndexByKey);
    const coveragePercent = placement === 'edge'
      ? ROCK_DECAL_CONFIG.edgeCoveragePercent
      : ROCK_DECAL_CONFIG.interiorCoveragePercent;
    if (!rollPercent(rng, coveragePercent)) continue;
    const textureKey = pickWeightedDecalTextureKey(rng, getRockDecalVariantsForPlacement(placement));
    if (!textureKey) continue;
    const variant = getRockDecalVariant(textureKey);
    const displaySize = variant?.displaySize;
    const maxOffset = getRockDecalMaxOffsetPx(displaySize);
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
      rotation: rng() * Math.PI * 2,
    });
  }

  return decals;
}

// -- Lobby-Oberflaeche: Rahmen, Panel und Freiflaechen -----------------------

const TITLE_START_X = Math.floor((GRID_COLS - textWidth(TITLE_TEXT, TITLE_GAP)) * 0.5);
const RIGHT_OVERLAY_BORDER_X = GRID_COLS - 11;
const RIGHT_OVERLAY_INFO_MIN_X = RIGHT_OVERLAY_BORDER_X + 1;

/**
 * Breite des zentralen Lobby-Panels.
 *
 * Steht hier und nicht in der Oberflaeche, weil die Lobby-Geometrie exakt seinen Grundriss als
 * Freiflaeche benutzt. Zwei getrennte Zahlen wuerden bei der naechsten Aenderung auseinanderlaufen.
 */
export const LOBBY_PANEL_WIDTH = 832;

/**
 * Gitterbezugspunkte der Lobby-Oberflaeche. Wer den Rahmen verschiebt, verschiebt damit auch
 * jede daraus abgeleitete Flaeche.
 */
export const LOBBY_LAYOUT_GRID = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  /** Senkrechte Felssaeule links bzw. rechts. */
  leftFrameColumn: LEFT_OVERLAY_BORDER_X,
  rightFrameColumn: RIGHT_OVERLAY_BORDER_X,
  /** Waagerechte Rahmenzeilen. */
  frameTopRow: OVERLAY_BORDER_TOP_Y,
  frameBottomRow: OVERLAY_BORDER_BOTTOM_Y,
} as const;

/**
 * Weltkoordinaten der Flaeche, die der Felsrahmen fuer die Lobby-Oberflaeche freilaesst.
 *
 * Der Rahmen besteht aus Felszellen im 32-px-Raster, die Lobby rechnet in Pixeln. Alle
 * Lobby-Flaechen leiten ihre Kanten hieraus ab, statt die Umrechnung je UI-Datei nachzubilden.
 */
export const LOBBY_FRAME_BOUNDS = {
  top: DEFAULT_ARENA_OFFSET_Y + (OVERLAY_BORDER_TOP_Y + 1) * CELL_SIZE,
  bottom: DEFAULT_ARENA_OFFSET_Y + OVERLAY_BORDER_BOTTOM_Y * CELL_SIZE,
  outerTop: DEFAULT_ARENA_OFFSET_Y + OVERLAY_BORDER_TOP_Y * CELL_SIZE,
  outerBottom: DEFAULT_ARENA_OFFSET_Y + (OVERLAY_BORDER_BOTTOM_Y + 1) * CELL_SIZE,
  /** Innenkante der linken Spalte: dort beginnt die senkrechte Felssaeule. */
  leftColumnRight: LEFT_OVERLAY_BORDER_X * CELL_SIZE,
  /** Innenkante der rechten Spalte: dort endet die senkrechte Felssaeule. */
  rightColumnLeft: RIGHT_OVERLAY_INFO_MIN_X * CELL_SIZE,
} as const;

/**
 * Freiflaechen fuer die Lobby-Oberflaeche.
 *
 * Die mittlere Zone traegt das Lobby-Panel und bleibt vollstaendig frei - sie ist zugleich die
 * Flaeche, auf der spaeter die persistente Basis erscheint.
 */
const overlayClearZones: readonly GridRect[] = [
  { minX: 0, maxX: LEFT_OVERLAY_BORDER_X - 1, minY: 9, maxY: OVERLAY_BORDER_BOTTOM_Y - 1 },
  { minX: 16, maxX: 42, minY: 7, maxY: OVERLAY_BORDER_BOTTOM_Y },
  { minX: RIGHT_OVERLAY_INFO_MIN_X, maxX: GRID_COLS - 1, minY: 9, maxY: OVERLAY_BORDER_BOTTOM_Y - 1 },
];

const leftOverlayInfoQuietZone = overlayClearZones[0];
const rightOverlayInfoQuietZone = overlayClearZones[2];

/**
 * Flaechen, die von der Lobby-Oberflaeche belegt sind: die beiden Seitenmenues und das
 * Mittelpanel. Dort entsteht weder Geometrie noch Bodendetail.
 */
const LOBBY_UI_RESERVED_ZONES: readonly GridRect[] = [
  leftOverlayInfoQuietZone,
  rightOverlayInfoQuietZone,
  overlayClearZones[1],
];

/**
 * Liegt die Zelle unter einer Oberflaechenflaeche?
 *
 * Zugleich die Zusicherung, die die Mittelflaeche fuer die spaetere persistente Basis
 * freihaelt: in diesen Zonen entsteht keine Geometrie.
 */
export function isLobbyUiReservedCell(gridX: number, gridY: number): boolean {
  return LOBBY_UI_RESERVED_ZONES.some((rect) => isInsideRect(gridX, gridY, rect));
}

/**
 * Dieselben Flaechen als authored Spawn-Sperre der World.
 *
 * Sie sind begehbar – wer den Schiessstand betritt, darf dort laufen. Nur starten soll niemand
 * unter dem Lobby-Panel oder hinter einem Seitenmenue, weil seine Figur dort verdeckt waere.
 */
export const LOBBY_SPAWN_EXCLUSION_ZONES: readonly ArenaGridRegion[] = LOBBY_UI_RESERVED_ZONES
  .map((rect) => ({
    minGridX: rect.minX,
    maxGridX: rect.maxX,
    minGridY: rect.minY,
    maxGridY: rect.maxY,
  }));

// -- Authored Geometrie ------------------------------------------------------

const frameRocks: RockCell[] = mergeUnique<RockCell>(
  rockRow(0, LEFT_OVERLAY_BORDER_X, OVERLAY_BORDER_TOP_Y),
  rockRow(0, LEFT_OVERLAY_BORDER_X, OVERLAY_BORDER_BOTTOM_Y),
  rockColumn(OVERLAY_BORDER_TOP_Y, OVERLAY_BORDER_BOTTOM_Y, LEFT_OVERLAY_BORDER_X),
  rockRow(RIGHT_OVERLAY_BORDER_X, GRID_COLS - 1, OVERLAY_BORDER_TOP_Y),
  rockRow(RIGHT_OVERLAY_BORDER_X, GRID_COLS - 1, OVERLAY_BORDER_BOTTOM_Y),
  rockColumn(OVERLAY_BORDER_TOP_Y, OVERLAY_BORDER_BOTTOM_Y, RIGHT_OVERLAY_BORDER_X),
).map((cell) => ({ ...cell, indestructible: true }));

/** Der Schriftzug ist gewoehnlicher Fels: er faellt der normalen World-Destruction zu. */
const titleRocks: RockCell[] = textRocks(TITLE_TEXT, TITLE_START_X, 1, TITLE_GAP);

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
];

const titleRockGapZone: GridRect = { minX: 0, maxX: GRID_COLS - 1, minY: 0, maxY: 9 };

const leftOverlayBorderReserveZone: GridRect = {
  minX: 0,
  maxX: LEFT_OVERLAY_BORDER_X + 2,
  minY: OVERLAY_BORDER_TOP_Y,
  maxY: OVERLAY_BORDER_BOTTOM_Y,
};

const rightOverlayBorderReserveZone: GridRect = {
  minX: RIGHT_OVERLAY_BORDER_X - 1,
  maxX: GRID_COLS - 1,
  minY: OVERLAY_BORDER_TOP_Y,
  maxY: OVERLAY_BORDER_BOTTOM_Y,
};

const ambientRocks: RockCell[] = excludeRectCells(
  createOrganicRockClusters(ambientRockAnchors, LOBBY_WORLD_SEED + 101),
  [
    ...overlayClearZones,
    titleRockGapZone,
    leftOverlayBorderReserveZone,
    rightOverlayBorderReserveZone,
  ],
);

const titleTreeClearZone: GridRect = {
  minX: Math.max(0, TITLE_START_X - 1),
  maxX: Math.min(GRID_COLS - 1, TITLE_START_X + textWidth(TITLE_TEXT, TITLE_GAP)),
  minY: 0,
  maxY: 6,
};

const titleDirtClearZone: GridRect = {
  minX: Math.max(0, TITLE_START_X - 1),
  maxX: Math.min(GRID_COLS - 1, TITLE_START_X + textWidth(TITLE_TEXT, TITLE_GAP)),
  minY: 0,
  maxY: 9,
};

const dirtQuietZones: readonly GridRect[] = [rightOverlayInfoQuietZone, overlayClearZones[1]];

/**
 * Reihenfolge zaehlt: `mergeUnique` behaelt den ersten Treffer, und der geschuetzte Rahmen
 * steht vorn. Ein Schriftzugfels an derselben Zelle waere sonst still unzerstoerbar.
 */
const lobbyRocks: RockCell[] = mergeUnique<RockCell>(frameRocks, titleRocks, ambientRocks);

const lobbyTrees: TreeCell[] = excludeRectCells(
  points<TreeCell>([[1, 4], [12, 18], [15, 31], [57, 4], [47, 17], [46, 25], [51, 31]]),
  [...overlayClearZones, titleTreeClearZone],
);

const lobbyDirt: DirtCell[] = mergeUnique<DirtCell>(
  excludeRectCells(
    mergeUnique<DirtCell>(
      excludeRectCells(createOrganicTopDirtBand(LOBBY_WORLD_SEED + 211), [titleDirtClearZone]),
      line(44, 59, 30),
      line(43, 59, 31),
      line(46, 59, 32),
    ),
    dirtQuietZones,
  ),
  createOrganicDirtMargin(lobbyRocks, {
    maxCols: GRID_COLS,
    maxRows: GRID_ROWS,
    rng: createLobbyRng(LOBBY_WORLD_SEED + 223),
  }),
);

const lobbyDecals: DecalCell[] = generateLobbyDecals(
  lobbyRocks,
  lobbyTrees,
  lobbyDirt,
  LOBBY_UI_RESERVED_ZONES,
);

const LOBBY_WORLD_LAYOUT: ArenaLayout = {
  seed: LOBBY_WORLD_SEED,
  rocks: lobbyRocks,
  trees: lobbyTrees,
  tracks: [],
  dirt: lobbyDirt,
  decals: lobbyDecals,
  powerUpPedestals: [],
};

/**
 * Das authored Layout der LobbyWorld.
 *
 * Deterministisch und ohne Laufzeiteingabe: Host und Client bauen exakt dieselbe Geometrie,
 * und der World-Fingerprint prueft das wie bei jeder anderen World.
 *
 * Jeder Aufruf liefert eine **eigene** Kopie, genau wie der Generator. Die Runtime schreibt in
 * das Layout ihrer World – platzierte Konstrukte haengen sich als zusaetzliche Felszellen an –,
 * und eine geteilte Instanz wuerde diese Runden nacheinander uebereinander schichten.
 */
export function buildLobbyWorldLayout(): ArenaLayout {
  return {
    seed: LOBBY_WORLD_LAYOUT.seed,
    rocks: LOBBY_WORLD_LAYOUT.rocks.map((cell) => ({ ...cell })),
    trees: LOBBY_WORLD_LAYOUT.trees.map((cell) => ({ ...cell })),
    tracks: [],
    dirt: LOBBY_WORLD_LAYOUT.dirt.map((cell) => ({ ...cell })),
    decals: (LOBBY_WORLD_LAYOUT.decals ?? []).map((cell) => ({ ...cell })),
    powerUpPedestals: [],
  };
}
