import * as Phaser from 'phaser';
import {
  CAPTURE_THE_BEER_BASE_TINT_ALPHA,
  CAPTURE_THE_BEER_BLUE_BASE_TINT,
  CAPTURE_THE_BEER_RED_BASE_TINT,
  getCaptureTheBeerBaseWorldBounds,
  isCaptureTheBeerBaseModeActive,
} from '../config';
import type { ArenaLayout, GameMode } from '../types';
import { ArenaVisualFactory } from './ArenaVisualFactory';
import { resolveArenaBackgroundSpec } from './ArenaBackground';
import type { ArenaBuilderResult, RockWorldFrame } from './ArenaBuilder';
import type { GroundSurfaceStreamer, GroundSnapshotRegion } from './chunks/GroundSurfaceStreamer';
import { TerrainColorSnapshot } from './TerrainColorSnapshot';
import type { WorldMetrics } from '../world/WorldMetrics';

type SnapshotRepeatConfig = Phaser.Types.GameObjects.TileSprite.TileSpriteConfig & {
  tilePositionX: number;
  tilePositionY: number;
};

export const TERRAIN_SNAPSHOT_SCALE = 4;
export const TERRAIN_SNAPSHOT_RENDER_SCALE = 1 / TERRAIN_SNAPSHOT_SCALE;
export const TERRAIN_SNAPSHOT_SCRATCH_SIZE = 512;
export const TERRAIN_SNAPSHOT_REGION_WORLD_SIZE = TERRAIN_SNAPSHOT_SCRATCH_SIZE * TERRAIN_SNAPSHOT_SCALE;

export interface TerrainColorSnapshotBuildOptions {
  readonly scene: Phaser.Scene;
  readonly mode: GameMode;
  readonly layout: ArenaLayout;
  readonly arenaResult: ArenaBuilderResult;
  readonly worldMetrics: WorldMetrics;
}

export interface TerrainSnapshotRegion extends GroundSnapshotRegion {
  readonly pixelX: number;
  readonly pixelY: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/** Liefert die festen Snapshot-Fenster, ohne eine Arena-Renderflaeche anzulegen. */
export function getTerrainSnapshotRegions(
  worldWidth: number,
  worldHeight: number,
  worldOffsetX: number,
  worldOffsetY: number,
): TerrainSnapshotRegion[] {
  const width = Math.ceil(worldWidth / TERRAIN_SNAPSHOT_SCALE);
  const height = Math.ceil(worldHeight / TERRAIN_SNAPSHOT_SCALE);
  const regions: TerrainSnapshotRegion[] = [];
  for (let pixelY = 0; pixelY < height; pixelY += TERRAIN_SNAPSHOT_SCRATCH_SIZE) {
    for (let pixelX = 0; pixelX < width; pixelX += TERRAIN_SNAPSHOT_SCRATCH_SIZE) {
      const pixelWidth = Math.min(TERRAIN_SNAPSHOT_SCRATCH_SIZE, width - pixelX);
      const pixelHeight = Math.min(TERRAIN_SNAPSHOT_SCRATCH_SIZE, height - pixelY);
      regions.push({
        worldX: worldOffsetX + pixelX * TERRAIN_SNAPSHOT_SCALE,
        worldY: worldOffsetY + pixelY * TERRAIN_SNAPSHOT_SCALE,
        width: pixelWidth * TERRAIN_SNAPSHOT_SCALE,
        height: pixelHeight * TERRAIN_SNAPSHOT_SCALE,
        pixelX,
        pixelY,
        pixelWidth,
        pixelHeight,
      });
    }
  }
  return regions;
}

/** Globale Kachelphase relativ zum sichtbaren Arena-Ursprung. */
export function getTerrainTexturePhase(worldPosition: number, worldOffset: number, textureSize: number): number {
  const phase = (worldPosition - worldOffset) % textureSize;
  return phase < 0 ? phase + textureSize : phase;
}

export class TerrainColorSnapshotBuilder {
  private readonly frame: RockWorldFrame;
  private readonly width: number;
  private readonly height: number;
  private readonly regions: TerrainSnapshotRegion[];
  private readonly scratch: Phaser.GameObjects.RenderTexture;

  constructor(private readonly options: TerrainColorSnapshotBuildOptions) {
    this.frame = {
      offsetX: options.worldMetrics.offsetX,
      offsetY: options.worldMetrics.offsetY,
      width: options.worldMetrics.widthPx,
      height: options.worldMetrics.heightPx,
    };
    this.width = Math.ceil(this.frame.width / TERRAIN_SNAPSHOT_SCALE);
    this.height = Math.ceil(this.frame.height / TERRAIN_SNAPSHOT_SCALE);
    this.regions = getTerrainSnapshotRegions(
      this.frame.width,
      this.frame.height,
      this.frame.offsetX,
      this.frame.offsetY,
    );
    this.scratch = options.scene.add.renderTexture(
      0,
      0,
      TERRAIN_SNAPSHOT_SCRATCH_SIZE,
      TERRAIN_SNAPSHOT_SCRATCH_SIZE,
    );
    this.scratch.camera.setOrigin(0, 0);
    this.scratch.setOrigin(0, 0).setVisible(false).setScrollFactor(0);
  }

  build(): Promise<TerrainColorSnapshot> {
    const data = new Uint8Array(this.width * this.height * 3);
    const snapshot = new TerrainColorSnapshot(
      this.width,
      this.height,
      this.frame.offsetX,
      this.frame.offsetY,
      data,
    );

    return new Promise<TerrainColorSnapshot>((resolve, reject) => {
      const finishWithError = (error: unknown): void => {
        this.scratch.destroy();
        reject(error);
      };
      const readRegion = (index: number): void => {
        if (index >= this.regions.length) {
          this.scratch.destroy();
          resolve(snapshot);
          return;
        }

        const region = this.regions[index];
        try {
          this.renderRegion(region);
          this.scratch.snapshotArea(0, 0, region.pixelWidth, region.pixelHeight, (image) => {
            try {
              if (!(image instanceof HTMLImageElement)) {
                throw new Error('[TerrainColorSnapshot] Snapshot lieferte kein Bild.');
              }
              copySnapshotImage(image, data, this.width, region);
              readRegion(index + 1);
            } catch (error) {
              finishWithError(error);
            }
          });
        } catch (error) {
          finishWithError(error);
        }
      };
      readRegion(0);
    });
  }

  private renderRegion(region: TerrainSnapshotRegion): void {
    const { scene, mode, layout, arenaResult } = this.options;
    const renderScale = TERRAIN_SNAPSHOT_RENDER_SCALE;
    const background = resolveArenaBackgroundSpec(mode, this.frame.width);
    const baseFrame = scene.textures.getFrame(background.textureKey);
    const detailFrame = scene.textures.getFrame(background.detailTextureKey);
    const baseTileWidth = Math.max(1, baseFrame.width);
    const baseTileHeight = Math.max(1, baseFrame.height);
    const detailTileWidth = Math.max(1, detailFrame.width);
    const detailTileHeight = Math.max(1, detailFrame.height);

    this.scratch.clear();
    // draw()/repeat() respektieren die interne Kamera; stamp() in den bestehenden Helfern nicht.
    this.scratch.camera.setScroll(region.worldX, region.worldY);
    this.scratch.camera.setZoom(renderScale);

    this.scratch.repeat(
      background.textureKey,
      undefined,
      region.worldX,
      region.worldY,
      region.width,
      region.height,
      {
        tilePositionX: getTerrainTexturePhase(region.worldX, this.frame.offsetX, baseTileWidth),
        tilePositionY: getTerrainTexturePhase(region.worldY, this.frame.offsetY, baseTileHeight),
      } as SnapshotRepeatConfig,
    );
    this.scratch.repeat(
      background.detailTextureKey,
      undefined,
      region.worldX,
      region.worldY,
      region.width,
      region.height,
      {
        alpha: background.detailAlpha,
        blendMode: Phaser.BlendModes.MULTIPLY,
        tilePositionX: getTerrainTexturePhase(region.worldX, this.frame.offsetX, detailTileWidth),
        tilePositionY: getTerrainTexturePhase(region.worldY, this.frame.offsetY, detailTileHeight),
      } as SnapshotRepeatConfig,
    );

    const groundSurface = arenaResult.groundSurface;
    groundSurface?.renderSnapshotDirt(this.scratch, region, renderScale);
    groundSurface?.renderSnapshotPersistentBaseGravel(this.scratch, region, renderScale);
    groundSurface?.renderSnapshotGroundCover(this.scratch, region, renderScale);
    groundSurface?.renderSnapshotPersistentBaseGravelDecoration(this.scratch, region, renderScale);
    this.renderTracks(layout, region);
    this.renderStaticBases(region);
    groundSurface?.renderSnapshotDecals(this.scratch, region, renderScale);

    this.scratch.render();
  }

  private renderTracks(layout: ArenaLayout, region: TerrainSnapshotRegion): void {
    const columns = ArenaVisualFactory.getTrackColumnSpecs(layout.tracks ?? [], {
      offsetX: this.frame.offsetX,
      offsetY: this.frame.offsetY,
    });
    for (const column of columns) {
      const left = Math.max(column.x, region.worldX);
      const top = Math.max(column.y, region.worldY);
      const right = Math.min(column.x + column.width, region.worldX + region.width);
      const bottom = Math.min(column.y + column.height, region.worldY + region.height);
      if (right <= left || bottom <= top) continue;
      this.scratch.repeat('bg_tracks', undefined, left, top, right - left, bottom - top, {
        tilePositionX: getTerrainTexturePhase(left, column.x, 64),
        tilePositionY: getTerrainTexturePhase(top, column.y, 32),
      } as SnapshotRepeatConfig);
    }
  }

  private renderStaticBases(region: TerrainSnapshotRegion): void {
    if (!isCaptureTheBeerBaseModeActive()) return;
    const bases = [
      { team: 'blue' as const, color: CAPTURE_THE_BEER_BLUE_BASE_TINT },
      { team: 'red' as const, color: CAPTURE_THE_BEER_RED_BASE_TINT },
    ];
    const scale = TERRAIN_SNAPSHOT_RENDER_SCALE;
    for (const base of bases) {
      const bounds = getCaptureTheBeerBaseWorldBounds(base.team);
      const left = Math.max(bounds.x, region.worldX);
      const top = Math.max(bounds.y, region.worldY);
      const right = Math.min(bounds.x + bounds.width, region.worldX + region.width);
      const bottom = Math.min(bounds.y + bounds.height, region.worldY + region.height);
      if (right <= left || bottom <= top) continue;
      this.scratch.fill(
        base.color,
        CAPTURE_THE_BEER_BASE_TINT_ALPHA,
        (left - region.worldX) * scale,
        (top - region.worldY) * scale,
        (right - left) * scale,
        (bottom - top) * scale,
      );
    }
  }
}

function copySnapshotImage(
  image: HTMLImageElement,
  target: Uint8Array,
  targetWidth: number,
  region: TerrainSnapshotRegion,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = region.pixelWidth;
  canvas.height = region.pixelHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('[TerrainColorSnapshot] Kein 2D-Kontext fuer Readback.');
  context.drawImage(image, 0, 0, region.pixelWidth, region.pixelHeight);
  const pixels = context.getImageData(0, 0, region.pixelWidth, region.pixelHeight).data;
  copyRgbRegion(pixels, target, targetWidth, region);
}

/** Kopiert ein gelesenes RGBA-Teilfenster in das zusammenhängende RGB-Snapshot-Array. */
export function copyRgbRegion(
  rgba: ArrayLike<number>,
  target: Uint8Array,
  targetWidth: number,
  region: Pick<TerrainSnapshotRegion, 'pixelX' | 'pixelY' | 'pixelWidth' | 'pixelHeight'>,
): void {
  const expectedSourceLength = region.pixelWidth * region.pixelHeight * 4;
  if (rgba.length < expectedSourceLength) {
    throw new Error(`[TerrainColorSnapshot] Erwartet ${expectedSourceLength} RGBA-Bytes, erhielt ${rgba.length}.`);
  }
  for (let y = 0; y < region.pixelHeight; y += 1) {
    for (let x = 0; x < region.pixelWidth; x += 1) {
      const source = (y * region.pixelWidth + x) * 4;
      const destination = ((region.pixelY + y) * targetWidth + region.pixelX + x) * 3;
      target[destination] = rgba[source];
      target[destination + 1] = rgba[source + 1];
      target[destination + 2] = rgba[source + 2];
    }
  }
}
