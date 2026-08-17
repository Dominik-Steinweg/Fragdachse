import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, GRID_COLS, GRID_ROWS } from '../../config';
import type { ArenaLayout, DecalCell } from '../../types';
import { ArenaVisualFactory, DIRT_FRINGE_OVERHANG_PX } from '../ArenaVisualFactory';
import { DIRT_BLOB_SURFACE_PROFILE, getBlobSurfaceMottleReachPx } from '../BlobSurfaceProfile';
import { stampBlobSurfaceMottle } from '../BlobSurfaceMottle';
import { DECAL_SIZE } from '../DecalConfig';
import { getGroundCoverPlacementRadiusPx, stampGroundCover } from '../GroundCoverLayer';
import type { GroundCoverPlacement } from '../GroundCoverField';
import { RockGridIndex } from '../RockGridIndex';
import { ChunkScratchPool, ChunkedRenderSurface, eraseChunkScratch } from './ChunkedRenderSurface';
import type { ChunkSamplingMode } from './ChunkedRenderSurface';
import type { ChunkBakeRegion, ChunkBakeSink, ChunkedSurfaceLayerSpec } from './ChunkedRenderSurface';
import type { ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';

/**
 * Gestreamte statische Bodenbaender: Dirt samt eingebackener Materialstoerung, Ground Cover und
 * die statischen Decals.
 *
 * Alle drei aendern sich zur Laufzeit nicht. Frueher war das der Grund, sie genau einmal je Runde
 * in je eine arenagrosse RenderTexture zu backen; bei 400 x 80 Zellen waeren das 12 800 x 2 560 px
 * je Band. Jetzt gilt dieselbe Ueberlegung je Render-Chunk: Ein Chunk wird beim Sichtbarwerden
 * einmal gebacken und danach nur noch gezeichnet.
 *
 * Der Bake ist deterministisch, weil jede Quelle es ist: Dirt-Autotiling und Ecktints haengen an
 * der Zellbelegung, die Materialstoerung an Zellkoordinate und Seed, Ground-Cover-Platzierungen
 * werden einmal je Runde erzeugt und danach nur gefiltert, und Decals tragen ihre Drehung im
 * Layout beziehungsweise leiten sie aus ihrer Zelle ab. Ein wieder betretener Chunk sieht deshalb
 * aus wie zuvor.
 */

export const GROUND_DIRT_LAYER_ID = 'dirt';
export const GROUND_COVER_LAYER_ID = 'groundCover';
export const GROUND_DECAL_LAYER_ID = 'groundDecals';

export interface GroundSurfaceStreamerOptions {
  readonly scene: Phaser.Scene;
  readonly frame: ChunkWorldFrame;
  readonly layout: ArenaLayout;
  readonly groundCoverPlacements: readonly GroundCoverPlacement[];
  readonly chunkSize?: number;
}

export class GroundSurfaceStreamer {
  private readonly scene: Phaser.Scene;
  private readonly frame: ChunkWorldFrame;
  private readonly layout: ArenaLayout;
  private readonly groundCoverPlacements: readonly GroundCoverPlacement[];
  private readonly groundDecals: readonly DecalCell[];
  private readonly dirtGrid: RockGridIndex;
  private readonly dirtIsOccupied: (gx: number, gy: number) => boolean;
  private readonly mottleConfigs = [
    DIRT_BLOB_SURFACE_PROFILE.mottle,
    ...(DIRT_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? []),
  ];
  private readonly scratch: ChunkScratchPool;
  private readonly surface: ChunkedRenderSurface;

  constructor(options: GroundSurfaceStreamerOptions) {
    this.scene = options.scene;
    this.frame = options.frame;
    this.layout = options.layout;
    this.groundCoverPlacements = options.groundCoverPlacements;
    this.groundDecals = (options.layout.decals ?? []).filter(
      (decal) => (decal.surface ?? 'ground') !== 'rock',
    );
    this.scratch = new ChunkScratchPool(options.scene);
    // Der Index sieht den gesamten Dirt-Bestand. Ein chunklokaler Index liesse jede Chunkgrenze
    // wie eine Aussenkante des Bodens aussehen.
    this.dirtGrid = new RockGridIndex(options.layout.dirt ?? [], { cols: GRID_COLS, rows: GRID_ROWS });
    this.dirtIsOccupied = (gx, gy) => this.dirtGrid.isOccupiedWithBorder(gx, gy);

    const layers: ChunkedSurfaceLayerSpec[] = [
      { id: GROUND_DIRT_LAYER_ID, depth: DEPTH.DIRT },
      { id: GROUND_COVER_LAYER_ID, depth: DEPTH.GROUND_COVER },
      { id: GROUND_DECAL_LAYER_ID, depth: DEPTH.DECALS },
    ];

    this.surface = new ChunkedRenderSurface(options.scene, {
      frame: options.frame,
      layers,
      chunkSize: options.chunkSize,
      bake: (region, sink) => this.bakeRegion(region, sink),
    });
  }

  updateResidency(view: ChunkWorldRect): void {
    this.surface.updateResidency(view);
  }

  setVisible(visible: boolean): void {
    this.surface.setVisible(visible);
  }

  isVisible(): boolean {
    return this.surface.isVisible();
  }

  setSamplingMode(mode: ChunkSamplingMode): void {
    this.surface.setSamplingMode(mode);
  }

  getSamplingMode(): ChunkSamplingMode {
    return this.surface.getSamplingMode();
  }

  getStats() {
    return this.surface.getStats();
  }

  /** Rastergeometrie der residenten Chunks – fuer Diagnose und Tests. */
  get grid() {
    return this.surface.grid;
  }

  /** Renderziel einer Ebene in einem residenten Chunk – fuer Diagnose und Tests. */
  getChunkTexture(layerId: string, cx: number, cy: number): Phaser.GameObjects.RenderTexture | null {
    return this.surface.getChunkTexture(layerId, cx, cy);
  }

  destroy(): void {
    this.surface.destroy();
    this.scratch.destroy();
  }

  // ── Bake ───────────────────────────────────────────────────────────────────

  private bakeRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    this.bakeDirtRegion(region, sink);
    this.bakeGroundCoverRegion(region, sink);
    this.bakeDecalRegion(region, sink);
  }

  /**
   * Dirt einer Region: Randfahne, scharfe Flaeche und die darauf eingebackene Materialstoerung.
   *
   * Die Materialstoerung bleibt wie bisher in derselben Textur wie der Boden statt in einer
   * eigenen Ebene: Sie aendert sich nie und spart so eine komplette Renderziel-Ebene je Chunk.
   */
  private bakeDirtRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    const dirtCells = this.layout.dirt ?? [];
    const { size } = region;
    const target = this.scratch.get('dirt', size);
    target.clear();

    if (dirtCells.length === 0) {
      target.render();
      sink.blit(GROUND_DIRT_LAYER_ID, target);
      return;
    }

    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const mottleReach = getBlobSurfaceMottleReachPx(DIRT_BLOB_SURFACE_PROFILE);

    // Zwei verschieden weite Auswahlen: Die sichtbaren Kacheln reichen um die Randfahne ueber
    // ihre Zelle hinaus, die Materialstempel um ein Vielfaches davon.
    const visibleCells: typeof dirtCells = [];
    const mottleSourceCells: typeof dirtCells = [];
    for (const cell of dirtCells) {
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      if (cellMaxX + DIRT_FRINGE_OVERHANG_PX > region.localX && cellMinX - DIRT_FRINGE_OVERHANG_PX < maxX
        && cellMaxY + DIRT_FRINGE_OVERHANG_PX > region.localY && cellMinY - DIRT_FRINGE_OVERHANG_PX < maxY) {
        visibleCells.push(cell);
      }
      if (cellMaxX + mottleReach > region.localX && cellMinX - mottleReach < maxX
        && cellMaxY + mottleReach > region.localY && cellMinY - mottleReach < maxY) {
        mottleSourceCells.push(cell);
      }
    }

    if (visibleCells.length === 0 && mottleSourceCells.length === 0) {
      target.render();
      sink.blit(GROUND_DIRT_LAYER_ID, target);
      return;
    }

    const { fringe, surface: tiles } = ArenaVisualFactory.createDirtImagesFromGrid(
      this.scene,
      visibleCells,
      this.dirtIsOccupied,
      {
        offsetX: -region.localX,
        offsetY: -region.localY,
        gridCols: GRID_COLS,
        gridRows: GRID_ROWS,
      },
    );
    if (fringe.length > 0) target.draw(fringe);
    if (tiles.length > 0) target.draw(tiles);
    target.render();

    if (tiles.length > 0 && mottleSourceCells.length > 0) {
      // Die Stanzform traegt nur die Silhouette *dieser* Region. Eine Dirt-Kachel deckt exakt
      // ihre eigene Zelle, der Satz ist damit vollstaendig.
      const cutout = this.scratch.get('dirtCutout', size, 'redraw');
      cutout.clear();
      cutout.fill(0x000000, 1);
      cutout.erase(tiles);
      cutout.render();

      for (let index = 0; index < this.mottleConfigs.length; index += 1) {
        const mottle = this.mottleConfigs[index];
        const layer = this.scratch.get(`dirtMottle${index}`, size);
        layer.setBlendMode(mottle.blend === 'multiply' ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL);
        layer.clear();
        stampBlobSurfaceMottle(
          this.scene,
          layer,
          DIRT_BLOB_SURFACE_PROFILE,
          mottle,
          mottleSourceCells,
          index,
          -region.localX,
          -region.localY,
        );
        layer.render();
        eraseChunkScratch(layer, cutout, size);
        layer.render();
        // `draw()` rendert das Objekt mit seinem eigenen Blendmode – so bleibt die geordnete
        // Normal-/Multiply-Kombination beim Verflachen erhalten.
        target.draw(layer);
        target.render();
      }
    }

    for (const image of fringe) image.destroy();
    for (const image of tiles) image.destroy();

    sink.blit(GROUND_DIRT_LAYER_ID, target);
  }

  private bakeGroundCoverRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const placements = this.groundCoverPlacements.filter((placement) => {
      const radius = getGroundCoverPlacementRadiusPx(placement);
      const localX = placement.worldX - this.frame.offsetX;
      const localY = placement.worldY - this.frame.offsetY;
      return localX + radius > region.localX && localX - radius < maxX
        && localY + radius > region.localY && localY - radius < maxY;
    });

    const target = this.scratch.get('groundCover', size);
    target.clear();
    if (placements.length > 0) {
      stampGroundCover(this.scene, target, placements, -region.worldX, -region.worldY);
    }
    // Auch ohne Platzierungen noetig: `clear()` ist ein gepufferter Befehl und wird erst hier
    // ausgefuehrt; sonst blittet die naechste Region den Inhalt dieser.
    target.render();
    sink.blit(GROUND_COVER_LAYER_ID, target);
  }

  private bakeDecalRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const radius = DECAL_SIZE * Math.SQRT1_2;
    const candidates = this.groundDecals.filter((decal) => {
      const centerX = decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX;
      const centerY = decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY;
      return centerX + radius > region.localX && centerX - radius < maxX
        && centerY + radius > region.localY && centerY - radius < maxY;
    });

    const target = this.scratch.get('groundDecal', size);
    target.clear();
    const images = ArenaVisualFactory.createDecals(
      this.scene,
      candidates as DecalCell[],
      { offsetX: -region.localX, offsetY: -region.localY },
    );
    if (images.length > 0) target.draw(images);
    target.render();
    for (const image of images) image.destroy();
    sink.blit(GROUND_DECAL_LAYER_ID, target);
  }
}
