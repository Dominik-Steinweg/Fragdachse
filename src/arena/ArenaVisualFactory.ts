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
import { CANOPY_TEXTURE_KEYS } from './CanopyConfig';
import { DECAL_SIZE, ROCK_DECAL_SIZE as ROCK_DECAL_DISPLAY_SIZE } from './DecalConfig';
import { AutoTiler, DIRT_AUTOTILE } from './AutoTiler';
import { RockGridIndex } from './RockGridIndex';
import { ROCK_MOSS_MASK_TEXTURE_KEY } from './RockMossConfig';
import { DIRT_BLOB_SURFACE_PROFILE } from './BlobSurfaceProfile';
import { resolveBlobSurfaceCornerTints } from './BlobSurfaceShading';
import type { BlobSurfaceCornerTints } from './BlobSurfaceShading';

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
  /**
   * `cornerTints` traegt Flaechenwash und Kantenlicht. Der Tint
   * folgt der Kachel-Alpha exakt, die 47-Blob-Silhouette bleibt also unangetastet.
   */
  static createRock(
    scene: Phaser.Scene,
    worldX: number,
    worldY: number,
    frame: number,
    cornerTints?: BlobSurfaceCornerTints,
  ): Phaser.GameObjects.Image {
    const img = scene.add.image(worldX, worldY, 'rocks', frame);
    img.setDisplaySize(CELL_SIZE, CELL_SIZE);
    img.setDepth(DEPTH.ROCKS);
    if (cornerTints) img.setTint(...cornerTints);
    return img;
  }

  /**
   * Verlaufsmasken zu einem Satz lebender Felsen – je Fels ein Bild desselben Autotile-Frames aus
   * dem Maskensheet, an derselben Stelle und in derselben Groesse.
   *
   * Der Frame wird bewusst vom Fels-Image uebernommen statt neu berechnet: Beide Sheets teilen
   * das 47-Blob-Raster, und so kann die Maske gar nicht von der Silhouette abweichen, auf die sie
   * sich bezieht – auch nicht nach einem Retiling.
   *
   * Die Bilder werden nur als Alphaquelle fuer `erase()` erzeugt und vom Aufrufer sofort wieder
   * zerstoert; sie erreichen nie einen Renderdurchlauf.
   */
  static createRockMossMasks(
    scene: Phaser.Scene,
    rocks: readonly Phaser.GameObjects.Image[],
  ): Phaser.GameObjects.Image[] {
    const masks: Phaser.GameObjects.Image[] = [];
    for (const rock of rocks) {
      if (!rock.active) continue;
      const mask = scene.add.image(rock.x, rock.y, ROCK_MOSS_MASK_TEXTURE_KEY, rock.frame.name);
      mask.setDisplaySize(CELL_SIZE, CELL_SIZE);
      masks.push(mask);
    }
    return masks;
  }

  static createTrunk(scene: Phaser.Scene, worldX: number, worldY: number): Phaser.GameObjects.Arc {
    const trunk = scene.add.circle(worldX, worldY, TRUNK_RADIUS, COLORS.BROWN_4);
    trunk.setDepth(DEPTH.ROCKS);
    return trunk;
  }

  static createCanopy(scene: Phaser.Scene, worldX: number, worldY: number): Phaser.GameObjects.Image {
    const canopy = scene.add.image(worldX, worldY, Phaser.Math.RND.pick(CANOPY_TEXTURE_KEYS));
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

  /**
   * Weiche Auslaufkante des Dirt-Bodens: vergroesserte, zunehmend transparentere Kopien
   * derselben Autotile-Kachel.
   *
   * Warum gestapelte Kopien und kein Weichzeichner: Die Kante entsteht aus der 47-Blob-Alpha
   * des Sheets, es gibt also keine separate Randgeometrie, die sich weichzeichnen liesse. Drei
   * abgestufte Kopien ergeben bei 32 px Zellgroesse einen rund 3 px breiten Verlauf – genug,
   * damit Dirt in das Gras einlaeuft, statt als ausgeschnittener Aufkleber darauf zu liegen.
   *
   * Die Werte sind bewusst klein: Ein breiterer Saum wandert sichtbar in die Nachbarzelle und
   * verschiebt damit die wahrgenommene Begehbarkeitsgrenze.
   */
  private static readonly DIRT_FRINGE_STEPS: readonly { scale: number; alpha: number }[] = [
    { scale: 1.05, alpha: 0.34 },
    { scale: 1.11, alpha: 0.19 },
    { scale: 1.18, alpha: 0.10 },
  ];

  static createDirt(scene: Phaser.Scene, dirtCells: DirtCell[], metrics?: ArenaVisualGridMetrics): Phaser.GameObjects.Image[] {
    return this.createDirtImages(scene, dirtCells, metrics).surface;
  }

  /**
   * Erzeugt Randfahne und scharfe Flaeche in einem Durchgang, weil beide dieselbe Belegung,
   * dieselbe Autotile-Maske und dieselben Ecktints brauchen.
   *
   * `fringe` gehoert beim Backen *unter* `surface`; die Reihenfolge der Rueckgabe entspricht
   * bereits der Zeichenreihenfolge.
   */
  static createDirtImages(
    scene: Phaser.Scene,
    dirtCells: DirtCell[],
    metrics?: ArenaVisualGridMetrics,
  ): { fringe: Phaser.GameObjects.Image[]; surface: Phaser.GameObjects.Image[] } {
    if (dirtCells.length === 0) return { fringe: [], surface: [] };

    const gridMetrics = getMetrics(metrics);
    const dirtGrid = new RockGridIndex(dirtCells, {
      cols: gridMetrics.gridCols ?? GRID_COLS,
      rows: gridMetrics.gridRows ?? GRID_ROWS,
    });
    const isOccupied = (gx: number, gy: number) => dirtGrid.isOccupiedWithBorder(gx, gy);
    const fringe: Phaser.GameObjects.Image[] = [];
    const surface: Phaser.GameObjects.Image[] = [];

    for (const { gridX, gridY } of dirtCells) {
      const worldX = gridMetrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = gridMetrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const frame = AutoTiler.getFrame(mask, DIRT_AUTOTILE);
      const tints = resolveBlobSurfaceCornerTints(DIRT_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied);

      // Nur Zellen mit freiliegender Kardinalkante tragen zur Silhouette bei. Bei einer Zelle
      // im Inneren faende die Vergroesserung ohnehin nur weiteren Dirt vor.
      const exposed = !isOccupied(gridX - 1, gridY)
        || !isOccupied(gridX + 1, gridY)
        || !isOccupied(gridX, gridY - 1)
        || !isOccupied(gridX, gridY + 1);
      if (exposed) {
        for (const step of this.DIRT_FRINGE_STEPS) {
          const halo = scene.add.image(worldX, worldY, 'dirt', frame);
          halo.setDisplaySize(CELL_SIZE * step.scale, CELL_SIZE * step.scale);
          halo.setDepth(DEPTH.DIRT);
          halo.setAlpha(step.alpha);
          halo.setTint(...tints);
          fringe.push(halo);
        }
      }

      const img = scene.add.image(worldX, worldY, 'dirt', frame);
      img.setDisplaySize(CELL_SIZE, CELL_SIZE);
      img.setDepth(DEPTH.DIRT);
      img.setTint(...tints);
      surface.push(img);
    }

    return { fringe, surface };
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
