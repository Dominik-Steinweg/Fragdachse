import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, GRID_COLS, GRID_ROWS } from '../../config';
import type { ArenaLayout, DecalCell, DirtCell } from '../../types';
import { ArenaVisualFactory, DIRT_FRINGE_OVERHANG_PX } from '../ArenaVisualFactory';
import { DIRT_BLOB_SURFACE_PROFILE, getBlobSurfaceMottleReachPx } from '../BlobSurfaceProfile';
import { stampBlobSurfaceMottle } from '../BlobSurfaceMottle';
import { DECAL_SIZE } from '../DecalConfig';
import { getGroundCoverPlacementRadiusPx, stampGroundCover } from '../GroundCoverLayer';
import type { GroundCoverPlacement } from '../GroundCoverField';
import { RockGridIndex } from '../RockGridIndex';
import { ArenaCellBucketIndex } from './ArenaCellBucketIndex';
import { ArenaPointBucketIndex } from './ArenaPointBucketIndex';
import { ChunkScratchPool, ChunkedRenderSurface, eraseChunkScratch } from './ChunkedRenderSurface';
import type { ChunkSamplingMode } from './ChunkedRenderSurface';
import type { ChunkBakeRegion, ChunkBakeSink, ChunkedSurfaceLayerSpec } from './ChunkedRenderSurface';
import type { ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';
import { ROCK_OVERLAY_CHUNK_SIZE } from '../RockOverlayRegions';

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

export interface GroundSnapshotRegion {
  readonly worldX: number;
  readonly worldY: number;
  readonly width: number;
  readonly height: number;
}

export class GroundSurfaceStreamer {
  private readonly scene: Phaser.Scene;
  private readonly frame: ChunkWorldFrame;
  private readonly dirtCells: readonly DirtCell[];
  private readonly groundCoverPlacements: readonly GroundCoverPlacement[];
  private readonly groundDecals: readonly DecalCell[];
  private readonly dirtGrid: RockGridIndex;
  private readonly dirtIndex: ArenaCellBucketIndex;
  private readonly groundCoverIndex: ArenaPointBucketIndex<GroundCoverPlacement>;
  private readonly groundDecalIndex: ArenaPointBucketIndex<DecalCell>;
  private readonly dirtIsOccupied: (gx: number, gy: number) => boolean;
  private readonly dirtCandidateIds: number[] = [];
  private readonly dirtVisibleCells: DirtCell[] = [];
  private readonly dirtMottleSourceCells: DirtCell[] = [];
  private readonly groundCoverCandidateIds: number[] = [];
  private readonly groundCoverCandidates: GroundCoverPlacement[] = [];
  private readonly groundDecalCandidateIds: number[] = [];
  private readonly groundDecalCandidates: DecalCell[] = [];
  private readonly groundCoverQueryRadius: number;
  private readonly mottleConfigs = [
    DIRT_BLOB_SURFACE_PROFILE.mottle,
    ...(DIRT_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? []),
  ];
  private readonly scratch: ChunkScratchPool;
  private readonly surface: ChunkedRenderSurface;

  constructor(options: GroundSurfaceStreamerOptions) {
    this.scene = options.scene;
    this.frame = options.frame;
    this.dirtCells = options.layout.dirt ?? [];
    this.groundCoverPlacements = options.groundCoverPlacements;
    const groundDecals: DecalCell[] = [];
    for (const decal of options.layout.decals ?? []) {
      if ((decal.surface ?? 'ground') !== 'rock') groundDecals.push(decal);
    }
    this.groundDecals = groundDecals;
    this.scratch = new ChunkScratchPool(options.scene);
    // Der Index sieht den gesamten Dirt-Bestand. Ein chunklokaler Index liesse jede Chunkgrenze
    // wie eine Aussenkante des Bodens aussehen.
    this.dirtGrid = new RockGridIndex(this.dirtCells, { cols: GRID_COLS, rows: GRID_ROWS });
    this.dirtIndex = new ArenaCellBucketIndex(options.frame.width);
    this.dirtIndex.sync(this.dirtCells);
    this.groundCoverIndex = new ArenaPointBucketIndex(
      options.frame,
      (placement) => ({ x: placement.worldX, y: placement.worldY }),
    );
    this.groundCoverIndex.sync(this.groundCoverPlacements);
    this.groundCoverQueryRadius = maxGroundCoverRadius(this.groundCoverPlacements);
    this.groundDecalIndex = new ArenaPointBucketIndex(
      options.frame,
      (decal) => ({
        x: options.frame.offsetX + decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX,
        y: options.frame.offsetY + decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY,
      }),
    );
    this.groundDecalIndex.sync(this.groundDecals);
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

    // Alle Scratch-Rollen haben dieselbe 128-px-Dirty-Groesse. Sie werden neben den Chunk-Zielen
    // im verdeckten Startup angelegt, damit auch eine spaet erstmals befuellte Mottle-/Decal-
    // Variante keinen neuen Framebuffer mitten im Match anfordern muss.
    const scratchSize = ROCK_OVERLAY_CHUNK_SIZE + this.surface.gutterPx * 2;
    this.scratch.preallocate('dirt', scratchSize);
    this.scratch.preallocate('dirtCutout', scratchSize, 'redraw');
    for (let index = 0; index < this.mottleConfigs.length; index += 1) {
      this.scratch.preallocate(`dirtMottle${index}`, scratchSize);
    }
    this.scratch.preallocate('groundCover', scratchSize);
    this.scratch.preallocate('groundDecal', scratchSize);
  }

  updateResidency(view: ChunkWorldRect): void {
    this.surface.updateResidency(view);
  }

  isReadyForView(view: ChunkWorldRect, includePrefetch = true): boolean {
    return this.surface.isReadyForView(view, includePrefetch);
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

  /**
   * Zeichnet die unveraenderten Dirt-Quelldaten in ein externes Snapshot-Target. Die Methode
   * benutzt bewusst dieselben Indizes, Autotile-/Corner-Tint-Fabriken und Mottle-Stempel wie der
   * normale Chunk-Bake; sie besitzt kein eigenes Renderziel.
   */
  renderSnapshotDirt(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
  ): void {
    const localX = region.worldX - this.frame.offsetX;
    const localY = region.worldY - this.frame.offsetY;
    const maxX = localX + region.width;
    const maxY = localY + region.height;
    this.dirtVisibleCells.length = 0;
    this.dirtMottleSourceCells.length = 0;

    const visibleCandidateIds = this.dirtIndex.collect(
      localX,
      localY,
      region.width,
      DIRT_FRINGE_OVERHANG_PX,
      this.dirtCandidateIds,
    );
    visibleCandidateIds.sort(compareNumbers);
    for (const id of visibleCandidateIds) {
      const cell = this.dirtCells[id];
      if (!cell) continue;
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      if (cellMaxX + DIRT_FRINGE_OVERHANG_PX > localX && cellMinX - DIRT_FRINGE_OVERHANG_PX < maxX
        && cellMaxY + DIRT_FRINGE_OVERHANG_PX > localY && cellMinY - DIRT_FRINGE_OVERHANG_PX < maxY) {
        this.dirtVisibleCells.push(cell);
      }
    }

    const mottleReach = getBlobSurfaceMottleReachPx(DIRT_BLOB_SURFACE_PROFILE);
    const mottleCandidateIds = this.dirtIndex.collect(
      localX,
      localY,
      region.width,
      mottleReach,
      this.dirtCandidateIds,
    );
    mottleCandidateIds.sort(compareNumbers);
    for (const id of mottleCandidateIds) {
      const cell = this.dirtCells[id];
      if (!cell) continue;
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      if (cellMaxX + mottleReach > localX && cellMinX - mottleReach < maxX
        && cellMaxY + mottleReach > localY && cellMinY - mottleReach < maxY) {
        this.dirtMottleSourceCells.push(cell);
      }
    }

    if (this.dirtVisibleCells.length === 0) return;

    const { fringe, surface: tiles } = ArenaVisualFactory.createDirtImagesFromGrid(
      this.scene,
      this.dirtVisibleCells,
      this.dirtIsOccupied,
      {
        offsetX: this.frame.offsetX,
        offsetY: this.frame.offsetY,
        gridCols: GRID_COLS,
        gridRows: GRID_ROWS,
      },
    );
    if (fringe.length > 0) target.draw(fringe);
    if (tiles.length > 0) target.draw(tiles);
    target.callback(() => {
      for (const image of fringe) image.destroy();
      for (const image of tiles) image.destroy();
    });

    const drawOffsetX = (this.frame.offsetX - region.worldX) * renderScale;
    const drawOffsetY = (this.frame.offsetY - region.worldY) * renderScale;
    const mottleConfigs = [
      DIRT_BLOB_SURFACE_PROFILE.mottle,
      ...(DIRT_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? []),
    ];
    for (let index = 0; index < mottleConfigs.length; index += 1) {
      stampBlobSurfaceMottle(
        this.scene,
        target,
        DIRT_BLOB_SURFACE_PROFILE,
        mottleConfigs[index],
        this.dirtMottleSourceCells,
        index,
        drawOffsetX,
        drawOffsetY,
        renderScale,
      );
    }
  }

  renderSnapshotGroundCover(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
  ): void {
    const localX = region.worldX - this.frame.offsetX;
    const localY = region.worldY - this.frame.offsetY;
    const maxX = localX + region.width;
    const maxY = localY + region.height;
    const candidateIds = this.groundCoverIndex.collect(
      localX,
      localY,
      region.width,
      this.groundCoverQueryRadius,
      this.groundCoverCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    this.groundCoverCandidates.length = 0;
    for (const id of candidateIds) {
      const placement = this.groundCoverPlacements[id];
      if (!placement) continue;
      const radius = getGroundCoverPlacementRadiusPx(placement);
      const placementX = placement.worldX - this.frame.offsetX;
      const placementY = placement.worldY - this.frame.offsetY;
      if (placementX + radius > localX && placementX - radius < maxX
        && placementY + radius > localY && placementY - radius < maxY) {
        this.groundCoverCandidates.push(placement);
      }
    }
    stampGroundCover(
      this.scene,
      target,
      this.groundCoverCandidates,
      -region.worldX * renderScale,
      -region.worldY * renderScale,
      1,
      renderScale,
    );
  }

  renderSnapshotDecals(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
  ): void {
    const localX = region.worldX - this.frame.offsetX;
    const localY = region.worldY - this.frame.offsetY;
    const maxX = localX + region.width;
    const maxY = localY + region.height;
    const radius = DECAL_SIZE * Math.SQRT2 * 0.5;
    const candidateIds = this.groundDecalIndex.collect(
      localX,
      localY,
      region.width,
      radius,
      this.groundDecalCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    this.groundDecalCandidates.length = 0;
    for (const id of candidateIds) {
      const decal = this.groundDecals[id];
      if (!decal) continue;
      const centerX = decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX;
      const centerY = decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY;
      if (centerX + radius > localX && centerX - radius < maxX
        && centerY + radius > localY && centerY - radius < maxY) {
        this.groundDecalCandidates.push(decal);
      }
    }
    const images = ArenaVisualFactory.createDecals(
      this.scene,
      this.groundDecalCandidates,
      { offsetX: this.frame.offsetX, offsetY: this.frame.offsetY },
    );
    if (images.length > 0) target.draw(images);
    target.callback(() => {
      for (const image of images) image.destroy();
    });
    void renderScale;
  }

  destroy(): void {
    this.surface.destroy();
    this.scratch.destroy();
    this.dirtIndex.clear();
    this.groundCoverIndex.clear();
    this.groundDecalIndex.clear();
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
    const dirtCells = this.dirtCells;
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
    this.dirtVisibleCells.length = 0;
    this.dirtMottleSourceCells.length = 0;
    const visibleCandidateIds = this.dirtIndex.collect(
      region.localX,
      region.localY,
      size,
      DIRT_FRINGE_OVERHANG_PX,
      this.dirtCandidateIds,
    );
    visibleCandidateIds.sort(compareNumbers);
    for (const id of visibleCandidateIds) {
      const cell = dirtCells[id];
      if (!cell) continue;
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      if (cellMaxX + DIRT_FRINGE_OVERHANG_PX > region.localX && cellMinX - DIRT_FRINGE_OVERHANG_PX < maxX
        && cellMaxY + DIRT_FRINGE_OVERHANG_PX > region.localY && cellMinY - DIRT_FRINGE_OVERHANG_PX < maxY) {
        this.dirtVisibleCells.push(cell);
      }
    }
    const mottleCandidateIds = this.dirtIndex.collect(
      region.localX,
      region.localY,
      size,
      mottleReach,
      this.dirtCandidateIds,
    );
    mottleCandidateIds.sort(compareNumbers);
    for (const id of mottleCandidateIds) {
      const cell = dirtCells[id];
      if (!cell) continue;
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      if (cellMaxX + mottleReach > region.localX && cellMinX - mottleReach < maxX
        && cellMaxY + mottleReach > region.localY && cellMinY - mottleReach < maxY) {
        this.dirtMottleSourceCells.push(cell);
      }
    }

    if (this.dirtVisibleCells.length === 0 && this.dirtMottleSourceCells.length === 0) {
      target.render();
      sink.blit(GROUND_DIRT_LAYER_ID, target);
      return;
    }

    const { fringe, surface: tiles } = ArenaVisualFactory.createDirtImagesFromGrid(
      this.scene,
      this.dirtVisibleCells,
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

    if (tiles.length > 0 && this.dirtMottleSourceCells.length > 0) {
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
          this.dirtMottleSourceCells,
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
    const candidates = this.groundCoverIndex.collect(
      region.localX,
      region.localY,
      size,
      this.groundCoverQueryRadius,
      this.groundCoverCandidateIds,
    );
    candidates.sort(compareNumbers);
    this.groundCoverCandidates.length = 0;
    for (const id of candidates) {
      const placement = this.groundCoverPlacements[id];
      if (!placement) continue;
      const radius = getGroundCoverPlacementRadiusPx(placement);
      const localX = placement.worldX - this.frame.offsetX;
      const localY = placement.worldY - this.frame.offsetY;
      if (localX + radius > region.localX && localX - radius < maxX
        && localY + radius > region.localY && localY - radius < maxY) {
        this.groundCoverCandidates.push(placement);
      }
    }

    const target = this.scratch.get('groundCover', size);
    target.clear();
    if (this.groundCoverCandidates.length > 0) {
      stampGroundCover(this.scene, target, this.groundCoverCandidates, -region.worldX, -region.worldY);
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
    const candidateIds = this.groundDecalIndex.collect(
      region.localX,
      region.localY,
      size,
      DECAL_SIZE * Math.SQRT1_2,
      this.groundDecalCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    this.groundDecalCandidates.length = 0;
    for (const id of candidateIds) {
      const decal = this.groundDecals[id];
      if (!decal) continue;
      const centerX = decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX;
      const centerY = decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY;
      if (centerX + radius > region.localX && centerX - radius < maxX
        && centerY + radius > region.localY && centerY - radius < maxY) {
        this.groundDecalCandidates.push(decal);
      }
    }

    const target = this.scratch.get('groundDecal', size);
    target.clear();
    const images = ArenaVisualFactory.createDecals(
      this.scene,
      this.groundDecalCandidates,
      { offsetX: -region.localX, offsetY: -region.localY },
    );
    if (images.length > 0) target.draw(images);
    target.render();
    for (const image of images) image.destroy();
    sink.blit(GROUND_DECAL_LAYER_ID, target);
  }
}

function compareNumbers(a: number, b: number): number {
  return a - b;
}

function maxGroundCoverRadius(placements: readonly GroundCoverPlacement[]): number {
  let maxRadius = 0;
  for (const placement of placements) {
    maxRadius = Math.max(maxRadius, getGroundCoverPlacementRadiusPx(placement));
  }
  return maxRadius;
}
