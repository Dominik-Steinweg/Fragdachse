import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import type { ArenaLayout, DecalCell, RockCell } from '../../types';
import { ArenaVisualFactory } from '../ArenaVisualFactory';
import { ROCK_BLOB_SURFACE_PROFILE, getBlobSurfaceMottleReachPx } from '../BlobSurfaceProfile';
import { stampBlobSurfaceMottle } from '../BlobSurfaceMottle';
import { ROCK_DECAL_LARGE_SIZE, ROCK_DECAL_SIZE, isEnclosedRockDecal } from '../DecalConfig';
import { ArenaCellBucketIndex } from './ArenaCellBucketIndex';
import { fillRockDecalCutout } from '../RockDecalLayer';
import { fillRockMossCutout, stampRockMoss } from '../RockMossLayer';
import { getRockMossPlacementRadiusPx } from '../RockMossField';
import type { RockMossPlacement } from '../RockMossField';
import { fillRockVegetationCutout, stampRockVegetation } from '../RockVegetationLayer';
import { getRockVegetationPlacementRadiusPx } from '../RockVegetationField';
import type { RockVegetationPlacement } from '../RockVegetationField';
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
import type { ChunkBakeRegion, ChunkBakeSink, ChunkedSurfaceLayerSpec } from './ChunkedRenderSurface';
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
 * 1. Die Materialquelle ist der **vollstaendige** Felsbestand der Runde und schrumpft nie.
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
  readonly rockObjects: readonly (Phaser.GameObjects.Image | null)[];
  readonly overlaySource: RockOverlaySource;
  readonly mossPlacements: readonly RockMossPlacement[];
  readonly vegetationPlacements: readonly RockVegetationPlacement[];
  readonly chunkSize?: number;
}

export class RockOverlayStreamer {
  private readonly scene: Phaser.Scene;
  private readonly frame: ChunkWorldFrame;
  private readonly layout: ArenaLayout;
  private readonly rockObjects: readonly (Phaser.GameObjects.Image | null)[];
  private readonly overlaySource: RockOverlaySource;
  private readonly mossPlacements: readonly RockMossPlacement[];
  private readonly vegetationPlacements: readonly RockVegetationPlacement[];
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
  /** Wiederverwendete Trefferpuffer – eine Allokation je Region weniger. */
  private readonly rockCandidates: number[] = [];
  private readonly sourceCandidates: number[] = [];

  constructor(options: RockOverlayStreamerOptions) {
    this.scene = options.scene;
    this.frame = options.frame;
    this.layout = options.layout;
    this.rockObjects = options.rockObjects;
    this.overlaySource = options.overlaySource;
    this.mossPlacements = options.mossPlacements;
    this.vegetationPlacements = options.vegetationPlacements;
    this.scratch = new ChunkScratchPool(options.scene);
    this.rockIndex = new ArenaCellBucketIndex(options.frame.width);
    this.sourceIndex = new ArenaCellBucketIndex(options.frame.width);

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

  /** Vollstaendiger Neuaufbau aller residenten Chunks – nach Aenderungen ohne Dirty-Menge. */
  refreshAll(): void {
    syncRockOverlaySource(this.overlaySource, this.layout.rocks);
    this.surface.refreshAll();
  }

  /**
   * Neuaufbau genau der Dirty-Chunks einer Aenderungswelle.
   *
   * Die Update-Granularitaet bleibt {@link ROCK_OVERLAY_CHUNK_SIZE}: Ein einzelner zerstoerter
   * Fels backt 128 px neu, nicht den ganzen Render-Chunk.
   */
  refreshRegions(dirtyRockIds: ReadonlySet<number>): void {
    if (dirtyRockIds.size === 0) return;
    const addedSourceCells = syncRockOverlaySource(this.overlaySource, this.layout.rocks);
    const dirtyCells: RockCell[] = [];
    for (const id of dirtyRockIds) {
      const cell = this.layout.rocks[id];
      if (cell) dirtyCells.push(cell);
    }
    const chunks = collectRockOverlayChunks(dirtyCells, addedSourceCells, this.frame);
    for (const chunk of chunks) {
      this.surface.refreshRegion(chunk.localX, chunk.localY, ROCK_OVERLAY_CHUNK_SIZE);
    }
  }

  destroy(): void {
    this.surface.destroy();
    this.scratch.destroy();
    this.rockIndex.clear();
    this.sourceIndex.clear();
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
    const silhouetteImages: Phaser.GameObjects.Image[] = [];
    const vegetationMaskImages: Phaser.GameObjects.Image[] = [];
    const temporaryImages: Phaser.GameObjects.Image[] = [];
    const activeCellKeys = new Set<number>();

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
      const image = this.rockObjects[id];
      if (!cell || !image?.active) continue;
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
        image.texture.key,
        image.frame.name,
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
    const sourceCells: RockCell[] = [];
    const decalCutoutCells: RockCell[] = [];
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
  }

  private bakeMossRegion(
    region: ChunkBakeRegion,
    sink: ChunkBakeSink,
    silhouetteImages: readonly Phaser.GameObjects.Image[],
  ): void {
    const { size } = region;
    const maxX = region.localX + size;
    const maxY = region.localY + size;
    const placements = this.mossPlacements.filter((placement) => {
      const radius = getRockMossPlacementRadiusPx(placement);
      const localX = placement.worldX - this.frame.offsetX;
      const localY = placement.worldY - this.frame.offsetY;
      return localX + radius > region.localX && localX - radius < maxX
        && localY + radius > region.localY && localY - radius < maxY;
    });

    const masks = ArenaVisualFactory.createRockMossMasks(this.scene, silhouetteImages);
    const cutout = this.scratch.get('mossCutout', size, 'redraw');
    fillRockMossCutout(cutout, masks);

    const target = this.scratch.get('moss', size);
    target.clear();
    if (placements.length > 0) {
      stampRockMoss(this.scene, target, placements, -region.worldX, -region.worldY);
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
    const placements = this.vegetationPlacements.filter((placement) => {
      const radius = getRockVegetationPlacementRadiusPx(placement);
      const localX = placement.worldX - this.frame.offsetX;
      const localY = placement.worldY - this.frame.offsetY;
      return localX + radius > region.localX && localX - radius < maxX
        && localY + radius > region.localY && localY - radius < maxY;
    });

    const masks = ArenaVisualFactory.createRockVegetationMasks(this.scene, maskSourceImages);
    const cutout = this.scratch.get('vegetationCutout', size, 'redraw');
    fillRockVegetationCutout(cutout, masks);

    const target = this.scratch.get('vegetation', size);
    target.clear();
    if (placements.length > 0) {
      stampRockVegetation(this.scene, target, placements, -region.worldX, -region.worldY);
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
    const candidates = (this.layout.decals ?? []).filter((decal) => {
      if (!isRockDecalVisible(decal, activeCellKeys)) return false;
      // Dieselbe Ersatzgroesse wie die Bildfabrik; eine andere liesse ein Decal aus dem Neubau
      // fallen, das die Fabrik gezeichnet haette.
      const radius = (decal.displaySize ?? ROCK_DECAL_SIZE) * Math.SQRT1_2;
      const centerX = decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX;
      const centerY = decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY;
      return centerX + radius > region.localX && centerX - radius < maxX
        && centerY + radius > region.localY && centerY - radius < maxY;
    });

    const target = this.scratch.get('rockDecal', size);
    target.clear();
    const images = ArenaVisualFactory.createRockDecals(
      this.scene,
      candidates,
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
