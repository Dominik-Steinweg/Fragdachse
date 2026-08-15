import * as Phaser from 'phaser';
import {
  CELL_SIZE,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config';
import type { ArenaLayout, RockCell } from '../types';
import { ARENA_BACKGROUND_DETAIL_ALPHA } from './ArenaBackground';
import { AutoTiler, ROCK_AUTOTILE } from './AutoTiler';
import { ArenaVisualFactory } from './ArenaVisualFactory';
import { DIRT_BLOB_SURFACE_PROFILE, ROCK_BLOB_SURFACE_PROFILE } from './BlobSurfaceProfile';
import { bakeBlobSurfaceMottle } from './BlobSurfaceMottle';
import { resolveBlobSurfaceCornerTints } from './BlobSurfaceShading';
import { generateGroundCoverPlacements } from './GroundCoverField';
import { bakeGroundCoverLayer } from './GroundCoverLayer';
import { generateRockMossPlacements } from './RockMossField';
import type { RockMossPlacement } from './RockMossField';
import { bakeRockMossLayer } from './RockMossLayer';
import { generateRockVegetationPlacements } from './RockVegetationField';
import type { RockVegetationPlacement } from './RockVegetationField';
import { bakeRockVegetationLayer } from './RockVegetationLayer';
import type { MenuArenaPreviewConfig, MenuArenaPreviewLayerConfig } from './MenuArenaPreviewConfig';
import { RockGridIndex } from './RockGridIndex';
import { ShadowSystem } from '../effects/ShadowSystem';

interface BakedLayer {
  layer: Phaser.GameObjects.RenderTexture;
  config: MenuArenaPreviewLayerConfig;
}

export class MenuArenaPreviewRenderer {
  private background: Phaser.GameObjects.TileSprite | null = null;
  private backgroundDetail: Phaser.GameObjects.TileSprite | null = null;
  private leftSidebar: Phaser.GameObjects.Rectangle | null = null;
  private rightSidebar: Phaser.GameObjects.Rectangle | null = null;
  private arenaShade: Phaser.GameObjects.Rectangle | null = null;
  private screenShade: Phaser.GameObjects.Rectangle | null = null;
  private tracks: Phaser.GameObjects.TileSprite[] = [];
  /**
   * Die statische Deko der Vorschau liegt als gebackene Layer vor – ein Objekt je Tiefenband
   * statt mehrerer hundert Einzel-Images. Die Bänder bleiben getrennt, damit die
   * Schatten-Graphics des `ShadowSystem` weiterhin zwischen Boden, Felsen und Kronen liegen.
   */
  private bakedLayers: BakedLayer[] = [];
  /**
   * Die felsabhängigen Bänder getrennt von den unveränderlichen: Boden, Decals und Kronen
   * ändern sich nie, die Felsen dagegen bei jeder Zerstörung und jedem Neubau.
   */
  private rockBandLayers: BakedLayer[] = [];
  private trunkLayer: Phaser.GameObjects.RenderTexture | null = null;
  private canopyLayer: Phaser.GameObjects.RenderTexture | null = null;
  private rockMottleLayers: Phaser.GameObjects.RenderTexture[] = [];
  private rockMottleConfig: MenuArenaPreviewLayerConfig | null = null;
  private rockSilhouetteCutout: Phaser.GameObjects.RenderTexture | null = null;
  /**
   * Fels-Moos samt Stanzform und Platzierung. Alle drei ueberdauern das Neubacken der
   * Fels-Baender: Die beiden RenderTextures sind bildschirmgross, und die Platzierung darf sich
   * bei einer Zerstoerung ohnehin nicht aendern.
   */
  private rockMossLayer: Phaser.GameObjects.RenderTexture | null = null;
  private rockMossCutout: Phaser.GameObjects.RenderTexture | null = null;
  private rockMossPlacements: RockMossPlacement[] | null = null;
  private rockMossConfig: MenuArenaPreviewLayerConfig | null = null;
  /** Fels-Vegetation, in Aufbau und Lebensdauer wie das Fels-Moos darueber. */
  private rockVegetationLayer: Phaser.GameObjects.RenderTexture | null = null;
  private rockVegetationCutout: Phaser.GameObjects.RenderTexture | null = null;
  private rockVegetationPlacements: RockVegetationPlacement[] | null = null;
  private rockVegetationConfig: MenuArenaPreviewLayerConfig | null = null;
  private shadows: ShadowSystem | null = null;
  private visible = true;

  /**
   * Belegung des Felsgitters. Bleibt über Zerstörung und Neubau hinweg dieselbe Instanz,
   * damit die Fels-Indizes des Layouts stabil bleiben.
   */
  private rockGrid: RockGridIndex | null = null;
  /** Indizes der aktuell stehenden Felsen; Grundlage jedes Neubaus der Fels-Bänder. */
  private readonly aliveRockIds = new Set<number>();
  private rockBandsDirty = false;

  constructor(
    private scene: Phaser.Scene,
    private config: MenuArenaPreviewConfig,
  ) {}

  build(): void {
    this.destroy();

    const { view, layout } = this.config;
    const { bounds } = view;
    this.visible = true;
    this.background = this.scene.add
      .tileSprite(bounds.offsetX + bounds.width * 0.5, bounds.offsetY + bounds.height * 0.5, bounds.width, bounds.height, view.backgroundTextureKey)
      .setTilePosition(0, 0)
      .setDepth(DEPTH.GRASS)
      .setTint(view.backgroundTint)
      .setAlpha(view.backgroundAlpha);

    // Dieselbe Multiply-Feinschicht wie in der Arena, damit Vorschau und Spielfeld dieselbe
    // Bodenstruktur zeigen. Der Basis-Tint bleibt darunter erhalten.
    this.backgroundDetail = this.scene.add
      .tileSprite(bounds.offsetX + bounds.width * 0.5, bounds.offsetY + bounds.height * 0.5, bounds.width, bounds.height, view.backgroundDetailTextureKey)
      .setTilePosition(0, 0)
      .setDepth(DEPTH.GRASS + 0.01)
      .setAlpha(ARENA_BACKGROUND_DETAIL_ALPHA)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    this.leftSidebar = this.scene.add
      .rectangle(bounds.offsetX * 0.5, GAME_HEIGHT * 0.5, bounds.offsetX, GAME_HEIGHT, view.frame.leftSidebarColor)
      .setDepth(DEPTH.LOCAL_UI - 1)
      .setAlpha(view.frame.sidebarAlpha)
      .setVisible(view.frame.showSidebars)
      .setScrollFactor(0);
    this.rightSidebar = this.scene.add
      .rectangle(GAME_WIDTH - bounds.offsetX * 0.5, GAME_HEIGHT * 0.5, bounds.offsetX, GAME_HEIGHT, view.frame.rightSidebarColor)
      .setDepth(DEPTH.LOCAL_UI - 1)
      .setAlpha(view.frame.sidebarAlpha)
      .setVisible(view.frame.showSidebars)
      .setScrollFactor(0);

    const metrics = {
      offsetX: bounds.offsetX,
      offsetY: bounds.offsetY,
      gridCols: Math.floor(bounds.width / CELL_SIZE),
      gridRows: Math.floor(bounds.height / CELL_SIZE),
    };

    this.aliveRockIds.clear();
    for (let id = 0; id < layout.rocks.length; id += 1) this.aliveRockIds.add(id);
    this.rockGrid = new RockGridIndex(layout.rocks, {
      cols: metrics.gridCols,
      rows: metrics.gridRows,
    });

    this.shadows = new ShadowSystem(this.scene);
    this.shadows.setWorldBoundsOverride({
      minX: bounds.offsetX,
      minY: bounds.offsetY,
      maxX: bounds.offsetX + bounds.width,
      maxY: bounds.offsetY + bounds.height,
    });
    this.rebuildShadows();
    // Unsichtbare Layer werden gar nicht erst erzeugt: Sie wuerden sonst als Objekte in der
    // Display-Liste liegen und jeden Frame durch Update- und Depth-Sort-Paesse laufen,
    // ohne je ein Pixel beizutragen.
    this.tracks = view.tracks.visible
      ? ArenaVisualFactory.createTracks(this.scene, layout.tracks ?? [], metrics)
      : [];
    this.applyLayerStyle(this.tracks, view.tracks);

    // Reihenfolge der Tiefenbaender bleibt exakt erhalten: Boden < Moos < Decals < Fels-Schatten
    // < Felsen < Kronen-Schatten < Kronen. Die Schatten liegen als eigene Graphics dazwischen.
    this.bakeDirtLayer(layout, metrics, view.dirt);
    this.bakeGroundCoverLayer(layout, metrics, view.groundCover);
    this.bakeLayer(ArenaVisualFactory.createDecals(this.scene, layout.decals ?? [], metrics), DEPTH.DECALS, view.decals, this.bakedLayers);

    this.bakeRockBands();

    const trees = ArenaVisualFactory.createTrees(this.scene, layout.trees ?? [], metrics);
    this.trunkLayer = this.bakeLayer(trees.map((tree) => tree.trunk), DEPTH.CANOPY - 0.01, view.trunks, this.bakedLayers);
    this.canopyLayer = this.bakeLayer(trees.map((tree) => tree.canopy), DEPTH.CANOPY, view.canopies, this.bakedLayers);

    this.arenaShade = this.scene.add
      .rectangle(
        bounds.offsetX + bounds.width * 0.5,
        bounds.offsetY + bounds.height * 0.5,
        bounds.width,
        bounds.height,
        view.overlay.arenaShadeColor,
        view.overlay.arenaShadeAlpha,
      )
      .setDepth(DEPTH.CANOPY + 1);

    this.screenShade = this.scene.add
      .rectangle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, GAME_WIDTH, GAME_HEIGHT, view.overlay.screenShadeColor, view.overlay.screenShadeAlpha)
      .setDepth(DEPTH.LOCAL_UI - 2)
      .setScrollFactor(0);
  }

  // ── Dynamischer Felsbestand ────────────────────────────────────────────────

  /** Steht an diesem Index noch ein Fels? */
  isRockAlive(id: number): boolean {
    return this.aliveRockIds.has(id);
  }

  /** Alle aktuell stehenden Felsen, in Layout-Reihenfolge. */
  forEachAliveRock(visit: (id: number, worldX: number, worldY: number) => void): void {
    const rocks = this.config.layout.rocks;
    for (let id = 0; id < rocks.length; id += 1) {
      if (!this.aliveRockIds.has(id)) continue;
      const world = this.gridToWorld(rocks[id].gridX, rocks[id].gridY);
      visit(id, world.x, world.y);
    }
  }

  /** Weltmittelpunkt einer Gitterzelle im Rahmen der Vorschau. */
  gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    const { bounds } = this.config.view;
    return {
      x: bounds.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2,
      y: bounds.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  /**
   * Nimmt einen Fels aus dem Bestand oder stellt ihn wieder her.
   *
   * Der sichtbare Neubau der Bänder passiert nicht sofort: eine Explosion trifft
   * typischerweise mehrere Felsen, und jedes Backen einer bildschirmgroßen RenderTexture
   * kostet. Die Änderungen sammeln sich und werden am Ende des Frames einmal ausgeführt.
   */
  setRockAlive(id: number, alive: boolean): boolean {
    const rock = this.config.layout.rocks[id];
    if (!rock) return false;
    if (alive === this.aliveRockIds.has(id)) return false;

    if (alive) {
      this.aliveRockIds.add(id);
      this.rockGrid?.set(rock.gridX, rock.gridY, id);
    } else {
      this.aliveRockIds.delete(id);
      this.rockGrid?.remove(rock.gridX, rock.gridY);
    }
    this.markRockBandsDirty();
    return true;
  }

  /**
   * Sammelstelle statt Sofortaufruf. Bewusst ein Frame-Sammelpunkt und kein Zeit-Timer: eine
   * Verzögerung würde den zerstörten Fels sichtbar länger stehen lassen als seine Trümmer.
   */
  private markRockBandsDirty(): void {
    if (this.rockBandsDirty) return;
    this.rockBandsDirty = true;
    this.scene.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.rockBandsDirty = false;
      // Der Rückruf läuft ausserhalb jedes Aufrufer-Kontexts; ein Fehler hier würde sonst
      // ungefangen den Frame abbrechen und die Lobby mitreissen.
      try {
        this.rebuildRockBands();
      } catch (error) {
        console.error('[MenuArenaPreviewRenderer] Fels-Bänder konnten nicht neu gebacken werden', error);
      }
    });
  }

  /** Führt einen ausstehenden Neubau sofort aus (Teardown, Moduswechsel). */
  flushRockBands(): void {
    if (!this.rockBandsDirty) return;
    this.rockBandsDirty = false;
    this.rebuildRockBands();
  }

  private rebuildRockBands(): void {
    if (!this.background) return; // nicht (mehr) aufgebaut
    this.destroyRockBands();
    this.bakeRockBands();
    this.rebuildShadows();
  }

  /**
   * Backt Fels-Basis samt AutoTile, die nicht-periodische Materialstörung und die
   * Fels-Decals neu. Alles leitet sich aus {@link aliveRockIds} ab, deshalb stimmen die
   * AutoTile-Kanten der Nachbarn nach jeder Zerstörung und jedem Neubau von selbst.
   */
  private bakeRockBands(): void {
    const { view, layout } = this.config;
    const { bounds } = view;
    const metrics = {
      offsetX: bounds.offsetX,
      offsetY: bounds.offsetY,
      gridCols: Math.floor(bounds.width / CELL_SIZE),
      gridRows: Math.floor(bounds.height / CELL_SIZE),
    };

    const rockImages = this.createRocks();
    // Materialquelle ist der vollstaendige Bestand, Maske der lebende – dieselbe Regel wie in der
    // Arena (siehe `ArenaBuilder.rebuildRockOverlays`). Waere die Quelle der lebende Bestand,
    // wuerfelte jede Zerstoerung die Flecken auf allen uebrigen Felsen neu aus.
    this.bakeRockMottle(layout.rocks, rockImages, metrics, view.rocks);
    this.bakeRockMossLayer(rockImages, view.rockMoss);
    this.bakeRockVegetationLayer(rockImages, view.rockVegetation);
    this.bakeLayer(rockImages, DEPTH.ROCKS, view.rocks, this.rockBandLayers);
    this.bakeLayer(
      ArenaVisualFactory.createRockDecals(this.scene, layout.decals ?? [], metrics, this.aliveRockIds),
      DEPTH.ROCK_DECALS,
      view.decals,
      this.rockBandLayers,
    );
  }

  /**
   * Verwirft die neu zu backenden Fels-Bänder.
   *
   * Materialstörung und Silhouetten-Ausschnitt bleiben bewusst bestehen: beide sind
   * bildschirmgroße RenderTextures, die {@link bakeBlobSurfaceMottle} an Ort und Stelle neu
   * befüllt. Sie bei jeder Zerstörung neu zu allokieren wäre ein spürbarer Ruckler.
   */
  private destroyRockBands(): void {
    for (const { layer } of this.rockBandLayers) layer.destroy();
    this.rockBandLayers = [];
  }

  /** Statische Schatten aus dem aktuellen Felsbestand – zerstörte Felsen werfen keinen mehr. */
  private rebuildShadows(): void {
    const { bounds } = this.config.view;
    const layout = this.config.layout;
    this.shadows?.rebuildStaticLayoutShadows(
      { ...layout, rocks: layout.rocks.filter((_, id) => this.aliveRockIds.has(id)) },
      { offsetX: bounds.offsetX, offsetY: bounds.offsetY },
    );
    this.shadows?.setVisible(this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.background?.setVisible(visible);
    this.shadows?.setVisible(visible);
    this.leftSidebar?.setVisible(visible && this.config.view.frame.showSidebars);
    this.rightSidebar?.setVisible(visible && this.config.view.frame.showSidebars);
    this.arenaShade?.setVisible(visible);
    this.screenShade?.setVisible(visible);
    for (const obj of this.tracks) obj.setVisible(visible && this.config.view.tracks.visible);
    for (const { layer, config } of this.bakedLayers) layer.setVisible(visible && config.visible);
    for (const { layer, config } of this.rockBandLayers) layer.setVisible(visible && config.visible);
    for (const layer of this.rockMottleLayers) {
      layer.setVisible(visible && (this.rockMottleConfig?.visible ?? true));
    }
    this.rockMossLayer?.setVisible(visible && (this.rockMossConfig?.visible ?? true));
    this.rockVegetationLayer?.setVisible(visible && (this.rockVegetationConfig?.visible ?? true));
  }

  /** Applies the same ambient tint used by live arena tree visuals to the baked lobby trees. */
  setTreeTint(tint: number): void {
    this.trunkLayer?.setTint(tint);
    this.canopyLayer?.setTint(tint);
  }

  destroy(): void {
    this.rockBandsDirty = false;
    this.background?.destroy();
    this.backgroundDetail?.destroy();
    this.leftSidebar?.destroy();
    this.rightSidebar?.destroy();
    this.arenaShade?.destroy();
    this.screenShade?.destroy();
    this.shadows?.destroy();
    for (const layer of this.rockMottleLayers) layer.destroy();
    this.rockSilhouetteCutout?.destroy();
    this.rockMossLayer?.destroy();
    this.rockMossCutout?.destroy();
    this.rockVegetationLayer?.destroy();
    this.rockVegetationCutout?.destroy();
    this.background = null;
    this.backgroundDetail = null;
    this.leftSidebar = null;
    this.rightSidebar = null;
    this.arenaShade = null;
    this.screenShade = null;
    this.shadows = null;
    this.trunkLayer = null;
    this.canopyLayer = null;
    this.rockMottleLayers = [];
    this.rockMottleConfig = null;
    this.rockSilhouetteCutout = null;
    this.rockMossLayer = null;
    this.rockMossCutout = null;
    this.rockMossConfig = null;
    this.rockMossPlacements = null;
    this.rockVegetationLayer = null;
    this.rockVegetationCutout = null;
    this.rockVegetationConfig = null;
    this.rockVegetationPlacements = null;
    this.rockGrid = null;
    this.aliveRockIds.clear();
    for (const obj of this.tracks) obj.destroy();
    for (const { layer } of this.bakedLayers) layer.destroy();
    for (const { layer } of this.rockBandLayers) layer.destroy();
    this.tracks = [];
    this.bakedLayers = [];
    this.rockBandLayers = [];
  }

  /**
   * Backt ein statisches Deko-Tiefenband einmalig in eine RenderTexture – analog zur Arena
   * ({@link ArenaBuilder}). Ohne das Backen laegen Boden, Decals, Felsen und Kronen als
   * mehrere hundert bis ueber tausend Einzel-Images in der Display-Liste, die Phaser jeden
   * Frame durch Update-, Cull- und Depth-Sort-Paesse zieht, obwohl die Vorschau vollstaendig
   * statisch ist. Da die Vorschau auch waehrend eines laufenden Matches nur unsichtbar
   * geschaltet und nicht abgebaut wird, entlastet das die Arena ebenso.
   *
   * Die Layer-Alpha wird bewusst auf die Einzelbilder angewendet und die RenderTexture selbst
   * bleibt bei Alpha 1. Nur so bleibt das Ergebnis auch bei einander ueberlappenden Bildern
   * pixelgleich zum ungebackenen Zustand ("over" ist assoziativ); eine Alpha auf dem
   * fertigen Layer wuerde Ueberlappungen anders gewichten.
   */
  private bakeLayer(
    images: Array<Phaser.GameObjects.GameObject & { setAlpha(alpha: number): unknown; destroy(): void }>,
    depth: number,
    layer: MenuArenaPreviewLayerConfig,
    target: BakedLayer[],
  ): Phaser.GameObjects.RenderTexture | null {
    if (images.length === 0) return null;

    // Dauerhaft unsichtbare Baender tragen kein Pixel bei und werden komplett verworfen.
    if (!layer.visible || layer.alpha <= 0) {
      for (const img of images) img.destroy();
      return null;
    }

    for (const img of images) img.setAlpha(layer.alpha);

    const { bounds } = this.config.view;
    const baked = this.scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
    baked.setOrigin(0, 0);
    baked.setDepth(depth);
    baked.camera.setScroll(bounds.offsetX, bounds.offsetY);
    baked.draw(images);
    baked.render();
    baked.setVisible(this.visible && layer.visible);

    for (const img of images) img.destroy();

    target.push({ layer: baked, config: layer });
    return baked;
  }

  /**
   * Uses the same profile-backed bake as arena Dirt, then flattens the temporary MULTIPLY
   * surface into the single persistent preview ground layer.
   */
  private bakeDirtLayer(
    layout: ArenaLayout,
    metrics: { offsetX: number; offsetY: number; gridCols: number; gridRows: number },
    layerConfig: MenuArenaPreviewLayerConfig,
  ): void {
    const { fringe, surface: images } = ArenaVisualFactory.createDirtImages(this.scene, layout.dirt ?? [], metrics);
    if (images.length === 0) return;
    if (!layerConfig.visible || layerConfig.alpha <= 0) {
      for (const image of fringe) image.destroy();
      for (const image of images) image.destroy();
      return;
    }
    // Die Randfahne traegt bereits ihre eigene Verlaufsdeckkraft; die Ebenendeckkraft der
    // Vorschau kommt multiplikativ dazu, sonst waere der Saum dort staerker als in der Arena.
    for (const image of fringe) image.setAlpha(image.alpha * layerConfig.alpha);
    for (const image of images) image.setAlpha(layerConfig.alpha);
    const { bounds } = this.config.view;
    const baked = this.scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
    baked.setOrigin(0, 0);
    baked.setDepth(DEPTH.DIRT);
    baked.camera.setScroll(bounds.offsetX, bounds.offsetY);
    baked.draw(fringe);
    baked.draw(images);
    baked.render();

    const mottle = bakeBlobSurfaceMottle(
      this.scene,
      DIRT_BLOB_SURFACE_PROFILE,
      layout.dirt ?? [],
      images,
      { offsetX: bounds.offsetX, offsetY: bounds.offsetY, width: bounds.width, height: bounds.height, layerDepth: DEPTH.DIRT },
    );
    for (const mottleLayer of mottle.layers) {
      mottleLayer.setAlpha(layerConfig.alpha);
      baked.draw(mottleLayer);
      baked.render();
      mottleLayer.destroy();
    }
    mottle.silhouetteCutout?.destroy();
    for (const image of fringe) image.destroy();
    for (const image of images) image.destroy();
    this.bakedLayers.push({ layer: baked, config: layerConfig });
  }

  /**
   * Backt die Moosschicht über denselben Helfer wie die Arena. Die Vorschau braucht keine
   * Stempel-Geometrie zurück – einen Terrain-Farb-Sampler gibt es dort nicht.
   *
   * Der Layer landet in `bakedLayers` und nicht in `rockBandLayers`: Er leitet sich allein aus
   * dem Dirt ab, der zur Laufzeit unverändert bleibt, und übersteht damit jede Fels-Zerstörung
   * ohne Neubau.
   */
  private bakeGroundCoverLayer(
    layout: ArenaLayout,
    metrics: { offsetX: number; offsetY: number; gridCols: number; gridRows: number },
    layerConfig: MenuArenaPreviewLayerConfig,
  ): void {
    if (!layerConfig.visible || layerConfig.alpha <= 0) return;
    const { bounds } = this.config.view;
    const { layer } = bakeGroundCoverLayer(
      this.scene,
      generateGroundCoverPlacements({
        seed: layout.seed,
        dirt: layout.dirt ?? [],
        metrics,
      }),
      bounds,
      DEPTH.GROUND_COVER,
      layerConfig.alpha,
    );
    if (!layer) return;
    layer.setVisible(this.visible && layerConfig.visible);
    this.bakedLayers.push({ layer, config: layerConfig });
  }

  /**
   * Erzeugt die Bilder der aktuell stehenden Felsen. AutoTile-Maske und Eckentints leiten
   * sich aus dem laufend gepflegten {@link rockGrid} ab – ein zerstörter Nachbar öffnet die
   * Kante seiner Nachbarn also automatisch.
   */
  private createRocks(): Phaser.GameObjects.Image[] {
    const images: Phaser.GameObjects.Image[] = [];
    const rockGrid = this.rockGrid;
    if (!rockGrid) return images;
    const isOccupied = (gridX: number, gridY: number) => rockGrid.isOccupiedWithBorder(gridX, gridY);

    const rocks = this.config.layout.rocks;
    for (let id = 0; id < rocks.length; id += 1) {
      if (!this.aliveRockIds.has(id)) continue;
      const { gridX, gridY } = rocks[id];
      const world = this.gridToWorld(gridX, gridY);
      const mask = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const frame = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      images.push(ArenaVisualFactory.createRock(
        this.scene,
        world.x,
        world.y,
        frame,
        resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied),
      ));
    }

    return images;
  }

  private bakeRockMottle(
    rockCells: readonly RockCell[],
    rockImages: Phaser.GameObjects.Image[],
    metrics: { offsetX: number; offsetY: number },
    layerConfig: MenuArenaPreviewLayerConfig,
  ): void {
    if (!layerConfig.visible || layerConfig.alpha <= 0 || rockCells.length === 0) return;

    const { bounds } = this.config.view;
    const mottle = bakeBlobSurfaceMottle(
      this.scene,
      ROCK_BLOB_SURFACE_PROFILE,
      rockCells,
      rockImages,
      {
        offsetX: metrics.offsetX,
        offsetY: metrics.offsetY,
        width: bounds.width,
        height: bounds.height,
        layerDepth: DEPTH.ROCKS,
      },
      this.rockMottleLayers,
      this.rockSilhouetteCutout,
    );
    this.rockMottleLayers = mottle.layers;
    this.rockSilhouetteCutout = mottle.silhouetteCutout;
    this.rockMottleConfig = layerConfig;
    for (const layer of this.rockMottleLayers) {
      layer.setAlpha(layerConfig.alpha);
      layer.setVisible(this.visible && layerConfig.visible);
    }
  }

  /**
   * Backt das Fels-Moos ueber denselben Helfer wie die Arena.
   *
   * Die Platzierung entsteht genau einmal je Vorschau und wird danach nur noch neu beschnitten –
   * dieselbe Regel wie in der Arena: Ein zerstoerter Fels darf das Moos der uebrigen nicht
   * verruecken. Anders als dort laeuft hier kein Chunk-Pfad; die Vorschau backt ihre Fels-Baender
   * ohnehin vollstaendig neu, und ihr Rahmen ist nur bildschirmgross.
   */
  private bakeRockMossLayer(
    rockImages: readonly Phaser.GameObjects.Image[],
    layerConfig: MenuArenaPreviewLayerConfig,
  ): void {
    if (!layerConfig.visible || layerConfig.alpha <= 0) return;
    const { bounds } = this.config.view;
    if (!this.rockMossPlacements) {
      this.rockMossPlacements = generateRockMossPlacements({
        seed: this.config.layout.seed,
        rocks: this.config.layout.rocks,
        metrics: {
          offsetX: bounds.offsetX,
          offsetY: bounds.offsetY,
          gridCols: Math.floor(bounds.width / CELL_SIZE),
          gridRows: Math.floor(bounds.height / CELL_SIZE),
        },
      });
    }

    const masks = ArenaVisualFactory.createRockMossMasks(this.scene, rockImages);
    const baked = bakeRockMossLayer(
      this.scene,
      this.rockMossPlacements,
      masks,
      bounds,
      DEPTH.ROCK_MOSS,
      { layer: this.rockMossLayer, cutout: this.rockMossCutout },
      layerConfig.alpha,
    );
    for (const mask of masks) mask.destroy();
    this.rockMossLayer = baked.layer;
    this.rockMossCutout = baked.cutout;
    this.rockMossConfig = layerConfig;
    this.rockMossLayer?.setVisible(this.visible && layerConfig.visible);
  }

  /**
   * Backt die Fels-Vegetation ueber denselben Helfer wie die Arena – Aufbau und Begruendung
   * wie bei {@link bakeRockMossLayer}, nur mit der Reichweitenmaske und einer Ebene darueber.
   */
  private bakeRockVegetationLayer(
    rockImages: readonly Phaser.GameObjects.Image[],
    layerConfig: MenuArenaPreviewLayerConfig,
  ): void {
    if (!layerConfig.visible || layerConfig.alpha <= 0) return;
    const { bounds } = this.config.view;
    if (!this.rockVegetationPlacements) {
      this.rockVegetationPlacements = generateRockVegetationPlacements({
        seed: this.config.layout.seed,
        rocks: this.config.layout.rocks,
        metrics: {
          offsetX: bounds.offsetX,
          offsetY: bounds.offsetY,
          gridCols: Math.floor(bounds.width / CELL_SIZE),
          gridRows: Math.floor(bounds.height / CELL_SIZE),
        },
      });
    }

    const masks = ArenaVisualFactory.createRockVegetationMasks(this.scene, rockImages);
    const baked = bakeRockVegetationLayer(
      this.scene,
      this.rockVegetationPlacements,
      masks,
      bounds,
      DEPTH.ROCK_VEGETATION,
      { layer: this.rockVegetationLayer, cutout: this.rockVegetationCutout },
      layerConfig.alpha,
    );
    for (const mask of masks) mask.destroy();
    this.rockVegetationLayer = baked.layer;
    this.rockVegetationCutout = baked.cutout;
    this.rockVegetationConfig = layerConfig;
    this.rockVegetationLayer?.setVisible(this.visible && layerConfig.visible);
  }

  private applyLayerStyle<T extends Phaser.GameObjects.GameObject & { setAlpha(alpha: number): T; setVisible(visible: boolean): T }>(
    objects: T[],
    layer: MenuArenaPreviewLayerConfig,
  ): void {
    for (const obj of objects) {
      obj.setAlpha(layer.alpha);
      obj.setVisible(layer.visible);
    }
  }
}
