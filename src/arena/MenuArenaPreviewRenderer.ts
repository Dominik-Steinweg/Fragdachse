import * as Phaser from 'phaser';
import {
  CELL_SIZE,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config';
import type { ArenaLayout } from '../types';
import { AutoTiler, ROCK_AUTOTILE } from './AutoTiler';
import { ArenaVisualFactory, type ArenaTreeVisual } from './ArenaVisualFactory';
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
  private dirt: Phaser.GameObjects.Image[] = [];
  private decals: Phaser.GameObjects.Image[] = [];
  private rocks: Phaser.GameObjects.Image[] = [];
  private trees: ArenaTreeVisual[] = [];
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
    this.tracks = ArenaVisualFactory.createTracks(this.scene, layout.tracks ?? [], metrics);
    this.dirt = ArenaVisualFactory.createDirt(this.scene, layout.dirt ?? [], metrics);
    this.decals = ArenaVisualFactory.createDecals(this.scene, layout.decals ?? [], metrics);
    this.rocks = this.createRocks(layout);
    this.trees = ArenaVisualFactory.createTrees(this.scene, layout.trees ?? [], metrics);

    this.applyLayerStyle(this.tracks, view.tracks);
    this.applyLayerStyle(this.dirt, view.dirt);
    this.applyLayerStyle(this.decals, view.decals);
    this.applyLayerStyle(this.rocks, view.rocks);
    this.applyLayerStyle(this.trees.map((tree) => tree.trunk), view.trunks);
    this.applyLayerStyle(this.trees.map((tree) => tree.canopy), view.canopies);

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
    for (const obj of this.dirt) obj.setVisible(visible && this.config.view.dirt.visible);
    for (const obj of this.decals) obj.setVisible(visible && this.config.view.decals.visible);
    for (const obj of this.rocks) obj.setVisible(visible && this.config.view.rocks.visible);
    for (const tree of this.trees) {
      tree.trunk.setVisible(visible && this.config.view.trunks.visible);
      tree.canopy.setVisible(visible && this.config.view.canopies.visible);
    }
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
    for (const obj of this.dirt) obj.destroy();
    for (const obj of this.decals) obj.destroy();
    for (const obj of this.rocks) obj.destroy();
    for (const tree of this.trees) {
      tree.trunk.destroy();
      tree.canopy.destroy();
    }
    this.tracks = [];
    this.dirt = [];
    this.decals = [];
    this.rocks = [];
    this.trees = [];
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