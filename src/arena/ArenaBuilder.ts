import * as Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_STATIC_FRAMES_VISIBLE,
  DEPTH, COLORS,
  CELL_SIZE, TRUNK_RADIUS, CANOPY_RADIUS, CANOPY_ALPHA_PLAYER, ROCK_HP_MAX, ROCK_TINT_STEPS,
  CAPTURE_THE_BEER_BASE_TINT_ALPHA,
  CAPTURE_THE_BEER_BLUE_BASE_TINT,
  CAPTURE_THE_BEER_RED_BASE_TINT,
  getCaptureTheBeerBaseWorldBounds,
  isCaptureTheBeerBaseModeActive,
} from '../config';
import { CAPTURE_THE_BEER_MODE } from '../gameModes';
import type { ArenaLayout, RockCell, TrackCell, GameMode, GamePhase } from '../types';
import type { WorldMetrics } from '../world/WorldMetrics';
import { AutoTiler, ROCK_AUTOTILE } from './AutoTiler';
import { ArenaVisualFactory } from './ArenaVisualFactory';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { ROCK_BLOB_SURFACE_PROFILE } from './BlobSurfaceProfile';
import { resolveBlobSurfaceCornerTints } from './BlobSurfaceShading';
import type { BlobSurfaceCornerTints } from './BlobSurfaceShading';
import { createRockOverlaySource, syncRockOverlaySource } from './RockOverlayRegions';
import type { RockOverlaySource } from './RockOverlayRegions';
import { generateGroundCoverPlacements } from './GroundCoverField';
import type { GroundCoverPlacement } from './GroundCoverField';
import { generateRockMossPlacements } from './RockMossField';
import type { RockMossPlacement } from './RockMossField';
import { generateRockVegetationPlacements } from './RockVegetationField';
import type { RockVegetationPlacement } from './RockVegetationField';
import { RockGridIndex } from './RockGridIndex';
import { GroundSurfaceStreamer } from './chunks/GroundSurfaceStreamer';
import type { GroundSurfacePersistentBaseGravelZone } from './chunks/GroundSurfaceStreamer';
import { RockOverlayStreamer } from './chunks/RockOverlayStreamer';
import type { ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { createRockPhysicsProxy, type RockPhysicsProxy } from './rocks/RockPhysicsProxy';
import { createTreePhysicsProxy, type TreePhysicsProxy } from './trees/TreePhysicsProxy';
import { RockVisualStateStore, type RockVisualState } from './rocks/RockVisualState';
import { RockVisualSystem } from './rocks/RockVisualSystem';
import { getRockGpuPageSize, getRockRendererMode } from './rocks/RockRendererSettings';
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
  /** StaticGroup mit nicht rendernden Fels-Proxies. */
  rockGroup:    Phaser.Physics.Arcade.StaticGroup;
  /** Paralleles Array zu layout.rocks; null bedeutet physisch nicht vorhanden. */
  rockPhysicsProxies: (RockPhysicsProxy | null)[];
  /** Rendererunabhaengige Source of Truth samt dedupliziertem Dirty-Trichter. */
  rockVisualStates: RockVisualStateStore;
  /** Umschaltbarer Classic-/SpriteGPU-Consumer der Visual States. */
  rockVisualSystem: RockVisualSystem | null;
  /** Spatial Index für Grid-basierte Nachbar-Lookups (Autotiling) */
  rockGrid:     RockGridIndex;
  /** StaticGroup mit nicht rendernden Baumstamm-Proxies. */
  trunkGroup:   Phaser.Physics.Arcade.StaticGroup;
  /**
   * Kanonische Runtime der Baeume: Position, Radius und Kollision. Hitscan-, Melee- und
   * Hindernisabfragen lesen ausschliesslich hier - nie am sichtbaren Stamm.
   */
  trunkBodies: TreePhysicsProxy[];
  /** Sichtbare Staemme; reine Darstellung ueber der Runtime und ohne sie entbehrlich. */
  trunkVisuals: Phaser.GameObjects.Arc[];
  /** Baumkronen-Sprites für Transparenz-Update; ebenfalls reine Darstellung. */
  canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }>;
  /** Gleis-TileSprites (eine pro Gleis-Spalte, nur visuell, keine Kollision) */
  trackObjects: Phaser.GameObjects.TileSprite[];
  /**
   * Die gestreamten statischen Bodenbaender: Dirt samt eingebackener Materialstoerung, optionaler
   * Persistent-Base-Kies, Ground Cover und die statischen Decals.
   *
   * Alle Schichten lagen frueher in je einer arenagrossen RenderTexture. Sie liegen jetzt in
   * Render-Chunks, von denen nur die kameranahen existieren – die GPU-Kosten folgen damit dem
   * sichtbaren Ausschnitt statt der Weltflaeche (siehe {@link ./chunks/GroundSurfaceStreamer}).
   */
  groundSurface: GroundSurfaceStreamer | null;
  /**
   * Die Ground-Cover-Platzierungen der Runde. Einmalig aus `layout.seed` und `layout.dirt`
   * erzeugt und danach unveraendert: Sie sind die Quelle jedes Chunk-Bakes und muessen deshalb
   * ueber die gesamte Runde dieselben bleiben, sonst spraenge die Schicht beim Wiederbetreten.
   */
  groundCoverPlacements: GroundCoverPlacement[];
  /**
   * Die gestreamten felsgebundenen Overlays: Materialstoerung, Moos, Fels-Decals und
   * Kantenvegetation (siehe {@link ./chunks/RockOverlayStreamer}).
   */
  rockOverlaySurface: RockOverlayStreamer | null;
  /**
   * Materialquelle aller felsgebundenen Overlays: jede Zelle, auf der in dieser Runde je ein Fels
   * stand. Sie waechst mit gebauten Felsen und schrumpft nie – nur so bleiben Materialflecken,
   * Moos und Kantenmatten auf unbeteiligten Felsen nach einer Zerstoerung Pixel fuer Pixel stehen
   * (siehe {@link ./RockOverlayRegions}).
   */
  rockOverlaySource: RockOverlaySource;
  /**
   * Die Moosflecken der Runde. Einmalig aus `layout.seed` und dem **vollstaendigen** Felsbestand
   * erzeugt und danach unveraendert: Eine Zerstoerung darf die Platzierung nicht neu auswuerfeln,
   * sonst spraenge das Moos auf allen unbeteiligten Felsen. Sichtbar ist davon immer nur, was die
   * Stanzform des aktuellen Bestands durchlaesst.
   */
  rockMossPlacements: RockMossPlacement[];
  /**
   * Die Kantenmatten der Runde. Einmalig aus `layout.seed` und dem **vollstaendigen** Felsbestand
   * erzeugt und danach unveraendert – dieselbe Regel wie bei `rockMossPlacements`, hier zusaetzlich
   * die Voraussetzung dafuer, dass eine Zerstoerung nur den Anteil des gefallenen Felsens entfernt
   * und die uebrige Matte Pixel fuer Pixel stehen laesst.
   */
  rockVegetationPlacements: RockVegetationPlacement[];
}

export interface ArenaBuilderDynamicOptions {
  /** Die World-Metrik ist die einzige räumliche Quelle fuer den dynamischen Aufbau. */
  readonly worldMetrics: WorldMetrics;
  /**
   * Ob dieser Peer die World darstellt. Ohne Darstellung entstehen Staemme und Kronen gar
   * nicht erst - die Runtime der Baeume bleibt davon unberuehrt.
   */
  readonly presentation?: boolean;
  /** Nur Maps mit Persistent-Base-Konfiguration bekommen die Gravel-Renderziele. */
  readonly enablePersistentBaseGravel?: boolean;
  /** Optionaler Zustand fuer den ersten Chunk-Bake. */
  readonly persistentBaseGravel?: GroundSurfacePersistentBaseGravelZone;
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
    this.ensureLobbyBackground();
    this.syncStaticBackdrop(mode, phase);
    this.setPhysicsBounds();
  }

  syncStaticBackdrop(mode: GameMode, phase: GamePhase): void {
    const inArena = phase === 'ARENA';
    // World-Surfaces entstehen lazy. Ein Peer, der nur die Lobby zeigt und eine Shared World
    // ohne eigene Presentation simuliert, besitzt damit auch keinen unsichtbaren Ground-Tree.
    if (inArena) {
      this.ensureSidebars();
      this.ensureArenaBackground();
    }
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
  buildDynamic(layout: ArenaLayout, options: ArenaBuilderDynamicOptions): ArenaBuilderResult {
    const worldMetrics = options.worldMetrics;
    if (!worldMetrics) {
      throw new Error('[ArenaBuilder] Dynamic world build requires WorldMetrics');
    }
    const presentation = options.presentation !== false;
    const baseZoneObjects = presentation ? this.buildCaptureTheBeerBaseZones() : [];
    const rockGroup    = this.scene.physics.add.staticGroup();
    const frame: RockWorldFrame = {
      offsetX: worldMetrics.offsetX,
      offsetY: worldMetrics.offsetY,
      width: worldMetrics.widthPx,
      height: worldMetrics.heightPx,
    };
    const trunkGroup   = this.scene.physics.add.staticGroup();
    const rockPhysicsProxies: (RockPhysicsProxy | null)[] = [];
    const rockVisualStates = new RockVisualStateStore();
    const trunkBodies: TreePhysicsProxy[] = [];
    const trunkVisuals: Phaser.GameObjects.Arc[] = [];
    const canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }> = [];

    // Spatial Index für Autotiling
    const rockGrid = new RockGridIndex(layout.rocks, {
      cols: worldMetrics.gridCols,
      rows: worldMetrics.gridRows,
    });
    const isOccupied = (gx: number, gy: number) => rockGrid.isOccupiedWithBorder(gx, gy);

    // Gleise (vor Felsen zeichnen, damit depth-Reihenfolge stimmt)
    const trackObjects = presentation ? this.buildTracks(layout.tracks ?? [], worldMetrics) : [];

    // Ground-Cover-Platzierungen entstehen genau einmal je Runde und bleiben danach
    // unveraendert; sie sind die Quelle jedes Chunk-Bakes dieser Schicht.
    const groundCoverPlacements = generateGroundCoverPlacements({
      seed: layout.seed,
      dirt: layout.dirt ?? [],
      metrics: worldMetrics,
    });

    // Felsen mit Autotiling
    for (let i = 0; i < layout.rocks.length; i++) {
      const { gridX, gridY } = layout.rocks[i];
      const worldX = worldMetrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = worldMetrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask   = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const autoTileFrame = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      rockVisualStates.add({
        id: i,
        gridX,
        gridY,
        x: worldX,
        y: worldY,
        active: true,
        frame: autoTileFrame,
        cornerTints: resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied),
        damageTint: 0xffffff,
        ownerTintStrength: 0,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
      }, false);
      const proxy = createRockPhysicsProxy(this.scene, worldX, worldY);
      rockGroup.add(proxy);
      (proxy.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      rockPhysicsProxies.push(proxy);
    }

    // Bäume (Trunk + Canopy)
    for (const { gridX, gridY } of layout.trees) {
      const worldX = worldMetrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = worldMetrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2;

      // Runtime: der nicht rendernde Koerper ist die kanonische Quelle des Baums.
      const trunk = createTreePhysicsProxy(this.scene, worldX, worldY);
      trunkGroup.add(trunk);
      const trunkBody = trunk.body as Phaser.Physics.Arcade.StaticBody;
      trunkBody.setCircle(TRUNK_RADIUS);
      trunkBody.updateFromGameObject();
      trunkBodies.push(trunk);

      // Presentation: Stamm und Krone setzen darauf auf und entfallen ohne Darstellung.
      if (presentation) {
        trunkVisuals.push(this.createTrunkVisual(worldX, worldY));
        canopyObjects.push({ gfx: this.createCanopyVisual(worldX, worldY), worldX, worldY });
      }
    }

    const rockVisualSystem = presentation
      ? new RockVisualSystem(
        this.scene,
        frame,
        rockVisualStates,
        getRockRendererMode(),
        getRockGpuPageSize(),
      )
      : null;
    const result: ArenaBuilderResult = {
      baseZoneObjects,
      rockGroup,
      rockPhysicsProxies,
      rockVisualStates,
      rockVisualSystem,
      rockGrid,
      trunkGroup,
      trunkBodies,
      trunkVisuals,
      canopyObjects,
      trackObjects,
      groundSurface: null,
      groundCoverPlacements,
      rockOverlaySurface: null,
      rockOverlaySource: createRockOverlaySource(),
      // Einmalig hier erzeugt und nie wieder: siehe `rockMossPlacements`.
      rockMossPlacements: generateRockMossPlacements({
        seed: layout.seed,
        rocks: layout.rocks,
        metrics: worldMetrics,
      }),
      // Ebenfalls einmalig hier erzeugt und nie wieder: siehe `rockVegetationPlacements`.
      rockVegetationPlacements: generateRockVegetationPlacements({
        seed: layout.seed,
        rocks: layout.rocks,
        metrics: worldMetrics,
      }),
    };

    // Die Materialquelle muss den vollstaendigen Bestand kennen, bevor der erste Chunk gebacken
    // wird: Sie entscheidet, welche Flecken ueberhaupt entstehen (siehe `RockOverlayRegions`).
    syncRockOverlaySource(result.rockOverlaySource, layout.rocks);

    if (presentation) {
      result.groundSurface = new GroundSurfaceStreamer({
        scene: this.scene,
        frame,
        layout,
        groundCoverPlacements,
        enablePersistentBaseGravel: options.enablePersistentBaseGravel === true,
        persistentBaseGravel: options.persistentBaseGravel,
      });
      // Erst nach dem Erzeugen der Live-Felsen, damit der Streamer beim ersten Bake exakt die
      // aktiven Fels-IDs sieht.
      result.rockOverlaySurface = new RockOverlayStreamer({
        scene: this.scene,
        frame,
        layout,
        rockPhysicsProxies,
        rockVisualStates: rockVisualStates.states,
        overlaySource: result.rockOverlaySource,
        mossPlacements: result.rockMossPlacements,
        vegetationPlacements: result.rockVegetationPlacements,
      });
    }
    return result;
  }

  /**
   * Gleicht die residenten Render-Chunks an den sichtbaren Weltausschnitt an.
   *
   * Gehoert einmal je Frame in den Arena-Update-Pfad, direkt nachdem die Kamera ihren
   * endgueltigen Scroll fuer diesen Frame hat. Wird der Aufruf ausgelassen, bleiben die zuletzt
   * residenten Chunks stehen – die Welt verschwindet also nicht, sie waechst nur nicht mit.
   */
  static updateSurfaceResidency(result: ArenaBuilderResult | null, view: ChunkWorldRect): void {
    if (!result) return;
    result.groundSurface?.updateResidency(view);
    result.rockOverlaySurface?.updateResidency(view);
    result.rockVisualSystem?.updateVisibility(view);
  }

  /**
   * Startup-ready means that both streamed ground surfaces have all visible and prefetched
   * chunks, including their render targets, fully baked. The large map outside this working set
   * remains ordinary runtime streaming.
   */
  static isSurfaceWorkingSetReady(result: ArenaBuilderResult | null, view: ChunkWorldRect): boolean {
    if (!result?.groundSurface || !result.rockOverlaySurface) return false;
    return result.groundSurface.isReadyForView(view, true)
      && result.rockOverlaySurface.isReadyForView(view, true);
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
    const state = result.rockVisualStates.get(id);
    if (!state?.active) return;

    // Glatte Abstufung in ROCK_TINT_STEPS Schritten: 0xffffff (voll) → 0x666666 (fast zerstört)
    const ratio = Math.round((hp / Math.max(1, maxHp)) * ROCK_TINT_STEPS) / ROCK_TINT_STEPS;
    const gray  = Math.round(0x66 + (0xFF - 0x66) * ratio);
    const damageTint = (gray << 16) | (gray << 8) | gray;
    result.rockVisualStates.patch(id, {
      damageTint,
      ownerColor,
      ownerTintStrength,
      cornerTints: ArenaBuilder.resolveSurfaceTints(result.rockGrid, rocks, id) ?? state.cornerTints,
    });
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
      const state = result.rockVisualStates.get(id);
      if (!state?.active) continue;
      const cornerTints = ArenaBuilder.resolveSurfaceTints(result.rockGrid, layout.rocks, id);
      if (cornerTints) result.rockVisualStates.patch(id, { cornerTints });
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
  ): RockPhysicsProxy {
    const { rockPhysicsProxies, rockGroup, rockGrid } = result;
    const { gridX, gridY } = rocks[id];
    const isOccupied = (gx: number, gy: number) => gx === gridX && gy === gridY
      ? true
      : rockGrid.isOccupiedWithBorder(gx, gy);
    const frame = AutoTiler.getFrame(AutoTiler.computeMask(gridX, gridY, isOccupied), ROCK_AUTOTILE);
    const worldX = worldFrame.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2;
    const worldY = worldFrame.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2;
    const existingState = result.rockVisualStates.get(id);
    const visualState: RockVisualState = existingState ?? {
      id,
      gridX,
      gridY,
      x: worldX,
      y: worldY,
      active: true,
      frame,
      cornerTints: resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied),
      damageTint: 0xffffff,
      ownerTintStrength: 0,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
    };
    if (existingState) {
      result.rockVisualStates.patch(id, {
        x: worldX,
        y: worldY,
        active: true,
        frame,
        cornerTints: resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied),
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
      });
    } else {
      result.rockVisualStates.add(visualState);
    }

    const proxy = createRockPhysicsProxy(scene, worldX, worldY);
    rockPhysicsProxies[id] = proxy;
    rockGroup.add(proxy);
    // Nur der neue Koerper wird in den statischen RTree eingetragen. `rockGroup.refresh()` waere
    // hier ein O(Bestand)-Sturm: Es setzt *jeden* Koerper der Gruppe zurueck und entfernt ihn
    // dafuer aus dem Baum, um ihn sofort wieder einzufuegen – siehe `destroyRock`.
    (proxy.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    rockGrid.set(gridX, gridY, id);

    const neighborIds = rockGrid.getNeighborIndices(gridX, gridY);
    for (const neighborId of neighborIds) {
      const neighbor = result.rockVisualStates.get(neighborId);
      if (!neighbor?.active) continue;
      const cell = rocks[neighborId];
      const neighborFrame = AutoTiler.getFrame(AutoTiler.computeMask(cell.gridX, cell.gridY, (gx, gy) => rockGrid.isOccupiedWithBorder(gx, gy)), ROCK_AUTOTILE);
      result.rockVisualStates.patch(neighborId, { frame: neighborFrame });
    }

    ArenaBuilder.updateRockVisual(result, rocks, id, hp, maxHp, ownerColor, ownerTintStrength);
    return proxy;
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
    const { rockVisualStates, rockGrid } = result;
    const { gridX, gridY } = rocks[id];
    ArenaBuilder.destroyRock(result, id);
    rockGrid.remove(gridX, gridY);

    // Nachbar-Tiles neu berechnen
    const isOccupied = (gx: number, gy: number) => rockGrid.isOccupiedWithBorder(gx, gy);
    const neighborIds = rockGrid.getNeighborIndices(gridX, gridY);
    for (const nid of neighborIds) {
      const state = rockVisualStates.get(nid);
      if (!state?.active) continue;
      if (!rocks[nid]) continue;
      const { gridX: ngx, gridY: ngy } = rocks[nid];
      const mask  = AutoTiler.computeMask(ngx, ngy, isOccupied);
      const frame = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      rockVisualStates.patch(nid, { frame });
    }
  }

  /**
   * Entfernt einen Fels physikalisch und visuell aus der Szene.
   * Sicher mehrfach aufzurufen (idempotent via null-Slot).
   *
   * `Group.remove(child, true, true)` meldet den Koerper bereits ueber den
   * `removeCallbackHandler` der StaticGroup an `world.disableBody()` ab; er verschwindet damit aus
   * dem statischen RTree. Ein anschliessendes `rockGroup.refresh()` waere nicht nur ueberfluessig,
   * sondern der teuerste Aufruf im ganzen Zerstoerungspfad: Es ruft `body.reset()` auf **jedem**
   * verbliebenen Fels, und jedes `reset()` entfernt den Koerper aus dem RTree und fuegt ihn sofort
   * wieder ein. Bei einem Bestand von rund 29 000 Felsen kostete eine einzelne Zerstoerung damit
   * 58 000 Baumoperationen – eine Flaechenzerstoerung entsprechend ein Vielfaches davon, gemessen
   * als 30-Sekunden-Standbild bei der NUKE. Felsen bewegen sich nie; es gibt nichts nachzufuehren.
   */
  static destroyRock(result: ArenaBuilderResult, id: number): void {
    const proxy = result.rockPhysicsProxies[id];
    if (!proxy) return;
    result.rockGroup.remove(proxy, true, true);
    result.rockPhysicsProxies[id] = null;
    result.rockVisualStates.patch(id, {
      active: false,
      damageTint: 0xffffff,
      ownerColor: undefined,
      ownerTintStrength: 0,
      alpha: 0,
      scaleX: 0,
      scaleY: 0,
    });
  }

  /**
   * Baut die felsgebundenen Overlays vollstaendig neu auf.
   *
   * "Vollstaendig" heisst seit dem Chunk-Streaming: alle gerade residenten Render-Chunks. Ein
   * nicht residenter Chunk braucht keinen Neuaufbau – er entsteht beim naechsten Sichtbarwerden
   * ohnehin aus dem dann aktuellen Weltzustand.
   *
   * Alle vier Schichten folgen derselben Regel: Ihre Platzierung entsteht aus dem **vollstaendigen**
   * Felsbestand der Runde und wird nie neu ausgewuerfelt; neu gebacken wird ausschliesslich der
   * Schnitt auf den aktuellen Bestand. Ein zerstoerter Fels nimmt damit genau seinen eigenen Anteil
   * mit und laesst die uebrigen Flaechen Pixel fuer Pixel stehen.
   */
  static rebuildRockOverlays(
    _scene: Phaser.Scene,
    result: ArenaBuilderResult,
    _layout: ArenaLayout,
    _worldFrame: RockWorldFrame = getArenaRockWorldFrame(),
  ): void {
    result.rockOverlaySurface?.refreshAll();
  }

  /**
   * Backt nur die Chunks neu, deren sichtbares Ergebnis sich tatsaechlich aendern kann.
   *
   * Die Update-Granularitaet bleibt ROCK_OVERLAY_CHUNK_SIZE = 128 px; ein Render-Chunk ist ein
   * ganzzahliges Vielfaches davon, ein Dirty-Chunk liegt also immer vollstaendig in genau einem
   * Renderziel.
   */
  static rebuildRockOverlayRegions(
    _scene: Phaser.Scene,
    result: ArenaBuilderResult,
    _layout: ArenaLayout,
    dirtyRockIds: ReadonlySet<number>,
    _worldFrame: RockWorldFrame = getArenaRockWorldFrame(),
  ): void {
    result.rockOverlaySurface?.refreshRegions(dirtyRockIds);
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

    // Felsen: Visuals und Physics haben getrennte Besitzer.
    result.rockVisualSystem?.destroy();
    for (const proxy of result.rockPhysicsProxies) {
      if (proxy?.active) proxy.destroy();
    }
    result.rockPhysicsProxies.length = 0;
    result.rockGroup.destroy(true);

    // Trunks: erst die Darstellung, dann die Runtime.
    for (const trunk of result.trunkVisuals) {
      if (trunk.active) trunk.destroy();
    }
    result.trunkVisuals.length = 0;
    for (const trunk of result.trunkBodies) {
      if (trunk.active) trunk.destroy();
    }
    result.trunkBodies.length = 0;
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

    // Gestreamte Weltschichten: residente Renderziele, Pool und Scratch-Ziele.
    result.groundSurface?.destroy();
    result.groundSurface = null;
    result.groundCoverPlacements.length = 0;

    result.rockOverlaySurface?.destroy();
    result.rockOverlaySurface = null;
    result.rockOverlaySource.cells.length = 0;
    result.rockOverlaySource.keys.clear();
    result.rockMossPlacements.length = 0;
    result.rockVegetationPlacements.length = 0;
  }

  // ── Private Factory-Methoden ───────────────────────────────────────────────

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
    registerGraphicsObject(this.scene, 'baseMarkers', rect);
    return rect;
  }

  // ── Gleise ────────────────────────────────────────────────────────────────

  /**
   * Gruppiert TrackCells nach Spalte und erstellt pro Spalte einen TileSprite.
   * Gleise sind rein visuell (keine Physik-Gruppe), da sie begehbar sind.
   */
  private buildTracks(tracks: TrackCell[], metrics: WorldMetrics): Phaser.GameObjects.TileSprite[] {
    return ArenaVisualFactory.createTracks(this.scene, tracks, metrics);
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
