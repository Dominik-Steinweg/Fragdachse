import * as Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_STATIC_FRAMES_VISIBLE,
  DEPTH, COLORS,
  GRID_COLS, GRID_ROWS,
  CELL_SIZE, TRUNK_RADIUS, CANOPY_RADIUS, CANOPY_ALPHA_PLAYER, ROCK_HP_MAX, ROCK_TINT_STEPS,
  CAPTURE_THE_BEER_BASE_TINT_ALPHA,
  CAPTURE_THE_BEER_BLUE_BASE_TINT,
  CAPTURE_THE_BEER_RED_BASE_TINT,
  getCaptureTheBeerBaseWorldBounds,
  isCaptureTheBeerBaseModeActive,
} from '../config';
import { CAPTURE_THE_BEER_MODE } from '../gameModes';
import type { ArenaLayout, DecalCell, DirtCell, RockCell, TrackCell, GameMode, GamePhase } from '../types';
import { DECAL_SIZE, ROCK_DECAL_SIZE, isEnclosedRockDecal } from './DecalConfig';
import { AutoTiler, ROCK_AUTOTILE, DIRT_AUTOTILE } from './AutoTiler';
import { ArenaVisualFactory } from './ArenaVisualFactory';
import { ROCK_BLOB_SURFACE_PROFILE, DIRT_BLOB_SURFACE_PROFILE } from './BlobSurfaceProfile';
import { multiplyTint, resolveBlobSurfaceCornerTints } from './BlobSurfaceShading';
import type { BlobSurfaceCornerTints } from './BlobSurfaceShading';
import { bakeBlobSurfaceMottle, stampBlobSurfaceMottle } from './BlobSurfaceMottle';
import { getBlobSurfaceMottleReachPx } from './BlobSurfaceProfile';
import { fillRockDecalCutout } from './RockDecalLayer';
import {
  ROCK_OVERLAY_CHUNK_SIZE,
  collectFallenRockCells,
  collectRockCellKeys,
  collectRockOverlayChunks,
  createRockOverlaySource,
  rockCellKey,
  syncRockOverlaySource,
} from './RockOverlayRegions';
import type { RockOverlayChunk, RockOverlaySource } from './RockOverlayRegions';
import { generateGroundCoverPlacements } from './GroundCoverField';
import { bakeGroundCoverLayer } from './GroundCoverLayer';
import { generateRockMossPlacements, getRockMossPlacementRadiusPx } from './RockMossField';
import type { RockMossPlacement } from './RockMossField';
import { bakeRockMossLayer, fillRockMossCutout, stampRockMoss } from './RockMossLayer';
import { generateRockVegetationPlacements, getRockVegetationPlacementRadiusPx } from './RockVegetationField';
import type { RockVegetationPlacement } from './RockVegetationField';
import { bakeRockVegetationLayer, fillRockVegetationCutout, stampRockVegetation } from './RockVegetationLayer';
import { ROCK_VEGETATION_MASK_MARGIN_PX } from './RockVegetationConfig';
import { RockGridIndex } from './RockGridIndex';
import {
  ARENA_BACKGROUND_DETAIL_TEXTURE_KEY,
  ARENA_BACKGROUND_TEXTURE_KEY,
  resolveArenaBackgroundSpec,
} from './ArenaBackground';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

/**
 * Weltausschnitt, in dem ein Felsbestand liegt.
 *
 * Die Arena benutzt die aktiven Arena-Metriken; die Lobby-Vorschau spannt einen eigenen,
 * bildschirmbreiten Rahmen auf. Bau, Zerstörung und Overlay-Neubau der Felsen laufen deshalb
 * über diesen Parameter statt über die globalen `ARENA_*`-Werte – nur so kann die Lobby
 * denselben Darstellungspfad benutzen, statt einen zweiten zu bauen.
 */
export interface RockWorldFrame {
  offsetX: number;
  offsetY: number;
  width:  number;
  height: number;
}

/**
 * Rahmen der laufenden Arena. Bewusst eine Funktion: `ARENA_*` sind zur Laufzeit
 * veränderlich (breite Coop-Karten, Capture the Beer).
 */
export function getArenaRockWorldFrame(): RockWorldFrame {
  return { offsetX: ARENA_OFFSET_X, offsetY: ARENA_OFFSET_Y, width: ARENA_WIDTH, height: ARENA_HEIGHT };
}

export interface ArenaBuilderResult {
  /** CTB-Basis-Tintflächen (round-scoped). Coop-Defense-Basen leben in BaseManager. */
  baseZoneObjects: Phaser.GameObjects.Rectangle[];
  /** StaticGroup mit Felsen-Sprites (für Kollision + HP-Tracking) */
  rockGroup:    Phaser.Physics.Arcade.StaticGroup;
  /** Paralleles Array zu layout.rocks – null-Slots = bereits zerstört */
  rockObjects:  (Phaser.GameObjects.Image | null)[];
  /**
   * Zuletzt angewendeter Zustandstint je Fels (Schaden × Besitzerfarbe), parallel zu
   * `rockObjects`. Der sichtbare Tint ist das Produkt aus diesem Wert und dem
   * 4-Ecken-Flaechentint; ohne den gespeicherten Zustand liesse sich der Flaechenanteil
   * nach einer Hindernisaenderung nicht neu berechnen, ohne den Schaden zu verlieren.
   * Auf Clients ist das ausserdem die einzige verfuegbare Quelle: dort fuehrt die
   * `RockRegistry` keine HP, die kommt aus dem Host-Snapshot.
   */
  rockStateTints: number[];
  /** Spatial Index für Grid-basierte Nachbar-Lookups (Autotiling) */
  rockGrid:     RockGridIndex;
  /** StaticGroup mit Baumstümpfen (Kreis-Körper, keine HP) */
  trunkGroup:   Phaser.Physics.Arcade.StaticGroup;
  /** Baumstumpf-Objekte für Hitscan-/Melee-Sweeps */
  trunkObjects: Phaser.GameObjects.Arc[];
  /** Baumkronen-Sprites für Transparenz-Update */
  canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }>;
  /** Gleis-TileSprites (eine pro Gleis-Spalte, nur visuell, keine Kollision) */
  trackObjects: Phaser.GameObjects.TileSprite[];
  /**
   * Der statische Dirt-Boden, einmalig in eine RenderTexture gebacken. Ersetzt bis zu ~2000
   * Einzel-Images in der Display-Liste durch ein Objekt und senkt so die fixen Render-Kosten pro
   * Frame. `null`, wenn die Map keinen Dirt hat.
   */
  dirtLayer: Phaser.GameObjects.RenderTexture | null;
  /**
   * Geometrie der gebackenen Dirt-Kacheln. Der Terrain-Farb-Sampler zeichnet daraus seine eigene
   * CPU-Canvas; die Live-Images existieren dafür nicht mehr.
   */
  dirtStamps: DirtStamp[];
  /**
   * Die prozedurale Moosschicht ueber der Dirt/Gras-Grenze, ebenfalls einmalig gebacken. Sie
   * entsteht aus `layout.seed` und `layout.dirt` und liegt auf `DEPTH.GROUND_COVER`, also ueber
   * dem Dirt samt Mottle und unter Gleisen, Basiszonen und Decals. `null`, wenn keine Platzierung
   * zustande kommt.
   */
  groundCoverLayer: Phaser.GameObjects.RenderTexture | null;
  /** Stempel-Geometrie der Moosschicht – aus demselben Grund erhalten wie `dirtStamps`. */
  groundCoverStamps: DirtStamp[];
  /**
   * Die statischen Decals, ebenfalls einmalig in eine RenderTexture gebacken. Decals sind rein
   * visuell und zur Laufzeit unveränderlich (keine Kollision, keine HP), deshalb gilt für sie
   * dieselbe Backregel wie für den Dirt-Boden. `null`, wenn die Map keine Decals hat.
   */
  decalLayer: Phaser.GameObjects.RenderTexture | null;
  /**
   * Geometrie der gebackenen Decals – aus demselben Grund erhalten wie `dirtStamps`: Der
   * Terrain-Farb-Sampler braucht sie, weil die Live-Images nicht mehr existieren.
   */
  decalStamps: DirtStamp[];
  /** Gebackene Fels-Decals; wird bei Fels-Aenderungen neu aufgebaut. */
  rockDecalLayer: Phaser.GameObjects.RenderTexture | null;
  /**
   * Stanzform der Fels-Decals: deckend genau dort, wo einmal Fels stand und jetzt keiner mehr
   * steht (siehe {@link ./RockDecalLayer}). Rundengebunden und an Ort und Stelle neu befuellt –
   * aus demselben Grund wie `rockSilhouetteCutout`.
   */
  rockDecalCutout: Phaser.GameObjects.RenderTexture | null;
  /**
   * Materialquelle aller felsgebundenen Overlays: jede Zelle, auf der in dieser Runde je ein Fels
   * stand. Sie waechst mit gebauten Felsen und schrumpft nie – nur so bleiben Materialflecken,
   * Moos und Kantenmatten auf unbeteiligten Felsen nach einer Zerstoerung Pixel fuer Pixel stehen
   * (siehe {@link ./RockOverlayRegions}).
   */
  rockOverlaySource: RockOverlaySource;
  /**
   * Grossflaechiges Moos auf dem Felsbestand samt seiner Stanzform. Beide sind arenagross und
   * rundengebunden; sie werden bei Hindernisaenderungen an Ort und Stelle neu befuellt, nie neu
   * allokiert.
   */
  rockMossLayer: Phaser.GameObjects.RenderTexture | null;
  rockMossCutout: Phaser.GameObjects.RenderTexture | null;
  /**
   * Die Moosflecken der Runde. Einmalig aus `layout.seed` und dem **vollstaendigen** Felsbestand
   * erzeugt und danach unveraendert: Eine Zerstoerung darf die Platzierung nicht neu auswuerfeln,
   * sonst spraenge das Moos auf allen unbeteiligten Felsen. Sichtbar ist davon immer nur, was die
   * Stanzform des aktuellen Bestands durchlaesst.
   */
  rockMossPlacements: RockMossPlacement[];
  /**
   * Kantenmatten aus Moos, Flechten und Efeu samt ihrer Stanzform. Aufbau und Lebensdauer wie beim
   * Fels-Moos; der Unterschied liegt allein in der Maske, die hier ueber die Felskante hinaus
   * reicht statt innerhalb der Kachel auszulaufen.
   */
  rockVegetationLayer: Phaser.GameObjects.RenderTexture | null;
  rockVegetationCutout: Phaser.GameObjects.RenderTexture | null;
  /**
   * Die Kantenmatten der Runde. Einmalig aus `layout.seed` und dem **vollstaendigen** Felsbestand
   * erzeugt und danach unveraendert – dieselbe Regel wie bei `rockMossPlacements`, hier zusaetzlich
   * die Voraussetzung dafuer, dass eine Zerstoerung nur den Anteil des gefallenen Felsens entfernt
   * und die uebrige Matte Pixel fuer Pixel stehen laesst.
   */
  rockVegetationPlacements: RockVegetationPlacement[];
  /**
   * Gebackene, nicht-periodische Materialstoerungen der Felsflaeche (`BlobSurfaceMottle`).
   * Die geordnete NORMAL- und MULTIPLY-Kombination wird bei Hindernisaenderungen erhalten.
   */
  rockMottleLayers: Phaser.GameObjects.RenderTexture[];
  /**
   * Rundengebundene Stanzform: arenagross, ausserhalb der Felsen deckend. Sie beschneidet
   * den Fleck-Layer exakt auf die Silhouette.
   *
   * Bewusst rundengebunden und nicht pro Aufbau neu erzeugt: der Layer wird bei *jeder*
   * Hindernisaenderung neu gebacken, und eine arenagrosse Textur pro zerstoertem Fels neu
   * zu allokieren waere auf den breiten Karten ein spuerbarer Ruckler.
   */
  rockSilhouetteCutout: Phaser.GameObjects.RenderTexture | null;
  /** Wiederverwendete, kleine Renderziele fuer lokale Fels-Overlay-Updates. */
  rockOverlayScratch: RockOverlayScratch | null;
}

interface RockOverlayScratch {
  cutout: Phaser.GameObjects.RenderTexture;
  mottleLayers: Phaser.GameObjects.RenderTexture[];
  decal: Phaser.GameObjects.RenderTexture;
  /**
   * Eigene Stanzform fuer das Moos. Sie kann nicht mit `cutout` geteilt werden: Der Mottle
   * schneidet hart an der Silhouette, das Moos weich an der Verlaufsmaske.
   */
  /**
   * Und noch eine eigene Stanzform: Decals duerfen die Felskante ueberragen, ihr Schnitt trifft
   * deshalb nur die Flaeche gefallener Felsen statt der Silhouette.
   */
  decalCutout: Phaser.GameObjects.RenderTexture;
  moss: Phaser.GameObjects.RenderTexture;
  mossCutout: Phaser.GameObjects.RenderTexture;
  /** Wieder eine eigene Stanzform: Die Vegetation schneidet an der Reichweiten-, nicht an der Verlaufsmaske. */
  vegetation: Phaser.GameObjects.RenderTexture;
  vegetationCutout: Phaser.GameObjects.RenderTexture;
}

/** Was der Terrain-Sampler von einer gebackenen Dirt-Kachel braucht (siehe ArenaTerrainColorSampler). */
export interface DirtStamp {
  textureKey: string;
  frameName: string | number;
  x: number;
  y: number;
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  alpha: number;
  /** Nur die Ground-Cover-Schicht spiegelt ihre Stempel; sonst undefiniert. */
  mirrorX?: boolean;
  mirrorY?: boolean;
}

export class ArenaBuilder {
  private scene: Phaser.Scene;
  private leftSidebar: Phaser.GameObjects.Rectangle | null = null;
  private rightSidebar: Phaser.GameObjects.Rectangle | null = null;
  private arenaBackground: Phaser.GameObjects.TileSprite | null = null;
  /** Multiply-Feinschicht über dem Gras; bricht dessen Kachelperiode (siehe ArenaBackground). */
  private arenaBackgroundDetail: Phaser.GameObjects.TileSprite | null = null;
  private lobbyBackground: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Statische Teile (einmalig in create()) ─────────────────────────────────

  /** Zeichnet Sidebars, Gras und setzt die Physics-Bounds.
   *  Wird einmalig in ArenaScene.create() aufgerufen, nie zerstört. */
  buildStatic(mode: GameMode, phase: GamePhase): void {
    this.ensureSidebars();
    this.ensureArenaBackground();
    this.ensureLobbyBackground();
    this.syncStaticBackdrop(mode, phase);
    this.setPhysicsBounds();
  }

  syncStaticBackdrop(mode: GameMode, phase: GamePhase): void {
    const inArena = phase === 'ARENA';
    const showFrames = inArena && ARENA_STATIC_FRAMES_VISIBLE && ARENA_OFFSET_X > 0;

    if (this.leftSidebar) {
      this.leftSidebar
        .setPosition(ARENA_OFFSET_X * 0.5, GAME_HEIGHT * 0.5)
        .setSize(ARENA_OFFSET_X, GAME_HEIGHT)
        .setVisible(showFrames);
    }

    if (this.rightSidebar) {
      this.rightSidebar
        .setPosition(GAME_WIDTH - ARENA_OFFSET_X * 0.5, GAME_HEIGHT * 0.5)
        .setSize(ARENA_OFFSET_X, GAME_HEIGHT)
        .setVisible(showFrames);
    }

    if (this.arenaBackground) {
      const background = resolveArenaBackgroundSpec(mode, ARENA_WIDTH);
      this.arenaBackground
        .setTexture(background.textureKey)
        .setPosition(ARENA_OFFSET_X + ARENA_WIDTH * 0.5, ARENA_OFFSET_Y + ARENA_HEIGHT * 0.5)
        .setSize(ARENA_WIDTH, ARENA_HEIGHT)
        .setTilePosition(0, 0)
        .setVisible(inArena);

      this.arenaBackgroundDetail
        ?.setTexture(background.detailTextureKey)
        .setPosition(ARENA_OFFSET_X + ARENA_WIDTH * 0.5, ARENA_OFFSET_Y + ARENA_HEIGHT * 0.5)
        .setSize(ARENA_WIDTH, ARENA_HEIGHT)
        .setTilePosition(0, 0)
        .setAlpha(background.detailAlpha)
        .setVisible(inArena);
    }

    if (this.lobbyBackground) {
      this.lobbyBackground
        .setPosition(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5)
        .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
        .setVisible(!inArena);
    }
  }

  // ── Dynamische Teile (einmal pro Runde) ────────────────────────────────────

  /**
   * Baut Felsen und Bäume anhand des übergebenen Layouts.
   * Wird pro Runde einmalig aufgerufen. Rückgabe muss in ArenaScene
   * gespeichert werden; `destroy()` räumt alles wieder auf.
   */
  buildDynamic(layout: ArenaLayout): ArenaBuilderResult {
    const baseZoneObjects = this.buildCaptureTheBeerBaseZones();
    const rockGroup    = this.scene.physics.add.staticGroup();
    const trunkGroup   = this.scene.physics.add.staticGroup();
    const rockObjects:  (Phaser.GameObjects.Image | null)[] = [];
    const rockStateTints: number[] = [];
    const trunkObjects: Phaser.GameObjects.Arc[] = [];
    const canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }> = [];

    // Spatial Index für Autotiling
    const rockGrid = new RockGridIndex(layout.rocks);
    const isOccupied = (gx: number, gy: number) => rockGrid.isOccupiedWithBorder(gx, gy);

    // Gleise (vor Felsen zeichnen, damit depth-Reihenfolge stimmt)
    const trackObjects = this.buildTracks(layout.tracks ?? []);

    // Dirt (rein visuell, keine Physik) – einmalig in eine RenderTexture backen, dann die
    // Einzel-Images verwerfen, damit sie nicht jeden Frame durch die Display-Liste laufen.
    const { dirtLayer, dirtStamps } = this.bakeDirt(layout.dirt ?? []);

    // Moosschicht ueber der Dirt/Gras-Grenze – zwischen Dirt und Decals, weil sie den Saum
    // ueberdecken soll, die kleinen Decals aber weiterhin darauf liegen.
    const { groundCoverLayer, groundCoverStamps } = this.bakeGroundCover(layout);

    // Decals (rein visuell, oberhalb von Gleisen/Dirt, unter Felsen) – zur Laufzeit
    // unveraenderlich und deshalb wie der Dirt-Boden gebacken.
    const { decalLayer, decalStamps } = this.bakeDecals(layout.decals ?? []);

    // Felsen mit Autotiling
    for (let i = 0; i < layout.rocks.length; i++) {
      const { gridX, gridY } = layout.rocks[i];
      const worldX = ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask   = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const frame  = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      const img    = this.createRockVisual(worldX, worldY, frame, resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied));
      rockGroup.add(img);
      (img.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      rockObjects.push(img);
      rockStateTints.push(0xffffff);
    }

    // Bäume (Trunk + Canopy)
    for (const { gridX, gridY } of layout.trees) {
      const worldX = ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;

      // Trunk (Kollision)
      const trunk = this.createTrunkVisual(worldX, worldY);
      trunkGroup.add(trunk);
      const trunkBody = trunk.body as Phaser.Physics.Arcade.StaticBody;
      trunkBody.setCircle(TRUNK_RADIUS);
      trunkBody.updateFromGameObject();
      trunkObjects.push(trunk);

      // Canopy (nur visuell)
      const gfx = this.createCanopyVisual(worldX, worldY);
      canopyObjects.push({ gfx, worldX, worldY });
    }

    const result: ArenaBuilderResult = {
      baseZoneObjects,
      rockGroup,
      rockObjects,
      rockStateTints,
      rockGrid,
      trunkGroup,
      trunkObjects,
      canopyObjects,
      trackObjects,
      dirtLayer,
      dirtStamps,
      groundCoverLayer,
      groundCoverStamps,
      decalLayer,
      decalStamps,
      rockDecalLayer: null,
      rockDecalCutout: null,
      rockOverlaySource: createRockOverlaySource(),
      rockMossLayer: null,
      rockMossCutout: null,
      // Einmalig hier erzeugt und nie wieder: siehe `rockMossPlacements`.
      rockMossPlacements: generateRockMossPlacements({
        seed: layout.seed,
        rocks: layout.rocks,
        metrics: { offsetX: ARENA_OFFSET_X, offsetY: ARENA_OFFSET_Y, gridCols: GRID_COLS, gridRows: GRID_ROWS },
      }),
      rockVegetationLayer: null,
      rockVegetationCutout: null,
      // Ebenfalls einmalig hier erzeugt und nie wieder: siehe `rockVegetationPlacements`.
      rockVegetationPlacements: generateRockVegetationPlacements({
        seed: layout.seed,
        rocks: layout.rocks,
        metrics: { offsetX: ARENA_OFFSET_X, offsetY: ARENA_OFFSET_Y, gridCols: GRID_COLS, gridRows: GRID_ROWS },
      }),
      rockMottleLayers: [],
      rockSilhouetteCutout: null,
      rockOverlayScratch: null,
    };

    // Erst nach dem Erzeugen der Live-Felsen backen, damit die Layer exakt die aktiven
    // Fels-IDs kennen. Zerstorungen bauen dieselben Layer spaeter gesammelt neu.
    ArenaBuilder.rebuildRockOverlays(this.scene, result, layout);
    return result;
  }

  // ── Canopy-Transparenz (jeden Frame lokal) ─────────────────────────────────

  /**
   * Setzt Alpha der Baumkrone auf CANOPY_ALPHA_PLAYER wenn sich der lokale
   * Spieler darunter befindet. Nur lokal – keine Netzwerkauswirkungen.
   *
   * Kronen liegen über dem Lightmap-Overlay (siehe `DEPTH_LIGHTING`), damit der
   * Schatten des eigenen Baumstamms nicht auf ihnen landet. Sie werden deshalb hier
   * einzeln eingefärbt; `resolveCanopyTint` liefert bei Tageslicht neutrales Weiß.
   */
  static updateCanopyTransparency(
    canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }>,
    localSprite:   Phaser.GameObjects.GameObject & { x: number; y: number } | null,
    resolveCanopyTint?: (worldX: number, worldY: number) => number,
  ): void {
    for (const { gfx, worldX, worldY } of canopyObjects) {
      if (!gfx.active) continue;
      const dx     = (localSprite?.x ?? -9999) - worldX;
      const dy     = (localSprite?.y ?? -9999) - worldY;
      const inside = Math.sqrt(dx * dx + dy * dy) < CANOPY_RADIUS;
      gfx.setAlpha(inside ? CANOPY_ALPHA_PLAYER : 1.0);
      if (resolveCanopyTint) gfx.setTint(resolveCanopyTint(worldX, worldY));
    }
  }

  // ── Rock-Visual-Updates ────────────────────────────────────────────────────

  /**
   * Aktualisiert Tint eines Felsens anhand seines HP-Wertes.
   * Bei hp <= 0 wird der Fels zerstört und Nachbar-Tiles aktualisiert.
   *
   * Der Zustandstint (Schaden, Besitzerfarbe) wird mit dem 4-Ecken-Flaechentint
   * multipliziert, damit Wash und Kantenlicht erhalten bleiben und der Schaden trotzdem
   * verhaeltnisgleich durchschlaegt.
   */
  static updateRockVisual(
    result:      ArenaBuilderResult,
    rocks:       readonly RockCell[],
    id:          number,
    hp:          number,
    maxHp = ROCK_HP_MAX,
    ownerColor?: number,
    ownerTintStrength = 0,
  ): void {
    if (hp <= 0) return;
    const img = result.rockObjects[id];
    if (!img?.active) return;

    // Glatte Abstufung in ROCK_TINT_STEPS Schritten: 0xffffff (voll) → 0x666666 (fast zerstört)
    const ratio = Math.round((hp / Math.max(1, maxHp)) * ROCK_TINT_STEPS) / ROCK_TINT_STEPS;
    const gray  = Math.round(0x66 + (0xFF - 0x66) * ratio);
    const damageTint = (gray << 16) | (gray << 8) | gray;
    const stateTint = ArenaBuilder.mixTint(damageTint, ownerColor, ownerTintStrength);
    result.rockStateTints[id] = stateTint;
    ArenaBuilder.applyRockTint(img, stateTint, ArenaBuilder.resolveSurfaceTints(result.rockGrid, rocks, id));
  }

  /**
   * Erneuert Flaechenwash und Kantenlicht aller lebenden Felsen.
   *
   * Nötig nach jeder Hindernisaenderung: das Kantenlicht leitet sich aus der Belegung der
   * Nachbarzellen ab, ein zerstoerter oder gesetzter Fels aendert es also auch bei seinen
   * Nachbarn. Der Aufruf gehört deshalb in denselben Trichter wie Retiling und statische
   * Schatten (`RockVisualHelper.refreshObstacleVisuals()`) und nicht in die einzelnen
   * Spawn-/Destroy-Pfade, die jeweils nur ihren eigenen Fels kennen.
   */
  static refreshRockSurfaceTints(
    result: ArenaBuilderResult,
    layout: ArenaLayout,
    dirtyRockIds?: ReadonlySet<number>,
  ): void {
    let ids: Iterable<number>;
    if (dirtyRockIds) {
      const affected = new Set<number>();
      for (const dirtyId of dirtyRockIds) {
        const cell = layout.rocks[dirtyId];
        if (!cell) continue;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const id = result.rockGrid.getIndex(cell.gridX + dx, cell.gridY + dy);
            if (id >= 0) affected.add(id);
          }
        }
      }
      ids = affected;
    } else {
      ids = layout.rocks.keys();
    }

    for (const id of ids) {
      const img = result.rockObjects[id];
      if (!img?.active) continue;
      ArenaBuilder.applyRockTint(
        img,
        result.rockStateTints[id] ?? 0xffffff,
        ArenaBuilder.resolveSurfaceTints(result.rockGrid, layout.rocks, id),
      );
    }
  }

  private static resolveSurfaceTints(
    rockGrid: RockGridIndex,
    rocks: readonly RockCell[],
    id: number,
  ): BlobSurfaceCornerTints | null {
    const cell = rocks[id];
    if (!cell) return null;
    return resolveBlobSurfaceCornerTints(
      ROCK_BLOB_SURFACE_PROFILE,
      cell.gridX,
      cell.gridY,
      (gx, gy) => rockGrid.isOccupiedWithBorder(gx, gy),
    );
  }

  private static applyRockTint(
    img: Phaser.GameObjects.Image,
    stateTint: number,
    surfaceTints: BlobSurfaceCornerTints | null,
  ): void {
    if (!surfaceTints) {
      img.setTint(stateTint);
      return;
    }
    img.setTint(
      multiplyTint(stateTint, surfaceTints[0]),
      multiplyTint(stateTint, surfaceTints[1]),
      multiplyTint(stateTint, surfaceTints[2]),
      multiplyTint(stateTint, surfaceTints[3]),
    );
  }

  static spawnRockAndRetile(
    scene: Phaser.Scene,
    result: ArenaBuilderResult,
    rocks: readonly RockCell[],
    id: number,
    ownerColor?: number,
    ownerTintStrength = 0,
    hp = ROCK_HP_MAX,
    maxHp = ROCK_HP_MAX,
    worldFrame: RockWorldFrame = getArenaRockWorldFrame(),
  ): Phaser.GameObjects.Image {
    const { rockObjects, rockGroup, rockGrid } = result;
    const { gridX, gridY } = rocks[id];
    const isOccupied = (gx: number, gy: number) => gx === gridX && gy === gridY
      ? true
      : rockGrid.isOccupiedWithBorder(gx, gy);
    const frame = AutoTiler.getFrame(AutoTiler.computeMask(gridX, gridY, isOccupied), ROCK_AUTOTILE);
    const img = ArenaBuilder.createRockVisual(
      scene,
      worldFrame.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2,
      worldFrame.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2,
      frame,
      resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied),
    );
    rockObjects[id] = img;
    rockGroup.add(img);
    (img.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    rockGroup.refresh();
    rockGrid.set(gridX, gridY, id);

    const neighborIds = rockGrid.getNeighborIndices(gridX, gridY);
    for (const neighborId of neighborIds) {
      const neighbor = rockObjects[neighborId];
      if (!neighbor?.active) continue;
      const cell = rocks[neighborId];
      const neighborFrame = AutoTiler.getFrame(AutoTiler.computeMask(cell.gridX, cell.gridY, (gx, gy) => rockGrid.isOccupiedWithBorder(gx, gy)), ROCK_AUTOTILE);
      neighbor.setFrame(neighborFrame);
    }

    ArenaBuilder.updateRockVisual(result, rocks, id, hp, maxHp, ownerColor, ownerTintStrength);
    return img;
  }

  /**
   * Entfernt einen Fels und aktualisiert die Tile-Frames aller Nachbarn.
   */
  static destroyRockAndRetile(
    result:      ArenaBuilderResult,
    rocks:       readonly RockCell[],
    id:          number,
  ): void {
    if (!rocks[id]) return;
    const { rockObjects, rockGrid } = result;
    const { gridX, gridY } = rocks[id];
    ArenaBuilder.destroyRock(result, id);
    rockGrid.remove(gridX, gridY);

    // Nachbar-Tiles neu berechnen
    const isOccupied = (gx: number, gy: number) => rockGrid.isOccupiedWithBorder(gx, gy);
    const neighborIds = rockGrid.getNeighborIndices(gridX, gridY);
    for (const nid of neighborIds) {
      const img = rockObjects[nid];
      if (!img?.active) continue;
      if (!rocks[nid]) continue;
      const { gridX: ngx, gridY: ngy } = rocks[nid];
      const mask  = AutoTiler.computeMask(ngx, ngy, isOccupied);
      const frame = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      img.setFrame(frame);
    }
  }

  /**
   * Entfernt einen Fels physikalisch und visuell aus der Szene.
   * Sicher mehrfach aufzurufen (idempotent via null-Slot).
   */
  static destroyRock(result: ArenaBuilderResult, id: number): void {
    const img = result.rockObjects[id];
    if (!img) return;
    result.rockGroup.remove(img, true, true);
    result.rockGroup.refresh();
    result.rockObjects[id] = null;
    result.rockStateTints[id] = 0xffffff;
  }

  /**
   * Backt die Fels-Overlays neu: geschichtete Materialstoerung (NORMAL + MULTIPLY), Moos,
   * Kantenmatten und Decals.
   *
   * Alle vier Schichten folgen derselben Regel: Ihre Platzierung entsteht aus dem **vollstaendigen**
   * Felsbestand der Runde und wird nie neu ausgewuerfelt; neu gebacken wird ausschliesslich der
   * Schnitt auf den aktuellen Bestand. Ein zerstoerter Fels nimmt damit genau seinen eigenen Anteil
   * mit und laesst die uebrigen Flaechen Pixel fuer Pixel stehen.
   *
   * Bewusst ein Rebuild gebackener Layer und kein Live-Image pro Fels: dadurch bleiben die vielen
   * Varianten und Instanzen im Renderwalk je ein einziges Objekt.
   */
  static rebuildRockOverlays(
    scene: Phaser.Scene,
    result: ArenaBuilderResult,
    layout: ArenaLayout,
    worldFrame: RockWorldFrame = getArenaRockWorldFrame(),
  ): void {
    syncRockOverlaySource(result.rockOverlaySource, layout.rocks);
    const activeCells: RockCell[] = [];
    const activeRocks: Phaser.GameObjects.Image[] = [];
    for (let id = 0; id < layout.rocks.length; id += 1) {
      const img = result.rockObjects[id];
      if (!img?.active || !layout.rocks[id]) continue;
      activeCells.push(layout.rocks[id]);
      activeRocks.push(img);
    }

    const mottle = bakeBlobSurfaceMottle(
      scene,
      ROCK_BLOB_SURFACE_PROFILE,
      // Quelle ist der vollstaendige Bestand, Maske der lebende – nicht umgekehrt.
      result.rockOverlaySource.cells,
      activeRocks,
      {
        offsetX: worldFrame.offsetX,
        offsetY: worldFrame.offsetY,
        width: worldFrame.width,
        height: worldFrame.height,
        layerDepth: DEPTH.ROCKS,
      },
      result.rockMottleLayers,
      result.rockSilhouetteCutout,
    );
    result.rockMottleLayers = mottle.layers;
    result.rockSilhouetteCutout = mottle.silhouetteCutout;

    // Das Moos liegt zwischen Materialstoerung und Decals. Die Platzierung bleibt unberuehrt;
    // neu gebacken wird nur der Schnitt auf den aktuellen Bestand.
    const mossMasks = ArenaVisualFactory.createRockMossMasks(scene, activeRocks);
    const moss = bakeRockMossLayer(
      scene,
      result.rockMossPlacements,
      mossMasks,
      worldFrame,
      DEPTH.ROCK_MOSS,
      { layer: result.rockMossLayer, cutout: result.rockMossCutout },
    );
    result.rockMossLayer = moss.layer;
    result.rockMossCutout = moss.cutout;
    for (const mask of mossMasks) mask.destroy();

    // Die Kantenmatten liegen ueber allem Felsgebundenen. Auch hier bleibt die Platzierung
    // unberuehrt; neu gebacken wird nur der Schnitt auf den aktuellen Bestand.
    const vegetationMasks = ArenaVisualFactory.createRockVegetationMasks(scene, activeRocks);
    const vegetation = bakeRockVegetationLayer(
      scene,
      result.rockVegetationPlacements,
      vegetationMasks,
      worldFrame,
      DEPTH.ROCK_VEGETATION,
      { layer: result.rockVegetationLayer, cutout: result.rockVegetationCutout },
    );
    result.rockVegetationLayer = vegetation.layer;
    result.rockVegetationCutout = vegetation.cutout;
    for (const mask of vegetationMasks) mask.destroy();

    const activeCellKeys = collectRockCellKeys(activeCells);
    const fallenCells = collectFallenRockCells(result.rockOverlaySource, activeCellKeys);
    const decalImages = ArenaVisualFactory.createRockDecals(
      scene,
      ArenaBuilder.selectVisibleRockDecals(layout.decals ?? [], activeCellKeys),
      { offsetX: worldFrame.offsetX, offsetY: worldFrame.offsetY },
    );
    if (decalImages.length > 0) {
      const layer = result.rockDecalLayer ?? ArenaBuilder.createArenaLayer(scene, DEPTH.ROCK_DECALS, worldFrame);
      layer.clear();
      layer.draw(decalImages);
      layer.render();
      for (const image of decalImages) image.destroy();
      ArenaBuilder.eraseFallenRockDecals(scene, result, fallenCells, worldFrame, layer);
      result.rockDecalLayer = layer;
    } else {
      result.rockDecalLayer?.clear();
    }
  }

  /**
   * Welche Fels-Decals ueberhaupt gezeichnet werden – die **einzige** Auswahlregel, die Vollbake
   * und Chunk-Neubau gemeinsam benutzen. Zwei Regeln nebeneinander waeren genau der Riss, an dem
   * der erste lokale Neubau eine bis dahin anders gebackene Flaeche umspringen liesse.
   *
   * Eine `core`-Matte liegt per Konstruktion vollstaendig auf Fels (siehe
   * {@link ./DecalConfig.isEnclosedRockDecal}), fuer sie ist der geometrische Schnitt an der
   * weggefallenen Felsflaeche vollstaendig – sie bleibt also auch dann stehen, wenn ihre Ankerzelle
   * faellt, und verliert nur den Teil ueber der gefallenen Zelle.
   *
   * Jedes andere Fels-Decal darf die Kante seiner Ankerzelle ueberragen. Dieser Ueberhang liegt
   * ueber nie belegtem Boden, den keine Stanzform trifft; faellt die Ankerzelle, muss das Decal
   * deshalb ganz verschwinden, sonst bliebe ein Moosbogen frei auf dem Boden liegen.
   */
  private static isRockDecalVisible(decal: DecalCell, activeCellKeys: ReadonlySet<number>): boolean {
    if ((decal.surface ?? 'ground') !== 'rock') return false;
    if (isEnclosedRockDecal(decal.textureKey)) return true;
    return activeCellKeys.has(rockCellKey(decal));
  }

  private static selectVisibleRockDecals(
    decals: readonly DecalCell[],
    activeCellKeys: ReadonlySet<number>,
  ): DecalCell[] {
    return decals.filter((decal) => ArenaBuilder.isRockDecalVisible(decal, activeCellKeys));
  }

  /**
   * Schneidet aus dem gebackenen Fels-Decal-Layer die Flaeche gefallener Felsen heraus.
   *
   * Solange noch jede je belegte Zelle einen Fels traegt – der Normalfall beim Rundenaufbau –
   * entfaellt der Schnitt vollstaendig und die arenagrosse Stanzform wird gar nicht erst angelegt.
   * Genau deshalb ist der Vollbake ohne Zerstoerung mit dem Chunk-Neubau ohne Zerstoerung
   * pixelgleich: Beide zeichnen dieselbe Decal-Auswahl und radieren nichts.
   */
  private static eraseFallenRockDecals(
    scene: Phaser.Scene,
    result: ArenaBuilderResult,
    fallenCells: readonly RockCell[],
    worldFrame: RockWorldFrame,
    layer: Phaser.GameObjects.RenderTexture,
  ): void {
    if (fallenCells.length === 0) return;

    const cutout = result.rockDecalCutout
      ?? ArenaBuilder.createArenaLayer(scene, DEPTH.ROCK_DECALS, worldFrame);
    // 'redraw': Der Kommandopuffer wird geleert, die Stanzform selbst nie gezeichnet.
    cutout.setRenderMode('redraw');
    result.rockDecalCutout = cutout;
    fillRockDecalCutout(cutout, fallenCells);

    const cutoutImage = new Phaser.GameObjects.Image(scene, worldFrame.offsetX, worldFrame.offsetY, cutout.texture.key)
      .setOrigin(0, 0);
    layer.erase(cutoutImage);
    layer.render();
    cutoutImage.destroy();
  }

  /**
   * Backt nur die Chunks neu, deren sichtbares Ergebnis sich tatsaechlich aendern kann.
   * Die persistenten Arena-Layer bleiben bestehen; kleine Scratch-RenderTextures schneiden
   * Mottle und Decals exakt auf den Chunk zu und verhindern damit Doppel-Blending ausserhalb
   * der Dirty-Region.
   *
   * Der Chunk-Neubau ist nur deshalb ununterscheidbar vom Vollbake, weil die Platzierung aller
   * vier Schichten aus dem vollstaendigen Bestand entsteht: Ein Chunk zieht seine Quellzellen und
   * Platzierungen mitsamt Reichweite aus derselben unveraenderlichen Menge, aus der auch die
   * unberuehrten Nachbarchunks gebacken wurden.
   */
  static rebuildRockOverlayRegions(
    scene: Phaser.Scene,
    result: ArenaBuilderResult,
    layout: ArenaLayout,
    dirtyRockIds: ReadonlySet<number>,
    worldFrame: RockWorldFrame = getArenaRockWorldFrame(),
  ): void {
    if (dirtyRockIds.size === 0 || result.rockMottleLayers.length === 0) return;

    const addedSourceCells = syncRockOverlaySource(result.rockOverlaySource, layout.rocks);
    const dirtyCells: RockCell[] = [];
    for (const id of dirtyRockIds) {
      const cell = layout.rocks[id];
      if (cell) dirtyCells.push(cell);
    }
    const chunks = collectRockOverlayChunks(dirtyCells, addedSourceCells, worldFrame);
    if (chunks.length === 0) return;

    const scratch = ArenaBuilder.ensureRockOverlayScratch(scene, result);
    const configs = [ROCK_BLOB_SURFACE_PROFILE.mottle, ...(ROCK_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? [])];
    const reach = getBlobSurfaceMottleReachPx(ROCK_BLOB_SURFACE_PROFILE);
    const activeRockIds = new Set<number>();
    const activeCellKeys = new Set<number>();
    for (let id = 0; id < layout.rocks.length; id += 1) {
      const cell = layout.rocks[id];
      if (!cell || !result.rockObjects[id]?.active) continue;
      activeRockIds.add(id);
      activeCellKeys.add(rockCellKey(cell));
    }

    for (const chunk of chunks) {
      const worldX = worldFrame.offsetX + chunk.localX;
      const worldY = worldFrame.offsetY + chunk.localY;
      const chunkMaxX = chunk.localX + ROCK_OVERLAY_CHUNK_SIZE;
      const chunkMaxY = chunk.localY + ROCK_OVERLAY_CHUNK_SIZE;
      const silhouetteImages: Phaser.GameObjects.Image[] = [];
      const vegetationMaskImages: Phaser.GameObjects.Image[] = [];
      const scratchRockImages: Phaser.GameObjects.Image[] = [];

      for (const id of activeRockIds) {
        const cell = layout.rocks[id];
        const image = result.rockObjects[id];
        if (!cell || !image) continue;
        const cellMinX = cell.gridX * CELL_SIZE;
        const cellMinY = cell.gridY * CELL_SIZE;
        const cellMaxX = cellMinX + CELL_SIZE;
        const cellMaxY = cellMinY + CELL_SIZE;
        const intersectsSilhouette = cellMaxX > chunk.localX && cellMinX < chunkMaxX
          && cellMaxY > chunk.localY && cellMinY < chunkMaxY;
        // Die Reichweitenmaske ragt ueber ihre Zelle hinaus. Ein Fels im Nachbarchunk deckt
        // deshalb noch in diesen hinein; ohne den Rand fehlte an jeder Chunkgrenze ein Streifen.
        const intersectsVegetation = cellMaxX + ROCK_VEGETATION_MASK_MARGIN_PX > chunk.localX
          && cellMinX - ROCK_VEGETATION_MASK_MARGIN_PX < chunkMaxX
          && cellMaxY + ROCK_VEGETATION_MASK_MARGIN_PX > chunk.localY
          && cellMinY - ROCK_VEGETATION_MASK_MARGIN_PX < chunkMaxY;
        if (!intersectsSilhouette && !intersectsVegetation) continue;

        // Ab hier ist der Regional-Rebuild strikt chunklokal. Weltpositionierte Live-Felsen ueber
        // eine RenderTexture-Kamera einzulesen hat den Arena-Offset beim realen Phaser-Renderer
        // gegenueber dem Vollbake verschoben. Die kurzlebige Kopie traegt nur Alpha und Frame und
        // kann deshalb ohne Kamera exakt in 0..127 gezeichnet werden.
        const scratchRock = scene.add.image(
          cellMinX + CELL_SIZE * 0.5 - chunk.localX,
          cellMinY + CELL_SIZE * 0.5 - chunk.localY,
          image.texture.key,
          image.frame.name,
        ).setDisplaySize(CELL_SIZE, CELL_SIZE);
        scratchRockImages.push(scratchRock);
        if (intersectsSilhouette) silhouetteImages.push(scratchRock);
        if (intersectsVegetation) vegetationMaskImages.push(scratchRock);
      }

      // Die Materialquelle kommt aus dem vollstaendigen Bestand, nicht aus den lebenden Felsen: Die
      // Flecken eines gefallenen Felsens reichen bis zu `reach` weit auf seine Nachbarn, und wuerden
      // sie mit ihm verschwinden, spraenge dort das Material um. Die Decal-Stanzform dagegen traegt
      // ausschliesslich weggefallene Zellen – jede weitere Zelle wuerde Decal-Pixel auf einem
      // unveraenderten Fels loeschen.
      const sourceCells: RockCell[] = [];
      const decalCutoutCells: RockCell[] = [];
      for (const cell of result.rockOverlaySource.cells) {
        const cellMinX = cell.gridX * CELL_SIZE;
        const cellMinY = cell.gridY * CELL_SIZE;
        const cellMaxX = cellMinX + CELL_SIZE;
        const cellMaxY = cellMinY + CELL_SIZE;
        if (cellMaxX + reach > chunk.localX && cellMinX - reach < chunkMaxX
          && cellMaxY + reach > chunk.localY && cellMinY - reach < chunkMaxY) {
          sourceCells.push(cell);
        }
        if (cellMaxX > chunk.localX && cellMinX < chunkMaxX
          && cellMaxY > chunk.localY && cellMinY < chunkMaxY
          && !activeCellKeys.has(rockCellKey(cell))) {
          decalCutoutCells.push(cell);
        }
      }

      scratch.cutout.camera.setScroll(0, 0);
      scratch.cutout.clear();
      scratch.cutout.fill(0x000000, 1);
      if (silhouetteImages.length > 0) scratch.cutout.erase(silhouetteImages);
      scratch.cutout.render();

      for (let layerIndex = 0; layerIndex < configs.length; layerIndex += 1) {
        const layer = result.rockMottleLayers[layerIndex];
        const scratchLayer = scratch.mottleLayers[layerIndex];
        if (!layer || !scratchLayer) continue;
        scratchLayer.clear();
        stampBlobSurfaceMottle(
          scene,
          scratchLayer,
          ROCK_BLOB_SURFACE_PROFILE,
          configs[layerIndex],
          sourceCells,
          layerIndex,
          -chunk.localX,
          -chunk.localY,
        );
        scratchLayer.render();
        ArenaBuilder.eraseRockOverlayScratch(scratchLayer, scratch.cutout);
        scratchLayer.render();

        ArenaBuilder.blitRockOverlayChunk(layer, scratchLayer, chunk);
      }

      // Die Verlaufsmasken entstehen aus denselben Fels-Images, die schon die harte Stanzform
      // getragen haben: Eine Fels-Kachel liegt bei 128er-Chunks und 32er-Zellen immer vollstaendig
      // in genau einem Chunk, der Satz ist also vollstaendig.
      const maskImages = ArenaVisualFactory.createRockMossMasks(scene, silhouetteImages);
      ArenaBuilder.rebuildRockMossRegion(scene, result, chunk, worldX, worldY, maskImages, scratch);
      for (const mask of maskImages) mask.destroy();

      const vegetationMasks = ArenaVisualFactory.createRockVegetationMasks(scene, vegetationMaskImages);
      ArenaBuilder.rebuildRockVegetationRegion(scene, result, chunk, worldX, worldY, vegetationMasks, scratch);
      for (const mask of vegetationMasks) mask.destroy();

      ArenaBuilder.rebuildRockDecalRegion(
        scene,
        result,
        layout,
        chunk,
        decalCutoutCells,
        activeCellKeys,
        scratch,
        worldFrame,
      );
      for (const image of scratchRockImages) image.destroy();
    }
  }

  /**
   * Backt die Moosschicht eines einzelnen Chunks neu.
   *
   * Die Platzierung wird dabei nie angefasst – gefiltert wird nur, welche der unveraenderlichen
   * Flecken in den Chunk hineinreichen. Neu ist ausschliesslich die Stanzform, die sich aus der
   * inzwischen geaenderten Felssilhouette ergibt.
   */
  private static rebuildRockMossRegion(
    scene: Phaser.Scene,
    result: ArenaBuilderResult,
    chunk: RockOverlayChunk,
    worldX: number,
    worldY: number,
    maskImages: readonly Phaser.GameObjects.Image[],
    scratch: RockOverlayScratch,
  ): void {
    const layer = result.rockMossLayer;
    if (!layer) return;

    const chunkMaxX = chunk.localX + ROCK_OVERLAY_CHUNK_SIZE;
    const chunkMaxY = chunk.localY + ROCK_OVERLAY_CHUNK_SIZE;
    const localPlacements = result.rockMossPlacements.filter((placement) => {
      const radius = getRockMossPlacementRadiusPx(placement);
      const localX = placement.worldX - (worldX - chunk.localX);
      const localY = placement.worldY - (worldY - chunk.localY);
      return localX + radius > chunk.localX && localX - radius < chunkMaxX
        && localY + radius > chunk.localY && localY - radius < chunkMaxY;
    });

    scratch.mossCutout.camera.setScroll(0, 0);
    fillRockMossCutout(scratch.mossCutout, maskImages);

    scratch.moss.clear();
    if (localPlacements.length > 0) {
      stampRockMoss(scene, scratch.moss, localPlacements, -worldX, -worldY);
      scratch.moss.render();
      ArenaBuilder.eraseRockOverlayScratch(scratch.moss, scratch.mossCutout);
    }
    // Muss auch ohne Platzierungen laufen: `clear()` ist ein gepufferter Befehl, der erst hier
    // ausgefuehrt wird. Ohne diesen Aufruf traegt das Scratch-Ziel beim naechsten `draw` noch den
    // Inhalt des zuvor bearbeiteten Chunks – sichtbar als Moos auf leerem Boden.
    scratch.moss.render();

    ArenaBuilder.blitRockOverlayChunk(layer, scratch.moss, chunk);
  }

  /**
   * Backt die Vegetationsschicht eines einzelnen Chunks neu – Gegenstueck zu
   * {@link rebuildRockMossRegion} mit derselben Regel: Die Matten selbst werden nie angefasst,
   * gefiltert wird nur, welche der unveraenderlichen Platzierungen in den Chunk hineinreichen.
   * Neu ist ausschliesslich die Stanzform aus der inzwischen geaenderten Felssilhouette.
   */
  private static rebuildRockVegetationRegion(
    scene: Phaser.Scene,
    result: ArenaBuilderResult,
    chunk: RockOverlayChunk,
    worldX: number,
    worldY: number,
    maskImages: readonly Phaser.GameObjects.Image[],
    scratch: RockOverlayScratch,
  ): void {
    const layer = result.rockVegetationLayer;
    if (!layer) return;

    const chunkMaxX = chunk.localX + ROCK_OVERLAY_CHUNK_SIZE;
    const chunkMaxY = chunk.localY + ROCK_OVERLAY_CHUNK_SIZE;
    const localPlacements = result.rockVegetationPlacements.filter((placement) => {
      const radius = getRockVegetationPlacementRadiusPx(placement);
      const localX = placement.worldX - (worldX - chunk.localX);
      const localY = placement.worldY - (worldY - chunk.localY);
      return localX + radius > chunk.localX && localX - radius < chunkMaxX
        && localY + radius > chunk.localY && localY - radius < chunkMaxY;
    });

    scratch.vegetationCutout.camera.setScroll(0, 0);
    fillRockVegetationCutout(scratch.vegetationCutout, maskImages);

    scratch.vegetation.clear();
    if (localPlacements.length > 0) {
      stampRockVegetation(scene, scratch.vegetation, localPlacements, -worldX, -worldY);
      scratch.vegetation.render();
      ArenaBuilder.eraseRockOverlayScratch(scratch.vegetation, scratch.vegetationCutout);
    }
    // Wie beim Moos: Der Leerbefehl wird erst hier ausgefuehrt, und ohne ihn landet der Inhalt des
    // vorigen Chunks in diesem.
    scratch.vegetation.render();

    ArenaBuilder.blitRockOverlayChunk(layer, scratch.vegetation, chunk);
  }

  /** Schreibt ein rein chunklokales Scratch-Ziel ohne Arena-Offset in den arenaweiten Layer. */
  private static blitRockOverlayChunk(
    layer: Phaser.GameObjects.RenderTexture,
    scratch: Phaser.GameObjects.RenderTexture,
    chunk: RockOverlayChunk,
  ): void {
    const scrollX = layer.camera.scrollX;
    const scrollY = layer.camera.scrollY;
    // Der WebGL-Pfad hat den Texture-Stamp entgegen dem abstrakten Phaser-Vertrag mit der
    // RenderTexture-Kamera ausgefuehrt. Deshalb muss nicht nur der Scratch-Inhalt lokal sein,
    // sondern auch die Zielkamera waehrend des gepufferten clear/stamp/render-Zyklus neutral.
    layer.camera.setScroll(0, 0);
    try {
      layer.clear(chunk.localX, chunk.localY, ROCK_OVERLAY_CHUNK_SIZE, ROCK_OVERLAY_CHUNK_SIZE);
      layer.stamp(scratch.texture.key, undefined, chunk.localX, chunk.localY, {
        originX: 0,
        originY: 0,
      });
      layer.render();
    } finally {
      layer.camera.setScroll(scrollX, scrollY);
    }
  }

  /** Schneidet ein chunklokales Scratch-Ziel mit einer chunklokalen, kameraunabhaengigen Textur. */
  private static eraseRockOverlayScratch(
    target: Phaser.GameObjects.RenderTexture,
    cutout: Phaser.GameObjects.RenderTexture,
  ): void {
    const center = ROCK_OVERLAY_CHUNK_SIZE * 0.5;
    // `erase()` delegiert Strings an `stamp()`: anders als ein Image-GameObject ignoriert die
    // Textur damit `target.camera`. Der Default-Origin 0.5 legt die 128er Cutout-Textur bei
    // (64, 64) exakt auf die chunklokale Flaeche 0..127.
    target.erase(cutout.texture.key, center, center);
  }

  private static ensureRockOverlayScratch(scene: Phaser.Scene, result: ArenaBuilderResult): RockOverlayScratch {
    if (result.rockOverlayScratch) return result.rockOverlayScratch;
    const makeScratch = (): Phaser.GameObjects.RenderTexture => {
      const target = scene.add.renderTexture(0, 0, ROCK_OVERLAY_CHUNK_SIZE, ROCK_OVERLAY_CHUNK_SIZE);
      target.setOrigin(0, 0);
      target.setVisible(false);
      return target;
    };
    const cutout = makeScratch();
    const mottleLayers = [ROCK_BLOB_SURFACE_PROFILE.mottle, ...(ROCK_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? [])]
      .map(() => makeScratch());
    const mossCutout = makeScratch();
    mossCutout.setRenderMode('redraw');
    const vegetationCutout = makeScratch();
    vegetationCutout.setRenderMode('redraw');
    const decalCutout = makeScratch();
    decalCutout.setRenderMode('redraw');
    result.rockOverlayScratch = {
      cutout,
      mottleLayers,
      decal: makeScratch(),
      decalCutout,
      moss: makeScratch(),
      mossCutout,
      vegetation: makeScratch(),
      vegetationCutout,
    };
    return result.rockOverlayScratch;
  }

  /**
   * Backt die Fels-Decals eines einzelnen Chunks neu.
   *
   * Die Darstellungslogik ist bis auf den Ausschnitt dieselbe wie beim Vollbake: dieselbe Auswahl
   * ueber {@link isRockDecalVisible}, dieselben Bilder aus {@link ArenaVisualFactory.createRockDecals}
   * in derselben Layout-Reihenfolge, danach derselbe Schnitt an der weggefallenen Felsflaeche aus
   * {@link ./RockDecalLayer}. Ohne Zerstoerung im Chunk ist das Ergebnis damit Pixel fuer Pixel
   * das, was schon dort stand; mit Zerstoerung unterscheidet es sich genau um deren Zellquadrate.
   *
   * Die zusaetzliche Filterung gilt allein der Chunk-Ueberschneidung. Sie benutzt dieselbe
   * Ersatzgroesse wie die Bildfabrik, sonst faellt ein Decal aus dem Neubau, das der Vollbake
   * gezeichnet hatte.
   */
  private static rebuildRockDecalRegion(
    scene: Phaser.Scene,
    result: ArenaBuilderResult,
    layout: ArenaLayout,
    chunk: RockOverlayChunk,
    decalCutoutCells: readonly RockCell[],
    activeCellKeys: ReadonlySet<number>,
    scratch: RockOverlayScratch,
    worldFrame: RockWorldFrame,
  ): void {
    const candidates = (layout.decals ?? []).filter((decal) => {
      if (!ArenaBuilder.isRockDecalVisible(decal, activeCellKeys)) return false;
      const radius = (decal.displaySize ?? ROCK_DECAL_SIZE) * Math.SQRT1_2;
      const centerX = decal.gridX * CELL_SIZE + CELL_SIZE / 2 + decal.offsetX;
      const centerY = decal.gridY * CELL_SIZE + CELL_SIZE / 2 + decal.offsetY;
      return centerX + radius > chunk.localX
        && centerX - radius < chunk.localX + ROCK_OVERLAY_CHUNK_SIZE
        && centerY + radius > chunk.localY
        && centerY - radius < chunk.localY + ROCK_OVERLAY_CHUNK_SIZE;
    });
    if (candidates.length === 0 && !result.rockDecalLayer) return;

    const layer = result.rockDecalLayer
      ?? ArenaBuilder.createArenaLayer(scene, DEPTH.ROCK_DECALS, worldFrame);
    result.rockDecalLayer = layer;

    const images = ArenaVisualFactory.createRockDecals(
      scene,
      candidates,
      { offsetX: -chunk.localX, offsetY: -chunk.localY },
    );
    scratch.decal.camera.setScroll(0, 0);
    scratch.decal.clear();
    if (images.length > 0) {
      scratch.decal.draw(images);
      scratch.decal.render();

      if (decalCutoutCells.length > 0) {
        fillRockDecalCutout(scratch.decalCutout, decalCutoutCells, -chunk.localX, -chunk.localY);
        ArenaBuilder.eraseRockOverlayScratch(scratch.decal, scratch.decalCutout);
      }
    }
    scratch.decal.render();
    for (const image of images) image.destroy();

    ArenaBuilder.blitRockOverlayChunk(layer, scratch.decal, chunk);
  }

  /** Arenagrosse RenderTexture in Weltkoordinaten – gemeinsame Grundlage aller gebackenen Layer. */
  private static createArenaLayer(
    scene: Phaser.Scene,
    depth: number,
    worldFrame: RockWorldFrame = getArenaRockWorldFrame(),
  ): Phaser.GameObjects.RenderTexture {
    const layer = scene.add.renderTexture(worldFrame.offsetX, worldFrame.offsetY, worldFrame.width, worldFrame.height);
    layer.setOrigin(0, 0);
    layer.setDepth(depth);
    layer.camera.setScroll(worldFrame.offsetX, worldFrame.offsetY);
    return layer;
  }

  // ── Teardown ────────────────────────────────────────────────────────────────

  /**
   * Zerstört alle dynamisch erstellten Objekte (Felsen, Trunks, Canopies).
   * Sidebars/Gras bleiben erhalten (diese sind statisch).
   */
  static destroyDynamic(result: ArenaBuilderResult): void {
    for (const zone of result.baseZoneObjects) {
      if (zone.active) zone.destroy();
    }
    result.baseZoneObjects.length = 0;

    // Felsen
    for (const img of result.rockObjects) {
      if (img?.active) img.destroy();
    }
    result.rockObjects.length = 0;
    result.rockStateTints.length = 0;
    result.rockGroup.destroy(true);

    // Trunks
    for (const trunk of result.trunkObjects) {
      if (trunk.active) trunk.destroy();
    }
    result.trunkObjects.length = 0;
    result.trunkGroup.destroy(true);

    // Canopies
    for (const { gfx } of result.canopyObjects) {
      if (gfx.active) gfx.destroy();
    }
    result.canopyObjects.length = 0;

    // Gleise
    for (const ts of result.trackObjects) {
      if (ts.active) ts.destroy();
    }
    result.trackObjects.length = 0;

    // Dirt (gebackene RenderTexture + Kachel-Geometrie)
    if (result.dirtLayer?.active) result.dirtLayer.destroy();
    result.dirtLayer = null;
    result.dirtStamps.length = 0;

    // Moosschicht (gebackene RenderTexture + Stamp-Geometrie)
    if (result.groundCoverLayer?.active) result.groundCoverLayer.destroy();
    result.groundCoverLayer = null;
    result.groundCoverStamps.length = 0;

    // Decals (gebackene RenderTexture + Stamp-Geometrie)
    if (result.decalLayer?.active) result.decalLayer.destroy();
    result.decalLayer = null;
    result.decalStamps.length = 0;

    if (result.rockDecalLayer?.active) result.rockDecalLayer.destroy();
    result.rockDecalLayer = null;
    if (result.rockDecalCutout?.active) result.rockDecalCutout.destroy();
    result.rockDecalCutout = null;
    result.rockOverlaySource.cells.length = 0;
    result.rockOverlaySource.keys.clear();

    if (result.rockMossLayer?.active) result.rockMossLayer.destroy();
    result.rockMossLayer = null;
    if (result.rockMossCutout?.active) result.rockMossCutout.destroy();
    result.rockMossCutout = null;
    result.rockMossPlacements.length = 0;

    if (result.rockVegetationLayer?.active) result.rockVegetationLayer.destroy();
    result.rockVegetationLayer = null;
    if (result.rockVegetationCutout?.active) result.rockVegetationCutout.destroy();
    result.rockVegetationCutout = null;
    result.rockVegetationPlacements.length = 0;

    for (const layer of result.rockMottleLayers) {
      if (layer.active) layer.destroy();
    }
    result.rockMottleLayers = [];

    if (result.rockSilhouetteCutout?.active) result.rockSilhouetteCutout.destroy();
    result.rockSilhouetteCutout = null;

    if (result.rockOverlayScratch) {
      result.rockOverlayScratch.cutout.destroy();
      for (const layer of result.rockOverlayScratch.mottleLayers) layer.destroy();
      result.rockOverlayScratch.decal.destroy();
      result.rockOverlayScratch.decalCutout.destroy();
      result.rockOverlayScratch.moss.destroy();
      result.rockOverlayScratch.mossCutout.destroy();
      result.rockOverlayScratch.vegetation.destroy();
      result.rockOverlayScratch.vegetationCutout.destroy();
      result.rockOverlayScratch = null;
    }
  }

  // ── Private Factory-Methoden ───────────────────────────────────────────────

  /**
   * Erstellt einen Felsen-Sprite aus dem Autotile-Spritesheet.
   */
  private createRockVisual(worldX: number, worldY: number, frame: number, cornerTints?: BlobSurfaceCornerTints): Phaser.GameObjects.Image {
    return ArenaVisualFactory.createRock(this.scene, worldX, worldY, frame, cornerTints);
  }

  private static createRockVisual(
    scene: Phaser.Scene,
    worldX: number,
    worldY: number,
    frame: number,
    cornerTints?: BlobSurfaceCornerTints,
  ): Phaser.GameObjects.Image {
    return ArenaVisualFactory.createRock(scene, worldX, worldY, frame, cornerTints);
  }

  private static mixTint(baseColor: number, ownerColor?: number, strength = 0): number {
    if (ownerColor === undefined || strength <= 0) return baseColor;
    const mix = Phaser.Math.Clamp(strength, 0, 1);
    const baseRed = (baseColor >> 16) & 0xff;
    const baseGreen = (baseColor >> 8) & 0xff;
    const baseBlue = baseColor & 0xff;
    const ownerRed = (ownerColor >> 16) & 0xff;
    const ownerGreen = (ownerColor >> 8) & 0xff;
    const ownerBlue = ownerColor & 0xff;
    const red = Math.round(baseRed + (ownerRed - baseRed) * mix);
    const green = Math.round(baseGreen + (ownerGreen - baseGreen) * mix);
    const blue = Math.round(baseBlue + (ownerBlue - baseBlue) * mix);
    return (red << 16) | (green << 8) | blue;
  }

  /**
   * Erstellt den Baumstumpf-Sprite (aktuell: Arc/Kreis).
   * Kann später durch `this.scene.add.image(...)` ersetzt werden.
   */
  private createTrunkVisual(worldX: number, worldY: number): Phaser.GameObjects.Arc {
    return ArenaVisualFactory.createTrunk(this.scene, worldX, worldY);
  }

  /**
   * Erstellt die Baumkronen-Grafik als Image-Sprite (192×192 px = CANOPY_RADIUS * 2).
   */
  private createCanopyVisual(worldX: number, worldY: number): Phaser.GameObjects.Image {
    return ArenaVisualFactory.createCanopy(this.scene, worldX, worldY);
  }

  private createDecalVisual(
    worldX: number,
    worldY: number,
    textureKey: DecalCell['textureKey'],
  ): Phaser.GameObjects.Image {
    const img = this.scene.add.image(worldX, worldY, textureKey);
    img.setDisplaySize(DECAL_SIZE, DECAL_SIZE);
    img.setDepth(DEPTH.DECALS);
    return img;
  }

  private buildCaptureTheBeerBaseZones(): Phaser.GameObjects.Rectangle[] {
    if (!isCaptureTheBeerBaseModeActive()) return [];

    return [
      this.createBaseZoneVisual(
        getCaptureTheBeerBaseWorldBounds('blue'),
        CAPTURE_THE_BEER_BLUE_BASE_TINT,
        CAPTURE_THE_BEER_BASE_TINT_ALPHA,
      ),
      this.createBaseZoneVisual(
        getCaptureTheBeerBaseWorldBounds('red'),
        CAPTURE_THE_BEER_RED_BASE_TINT,
        CAPTURE_THE_BEER_BASE_TINT_ALPHA,
      ),
    ];
  }

  private createBaseZoneVisual(
    bounds: { x: number; y: number; width: number; height: number },
    color: number,
    alpha: number,
  ): Phaser.GameObjects.Rectangle {
    const rect = this.scene.add.rectangle(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      bounds.width,
      bounds.height,
      color,
      alpha,
    );
    rect.setDepth(DEPTH.BASES);
    return rect;
  }

  // ── Dirt ───────────────────────────────────────────────────────────────────

  /**
   * Baut die Dirt-Kacheln mit Autotiling, backt sie einmalig in eine arenagroße RenderTexture und
   * verwirft danach die Einzel-Images. Ergebnis ist ein einziges Display-Objekt plus die
   * Kachel-Geometrie für den Terrain-Sampler.
   *
   * Die Bilder tragen ihre Weltkoordinaten; die interne Kamera der RenderTexture wird um den
   * Arena-Offset gescrollt, damit `draw()` sie an der richtigen Stelle in die (am Offset
   * positionierte) Textur legt. Die Bilder existieren nur zwischen Erzeugung und Backen innerhalb
   * dieses synchronen Aufrufs, rendern also nie einzeln sichtbar.
   */
  private bakeDirt(dirtCells: DirtCell[]): { dirtLayer: Phaser.GameObjects.RenderTexture | null; dirtStamps: DirtStamp[] } {
    const { fringe, surface: images } = ArenaVisualFactory.createDirtImages(this.scene, dirtCells);
    if (images.length === 0) return { dirtLayer: null, dirtStamps: [] };

    // Die Randfahne steht vorn, weil der Sampler die Stamps in genau dieser Reihenfolge
    // nachzeichnet und die scharfe Flaeche sie ueberdecken muss.
    const dirtStamps: DirtStamp[] = [...fringe, ...images].map((img) => ({
      textureKey: img.texture.key,
      frameName: img.frame.name,
      x: img.x,
      y: img.y,
      displayWidth: img.displayWidth,
      displayHeight: img.displayHeight,
      rotation: img.rotation,
      alpha: img.alpha,
    }));

    const dirtLayer = this.scene.add.renderTexture(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
    dirtLayer.setOrigin(0, 0);
    dirtLayer.setDepth(DEPTH.DIRT);
    dirtLayer.camera.setScroll(ARENA_OFFSET_X, ARENA_OFFSET_Y);
    dirtLayer.draw(fringe);
    dirtLayer.draw(images);
    dirtLayer.render();

    // Dirt remains a single persistent object: ordered generic Normal + Multiply material
    // layers and their shared silhouette cutout are flattened, then immediately freed.
    const dirtMottle = bakeBlobSurfaceMottle(
      this.scene,
      DIRT_BLOB_SURFACE_PROFILE,
      dirtCells,
      images,
      { offsetX: ARENA_OFFSET_X, offsetY: ARENA_OFFSET_Y, width: ARENA_WIDTH, height: ARENA_HEIGHT, layerDepth: DEPTH.DIRT },
    );
    for (const layer of dirtMottle.layers) {
      dirtLayer.draw(layer);
      dirtLayer.render();
      layer.destroy();
    }
    dirtMottle.silhouetteCutout?.destroy();

    for (const img of fringe) img.destroy();
    for (const img of images) img.destroy();

    return { dirtLayer, dirtStamps };
  }

  /**
   * Backt die statischen Decals nach demselben Muster wie {@link bakeDirt}. Decals sind rein
   * visuell und werden zur Laufzeit nie verändert, getintet oder entfernt – die einzige
   * Live-Abhängigkeit war der Terrain-Farb-Sampler, der stattdessen die Stamps erhält.
   * Blut-Decals sind davon nicht betroffen: Sie entstehen dynamisch im Kampf und bleiben
   * eigene Objekte.
   */
  private bakeDecals(decals: DecalCell[]): { decalLayer: Phaser.GameObjects.RenderTexture | null; decalStamps: DirtStamp[] } {
    const images = this.buildDecals(decals);
    if (images.length === 0) return { decalLayer: null, decalStamps: [] };

    const decalStamps: DirtStamp[] = images.map((img) => ({
      textureKey: img.texture.key,
      frameName: img.frame.name,
      x: img.x,
      y: img.y,
      displayWidth: img.displayWidth,
      displayHeight: img.displayHeight,
      rotation: img.rotation,
      alpha: img.alpha,
    }));

    const decalLayer = this.scene.add.renderTexture(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
    decalLayer.setOrigin(0, 0);
    decalLayer.setDepth(DEPTH.DECALS);
    decalLayer.camera.setScroll(ARENA_OFFSET_X, ARENA_OFFSET_Y);
    decalLayer.draw(images);
    decalLayer.render();

    for (const img of images) img.destroy();

    return { decalLayer, decalStamps };
  }

  private buildDecals(decals: DecalCell[]): Phaser.GameObjects.Image[] {
    return ArenaVisualFactory.createDecals(this.scene, decals);
  }

  /**
   * Backt die prozedurale Moosschicht. Die Platzierung leitet sich allein aus `layout.seed` und
   * `layout.dirt` ab, ist also auf Host und Clients identisch, ohne dass etwas zusaetzlich
   * uebertragen werden muesste.
   *
   * Die Arena-Metriken werden hier gelesen und nicht zwischengespeichert: `ARENA_*` und `GRID_*`
   * sind zur Laufzeit veraenderlich (breite Coop-Karten, Capture the Beer).
   */
  private bakeGroundCover(layout: ArenaLayout): {
    groundCoverLayer: Phaser.GameObjects.RenderTexture | null;
    groundCoverStamps: DirtStamp[];
  } {
    const placements = generateGroundCoverPlacements({
      seed: layout.seed,
      dirt: layout.dirt ?? [],
      metrics: {
        offsetX: ARENA_OFFSET_X,
        offsetY: ARENA_OFFSET_Y,
        gridCols: GRID_COLS,
        gridRows: GRID_ROWS,
      },
    });
    const { layer, stamps } = bakeGroundCoverLayer(
      this.scene,
      placements,
      getArenaRockWorldFrame(),
      DEPTH.GROUND_COVER,
    );
    return { groundCoverLayer: layer, groundCoverStamps: stamps };
  }

  // ── Gleise ────────────────────────────────────────────────────────────────

  /**
   * Gruppiert TrackCells nach Spalte und erstellt pro Spalte einen TileSprite.
   * Gleise sind rein visuell (keine Physik-Gruppe), da sie begehbar sind.
   */
  private buildTracks(tracks: TrackCell[]): Phaser.GameObjects.TileSprite[] {
    return ArenaVisualFactory.createTracks(this.scene, tracks);
  }

  /**
   * Erstellt einen TileSprite für eine vollständige Gleis-Spalte.
   * Die Textur 'bg_tracks' (64×32 px) passt exakt auf 2 Zellen Breite
   * und wird vertikal ohne Skalierung pro 32 px Zeile gekachelt.
   */
  private createTrackColumnVisual(col: number, rowCount: number): Phaser.GameObjects.TileSprite {
    const w = CELL_SIZE * 2;
    const h = rowCount * CELL_SIZE;
    const cx = ARENA_OFFSET_X + col * CELL_SIZE + w / 2;
    const cy = ARENA_OFFSET_Y + h / 2;

    const ts = this.scene.add.tileSprite(cx, cy, w, h, 'bg_tracks');
    ts.setDepth(DEPTH.TRACKS);
    return ts;
  }

  // ── Statische Interna ──────────────────────────────────────────────────────

  private ensureSidebars(): void {
    if (!this.leftSidebar) {
      this.leftSidebar = this.scene.add
        .rectangle(ARENA_OFFSET_X * 0.5, GAME_HEIGHT * 0.5, ARENA_OFFSET_X, GAME_HEIGHT, COLORS.GREY_10)
        .setScrollFactor(0)
        .setDepth(DEPTH.LOCAL_UI - 1);
      // Undurchsichtige Rahmen sind Bildschirmchrome, keine Welt: ein Color-Grading würde sie
      // mit der Tageszeit umfärben, was für einen statischen Rahmen falsch aussieht.
      promoteToClarityCamera(this.scene, this.leftSidebar);
    }

    if (!this.rightSidebar) {
      this.rightSidebar = this.scene.add
        .rectangle(
          GAME_WIDTH - ARENA_OFFSET_X * 0.5,
          GAME_HEIGHT * 0.5,
          ARENA_OFFSET_X,
          GAME_HEIGHT,
          COLORS.GREY_9,
        )
        .setScrollFactor(0)
        .setDepth(DEPTH.LOCAL_UI - 1);
      promoteToClarityCamera(this.scene, this.rightSidebar);
    }
  }

  private ensureArenaBackground(): void {
    if (this.arenaBackground) return;
    this.arenaBackground = this.scene.add
      .tileSprite(
        ARENA_OFFSET_X + ARENA_WIDTH * 0.5,
        ARENA_OFFSET_Y + ARENA_HEIGHT * 0.5,
        ARENA_WIDTH,
        ARENA_HEIGHT,
        ARENA_BACKGROUND_TEXTURE_KEY,
      )
      .setDepth(DEPTH.GRASS);

    // Knapp über dem Gras und deutlich unter DEPTH.DIRT: die Multiply-Ebene darf ausschließlich
    // das Gras einfärben, nicht den Dirt-Boden oder die Decals darüber.
    this.arenaBackgroundDetail = this.scene.add
      .tileSprite(
        ARENA_OFFSET_X + ARENA_WIDTH * 0.5,
        ARENA_OFFSET_Y + ARENA_HEIGHT * 0.5,
        ARENA_WIDTH,
        ARENA_HEIGHT,
        ARENA_BACKGROUND_DETAIL_TEXTURE_KEY,
      )
      .setDepth(DEPTH.GRASS + 0.01)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  private ensureLobbyBackground(): void {
    if (this.lobbyBackground) return;
    this.lobbyBackground = this.scene.add
      .image(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, 'lobby_bg')
      .setScrollFactor(0)
      .setDepth(DEPTH.GRASS);
  }

  private setPhysicsBounds(): void {
    this.scene.physics.world.setBounds(
      ARENA_OFFSET_X,
      ARENA_OFFSET_Y,
      ARENA_WIDTH,
      ARENA_HEIGHT,
    );
  }
}
