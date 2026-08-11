import * as Phaser from 'phaser';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CANOPY_RADIUS,
  CELL_SIZE,
  COLORS,
  DEPTH,
  GRID_COLS,
  GRID_ROWS,
  TRUNK_RADIUS,
} from '../config';
import type { DecalCell, DirtCell, TrackCell, TreeCell } from '../types';
import { DECAL_SIZE, ROCK_DECAL_SIZE as ROCK_DECAL_DISPLAY_SIZE } from './DecalConfig';
import { AutoTiler, DIRT_AUTOTILE } from './AutoTiler';
import { RockGridIndex } from './RockGridIndex';

interface RockVariationWash {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  color: number;
  strength: number;
}

/** Grossraeumige, deterministische Farbregionen statt eines sichtbaren Per-Tile-Zufallsrasters. */
const ROCK_VARIATION_WASHES: readonly RockVariationWash[] = [
  { centerX: 0.16, centerY: 0.2, radiusX: 0.46, radiusY: 0.34, color: 0xd0a878, strength: 0.22 },
  { centerX: 0.79, centerY: 0.25, radiusX: 0.42, radiusY: 0.31, color: 0x8ca9b2, strength: 0.2 },
  { centerX: 0.42, centerY: 0.76, radiusX: 0.5, radiusY: 0.32, color: 0x93a56f, strength: 0.19 },
  { centerX: 0.88, centerY: 0.78, radiusX: 0.31, radiusY: 0.28, color: 0xb28b91, strength: 0.16 },
];

const ROCK_VARIATION_ALPHA = 0.16;

export interface ArenaTreeVisual {
  trunk: Phaser.GameObjects.Arc;
  canopy: Phaser.GameObjects.Image;
  worldX: number;
  worldY: number;
}

export interface ArenaVisualGridMetrics {
  offsetX: number;
  offsetY: number;
  gridCols?: number;
  gridRows?: number;
}

function getMetrics(metrics?: ArenaVisualGridMetrics): ArenaVisualGridMetrics {
  if (metrics) return metrics;
  return {
    offsetX: ARENA_OFFSET_X,
    offsetY: ARENA_OFFSET_Y,
    gridCols: GRID_COLS,
    gridRows: GRID_ROWS,
  };
}

export class ArenaVisualFactory {
  static createRock(scene: Phaser.Scene, worldX: number, worldY: number, frame: number): Phaser.GameObjects.Image {
    const img = scene.add.image(worldX, worldY, 'rocks', frame);
    img.setDisplaySize(CELL_SIZE, CELL_SIZE);
    img.setDepth(DEPTH.ROCKS);
    return img;
  }

  /**
   * Erstellt die temporaeren, exakt auf die aktuellen Felsframes zugeschnittenen
   * Farbkopien fuer den gemeinsamen gebackenen Fels-Overlay-Layer.
   */
  static createRockVariationOverlays(
    scene: Phaser.Scene,
    rocks: readonly { gridX: number; gridY: number }[],
    rockObjects: readonly (Phaser.GameObjects.Image | null)[],
    activeRockIds: ReadonlySet<number>,
  ): Phaser.GameObjects.Image[] {
    const result: Phaser.GameObjects.Image[] = [];
    for (let id = 0; id < rocks.length; id += 1) {
      if (!activeRockIds.has(id)) continue;
      const source = rockObjects[id];
      const rock = rocks[id];
      if (!source?.active || !rock) continue;

      const img = scene.add.image(source.x, source.y, source.texture.key, source.frame.name);
      img
        .setDisplaySize(source.displayWidth, source.displayHeight)
        .setTint(
          resolveRockVariationTint(rock.gridX, rock.gridY, 0, 0),
          resolveRockVariationTint(rock.gridX, rock.gridY, 1, 0),
          resolveRockVariationTint(rock.gridX, rock.gridY, 0, 1),
          resolveRockVariationTint(rock.gridX, rock.gridY, 1, 1),
        )
        .setAlpha(ROCK_VARIATION_ALPHA)
        .setBlendMode(Phaser.BlendModes.NORMAL)
        .setDepth(DEPTH.ROCKS);
      result.push(img);
    }

    return result;
  }

  static createTrunk(scene: Phaser.Scene, worldX: number, worldY: number): Phaser.GameObjects.Arc {
    const trunk = scene.add.circle(worldX, worldY, TRUNK_RADIUS, COLORS.BROWN_4);
    trunk.setDepth(DEPTH.ROCKS);
    return trunk;
  }

  static createCanopy(scene: Phaser.Scene, worldX: number, worldY: number): Phaser.GameObjects.Image {
    const canopy = scene.add.image(worldX, worldY, 'bg_canopy');
    canopy.setDisplaySize(CANOPY_RADIUS * 2, CANOPY_RADIUS * 2);
    canopy.setAngle(Phaser.Math.Between(0, 359));
    canopy.setDepth(DEPTH.CANOPY);
    return canopy;
  }

  static createTrees(scene: Phaser.Scene, trees: TreeCell[], metrics?: ArenaVisualGridMetrics): ArenaTreeVisual[] {
    const gridMetrics = getMetrics(metrics);
    const result: ArenaTreeVisual[] = [];
    for (const { gridX, gridY } of trees) {
      const worldX = gridMetrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = gridMetrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2;
      const trunk = this.createTrunk(scene, worldX, worldY);
      const canopy = this.createCanopy(scene, worldX, worldY);
      result.push({ trunk, canopy, worldX, worldY });
    }
    return result;
  }

  static createDirt(scene: Phaser.Scene, dirtCells: DirtCell[], metrics?: ArenaVisualGridMetrics): Phaser.GameObjects.Image[] {
    if (dirtCells.length === 0) return [];

    const gridMetrics = getMetrics(metrics);
    const dirtGrid = new RockGridIndex(dirtCells, {
      cols: gridMetrics.gridCols ?? GRID_COLS,
      rows: gridMetrics.gridRows ?? GRID_ROWS,
    });
    const isOccupied = (gx: number, gy: number) => dirtGrid.isOccupiedWithBorder(gx, gy);
    const result: Phaser.GameObjects.Image[] = [];

    for (const { gridX, gridY } of dirtCells) {
      const worldX = gridMetrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = gridMetrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const frame = AutoTiler.getFrame(mask, DIRT_AUTOTILE);
      const img = scene.add.image(worldX, worldY, 'dirt', frame);
      img.setDisplaySize(CELL_SIZE, CELL_SIZE);
      img.setDepth(DEPTH.DIRT);
      result.push(img);
    }

    return result;
  }

  static createDecals(
    scene: Phaser.Scene,
    decals: DecalCell[],
    metrics?: ArenaVisualGridMetrics,
    surface: 'ground' | 'rock' = 'ground',
    activeRockIds?: ReadonlySet<number>,
  ): Phaser.GameObjects.Image[] {
    if (decals.length === 0) return [];

    const gridMetrics = getMetrics(metrics);
    const result: Phaser.GameObjects.Image[] = [];
    for (const decal of decals) {
      if ((decal.surface ?? 'ground') !== surface) continue;
      if (surface === 'rock' && activeRockIds && decal.rockIds?.some((id) => !activeRockIds.has(id))) continue;

      const { gridX, gridY, textureKey, offsetX, offsetY } = decal;
      const worldX = gridMetrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2 + offsetX;
      const worldY = gridMetrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2 + offsetY;
      const img = scene.add.image(worldX, worldY, textureKey);
      const displaySize = surface === 'rock' ? decal.displaySize ?? ROCK_DECAL_DISPLAY_SIZE : DECAL_SIZE;
      img.setDisplaySize(displaySize, displaySize);
      if (decal.alpha !== undefined) img.setAlpha(decal.alpha);
      // Decals are decorative and are baked immediately after creation. Keeping the
      // random transform on the temporary Image lets both the RenderTexture and the
      // terrain sampler consume the exact same placement.
      img.setRotation(decal.rotation ?? Phaser.Math.FloatBetween(0, Math.PI * 2));
      img.setDepth(surface === 'rock' ? DEPTH.ROCK_DECALS : DEPTH.DECALS);
      result.push(img);
    }

    return result;
  }

  static createRockDecals(
    scene: Phaser.Scene,
    decals: DecalCell[],
    metrics?: ArenaVisualGridMetrics,
    activeRockIds?: ReadonlySet<number>,
  ): Phaser.GameObjects.Image[] {
    return this.createDecals(scene, decals, metrics, 'rock', activeRockIds);
  }

  static createTracks(scene: Phaser.Scene, tracks: TrackCell[], metrics?: ArenaVisualGridMetrics): Phaser.GameObjects.TileSprite[] {
    if (tracks.length === 0) return [];

    const gridMetrics = getMetrics(metrics);
    const colRows = new Map<number, number>();
    for (const { gridX, gridY } of tracks) {
      const current = colRows.get(gridX) ?? 0;
      colRows.set(gridX, Math.max(current, gridY + 1));
    }

    const result: Phaser.GameObjects.TileSprite[] = [];
    for (const [col, rowCount] of colRows) {
      const width = CELL_SIZE * 2;
      const height = rowCount * CELL_SIZE;
      const centerX = gridMetrics.offsetX + col * CELL_SIZE + width / 2;
      const centerY = gridMetrics.offsetY + height / 2;
      const tileSprite = scene.add.tileSprite(centerX, centerY, width, height, 'bg_tracks');
      tileSprite.setDepth(DEPTH.TRACKS);
      result.push(tileSprite);
    }

    return result;
  }
}

function resolveRockVariationTint(gridX: number, gridY: number, cornerX: number, cornerY: number): number {
  const normalizedX = (gridX + cornerX) / Math.max(1, GRID_COLS);
  const normalizedY = (gridY + cornerY) / Math.max(1, GRID_ROWS);
  let tint = 0xffffff;

  for (const wash of ROCK_VARIATION_WASHES) {
    const dx = (normalizedX - wash.centerX) / wash.radiusX;
    const dy = (normalizedY - wash.centerY) / wash.radiusY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const edge = Phaser.Math.Clamp(1 - distance, 0, 1);
    const smoothInfluence = edge * edge * (3 - 2 * edge);
    tint = mixRockColors(tint, wash.color, wash.strength * smoothInfluence);
  }

  return tint;
}

function mixRockColors(colorA: number, colorB: number, amount: number): number {
  const t = Phaser.Math.Clamp(amount, 0, 1);
  const ar = (colorA >> 16) & 0xff;
  const ag = (colorA >> 8) & 0xff;
  const ab = colorA & 0xff;
  const br = (colorB >> 16) & 0xff;
  const bg = (colorB >> 8) & 0xff;
  const bb = colorB & 0xff;
  const red = Math.round(Phaser.Math.Linear(ar, br, t));
  const green = Math.round(Phaser.Math.Linear(ag, bg, t));
  const blue = Math.round(Phaser.Math.Linear(ab, bb, t));
  return (red << 16) | (green << 8) | blue;
}
