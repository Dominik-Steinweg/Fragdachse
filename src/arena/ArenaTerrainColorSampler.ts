import type * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
} from '../config';
import type { ArenaLayout, GameMode } from '../types';
import type { ArenaBuilderResult } from './ArenaBuilder';
import { resolveArenaBackgroundSpec } from './ArenaBackground';
import { DECAL_SIZE } from './DecalConfig';
import { getGroundCoverPlacementRadiusPx } from './GroundCoverLayer';
import {
  ArenaTerrainColorGrid,
  TERRAIN_COLOR_FALLBACK,
  multiplyTerrainColor,
} from './ArenaTerrainColorGrid';

/**
 * Repraesentative Bodenfarbe je Rasterzelle.
 *
 * Der frueher hier gebaute Vollflaechen-Canvas samt `getImageData` ist entfallen: Sein Speicher
 * skalierte mit der Weltflaeche, und die einzige Frage, die er beantwortet hat – "welche Farbe hat
 * der Boden unter diesem Punkt?" – braucht keine Pixelaufloesung. Der Aufbau folgt weiterhin
 * derselben geordneten Ueberlagerung wie die sichtbaren Bodenbaender (Gras, Dirt, Ground Cover,
 * Gleise, Basiszonen, Decals), rastert sie aber direkt in {@link ArenaTerrainColorGrid}.
 *
 * Die Farben der Baender kommen aus den Texturen selbst: je Textur ein einziger, gecachter
 * Mittelwert. Das ist O(Texturen) statt O(Weltpixel) und bleibt damit unabhaengig von der
 * Kartengroesse.
 */

const TERRAIN_SAMPLE_CANVAS_SIZE = 8;

export type TerrainColorSampler = (worldX: number, worldY: number) => number;

interface AverageTextureColor {
  readonly color: number;
  /** Mittlere Deckkraft der Textur – eine luecken­hafte Marke faerbt ihre Zelle nur teilweise. */
  readonly alpha: number;
}

/**
 * Ein Mittelwert je Texturschluessel, ueber Rundengrenzen hinweg. Die Texturen selbst ueberleben
 * einen Rundenwechsel ebenfalls, der Cache also auch.
 */
const averageColorCache = new Map<string, AverageTextureColor>();

export function createArenaTerrainColorSampler(
  scene: Phaser.Scene,
  mode: GameMode,
  arenaResult: ArenaBuilderResult,
  layout: ArenaLayout | null,
): TerrainColorSampler {
  const background = resolveArenaBackgroundSpec(mode, ARENA_WIDTH);
  const grass = averageTextureColor(scene, background.textureKey);
  const detail = averageTextureColor(scene, background.detailTextureKey);
  // Die Feinschicht liegt in der Szene als Multiply-TileSprite ueber dem Gras. Ohne sie laege der
  // Lookup um den mittleren Multiply-Verlust der Kachel zu hell.
  const baseColor = detail
    ? multiplyTerrainColor(grass?.color ?? TERRAIN_COLOR_FALLBACK, detail.color)
    : grass?.color ?? TERRAIN_COLOR_FALLBACK;

  const grid = new ArenaTerrainColorGrid(GRID_COLS, GRID_ROWS, CELL_SIZE, baseColor);

  const dirt = averageTextureColor(scene, 'dirt');
  if (dirt && layout) {
    for (const cell of layout.dirt ?? []) grid.paintCell(cell.gridX, cell.gridY, dirt.color, dirt.alpha);
  }

  for (const placement of arenaResult.groundCoverPlacements) {
    const cover = averageTextureColor(scene, placement.textureKey);
    if (!cover) continue;
    const radius = getGroundCoverPlacementRadiusPx(placement);
    const localX = placement.worldX - ARENA_OFFSET_X;
    const localY = placement.worldY - ARENA_OFFSET_Y;
    grid.paintRect(
      localX - radius,
      localY - radius,
      localX + radius,
      localY + radius,
      cover.color,
      cover.alpha * placement.alpha,
    );
  }

  const track = averageTextureColor(scene, 'bg_tracks');
  if (track && layout) {
    // Eine Gleiszelle bezeichnet die *linke* der beiden belegten Spalten; die Kachel ist zwei
    // Zellen breit (siehe `ArenaVisualFactory.createTracks`).
    for (const cell of layout.tracks ?? []) {
      grid.paintCell(cell.gridX, cell.gridY, track.color, track.alpha);
      grid.paintCell(cell.gridX + 1, cell.gridY, track.color, track.alpha);
    }
  }

  for (const rect of arenaResult.baseZoneObjects) {
    grid.paintRect(
      rect.x - rect.width / 2 - ARENA_OFFSET_X,
      rect.y - rect.height / 2 - ARENA_OFFSET_Y,
      rect.x + rect.width / 2 - ARENA_OFFSET_X,
      rect.y + rect.height / 2 - ARENA_OFFSET_Y,
      rect.fillColor,
      rect.fillAlpha,
    );
  }

  for (const decal of layout?.decals ?? []) {
    if ((decal.surface ?? 'ground') !== 'ground') continue;
    const color = averageTextureColor(scene, decal.textureKey);
    if (!color) continue;
    const half = DECAL_SIZE * 0.5;
    const centerX = decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX;
    const centerY = decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY;
    grid.paintRect(
      centerX - half,
      centerY - half,
      centerX + half,
      centerY + half,
      color.color,
      color.alpha * (decal.alpha ?? 1),
    );
  }

  grid.freeze();

  return (worldX: number, worldY: number): number => {
    const localX = worldX - ARENA_OFFSET_X;
    const localY = worldY - ARENA_OFFSET_Y;
    if (localX < 0 || localY < 0 || localX >= ARENA_WIDTH || localY >= ARENA_HEIGHT) {
      return TERRAIN_COLOR_FALLBACK;
    }
    return grid.sampleLocal(localX, localY);
  };
}

/**
 * Mittlere Farbe und Deckkraft einer Textur.
 *
 * Die Textur wird dafuer einmalig auf ein 8x8-Raster heruntergezeichnet; der Browser erledigt die
 * Mittelung beim Skalieren. Das ist bewusst grob: Gefragt ist ein Farbeindruck, keine Analyse.
 * Der Cache haengt am Texturschluessel und ueberlebt Rundenwechsel, weil die Texturen es auch tun.
 */
function averageTextureColor(scene: Phaser.Scene, textureKey: string): AverageTextureColor | null {
  const cached = averageColorCache.get(textureKey);
  if (cached) return cached;
  if (!scene.textures.exists(textureKey)) return null;

  const frame = scene.textures.getFrame(textureKey);
  const source = frame?.texture.source[frame.sourceIndex]?.image as CanvasImageSource | undefined;
  if (!frame || !source) return null;

  const canvas = document.createElement('canvas');
  canvas.width = TERRAIN_SAMPLE_CANVAS_SIZE;
  canvas.height = TERRAIN_SAMPLE_CANVAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(
    source,
    frame.cutX,
    frame.cutY,
    Math.max(1, frame.cutWidth),
    Math.max(1, frame.cutHeight),
    0,
    0,
    TERRAIN_SAMPLE_CANVAS_SIZE,
    TERRAIN_SAMPLE_CANVAS_SIZE,
  );

  const { data } = ctx.getImageData(0, 0, TERRAIN_SAMPLE_CANVAS_SIZE, TERRAIN_SAMPLE_CANVAS_SIZE);
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let weight = 0;
  for (let index = 0; index < data.length; index += 4) {
    const pixelAlpha = data[index + 3] / 255;
    // Nach Deckkraft gewichten: Ein transparenter Rand darf die Farbe nicht nach Schwarz ziehen.
    red += data[index] * pixelAlpha;
    green += data[index + 1] * pixelAlpha;
    blue += data[index + 2] * pixelAlpha;
    alpha += pixelAlpha;
    weight += 1;
  }
  if (weight === 0 || alpha === 0) return null;

  const result: AverageTextureColor = {
    color: (Math.round(red / alpha) << 16) | (Math.round(green / alpha) << 8) | Math.round(blue / alpha),
    alpha: alpha / weight,
  };
  averageColorCache.set(textureKey, result);
  return result;
}
