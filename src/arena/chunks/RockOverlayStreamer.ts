import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import type { ArenaLayout, DecalCell, RockCell } from '../../types';
import { ArenaVisualFactory } from '../ArenaVisualFactory';
import { ROCK_BLOB_SURFACE_PROFILE, getBlobSurfaceMottleReachPx } from '../BlobSurfaceProfile';
import { stampBlobSurfaceMottle } from '../BlobSurfaceMottle';
import { ROCK_DECAL_LARGE_SIZE, ROCK_DECAL_SIZE, isEnclosedRockDecal } from '../DecalConfig';
import { ArenaCellBucketIndex } from './ArenaCellBucketIndex';
import { ArenaPointBucketIndex } from './ArenaPointBucketIndex';
import { fillRockDecalCutout } from '../RockDecalLayer';
import { fillRockMossCutout, stampRockMoss } from '../RockMossLayer';
import { getRockMossPlacementRadiusPx } from '../RockMossField';
import type { RockMossPlacement } from '../RockMossField';
import { fillRockVegetationCutout, stampRockVegetation } from '../RockVegetationLayer';
import { getRockVegetationPlacementRadiusPx } from '../RockVegetationField';
import type { RockVegetationPlacement } from '../RockVegetationField';
import type { RockVisualState } from '../rocks/RockVisualState';
import { ROCK_VEGETATION_MASK_MARGIN_PX } from '../RockVegetationConfig';
import {
  ROCK_OVERLAY_CHUNK_SIZE,
  collectRockOverlayChunks,
  rockCellKey,
  syncRockOverlaySource,
} from '../RockOverlayRegions';
import type { RockOverlaySource } from '../RockOverlayRegions';
import { ChunkScratchPool, ChunkedRenderSurface, eraseChunkScratch } from './ChunkedRenderSurface';
import type { ChunkSamplingMode } from './ChunkedRenderSurface';
import type {
  ChunkBakeRegion,
  ChunkBakeSink,
  ChunkedRenderWorkingSet,
  ChunkedRenderSurfaceRefreshOptions,
  ChunkedSurfaceLayerSpec,
} from './ChunkedRenderSurface';
import type { ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';

/**
 * Gestreamte felsgebundene Overlays: Materialstoerung, Moos, Fels-Decals und Kantenvegetation.
 *
 * Fachlich aendert sich gegenueber dem bisherigen arenagrossen Bake nichts – dieselben vier
 * Schichten, dieselbe Reihenfolge, dieselben Stanzformen. Neu ist allein, *wo* das Ergebnis
 * landet: statt in vier arenagrossen RenderTextures in den residenten Render-Chunks.
 *
 * Damit gibt es nur noch **einen** Bake-Pfad. Der frueher noetige Gleichstand zwischen Vollbake
 * und lokalem Neubau ist keine Zusicherung mehr, sondern Konstruktion: Der erste Aufbau eines
 * Chunks und jeder spaetere Dirty-Neubau laufen durch dieselbe Funktion, nur mit anderer
 * Regionsgroesse.
 *
 * Die beiden Regeln, an denen die Pixelstabilitaet haengt, bleiben unveraendert (siehe
 * {@link ../RockOverlayRegions}):
 *
 * 1. Die Materialquelle ist der **vollstaendige** Felsbestand der laufenden World und schrumpft
 *    innerhalb dieser Laufzeit nie; beim Fast-Reinstance wird sie auf die authored Baseline
 *    reduziert.
 * 2. Neu gebacken wird ausschliesslich der Schnitt auf den aktuell stehenden Bestand.
 */

/**
 * Wie weit ausserhalb einer Region ein *lebender* Fels noch fuer sie relevant ist.
 *
 * Drei Ansprueche laufen hier zusammen, der groesste gewinnt: die Reichweitenmaske der Vegetation,
 * die ueber die eigene Zelle hinausragt, und die Ankerzelle eines Fels-Decals, dessen Mittelpunkt
 * gerade noch in die Region ragt – ihr Quadrat kann eine halbe Decal-Diagonale plus eine Zelle
 * ausserhalb liegen. Wer hier zu klein waehlt, haelt einen lebenden Fels faelschlich fuer
 * gefallen und radiert sein Decal weg.
 */
const ACTIVE_ROCK_QUERY_MARGIN_PX = Math.max(
  ROCK_VEGETATION_MASK_MARGIN_PX,
  ROCK_DECAL_LARGE_SIZE * Math.SQRT1_2,
) + CELL_SIZE;

export const ROCK_OVERLAY_MOSS_LAYER_ID = 'rockMoss';
export const ROCK_OVERLAY_DECAL_LAYER_ID = 'rockDecals';
export const ROCK_OVERLAY_VEGETATION_LAYER_ID = 'rockVegetation';

export function rockOverlayMottleLayerId(index: number): string {
  return `rockMottle${index}`;
}

export interface RockOverlayStreamerOptions {
  readonly scene: Phaser.Scene;
  readonly frame: ChunkWorldFrame;
  readonly layout: ArenaLayout;
  /** Paralleles Array zu `layout.rocks`; wird von aussen in-place mutiert. */
  readonly rockVisualStates: readonly (RockVisualState | undefined)[];
  readonly overlaySource: RockOverlaySource;
  readonly mossPlacements: readonly RockMossPlacement[];
  readonly vegetationPlacements: readonly RockVegetationPlacement[];
  readonly chunkSize?: number;
}

export class RockOverlayStreamer {
  private readonly scene: Phaser.Scene;
  private readonly frame: ChunkWorldFrame;
  private readonly layout: ArenaLayout;
  private readonly rockVisualStates: readonly (RockVisualState | undefined)[];
  private readonly overlaySource: RockOverlaySource;
  private readonly mossPlacements: readonly RockMossPlacement[];
  private readonly vegetationPlacements: readonly RockVegetationPlacement[];
  private readonly rockDecals: readonly DecalCell[];
  private readonly mottleConfigs = [
    ROCK_BLOB_SURFACE_PROFILE.mottle,
    ...(ROCK_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? []),
  ];
  private readonly scratch: ChunkScratchPool;
  private readonly surface: ChunkedRenderSurface;
  /** Raeumlicher Index ueber `layout.rocks` – Positionen im Array sind die Fels-IDs. */
  private readonly rockIndex: ArenaCellBucketIndex;
  /** Raeumlicher Index ueber die Materialquelle; sie waechst, schrumpft aber nie. */
  private readonly sourceIndex: ArenaCellBucketIndex;
  /** Einmalige Indizes ueber die deterministischen, weltpositionierten Platzierungen. */
  private readonly mossIndex: ArenaPointBucketIndex<RockMossPlacement>;
  private readonly vegetationIndex: ArenaPointBucketIndex<RockVegetationPlacement>;
  private readonly rockDecalIndex: ArenaPointBucketIndex<DecalCell>;
  private readonly mossQueryRadius: number;
  private readonly vegetationQueryRadius: number;
  private readonly rockDecalQueryRadius: number;
  /** Wiederverwendete Trefferpuffer – eine Allokation je Region weniger. */
  private readonly rockCandidates: number[] = [];
  private readonly sourceCandidates: number[] = [];
  private readonly mossCandidateIds: number[] = [];
  private readonly vegetationCandidateIds: number[] = [];
  private readonly rockDecalCandidateIds: number[] = [];
  private readonly mossCandidates: RockMossPlacement[] = [];
  private readonly vegetationCandidates: RockVegetationPlacement[] = [];
  private readonly rockDecalCandidates: DecalCell[] = [];
  private readonly sourceCells: RockCell[] = [];
  private readonly decalCutoutCells: RockCell[] = [];
  private readonly activeCellKeys = new Set<number>();
  private readonly silhouetteImages: Phaser.GameObjects.Image[] = [];
  private readonly vegetationMaskImages: Phaser.GameObjects.Image[] = [];
  private readonly temporaryImages: Phaser.GameObjects.Image[] = [];

  constructor(options: RockOverlayStreamerOptions) {
    this.scene = options.scene;
    this.frame = options.frame;
    this.layout = options.layout;
    this.rockVisualStates = options.rockVisualStates;
    this.overlaySource = options.overlaySource;
    this.mossPlacements = options.mossPlacements;
    this.vegetationPlacements = options.vegetationPlacements;
    const rockDecals: DecalCell[] = [];
    for (const decal of options.layout.decals ?? []) {
      if ((decal.surface ?? 'ground') === 'rock') rockDecals.push(decal);
    }
    this.rockDecals = rockDecals;
    this.scratch = new ChunkScratchPool(options.scene);
    this.rockIndex = new ArenaCellBucketIndex(options.frame.width);
    this.sourceIndex = new ArenaCellBucketIndex(options.frame.width);
    this.mossIndex = new ArenaPointBucketIndex(
      options.frame,
      (placement) => ({ x: placement.worldX, y: placement.worldY }),
    );
    this.mossIndex.sync(this.mossPlacements);
    this.mossQueryRadius = maxMossRadius(this.mossPlacements);
    this.vegetationIndex = new ArenaPointBucketIndex(
      options.frame,
      (placement) => ({ x: placement.worldX, y: placement.worldY }),
    );
    this.vegetationIndex.sync(this.vegetationPlacements);
    this.vegetationQueryRadius = maxVegetationRadius(this.vegetationPlacements);
    this.rockDecalIndex = new ArenaPointBucketIndex(
      options.frame,
      (decal) => ({
        x: options.frame.offsetX + decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX,
        y: options.frame.offsetY + decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY,
      }),
    );
    this.rockDecalIndex.sync(this.rockDecals);
    this.rockDecalQueryRadius = maxRockDecalRadius(this.rockDecals);

    const layers: ChunkedSurfaceLayerSpec[] = this.mottleConfigs.map((mottle, index) => ({
      id: rockOverlayMottleLayerId(index),
      // Dieselbe Staffelung wie im arenagrossen Bake: Materialstoerung knapp ueber dem Fels,
      // jede weitere Lage ein Hundertstel darueber.
      depth: DEPTH.ROCKS + 0.05 + index * 0.01,
      blend: mottle.blend === 'multiply' ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL,
    }));
    layers.push(
      { id: ROCK_OVERLAY_MOSS_LAYER_ID, depth: DEPTH.ROCK_MOSS },
      { id: ROCK_OVERLAY_DECAL_LAYER_ID, depth: DEPTH.ROCK_DECALS },
      { id: ROCK_OVERLAY_VEGETATION_LAYER_ID, depth: DEPTH.ROCK_VEGETATION },
    );

    this.surface = new ChunkedRenderSurface(options.scene, {
      frame: options.frame,
      layers,
      chunkSize: options.chunkSize,
      bake: (region, sink) => this.bakeRegion(region, sink),
    });

    // Scratch-Targets sind klein, aber ebenfalls WebGL-Renderziele. Alle Rollen werden deshalb
    // mit der Dirty-Region-Groesse im verdeckten Arena-Startup warm gemacht.
    const scratchSize = ROCK_OVERLAY_CHUNK_SIZE + this.surface.gutterPx * 2;
    this.scratch.preallocate('silhouetteCutout', scratchSize, 'redraw');
    for (let index = 0; index < this.mottleConfigs.length; index += 1) {
      this.scratch.preallocate(`mottle${index}`, scratchSize);
    }
    this.scratch.preallocate('mossCutout', scratchSize, 'redraw');
    this.scratch.preallocate('moss', scratchSize);
    this.scratch.preallocate('vegetationCutout', scratchSize, 'redraw');
    this.scratch.preallocate('vegetation', scratchSize);
    this.scratch.preallocate('rockDecal', scratchSize);
    this.scratch.preallocate('rockDecalCutout', scratchSize, 'redraw');
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

  /** Vollstaendiger Neuaufbau aller residenten Chunks – nach Aenderungen ohne Dirty-Menge. */
  refreshAll(options: ChunkedRenderSurfaceRefreshOptions = {}): void {
    syncRockOverlaySource(this.overlaySource, this.layout.rocks);
    this.surface.refreshAll(options);
  }

  /**
   * Neuaufbau genau der Dirty-Chunks einer Aenderungswelle.
   *
   * Die Update-Granularitaet bleibt {@link ROCK_OVERLAY_CHUNK_SIZE}: Ein einzelner zerstoerter
   * Fels backt 128 px neu, nicht den ganzen Render-Chunk.
   */
  refreshRegions(dirtyRockIds: ReadonlySet<number>): void {
    if (dirtyRockIds.size === 0) return;
    // Nur ein Rebind kann Source-Zellen hinterlassen, die nicht mehr im Layout stehen. Im
    // normalen Zerstörungspfad bleibt die Quelle bewusst so gross wie das Layout; dadurch wird
    // hier kein Vollscan des Felsbestands in den häufigen Dirty-Region-Pfad eingeführt.
    const sourceMayContainRemovedCells = this.overlaySource.cells.length > this.layout.rocks.length;
    const currentRockKeys = sourceMayContainRemovedCells
      ? new Set(this.layout.rocks.map((cell) => rockCellKey(cell)))
      : null;
    const removedSourceCells = currentRockKeys
      ? this.overlaySource.cells.filter((cell) => !currentRockKeys.has(rockCellKey(cell)))
      : [];
    const addedSourceCells = syncRockOverlaySource(this.overlaySource, this.layout.rocks);
    if (currentRockKeys && removedSourceCells.length > 0) {
      const retained = this.overlaySource.cells.filter((cell) => currentRockKeys.has(rockCellKey(cell)));
      this.overlaySource.cells.length = 0;
      this.overlaySource.cells.push(...retained);
      this.overlaySource.keys.clear();
      for (const cell of retained) this.overlaySource.keys.add(rockCellKey(cell));
    }
    const dirtyCells: RockCell[] = [];
    for (const id of dirtyRockIds) {
      const cell = this.layout.rocks[id];
      if (cell) {
        dirtyCells.push(cell);
        continue;
      }

      // Beim Fast-Reinstance werden Runtime-Slots aus dem Layout entfernt. Der inaktive Visual
      // State traegt weiterhin die alte Zelle, damit deren vorheriger Source-Beitrag und dessen
      // groessere Mottle-Reichweite vollstaendig aus den residenten Chunks entfernt werden kann.
      const previousCell = this.rockVisualStates[id];
      if (previousCell) removedSourceCells.push(previousCell);
    }
    const chunks = collectRockOverlayChunks(
      dirtyCells,
      [...addedSourceCells, ...removedSourceCells],
      this.frame,
    );
    for (const chunk of chunks) {
      this.surface.refreshRegion(chunk.localX, chunk.localY, ROCK_OVERLAY_CHUNK_SIZE);
    }
  }

  destroy(): void {
    this.surface.destroy();
    this.scratch.destroy();
    this.rockIndex.clear();
    this.sourceIndex.clear();
    this.mossIndex.clear();
    this.vegetationIndex.clear();
    this.rockDecalIndex.clear();
  }

  // ── Bake ───────────────────────────────────────────────────────────────────

  private bakeRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const reach = getBlobSurfaceMottleReachPx(ROCK_BLOB_SURFACE_PROFILE);

    // Die kurzlebigen Kopien tragen nur Frame und Alpha des lebenden Felsens und werden
    // ausschliesslich chunklokal gezeichnet. Weltpositionierte Live-Felsen ueber eine
    // Scratch-Kamera einzulesen hat den Arena-Offset gegenueber dem Bake verschoben.
    const silhouetteImages = this.silhouetteImages;
    const vegetationMaskImages = this.vegetationMaskImages;
    const temporaryImages = this.temporaryImages;
    const activeCellKeys = this.activeCellKeys;
    silhouetteImages.length = 0;
    vegetationMaskImages.length = 0;
    temporaryImages.length = 0;
    activeCellKeys.clear();

    // Statt eines Durchlaufs ueber den gesamten Felsbestand nur die Buckets der Region: Auf einer
    // grossen Karte ist das der Unterschied zwischen rund 29 000 und wenigen hundert Kandidaten
    // je Region – und bei einer Flaechenzerstoerung mit dutzenden Dirty-Chunks der Unterschied
    // zwischen einem Ruckler und einem Standbild.
    this.rockIndex.sync(this.layout.rocks);
    this.sourceIndex.sync(this.overlaySource.cells);

    for (const id of this.rockIndex.collect(
      region.localX,
      region.localY,
      size,
      ACTIVE_ROCK_QUERY_MARGIN_PX,
      this.rockCandidates,
    )) {
      const cell = this.layout.rocks[id];
      const visualState = this.rockVisualStates[id];
      if (!cell || !visualState?.active) continue;
      activeCellKeys.add(rockCellKey(cell));

      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      const intersectsSilhouette = cellMaxX > region.localX && cellMinX < maxX
        && cellMaxY > region.localY && cellMinY < maxY;
      // Die Reichweitenmaske ragt ueber ihre Zelle hinaus. Ein Fels im Nachbarchunk deckt
      // deshalb noch in diesen hinein; ohne den Rand fehlte an jeder Chunkgrenze ein Streifen.
      const intersectsVegetation = cellMaxX + ROCK_VEGETATION_MASK_MARGIN_PX > region.localX
        && cellMinX - ROCK_VEGETATION_MASK_MARGIN_PX < maxX
        && cellMaxY + ROCK_VEGETATION_MASK_MARGIN_PX > region.localY
        && cellMinY - ROCK_VEGETATION_MASK_MARGIN_PX < maxY;
      if (!intersectsSilhouette && !intersectsVegetation) continue;

      // Losgeloest statt ueber `scene.add`: Die Kopie wird nur gezeichnet und sofort wieder
      // zerstoert; die Anzeigeliste wuerde jede davon linear durchsuchen (siehe
      // {@link ../ArenaVisualFactory}).
      const copy = new Phaser.GameObjects.Image(
        this.scene,
        cellMinX + CELL_SIZE * 0.5 - region.localX,
        cellMinY + CELL_SIZE * 0.5 - region.localY,
        ROCK_BLOB_SURFACE_PROFILE.textureKey,
        visualState.frame,
      ).setDisplaySize(CELL_SIZE, CELL_SIZE);
      temporaryImages.push(copy);
      if (intersectsSilhouette) silhouetteImages.push(copy);
      if (intersectsVegetation) vegetationMaskImages.push(copy);
    }

    // Die Materialquelle kommt aus dem vollstaendigen Bestand, nicht aus den lebenden Felsen:
    // Die Flecken eines gefallenen Felsens reichen bis zu `reach` weit auf seine Nachbarn, und
    // wuerden sie mit ihm verschwinden, spraenge dort das Material um. Die Decal-Stanzform traegt
    // dagegen ausschliesslich weggefallene Zellen – jede weitere Zelle wuerde Decal-Pixel auf
    // einem unveraenderten Fels loeschen.
    const sourceCells = this.sourceCells;
    const decalCutoutCells = this.decalCutoutCells;
    sourceCells.length = 0;
    decalCutoutCells.length = 0;
    for (const index of this.sourceIndex.collect(
      region.localX,
      region.localY,
      size,
      reach,
      this.sourceCandidates,
    )) {
      const cell = this.overlaySource.cells[index];
      if (!cell) continue;
      const cellMinX = cell.gridX * CELL_SIZE;
      const cellMinY = cell.gridY * CELL_SIZE;
      const cellMaxX = cellMinX + CELL_SIZE;
      const cellMaxY = cellMinY + CELL_SIZE;
      if (cellMaxX + reach > region.localX && cellMinX - reach < maxX
        && cellMaxY + reach > region.localY && cellMinY - reach < maxY) {
        sourceCells.push(cell);
      }
      if (cellMaxX > region.localX && cellMinX < maxX
        && cellMaxY > region.localY && cellMinY < maxY
        && !activeCellKeys.has(rockCellKey(cell))) {
        decalCutoutCells.push(cell);
      }
    }

    const cutout = this.scratch.get('silhouetteCutout', size, 'redraw');
    cutout.clear();
    cutout.fill(0x000000, 1);
    if (silhouetteImages.length > 0) cutout.erase(silhouetteImages);
    cutout.render();

    for (let index = 0; index < this.mottleConfigs.length; index += 1) {
      const target = this.scratch.get(`mottle${index}`, size);
      target.clear();
      stampBlobSurfaceMottle(
        this.scene,
        target,
        ROCK_BLOB_SURFACE_PROFILE,
        this.mottleConfigs[index],
        sourceCells,
        index,
        -region.localX,
        -region.localY,
      );
      target.render();
      eraseChunkScratch(target, cutout, size);
      target.render();
      sink.blit(rockOverlayMottleLayerId(index), target);
    }

    this.bakeMossRegion(region, sink, silhouetteImages);
    this.bakeDecalRegion(region, sink, decalCutoutCells, activeCellKeys);
    this.bakeVegetationRegion(region, sink, vegetationMaskImages);

    for (const image of temporaryImages) image.destroy();
    temporaryImages.length = 0;
  }

  private bakeMossRegion(
    region: ChunkBakeRegion,
    sink: ChunkBakeSink,
    silhouetteImages: readonly Phaser.GameObjects.Image[],
  ): void {
    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const candidateIds = this.mossIndex.collect(
      region.localX,
      region.localY,
      size,
      this.mossQueryRadius,
      this.mossCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    this.mossCandidates.length = 0;
    for (const id of candidateIds) {
      const placement = this.mossPlacements[id];
      if (!placement) continue;
      const radius = getRockMossPlacementRadiusPx(placement);
      const localX = placement.worldX - this.frame.offsetX;
      const localY = placement.worldY - this.frame.offsetY;
      if (localX + radius > region.localX && localX - radius < maxX
        && localY + radius > region.localY && localY - radius < maxY) {
        this.mossCandidates.push(placement);
      }
    }

    const masks = ArenaVisualFactory.createRockMossMasks(this.scene, silhouetteImages);
    const cutout = this.scratch.get('mossCutout', size, 'redraw');
    fillRockMossCutout(cutout, masks);

    const target = this.scratch.get('moss', size);
    target.clear();
    if (this.mossCandidates.length > 0) {
      stampRockMoss(this.scene, target, this.mossCandidates, -region.worldX, -region.worldY);
      target.render();
      eraseChunkScratch(target, cutout, size);
    }
    // Muss auch ohne Platzierungen laufen: `clear()` ist ein gepufferter Befehl, der erst hier
    // ausgefuehrt wird. Ohne diesen Aufruf traegt das Scratch-Ziel beim naechsten Blit noch den
    // Inhalt der zuvor bearbeiteten Region – sichtbar als Moos auf leerem Boden.
    target.render();
    sink.blit(ROCK_OVERLAY_MOSS_LAYER_ID, target);
    for (const mask of masks) mask.destroy();
  }

  private bakeVegetationRegion(
    region: ChunkBakeRegion,
    sink: ChunkBakeSink,
    maskSourceImages: readonly Phaser.GameObjects.Image[],
  ): void {
    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const candidateIds = this.vegetationIndex.collect(
      region.localX,
      region.localY,
      size,
      this.vegetationQueryRadius,
      this.vegetationCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    this.vegetationCandidates.length = 0;
    for (const id of candidateIds) {
      const placement = this.vegetationPlacements[id];
      if (!placement) continue;
      const radius = getRockVegetationPlacementRadiusPx(placement);
      const localX = placement.worldX - this.frame.offsetX;
      const localY = placement.worldY - this.frame.offsetY;
      if (localX + radius > region.localX && localX - radius < maxX
        && localY + radius > region.localY && localY - radius < maxY) {
        this.vegetationCandidates.push(placement);
      }
    }

    const masks = ArenaVisualFactory.createRockVegetationMasks(this.scene, maskSourceImages);
    const cutout = this.scratch.get('vegetationCutout', size, 'redraw');
    fillRockVegetationCutout(cutout, masks);

    const target = this.scratch.get('vegetation', size);
    target.clear();
    if (this.vegetationCandidates.length > 0) {
      stampRockVegetation(this.scene, target, this.vegetationCandidates, -region.worldX, -region.worldY);
      target.render();
      eraseChunkScratch(target, cutout, size);
    }
    target.render();
    sink.blit(ROCK_OVERLAY_VEGETATION_LAYER_ID, target);
    for (const mask of masks) mask.destroy();
  }

  /**
   * Fels-Decals einer Region.
   *
   * Sie sind die eine Ausnahme vom Silhouettenschnitt, weil sie die Felskante absichtlich
   * ueberragen: Ihre Stanzform ist allein die Vereinigung der Zellquadrate weggefallener Felsen
   * (siehe {@link ../RockDecalLayer}).
   */
  private bakeDecalRegion(
    region: ChunkBakeRegion,
    sink: ChunkBakeSink,
    decalCutoutCells: readonly RockCell[],
    activeCellKeys: ReadonlySet<number>,
  ): void {
    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const candidateIds = this.rockDecalIndex.collect(
      region.localX,
      region.localY,
      size,
      this.rockDecalQueryRadius,
      this.rockDecalCandidateIds,
    );
    candidateIds.sort(compareNumbers);
    this.rockDecalCandidates.length = 0;
    for (const id of candidateIds) {
      const decal = this.rockDecals[id];
      if (!decal) continue;
      if (!isRockDecalVisible(decal, activeCellKeys)) continue;
      // Dieselbe Ersatzgroesse wie die Bildfabrik; eine andere liesse ein Decal aus dem Neubau
      // fallen, das die Fabrik gezeichnet haette.
      const radius = (decal.displaySize ?? ROCK_DECAL_SIZE) * Math.SQRT1_2;
      const centerX = decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX;
      const centerY = decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY;
      if (centerX + radius > region.localX && centerX - radius < maxX
        && centerY + radius > region.localY && centerY - radius < maxY) {
        this.rockDecalCandidates.push(decal);
      }
    }

    const target = this.scratch.get('rockDecal', size);
    target.clear();
    const images = ArenaVisualFactory.createRockDecals(
      this.scene,
      this.rockDecalCandidates,
      { offsetX: -region.localX, offsetY: -region.localY },
    );
    if (images.length > 0) {
      target.draw(images);
      target.render();
      if (decalCutoutCells.length > 0) {
        const cutout = this.scratch.get('rockDecalCutout', size, 'redraw');
        fillRockDecalCutout(cutout, decalCutoutCells, -region.localX, -region.localY);
        eraseChunkScratch(target, cutout, size);
      }
    }
    target.render();
    for (const image of images) image.destroy();
    sink.blit(ROCK_OVERLAY_DECAL_LAYER_ID, target);
  }
}

function compareNumbers(a: number, b: number): number {
  return a - b;
}

function maxMossRadius(placements: readonly RockMossPlacement[]): number {
  let maxRadius = 0;
  for (const placement of placements) {
    maxRadius = Math.max(maxRadius, getRockMossPlacementRadiusPx(placement));
  }
  return maxRadius;
}

function maxVegetationRadius(placements: readonly RockVegetationPlacement[]): number {
  let maxRadius = 0;
  for (const placement of placements) {
    maxRadius = Math.max(maxRadius, getRockVegetationPlacementRadiusPx(placement));
  }
  return maxRadius;
}

function maxRockDecalRadius(decals: readonly DecalCell[]): number {
  let maxRadius = 0;
  for (const decal of decals) {
    maxRadius = Math.max(
      maxRadius,
      (decal.displaySize ?? ROCK_DECAL_SIZE) * Math.SQRT1_2,
    );
  }
  // Auch fuer eine spaeter gelieferte grosse authored Platzierung bleibt der Query konservativ.
  return Math.max(maxRadius, ROCK_DECAL_LARGE_SIZE * Math.SQRT1_2);
}

/**
 * Welche Fels-Decals ueberhaupt gezeichnet werden.
 *
 * Eine `core`-Matte liegt per Konstruktion vollstaendig auf Fels (siehe
 * {@link ../DecalConfig.isEnclosedRockDecal}); fuer sie ist der geometrische Schnitt an der
 * weggefallenen Felsflaeche vollstaendig, sie bleibt also auch dann stehen, wenn ihre Ankerzelle
 * faellt. Jedes andere Fels-Decal darf die Kante seiner Ankerzelle ueberragen; dieser Ueberhang
 * liegt ueber nie belegtem Boden, den keine Stanzform trifft, und muss mit der Ankerzelle ganz
 * verschwinden.
 */
export function isRockDecalVisible(decal: DecalCell, activeCellKeys: ReadonlySet<number>): boolean {
  if ((decal.surface ?? 'ground') !== 'rock') return false;
  if (isEnclosedRockDecal(decal.textureKey)) return true;
  return activeCellKeys.has(rockCellKey(decal));
}
