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
import { DECAL_SIZE } from './DecalConfig';
import { AutoTiler, DIRT_AUTOTILE } from './AutoTiler';
import { RockGridIndex } from './RockGridIndex';

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

  static createDecals(scene: Phaser.Scene, decals: DecalCell[], metrics?: ArenaVisualGridMetrics): Phaser.GameObjects.Image[] {
    if (decals.length === 0) return [];

    const gridMetrics = getMetrics(metrics);
    const result: Phaser.GameObjects.Image[] = [];
    for (const { gridX, gridY, textureKey, offsetX, offsetY } of decals) {
      const worldX = gridMetrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2 + offsetX;
      const worldY = gridMetrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2 + offsetY;
      const img = scene.add.image(worldX, worldY, textureKey);
      img.setDisplaySize(DECAL_SIZE, DECAL_SIZE);
      img.setDepth(DEPTH.DECALS);
      result.push(img);
    }

    return result;
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