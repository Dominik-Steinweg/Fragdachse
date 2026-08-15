import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, GRID_COLS, GRID_ROWS } from '../config';
import type { RockCell } from '../types';
import type { ArenaVisualGridMetrics } from './ArenaVisualFactory';
import { hashSeededCell01 } from './CellHash';
import { ROCK_VEGETATION_CONFIG, getRockVegetationTextureKey } from './RockVegetationConfig';
import type { RockVegetationClassConfig, RockVegetationLayerConfig } from './RockVegetationConfig';

/**
 * Platzierung der Fels-Vegetation: deterministisch aus Seed und Felsgeometrie, ohne
 * Phaser-Abhaengigkeit und damit direkt testbar. Aufbau wie {@link ./RockMossField}.
 *
 * Das Feld denkt in **Kantenlaeufen**, nicht in einzelnen Zellen. Gesucht werden maximale Ketten
 * benachbarter Felszellen, die zur selben Seite hin frei liegen; auf ihnen werden Matten in
 * Groessenklassen abgesetzt. Lange gerade Aussenkanten bekommen dadurch grosse zusammenhaengende
 * Matten ueber viele Zellen, kurze Kanten und Einzelfelsen kleine Ausschnitte derselben Vorlagen.
 *
 * Wie beim Fels-Moos leitet sich die Platzierung aus dem **vollstaendigen** Felsbestand des
 * Layouts ab, nie aus den gerade noch stehenden Felsen. Eine Zerstoerung darf die Matten nicht neu
 * auswuerfeln – im Spiel waere das als springender Bewuchs auf allen unbeteiligten Felsen sichtbar.
 * Dass Vegetation nur auf noch stehendem Fels erscheint, ist deshalb keine Frage der Platzierung,
 * sondern der Reichweitenmaske beim Backen (siehe {@link ./RockVegetationLayer}): Faellt ein Fels,
 * verschwindet genau der Teil der Matte, der ueber ihm lag, und die Nachbarn bleiben unberuehrt.
 */

export interface RockVegetationPlacement {
  textureKey: string;
  worldX: number;
  worldY: number;
  /** Laenge entlang der Felskante, in Weltpixeln. */
  lengthPx: number;
  /** Hoehe quer zur Felskante, in Weltpixeln. Streut je Matte. */
  bandPx: number;
  /** Nahe einem Vielfachen von 90 Grad; dreht die gewachsene Franse der Vorlage nach aussen. */
  rotation: number;
  alpha: number;
  /** Spiegelung entlang der Kante. Quer wird nie gespiegelt, sonst zeigte die Franse nach innen. */
  mirrorX: boolean;
}

export interface RockVegetationFieldOptions {
  seed: number;
  /** Alle Felsen des Layouts, einschliesslich bereits zerstoerter. Siehe Modulkommentar. */
  rocks: readonly RockCell[];
  /** Rahmen und Gittergroesse. Ohne Angabe die laufenden Arena-Metriken. */
  metrics?: ArenaVisualGridMetrics;
  config?: RockVegetationLayerConfig;
}

/**
 * Die vier Kantenrichtungen. `rotation` dreht die Vorlage so, dass ihre gewachsene Franse (im
 * Bild oben, siehe Generatorskript) nach aussen ueber die Felskante zeigt.
 */
const EDGES = [
  { dx: 0, dy: -1, rotation: 0 },
  { dx: 0, dy: 1, rotation: Math.PI },
  { dx: -1, dy: 0, rotation: -Math.PI / 2 },
  { dx: 1, dy: 0, rotation: Math.PI / 2 },
] as const;

/**
 * Eigener Salt-Versatz gegen {@link ./RockMossField} und {@link ./GroundCoverField}. Ohne ihn
 * lieferten die Felder bei gleichem Seed und gleicher Zelle dieselben Hashwerte, und die
 * Bewuchsschichten laegen sichtbar im selben Muster.
 */
const ROCK_VEGETATION_SALT_BASE = 0x7e21;
const SALT_COVER = 1;
const SALT_CLASS = 2;
const SALT_SPAN = 3;
const SALT_GAP = 4;
const SALT_VARIANT = 5;
const SALT_ALPHA = 6;
const SALT_MIRROR = 7;
const SALT_OVERHANG = 8;
const SALT_BAND = 9;
const SALT_ROTATION = 10;
const SALT_ALONG = 11;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function generateRockVegetationPlacements(options: RockVegetationFieldOptions): RockVegetationPlacement[] {
  const config = options.config ?? ROCK_VEGETATION_CONFIG;
  const metrics = options.metrics;
  const offsetX = metrics?.offsetX ?? ARENA_OFFSET_X;
  const offsetY = metrics?.offsetY ?? ARENA_OFFSET_Y;
  const cols = metrics?.gridCols ?? GRID_COLS;
  const rows = metrics?.gridRows ?? GRID_ROWS;
  if (cols <= 0 || rows <= 0 || options.rocks.length === 0 || config.classes.length === 0) return [];

  const rockSet = new Set<number>();
  for (const { gridX, gridY } of options.rocks) {
    if (gridX < 0 || gridY < 0 || gridX >= cols || gridY >= rows) continue;
    rockSet.add(gridY * cols + gridX);
  }
  const isRock = (gridX: number, gridY: number): boolean =>
    gridX >= 0 && gridY >= 0 && gridX < cols && gridY < rows && rockSet.has(gridY * cols + gridX);

  const placements: RockVegetationPlacement[] = [];
  /** Wieviele Kanten je Zelle bereits eine Matte tragen – deckelt den Bewuchs kleiner Felsen. */
  const edgeLoad = new Map<number, number>();

  for (let edge = 0; edge < EDGES.length; edge += 1) {
    const { dx, dy, rotation } = EDGES[edge];
    const alongX = dx === 0;
    const lineCount = alongX ? rows : cols;
    const runLimit = alongX ? cols : rows;

    for (let line = 0; line < lineCount; line += 1) {
      let start = -1;
      for (let index = 0; index <= runLimit; index += 1) {
        const gridX = alongX ? index : line;
        const gridY = alongX ? line : index;
        const open = index < runLimit && isRock(gridX, gridY) && !isRock(gridX + dx, gridY + dy);
        if (open) {
          if (start < 0) start = index;
          continue;
        }
        if (start < 0) continue;
        if (placements.length >= config.maxPlacements) return placements;
        emitRun(placements, edgeLoad, {
          config,
          seed: options.seed,
          cols,
          offsetX,
          offsetY,
          edge,
          rotation,
          alongX,
          line,
          start,
          length: index - start,
        });
        start = -1;
      }
    }
  }

  return placements;
}

interface RunContext {
  config: RockVegetationLayerConfig;
  seed: number;
  cols: number;
  offsetX: number;
  offsetY: number;
  edge: number;
  rotation: number;
  alongX: boolean;
  line: number;
  start: number;
  length: number;
}

/**
 * Setzt die Matten eines einzelnen Kantenlaufs.
 *
 * Jeder Wuerfel haengt an den Gitterkoordinaten der Zelle, an der das jeweilige Segment beginnt –
 * nie an einem Laufindex oder einer Listenposition. Nur so bleibt das Feld unabhaengig von der
 * Reihenfolge, in der die Laeufe gefunden werden.
 */
function emitRun(
  placements: RockVegetationPlacement[],
  edgeLoad: Map<number, number>,
  run: RunContext,
): void {
  const { config, seed, cols, edge, alongX, line, start, length } = run;
  const salt = ROCK_VEGETATION_SALT_BASE + edge * 1013;
  const coverage = Math.min(config.maxCoverage, config.minCoverage + config.coverageSlopePerCell * (length - 1));

  let position = 0;
  while (position < length) {
    if (placements.length >= config.maxPlacements) return;
    const index = start + position;
    const gridX = alongX ? index : line;
    const gridY = alongX ? line : index;
    const roll = (purpose: number): number => hashSeededCell01(seed, gridX, gridY, salt + purpose);

    if (roll(SALT_COVER) >= coverage) {
      position += 1;
      continue;
    }

    const remaining = length - position;
    const sizeClass = pickClass(config, remaining, roll(SALT_CLASS));
    if (!sizeClass) break;
    const span = pickSpan(sizeClass, remaining, roll(SALT_SPAN));
    if (!fitsEdgeBudget(edgeLoad, config, cols, alongX, line, index, span)) {
      position += 1;
      continue;
    }

    placements.push(buildPlacement(run, sizeClass, index, span, roll));
    chargeEdgeBudget(edgeLoad, cols, alongX, line, index, span);
    position += span + Math.floor(roll(SALT_GAP) * (config.maxGapCells + 1));
  }
}

/**
 * Waehlt die Groessenklasse. Der quadrierte Hash zieht die Wahl zur groessten noch passenden
 * Klasse – lange gerade Kanten sollen bevorzugt eine durchgehende Matte tragen statt einer Kette
 * kleiner Flecken.
 */
function pickClass(
  config: RockVegetationLayerConfig,
  remaining: number,
  roll: number,
): RockVegetationClassConfig | null {
  const candidates = config.classes.filter((entry) => entry.minCells <= remaining);
  if (candidates.length === 0) return null;
  const offset = Math.min(candidates.length - 1, Math.floor(roll ** 2 * candidates.length));
  return candidates[candidates.length - 1 - offset];
}

function pickSpan(sizeClass: RockVegetationClassConfig, remaining: number, roll: number): number {
  const high = Math.min(sizeClass.maxCells, remaining);
  const low = Math.min(sizeClass.minCells, high);
  return Math.min(high, low + Math.floor((1 - roll ** 2) * (high - low + 1)));
}

function edgeLoadKey(cols: number, alongX: boolean, line: number, index: number): number {
  return alongX ? line * cols + index : index * cols + line;
}

function fitsEdgeBudget(
  edgeLoad: Map<number, number>,
  config: RockVegetationLayerConfig,
  cols: number,
  alongX: boolean,
  line: number,
  index: number,
  span: number,
): boolean {
  for (let offset = 0; offset < span; offset += 1) {
    const key = edgeLoadKey(cols, alongX, line, index + offset);
    if ((edgeLoad.get(key) ?? 0) >= config.maxEdgesPerCell) return false;
  }
  return true;
}

function chargeEdgeBudget(
  edgeLoad: Map<number, number>,
  cols: number,
  alongX: boolean,
  line: number,
  index: number,
  span: number,
): void {
  for (let offset = 0; offset < span; offset += 1) {
    const key = edgeLoadKey(cols, alongX, line, index + offset);
    edgeLoad.set(key, (edgeLoad.get(key) ?? 0) + 1);
  }
}

function buildPlacement(
  run: RunContext,
  sizeClass: RockVegetationClassConfig,
  index: number,
  span: number,
  roll: (purpose: number) => number,
): RockVegetationPlacement {
  const { config, offsetX, offsetY, edge, rotation, alongX, line } = run;
  // Nord- und Westkante liegen an der niedrigen Zellgrenze, Sued- und Ostkante an der hohen. Die
  // Mattenmitte rueckt von dort aus immer nach *innen*, in den Fels hinein.
  const atLowEdge = edge === 0 || edge === 2;
  const bandPx = lerp(config.minBandPx, config.maxBandPx, roll(SALT_BAND));
  const overhang = config.overhangPx + (roll(SALT_OVERHANG) - 0.5) * 2 * config.overhangJitterPx;
  const inset = bandPx / 2 - overhang;
  const edgeLine = (atLowEdge ? line : line + 1) * CELL_SIZE;
  const across = atLowEdge ? edgeLine + inset : edgeLine - inset;
  const along = (index + span / 2) * CELL_SIZE
    + (roll(SALT_ALONG) - 0.5) * 2 * config.alongJitterPx;

  let totalWeight = 0;
  for (const variant of config.variants) totalWeight += variant.frequencyPercent;
  let variantRoll = roll(SALT_VARIANT) * totalWeight;
  let picked = config.variants[config.variants.length - 1];
  for (const variant of config.variants) {
    variantRoll -= variant.frequencyPercent;
    if (variantRoll <= 0) {
      picked = variant;
      break;
    }
  }

  return {
    textureKey: getRockVegetationTextureKey(picked.index, sizeClass.name),
    worldX: offsetX + (alongX ? along : across),
    worldY: offsetY + (alongX ? across : along),
    lengthPx: span * CELL_SIZE + config.overlapPx * 2,
    bandPx,
    rotation: rotation + (roll(SALT_ROTATION) - 0.5) * 2 * config.rotationJitter,
    alpha: lerp(config.minAlpha, config.maxAlpha, roll(SALT_ALPHA)),
    mirrorX: roll(SALT_MIRROR) < 0.5,
  };
}

/** Halbe Diagonale einer Matte – konservativer Radius fuer Chunk-Ueberschneidungstests. */
export function getRockVegetationPlacementRadiusPx(placement: RockVegetationPlacement): number {
  return Math.hypot(placement.lengthPx, placement.bandPx) / 2;
}
