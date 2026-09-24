import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import type { ArenaLayout, DecalCell, DirtCell } from '../../types';
import { ArenaVisualFactory } from '../ArenaVisualFactory';
import {
  getBlobSurfaceMottleReachPx,
  GRAVEL_BLOB_SURFACE_PROFILE,
} from '../BlobSurfaceProfile';
import { stampBlobSurfaceMottle } from '../BlobSurfaceMottle';
import { DECAL_SIZE } from '../DecalConfig';
import { getGroundCoverPlacementRadiusPx, stampGroundCover } from '../GroundCoverLayer';
import type { GroundCoverPlacement } from '../GroundCoverField';
import {
  createPersistentBaseGravelState,
  getPersistentBaseGravelDecorationReachPx,
  getPersistentBaseGravelStateKey,
  persistentBaseGravelCellKey,
} from '../PersistentBaseGravelField';
import type {
  PersistentBaseGravelCell,
  PersistentBaseGravelDecoration,
  PersistentBaseGravelState,
} from '../PersistentBaseGravelField';
import type { PersistentBaseAnchor } from '../../persistentBase/PersistentBaseTypes';
import type { PersistentBaseBuildArea } from '../../persistentBase/PersistentBaseCore';
import { ArenaCellBucketIndex } from './ArenaCellBucketIndex';
import { ArenaPointBucketIndex } from './ArenaPointBucketIndex';
import { ChunkScratchPool, ChunkedRenderSurface, eraseChunkScratch } from './ChunkedRenderSurface';
import type { ChunkSamplingMode } from './ChunkedRenderSurface';
import type {
  ChunkBakeRegion,
  ChunkBakeSink,
  ChunkedRenderWorkingSet,
  ChunkedSurfaceLayerSpec,
} from './ChunkedRenderSurface';
import type { ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';
import { ROCK_OVERLAY_CHUNK_SIZE } from '../RockOverlayRegions';
import { TrackGravelLayer } from '../TrackGravelLayer';
import { DirtSurfaceLayer } from '../DirtSurfaceLayer';
import { DIRT_SURFACE_REACH_PX } from '../DirtSurfaceField';
import { readGroundMaterialSamples, type GroundMaterialSamples } from '../GroundMaterialSamples';

/**
 * Gestreamte statische Bodenbaender: durchgehendes Dirt-Material mit organischer Maske, optionaler
 * Persistent-Base-Kies, Ground Cover, Bahnschotter und die statischen Decals.
 *
 * Diese Schichten aendern sich zur Laufzeit nicht. Frueher war das der Grund, sie genau einmal je World
 * in je eine arenagrosse RenderTexture zu backen; bei 400 x 80 Zellen waeren das 12 800 x 2 560 px
 * je Band. Jetzt gilt dieselbe Ueberlegung je Render-Chunk: Ein Chunk wird beim Sichtbarwerden
 * einmal gebacken und danach nur noch gezeichnet.
 *
 * Der Bake ist deterministisch, weil jede Quelle es ist: Dirt-Maske und Materialphase haengen an
 * Zellbelegung, Weltkoordinate und Seed, Ground-Cover-Platzierungen
 * werden einmal je World erzeugt und danach nur gefiltert, und Decals tragen ihre Drehung im
 * Layout beziehungsweise leiten sie aus ihrer Zelle ab. Ein wieder betretener Chunk sieht deshalb
 * aus wie zuvor.
 */

export const GROUND_DIRT_LAYER_ID = 'dirt';
export const GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID = 'persistentBaseGravel';
export const GROUND_PERSISTENT_BASE_GRAVEL_DECORATION_LAYER_ID = 'persistentBaseGravelDecoration';
export const GROUND_COVER_LAYER_ID = 'groundCover';
export const GROUND_TRACK_GRAVEL_LAYER_ID = 'trackGravel';
export const GROUND_DECAL_LAYER_ID = 'groundDecals';

export interface GroundSurfacePersistentBaseGravelZone {
  readonly seed: number;
  readonly anchor: PersistentBaseAnchor;
  readonly buildArea: PersistentBaseBuildArea;
}

export interface GroundSurfaceStreamerOptions {
  readonly scene: Phaser.Scene;
  readonly frame: ChunkWorldFrame;
  readonly layout: ArenaLayout;
  readonly groundCoverPlacements: readonly GroundCoverPlacement[];
  /** Nur aktive Persistent Bases oder Activity-Vorschauen reservieren die zusaetzlichen Gravel-Layer. */
  readonly enablePersistentBaseGravel?: boolean;
  /** Optionaler Initialzustand, damit der erste Chunk bereits mit Kies gebacken wird. */
  readonly persistentBaseGravel?: GroundSurfacePersistentBaseGravelZone;
  readonly chunkSize?: number;
  /** CPU material samples for the soil bake; read from the loaded textures when omitted. */
  readonly groundMaterials?: GroundMaterialSamples;
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
  private readonly gridCols: number;
  private readonly gridRows: number;
  private readonly groundCoverPlacements: readonly GroundCoverPlacement[];
  private readonly groundDecals: readonly DecalCell[];
  private readonly dirtIndex: ArenaCellBucketIndex;
  private readonly groundCoverIndex: ArenaPointBucketIndex<GroundCoverPlacement>;
  private readonly groundDecalIndex: ArenaPointBucketIndex<DecalCell>;
  private readonly dirtCandidateIds: number[] = [];
  private readonly groundCoverCandidateIds: number[] = [];
  private readonly groundCoverCandidates: GroundCoverPlacement[] = [];
  private readonly groundDecalCandidateIds: number[] = [];
  private readonly groundDecalCandidates: DecalCell[] = [];
  private readonly groundCoverQueryRadius: number;
  private readonly persistentBaseGravelEnabled: boolean;
  private persistentBaseGravelState: PersistentBaseGravelState | null = null;
  private persistentBaseGravelKey = 'none';
  private persistentBaseGravelCells: readonly PersistentBaseGravelCell[] = [];
  private persistentBaseGravelCellKeys: ReadonlySet<string> = new Set();
  private persistentBaseGravelDecorations: readonly PersistentBaseGravelDecoration[] = [];
  private readonly persistentBaseGravelIndex: ArenaCellBucketIndex;
  private readonly persistentBaseGravelDecorationIndex: ArenaPointBucketIndex<PersistentBaseGravelDecoration>;
  private persistentBaseGravelDecorationQueryRadius = 0;
  private readonly persistentBaseGravelCandidateIds: number[] = [];
  private readonly persistentBaseGravelVisibleCells: PersistentBaseGravelCell[] = [];
  private readonly persistentBaseGravelMottleCandidateIds: number[] = [];
  private readonly persistentBaseGravelMottleSourceCells: PersistentBaseGravelCell[] = [];
  private readonly persistentBaseGravelDecorationCandidateIds: number[] = [];
  private readonly persistentBaseGravelDecorationCandidates: PersistentBaseGravelDecoration[] = [];
  private readonly dirtLayer: DirtSurfaceLayer | null;
  private readonly persistentBaseGravelMottleConfigs = [
    GRAVEL_BLOB_SURFACE_PROFILE.mottle,
    ...(GRAVEL_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? []),
  ];
  private readonly scratch: ChunkScratchPool;
  private readonly surface: ChunkedRenderSurface;
  private readonly trackGravelLayer: TrackGravelLayer | null;

  constructor(options: GroundSurfaceStreamerOptions) {
    this.scene = options.scene;
    this.frame = options.frame;
    this.gridCols = Math.max(1, Math.floor(options.frame.width / CELL_SIZE));
    this.gridRows = Math.max(1, Math.floor(options.frame.height / CELL_SIZE));
    this.dirtCells = options.layout.dirt ?? [];
    this.groundCoverPlacements = options.groundCoverPlacements;
    const groundDecals: DecalCell[] = [];
    for (const decal of options.layout.decals ?? []) {
      if ((decal.surface ?? 'ground') !== 'rock') groundDecals.push(decal);
    }
    this.groundDecals = groundDecals;
    this.scratch = new ChunkScratchPool(options.scene);
    this.dirtIndex = new ArenaCellBucketIndex(options.frame.width);
    this.dirtIndex.sync(this.dirtCells);
    this.groundCoverIndex = new ArenaPointBucketIndex(
      options.frame,
      (placement) => ({ x: placement.worldX, y: placement.worldY }),
    );
    this.groundCoverIndex.sync(this.groundCoverPlacements);
    this.groundCoverQueryRadius = maxGroundCoverRadius(this.groundCoverPlacements);
    this.persistentBaseGravelEnabled = options.enablePersistentBaseGravel === true;
    this.persistentBaseGravelIndex = new ArenaCellBucketIndex(options.frame.width);
    this.persistentBaseGravelDecorationIndex = new ArenaPointBucketIndex(
      options.frame,
      (placement) => ({ x: placement.worldX, y: placement.worldY }),
    );
    this.groundDecalIndex = new ArenaPointBucketIndex(
      options.frame,
      (decal) => ({
        x: options.frame.offsetX + decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX,
        y: options.frame.offsetY + decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY,
      }),
    );
    this.groundDecalIndex.sync(this.groundDecals);

    const trackColumns = ArenaVisualFactory.getTrackColumnSpecs(options.layout.tracks ?? [], options.frame);
    const layers: ChunkedSurfaceLayerSpec[] = [
      { id: GROUND_DIRT_LAYER_ID, depth: DEPTH.DIRT },
      ...(this.persistentBaseGravelEnabled
        ? [
          { id: GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID, depth: DEPTH.PERSISTENT_BASE_GRAVEL },
          {
            id: GROUND_PERSISTENT_BASE_GRAVEL_DECORATION_LAYER_ID,
            depth: DEPTH.PERSISTENT_BASE_GRAVEL_DECORATION,
          },
        ]
        : []),
      { id: GROUND_COVER_LAYER_ID, depth: DEPTH.GROUND_COVER },
      ...(trackColumns.length > 0 ? [{ id: GROUND_TRACK_GRAVEL_LAYER_ID, depth: DEPTH.TRACK_GRAVEL }] : []),
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
    this.trackGravelLayer = trackColumns.length > 0
      ? new TrackGravelLayer(options.scene, options.layout.seed, trackColumns, options.frame, scratchSize)
      : null;
    if (this.trackGravelLayer) this.scratch.preallocate('trackGravel', scratchSize);
    this.scratch.preallocate('dirt', scratchSize);
    this.dirtLayer = this.dirtCells.length > 0
      ? new DirtSurfaceLayer(options.scene, options.layout.seed, this.dirtCells, this.frame, scratchSize,
        options.groundMaterials ?? readGroundMaterialSamples(options.scene))
      : null;
    this.scratch.preallocate('groundCover', scratchSize);
    this.scratch.preallocate('groundDecal', scratchSize);
    if (this.persistentBaseGravelEnabled) {
      this.scratch.preallocate('persistentBaseGravel', scratchSize);
      this.scratch.preallocate('persistentBaseGravelCutout', scratchSize, 'redraw');
      for (let index = 0; index < this.persistentBaseGravelMottleConfigs.length; index += 1) {
        this.scratch.preallocate(`persistentBaseGravelMottle${index}`, scratchSize);
      }
      this.scratch.preallocate('persistentBaseGravelDecoration', scratchSize);
      if (options.persistentBaseGravel) this.setPersistentBaseGravel(options.persistentBaseGravel);
    }
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

  getWorkingSet(view: ChunkWorldRect, includePrefetch = true): ChunkedRenderWorkingSet {
    return this.surface.getWorkingSet(view, includePrefetch);
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
   * Aktualisiert die sichtbare Persistent Zone. Die Szene ruft diesen Setter aus ihrem normalen
   * Round-State-Sync auf; der State-Key verhindert jede Arbeit, solange Anchor, Build-Area und
   * Seed unveraendert sind.
   */
  setPersistentBaseGravel(zone: GroundSurfacePersistentBaseGravelZone | null): boolean {
    if (!this.persistentBaseGravelEnabled) return false;

    const nextKey = zone
      ? getPersistentBaseGravelStateKey(zone.seed, zone.anchor, zone.buildArea)
      : 'none';
    if (nextKey === this.persistentBaseGravelKey) return false;

    const previousState = this.persistentBaseGravelState;
    const nextState = zone
      ? createPersistentBaseGravelState({
        seed: zone.seed >>> 0,
        anchor: zone.anchor,
        buildArea: zone.buildArea,
        frame: this.frame,
      })
      : null;
    this.persistentBaseGravelState = nextState;
    this.persistentBaseGravelKey = nextKey;
    this.persistentBaseGravelCells = nextState?.cells ?? [];
    this.persistentBaseGravelCellKeys = nextState?.cellKeys ?? new Set();
    this.persistentBaseGravelDecorations = nextState?.decorations ?? [];
    this.persistentBaseGravelDecorationQueryRadius = nextState
      ? getPersistentBaseGravelDecorationReachPx()
      : 0;

    this.persistentBaseGravelIndex.clear();
    this.persistentBaseGravelIndex.sync(this.persistentBaseGravelCells);
    this.persistentBaseGravelDecorationIndex.clear();
    this.persistentBaseGravelDecorationIndex.sync(this.persistentBaseGravelDecorations);
    this.invalidatePersistentBaseGravelDelta(previousState, nextState);
    return true;
  }

  getPersistentBaseGravelState(): PersistentBaseGravelState | null {
    return this.persistentBaseGravelState;
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
    this.renderSnapshotBakedLayer(target, region, renderScale, (part, sink) => this.bakeDirtRegion(part, sink));
  }

  renderSnapshotTrackGravel(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
  ): void {
    if (!this.trackGravelLayer) return;
    this.renderSnapshotBakedLayer(target, region, renderScale, (part, sink) => this.bakeTrackGravelRegion(part, sink));
  }

  private renderSnapshotBakedLayer(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
    bake: (region: ChunkBakeRegion, sink: ChunkBakeSink) => void,
  ): void {
    // Die Aufloesung des Snapshot-Targets ist grober als der bestehende Dirt-Bake. Wir lassen
    // deshalb denselben 128-px-Bake in kleinen Quadraten laufen und stempeln jedes fertige,
    // silhouette-geclipte Ergebnis 1:4 in das eine Snapshot-Target. Dadurch braucht der
    // Snapshot keinen zweiten 512er-Mottle-/Cutout-Puffer und kann trotzdem exakt den normalen
    // Dirt-Schnitt wiederverwenden.
    const bakeSize = ROCK_OVERLAY_CHUNK_SIZE;
    const regionRight = region.worldX + region.width;
    const regionBottom = region.worldY + region.height;
    for (let worldY = region.worldY; worldY < regionBottom; worldY += bakeSize) {
      for (let worldX = region.worldX; worldX < regionRight; worldX += bakeSize) {
        const localX = worldX - this.frame.offsetX;
        const localY = worldY - this.frame.offsetY;
        const bakeRegion: ChunkBakeRegion = {
          chunk: { cx: 0, cy: 0, localX, localY },
          localX,
          localY,
          size: bakeSize,
          worldX,
          worldY,
          gutterPx: 0,
        };
        bake(bakeRegion, {
          blit: (_layerId, scratch) => {
            target.stamp(
              scratch.texture.key,
              undefined,
              (worldX - region.worldX) * renderScale,
              (worldY - region.worldY) * renderScale,
              {
                originX: 0,
                originY: 0,
                scaleX: renderScale,
                scaleY: renderScale,
              },
            );
            target.render();
          },
          clearRegion: () => {},
          fillRegion: () => {},
        });
      }
    }
  }

  /** Snapshot-Gegenstueck zu den sichtbaren Gravel-Layern, ohne ein zweites Renderziel anzulegen. */
  renderSnapshotPersistentBaseGravel(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
  ): void {
    this.renderSnapshotPersistentBaseGravelLayers(target, region, renderScale, true, false);
  }

  /** Snapshot-Gegenstueck fuer die grossen authored Gravel-Dekorstempel. */
  renderSnapshotPersistentBaseGravelDecoration(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
  ): void {
    this.renderSnapshotPersistentBaseGravelLayers(target, region, renderScale, false, true);
  }

  private renderSnapshotPersistentBaseGravelLayers(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    renderScale: number,
    includeGravel: boolean,
    includeDecoration: boolean,
  ): void {
    if (!this.persistentBaseGravelEnabled || !this.persistentBaseGravelState) return;

    const bakeSize = ROCK_OVERLAY_CHUNK_SIZE;
    const regionRight = region.worldX + region.width;
    const regionBottom = region.worldY + region.height;
    for (let worldY = region.worldY; worldY < regionBottom; worldY += bakeSize) {
      for (let worldX = region.worldX; worldX < regionRight; worldX += bakeSize) {
        const localX = worldX - this.frame.offsetX;
        const localY = worldY - this.frame.offsetY;
        const bakeRegion: ChunkBakeRegion = {
          chunk: { cx: 0, cy: 0, localX, localY },
          localX,
          localY,
          size: bakeSize,
          worldX,
          worldY,
          gutterPx: 0,
        };
        const blitSnapshot = (_layerId: string, scratch: Phaser.GameObjects.RenderTexture): void => {
          target.stamp(
            scratch.texture.key,
            undefined,
            (worldX - region.worldX) * renderScale,
            (worldY - region.worldY) * renderScale,
            {
              originX: 0,
              originY: 0,
              scaleX: renderScale,
              scaleY: renderScale,
            },
          );
          target.render();
        };
        if (includeGravel) {
          this.bakePersistentBaseGravelRegion(bakeRegion, {
            blit: blitSnapshot,
            clearRegion: () => {},
            fillRegion: () => {},
          });
        }
        if (includeDecoration) {
          this.bakePersistentBaseGravelDecorationRegion(bakeRegion, {
            blit: blitSnapshot,
            clearRegion: () => {},
            fillRegion: () => {},
          });
        }
      }
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
    this.trackGravelLayer?.destroy();
    this.dirtLayer?.destroy();
    this.dirtIndex.clear();
    this.groundCoverIndex.clear();
    this.groundDecalIndex.clear();
    this.persistentBaseGravelIndex.clear();
    this.persistentBaseGravelDecorationIndex.clear();
    this.persistentBaseGravelState = null;
    this.persistentBaseGravelCells = [];
    this.persistentBaseGravelCellKeys = new Set();
    this.persistentBaseGravelDecorations = [];
  }

  // ── Bake ───────────────────────────────────────────────────────────────────

  private invalidatePersistentBaseGravelDelta(
    previous: PersistentBaseGravelState | null,
    next: PersistentBaseGravelState | null,
  ): void {
    if (!this.persistentBaseGravelEnabled) return;

    const previousKeys = previous?.cellKeys ?? new Set<string>();
    const nextKeys = next?.cellKeys ?? new Set<string>();
    const changedCells = new Map<string, PersistentBaseGravelCell>();
    for (const cell of previous?.cells ?? []) {
      const key = persistentBaseGravelCellKey(cell.gridX, cell.gridY);
      if (!nextKeys.has(key)) changedCells.set(key, cell);
    }
    for (const cell of next?.cells ?? []) {
      const key = persistentBaseGravelCellKey(cell.gridX, cell.gridY);
      if (!previousKeys.has(key)) changedCells.set(key, cell);
    }
    const sourceChanged = previous && next && previous.key !== next.key;
    if (sourceChanged) {
      for (const cell of previous.cells) {
        changedCells.set(persistentBaseGravelCellKey(cell.gridX, cell.gridY), cell);
      }
      for (const cell of next.cells) {
        changedCells.set(persistentBaseGravelCellKey(cell.gridX, cell.gridY), cell);
      }
    }
    if (changedCells.size === 0) return;

    // Retiling needs one cell of complete 8-neighbour context. Decorations and the material
    // mottle reach several cells, so invalidate the larger surrounding region as well; the
    // surface itself deduplicates the resulting 128-px dirty work units.
    const decorationReachPx = getPersistentBaseGravelDecorationReachPx();
    const mottleReachPx = getBlobSurfaceMottleReachPx(GRAVEL_BLOB_SURFACE_PROFILE);
    const reachCells = Math.max(
      1,
      Math.ceil(Math.max(decorationReachPx, mottleReachPx) / CELL_SIZE) + 1,
    );
    const cols = Math.ceil(this.frame.width / CELL_SIZE);
    const rows = Math.ceil(this.frame.height / CELL_SIZE);
    const invalidated = new Set<string>();
    for (const cell of changedCells.values()) {
      for (let dy = -reachCells; dy <= reachCells; dy += 1) {
        for (let dx = -reachCells; dx <= reachCells; dx += 1) {
          const gridX = cell.gridX + dx;
          const gridY = cell.gridY + dy;
          if (gridX < 0 || gridY < 0 || gridX >= cols || gridY >= rows) continue;
          const key = persistentBaseGravelCellKey(gridX, gridY);
          if (invalidated.has(key)) continue;
          invalidated.add(key);
          this.surface.refreshRegion(gridX * CELL_SIZE, gridY * CELL_SIZE, CELL_SIZE);
        }
      }
    }
  }

  private bakeRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    this.bakeDirtRegion(region, sink);
    this.bakePersistentBaseGravelRegion(region, sink);
    this.bakePersistentBaseGravelDecorationRegion(region, sink);
    this.bakeGroundCoverRegion(region, sink);
    this.bakeTrackGravelRegion(region, sink);
    this.bakeDecalRegion(region, sink);
  }

  private bakeTrackGravelRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    if (!this.trackGravelLayer) return;
    const target = this.scratch.get('trackGravel', region.size);
    this.trackGravelLayer.bake(target, region);
    sink.blit(GROUND_TRACK_GRAVEL_LAYER_ID, target);
  }

  /** Native continuous soil, clipped by the same World field used for snapshots. */
  private bakeDirtRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    const target = this.scratch.get('dirt', region.size);
    const candidates = this.dirtIndex.collect(region.localX, region.localY, region.size,
      DIRT_SURFACE_REACH_PX, this.dirtCandidateIds);
    if (this.dirtLayer && candidates.length > 0) this.dirtLayer.bake(target, region);
    else { target.clear(); target.render(); }
    sink.blit(GROUND_DIRT_LAYER_ID, target);
  }

  private bakePersistentBaseGravelRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    if (!this.persistentBaseGravelEnabled) return;

    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const mottleReach = getBlobSurfaceMottleReachPx(GRAVEL_BLOB_SURFACE_PROFILE);
    this.persistentBaseGravelVisibleCells.length = 0;
    this.persistentBaseGravelMottleSourceCells.length = 0;
    const candidateIds = this.persistentBaseGravelIndex.collect(
      region.localX,
      region.localY,
      size,
      0,
      this.persistentBaseGravelCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    for (const id of candidateIds) {
      const cell = this.persistentBaseGravelCells[id];
      if (!cell) continue;
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      if (cellMinX + CELL_SIZE > region.localX && cellMinX < maxX
        && cellMinY + CELL_SIZE > region.localY && cellMinY < maxY) {
        this.persistentBaseGravelVisibleCells.push(cell);
      }
    }
    const mottleCandidateIds = this.persistentBaseGravelIndex.collect(
      region.localX,
      region.localY,
      size,
      mottleReach,
      this.persistentBaseGravelMottleCandidateIds,
    );
    mottleCandidateIds.sort(compareNumbers);
    for (const id of mottleCandidateIds) {
      const cell = this.persistentBaseGravelCells[id];
      if (!cell) continue;
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      if (cellMaxX + mottleReach > region.localX && cellMinX - mottleReach < maxX
        && cellMaxY + mottleReach > region.localY && cellMinY - mottleReach < maxY) {
        this.persistentBaseGravelMottleSourceCells.push(cell);
      }
    }

    const target = this.scratch.get('persistentBaseGravel', size);
    target.clear();
    let images: Phaser.GameObjects.Image[] = [];
    if (this.persistentBaseGravelVisibleCells.length > 0) {
      images = ArenaVisualFactory.createGravelImagesFromGrid(
        this.scene,
        this.persistentBaseGravelVisibleCells,
        (gridX, gridY) => this.persistentBaseGravelCellKeys.has(persistentBaseGravelCellKey(gridX, gridY)),
        {
          offsetX: -region.localX,
          offsetY: -region.localY,
          gridCols: Math.ceil(this.frame.width / CELL_SIZE),
          gridRows: Math.ceil(this.frame.height / CELL_SIZE),
        },
      );
      if (images.length > 0) target.draw(images);
    }
    target.render();

    if (images.length > 0 && this.persistentBaseGravelMottleSourceCells.length > 0) {
      const cutout = this.scratch.get('persistentBaseGravelCutout', size, 'redraw');
      cutout.clear();
      cutout.fill(0x000000, 1);
      cutout.erase(images);
      cutout.render();

      for (let index = 0; index < this.persistentBaseGravelMottleConfigs.length; index += 1) {
        const mottle = this.persistentBaseGravelMottleConfigs[index];
        const layer = this.scratch.get(`persistentBaseGravelMottle${index}`, size);
        layer.setBlendMode(mottle.blend === 'multiply' ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL);
        layer.clear();
        stampBlobSurfaceMottle(
          this.scene,
          layer,
          GRAVEL_BLOB_SURFACE_PROFILE,
          mottle,
          this.persistentBaseGravelMottleSourceCells,
          index,
          -region.localX,
          -region.localY,
        );
        layer.render();
        eraseChunkScratch(layer, cutout, size);
        layer.render();
        target.draw(layer);
        target.render();
      }
    }

    for (const image of images) image.destroy();
    sink.blit(GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID, target);
  }

  private bakePersistentBaseGravelDecorationRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    if (!this.persistentBaseGravelEnabled) return;

    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const candidateIds = this.persistentBaseGravelDecorationIndex.collect(
      region.localX,
      region.localY,
      size,
      this.persistentBaseGravelDecorationQueryRadius,
      this.persistentBaseGravelDecorationCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    this.persistentBaseGravelDecorationCandidates.length = 0;
    for (const id of candidateIds) {
      const placement = this.persistentBaseGravelDecorations[id];
      if (!placement) continue;
      const radius = getGroundCoverPlacementRadiusPx(placement);
      const localX = placement.worldX - this.frame.offsetX;
      const localY = placement.worldY - this.frame.offsetY;
      if (localX + radius > region.localX && localX - radius < maxX
        && localY + radius > region.localY && localY - radius < maxY) {
        this.persistentBaseGravelDecorationCandidates.push(placement);
      }
    }

    const target = this.scratch.get('persistentBaseGravelDecoration', size);
    target.clear();
    if (this.persistentBaseGravelDecorationCandidates.length > 0) {
      stampGroundCover(
        this.scene,
        target,
        this.persistentBaseGravelDecorationCandidates,
        -region.worldX,
        -region.worldY,
      );
    }
    target.render();
    sink.blit(GROUND_PERSISTENT_BASE_GRAVEL_DECORATION_LAYER_ID, target);
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
