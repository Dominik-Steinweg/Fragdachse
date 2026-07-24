import * as Phaser from 'phaser';
import {
  CELL_SIZE,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config';
import type { ArenaLayout } from '../types';
import { AutoTiler, ROCK_AUTOTILE } from './AutoTiler';
import { ArenaVisualFactory } from './ArenaVisualFactory';
import type { MenuArenaPreviewConfig, MenuArenaPreviewLayerConfig } from './MenuArenaPreviewConfig';
import { RockGridIndex } from './RockGridIndex';
import { ShadowSystem } from '../effects/ShadowSystem';

export class MenuArenaPreviewRenderer {
  private background: Phaser.GameObjects.Image | null = null;
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
  private bakedLayers: Array<{ layer: Phaser.GameObjects.RenderTexture; config: MenuArenaPreviewLayerConfig }> = [];
  private shadows: ShadowSystem | null = null;

  constructor(
    private scene: Phaser.Scene,
    private config: MenuArenaPreviewConfig,
  ) {}

  build(): void {
    this.destroy();

    const { view, layout } = this.config;
    const { bounds } = view;
    this.background = this.scene.add
      .image(bounds.offsetX + bounds.width * 0.5, bounds.offsetY + bounds.height * 0.5, view.backgroundTextureKey)
      .setDisplaySize(bounds.width, bounds.height)
      .setDepth(DEPTH.GRASS)
      .setTint(view.backgroundTint)
      .setAlpha(view.backgroundAlpha);

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
    this.shadows = new ShadowSystem(this.scene);
    this.shadows.setWorldBoundsOverride({
      minX: bounds.offsetX,
      minY: bounds.offsetY,
      maxX: bounds.offsetX + bounds.width,
      maxY: bounds.offsetY + bounds.height,
    });
    this.shadows.rebuildStaticLayoutShadows(layout, {
      offsetX: bounds.offsetX,
      offsetY: bounds.offsetY,
    });
    // Unsichtbare Layer werden gar nicht erst erzeugt: Sie wuerden sonst als Objekte in der
    // Display-Liste liegen und jeden Frame durch Update- und Depth-Sort-Paesse laufen,
    // ohne je ein Pixel beizutragen.
    this.tracks = view.tracks.visible
      ? ArenaVisualFactory.createTracks(this.scene, layout.tracks ?? [], metrics)
      : [];
    this.applyLayerStyle(this.tracks, view.tracks);

    // Reihenfolge der Tiefenbaender bleibt exakt erhalten: Boden < Decals < Fels-Schatten
    // < Felsen < Kronen-Schatten < Kronen. Die Schatten liegen als eigene Graphics dazwischen.
    this.bakeLayer(ArenaVisualFactory.createDirt(this.scene, layout.dirt ?? [], metrics), DEPTH.DIRT, view.dirt);
    this.bakeLayer(ArenaVisualFactory.createDecals(this.scene, layout.decals ?? [], metrics), DEPTH.DECALS, view.decals);
    this.bakeLayer(this.createRocks(layout), DEPTH.ROCKS, view.rocks);

    const trees = ArenaVisualFactory.createTrees(this.scene, layout.trees ?? [], metrics);
    this.bakeLayer(trees.map((tree) => tree.trunk), DEPTH.CANOPY - 0.01, view.trunks);
    this.bakeLayer(trees.map((tree) => tree.canopy), DEPTH.CANOPY, view.canopies);

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

  setVisible(visible: boolean): void {
    this.background?.setVisible(visible);
    this.shadows?.setVisible(visible);
    this.leftSidebar?.setVisible(visible && this.config.view.frame.showSidebars);
    this.rightSidebar?.setVisible(visible && this.config.view.frame.showSidebars);
    this.arenaShade?.setVisible(visible);
    this.screenShade?.setVisible(visible);
    for (const obj of this.tracks) obj.setVisible(visible && this.config.view.tracks.visible);
    for (const { layer, config } of this.bakedLayers) layer.setVisible(visible && config.visible);
  }

  destroy(): void {
    this.background?.destroy();
    this.leftSidebar?.destroy();
    this.rightSidebar?.destroy();
    this.arenaShade?.destroy();
    this.screenShade?.destroy();
    this.shadows?.destroy();
    this.background = null;
    this.leftSidebar = null;
    this.rightSidebar = null;
    this.arenaShade = null;
    this.screenShade = null;
    this.shadows = null;
    for (const obj of this.tracks) obj.destroy();
    for (const { layer } of this.bakedLayers) layer.destroy();
    this.tracks = [];
    this.bakedLayers = [];
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
  ): void {
    if (images.length === 0) return;

    // Dauerhaft unsichtbare Baender tragen kein Pixel bei und werden komplett verworfen.
    if (!layer.visible || layer.alpha <= 0) {
      for (const img of images) img.destroy();
      return;
    }

    for (const img of images) img.setAlpha(layer.alpha);

    const { bounds } = this.config.view;
    const baked = this.scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
    baked.setOrigin(0, 0);
    baked.setDepth(depth);
    baked.camera.setScroll(bounds.offsetX, bounds.offsetY);
    baked.draw(images);
    baked.render();

    for (const img of images) img.destroy();

    this.bakedLayers.push({ layer: baked, config: layer });
  }

  private createRocks(layout: ArenaLayout): Phaser.GameObjects.Image[] {
    const result: Phaser.GameObjects.Image[] = [];
    const rockGrid = new RockGridIndex(layout.rocks, {
      cols: Math.floor(this.config.view.bounds.width / CELL_SIZE),
      rows: Math.floor(this.config.view.bounds.height / CELL_SIZE),
    });
    const isOccupied = (gridX: number, gridY: number) => rockGrid.isOccupiedWithBorder(gridX, gridY);

    for (const { gridX, gridY } of layout.rocks) {
      const worldX = this.config.view.bounds.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = this.config.view.bounds.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const frame = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      result.push(ArenaVisualFactory.createRock(this.scene, worldX, worldY, frame));
    }

    return result;
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