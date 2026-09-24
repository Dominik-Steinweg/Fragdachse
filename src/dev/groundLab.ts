import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, GAME_WIDTH, GAME_HEIGHT, CANOPY_RADIUS } from '../config';
import type { ArenaLayout, DirtCell } from '../types';
import { preloadGroundMaterials } from '../arena/GroundMaterialConfig';
import { createArenaBackground } from '../arena/ArenaBackgroundRenderer';
import { preloadGroundCoverAssets } from '../arena/GroundCoverConfig';
import { generateGroundCoverPlacements } from '../arena/GroundCoverField';
import { buildLobbyWorldLayout, LOBBY_WORLD_WIDTH_CELLS, LOBBY_WORLD_HEIGHT_CELLS } from '../arena/LobbyWorldLayout';
import { GroundSurfaceStreamer } from '../arena/chunks/GroundSurfaceStreamer';
import { ChunkedRenderSurface } from '../arena/chunks/ChunkedRenderSurface';
import { ARENA_RENDER_CHUNK_SIZE } from '../arena/chunks/ArenaChunkGrid';
import { AutoTiler, ROCK_AUTOTILE } from '../arena/AutoTiler';
import { ArenaVisualFactory } from '../arena/ArenaVisualFactory';
import { ROCK_BLOB_SURFACE_PROFILE } from '../arena/BlobSurfaceProfile';
import { resolveBlobSurfaceCornerTints } from '../arena/BlobSurfaceShading';
import { RenderResolutionController, getRenderScale } from '../graphics/RenderResolution';
import { createWebGLStartupContext } from '../utils/webglContext';

const state = { zoom: 1, cover: true, grid: false, shifted: false, away: false };
const element = (id: string): HTMLElement => document.getElementById(id)!;

/** Deliberately adversarial topology; these fixtures are never written to authored layouts. */
function materialFixture(seed: number): ArenaLayout {
  const dirt: DirtCell[] = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) {
    const patch = x >= 5 && x <= 23 && y >= 7 && y <= 23;
    const hole = x >= 11 && x <= 16 && y >= 12 && y <= 17;
    const diagonal = x >= 28 && x < 43 && y >= 5 && y < 27 && x < 28 + y * .6;
    const strip = x >= 46 && x <= 48 && y >= 8 && y <= 25;
    const islands = (x === 53 && y === 11) || (x >= 52 && x <= 55 && y >= 19 && y <= 22);
    const expanse = y >= 32 && x < 70;
    const remote = x >= 210 && x < 240 && y >= 8 && y < 30;
    if ((patch && !hole) || diagonal || strip || islands || expanse || remote) dirt.push({ gridX: x, gridY: y });
  }
  return { seed, rocks: [], trees: [], tracks: [], dirt, decals: [], powerUpPedestals: [] };
}

class GroundLab extends Phaser.Scene {
  private ground!: GroundSurfaceStreamer;
  private cleanup: (() => void)[] = [];
  private center = { x: 960, y: 540 };
  private lastStatus = '';
  private bakeMs = 0;

  preload(): void {
    preloadGroundMaterials(this.load);
    preloadGroundCoverAssets(this.load);
    this.load.spritesheet('rocks', './assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    this.load.image('ground-lab-canopy', './assets/sprites/canopies/canopy01.png');
    this.load.image('ground-lab-player', './assets/sprites/pipeline-v2/badger/idle.png');
  }

  create(): void {
    const forest = (element('fixture') as HTMLSelectElement).value === 'forest';
    const seed = Number((element('seed') as HTMLInputElement).value) | 0;
    const layout = forest ? buildLobbyWorldLayout() : materialFixture(seed);
    // Lab variation changes only presentation. The original authored layout is a fresh copy.
    layout.seed = seed;
    const width = forest ? LOBBY_WORLD_WIDTH_CELLS * CELL_SIZE : 8192;
    const height = forest ? LOBBY_WORLD_HEIGHT_CELLS * CELL_SIZE : 2048;
    const frame = { offsetX: state.shifted ? 37 : 0, offsetY: state.shifted ? 19 : 0, width, height };
    const metrics = { ...frame, gridCols: width / CELL_SIZE, gridRows: height / CELL_SIZE };
    createArenaBackground(this, frame.offsetX + width / 2, frame.offsetY + height / 2, width, height);
    // Physical scale reference, in world space so it follows the selected zoom.
    const rulerX = frame.offsetX + 90, rulerY = frame.offsetY + 80;
    this.add.graphics().setDepth(1000).lineStyle(1, 0xeee3c7, .9)
      .lineBetween(rulerX, rulerY, rulerX + CELL_SIZE, rulerY)
      .lineBetween(rulerX, rulerY - 4, rulerX, rulerY + 4)
      .lineBetween(rulerX + CELL_SIZE, rulerY - 4, rulerX + CELL_SIZE, rulerY + 4);
    this.add.text(rulerX, rulerY + 8, '1 m', { fontSize: '13px', color: '#eee3c7' }).setDepth(1000);
    this.ground = new GroundSurfaceStreamer({ scene: this, frame,
      layout: { ...layout, tracks: [], decals: [] },
      groundCoverPlacements: state.cover ? generateGroundCoverPlacements({ seed, dirt: layout.dirt, metrics }) : [],
    });
    if (forest) {
      const cells = new Set(layout.rocks.map(c => `${c.gridX}:${c.gridY}`));
      const occupied = (x: number, y: number) => cells.has(`${x}:${y}`);
      for (const cell of layout.rocks) ArenaVisualFactory.createRock(this,
        frame.offsetX + (cell.gridX + .5) * CELL_SIZE, frame.offsetY + (cell.gridY + .5) * CELL_SIZE,
        AutoTiler.getFrame(AutoTiler.computeMask(cell.gridX, cell.gridY, occupied), ROCK_AUTOTILE),
        resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, cell.gridX, cell.gridY, occupied));
      for (const tree of layout.trees) this.add.image(frame.offsetX + (tree.gridX + .5) * CELL_SIZE,
        frame.offsetY + (tree.gridY + .5) * CELL_SIZE, 'ground-lab-canopy')
        .setDisplaySize(CANOPY_RADIUS * 2, CANOPY_RADIUS * 2).setDepth(DEPTH.CANOPY);
      this.add.image(frame.offsetX + 800, frame.offsetY + 690, 'ground-lab-player').setDisplaySize(48, 48).setDepth(DEPTH.PLAYERS);
    }
    const camera = this.cameras.main;
    // This lab has no screen-fixed world UI. Default camera origin keeps Phaser's
    // centerOn, bounds and worldView consistent at the production render scale.
    camera.setOrigin(.5, .5).setBounds(frame.offsetX, frame.offsetY, width, height);
    this.center = { x: frame.offsetX + (state.away && !forest ? 7350 : 960), y: frame.offsetY + 540 };
    const syncCamera = (): void => {
      camera.setZoom(getRenderScale(this.scale) * state.zoom).centerOn(this.center.x, this.center.y);
    };
    syncCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, syncCamera);
    this.cleanup.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, syncCamera));
    const grid = this.add.graphics().setDepth(1000).setVisible(state.grid).lineStyle(1, 0xe9c176, .75);
    for (let x = 0; x <= width; x += ARENA_RENDER_CHUNK_SIZE) grid.lineBetween(frame.offsetX + x, frame.offsetY, frame.offsetX + x, frame.offsetY + height);
    for (let y = 0; y <= height; y += ARENA_RENDER_CHUNK_SIZE) grid.lineBetween(frame.offsetX, frame.offsetY + y, frame.offsetX + width, frame.offsetY + y);
    const bind = (id: string, event: string, action: () => void): void => {
      element(id).addEventListener(event, action);
      this.cleanup.push(() => element(id).removeEventListener(event, action));
    };
    const labels = (): void => {
      element('zoom').textContent = `Zoom ${Math.round(state.zoom * 100)} %`;
      element('cover').textContent = state.cover ? 'Büschel an' : 'Büschel aus';
      element('cover').setAttribute('aria-pressed', String(state.cover));
      element('grid').setAttribute('aria-pressed', String(state.grid));
      element('offset').textContent = `Weltversatz ${frame.offsetX}, ${frame.offsetY}`;
      element('pan').textContent = state.away ? 'Zurück zur Probe' : 'Kamera weg';
    };
    bind('fixture', 'change', () => { state.away = false; this.scene.restart(); });
    bind('seed', 'change', () => this.scene.restart());
    bind('zoom', 'click', () => { state.zoom = state.zoom === 1 ? 1.5 : state.zoom === 1.5 ? 2 : state.zoom === 2 ? .75 : 1; syncCamera(); labels(); });
    bind('cover', 'click', () => { state.cover = !state.cover; this.scene.restart(); });
    bind('grid', 'click', () => { state.grid = !state.grid; grid.setVisible(state.grid); labels(); });
    bind('offset', 'click', () => { state.shifted = !state.shifted; this.scene.restart(); });
    bind('rebuild', 'click', () => this.scene.restart());
    bind('pan', 'click', () => {
      state.away = !state.away;
      this.center.x = frame.offsetX + (state.away ? width - 600 : 960);
      syncCamera(); labels();
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
      this.center = { x: camera.scrollX + camera.width / 2, y: camera.scrollY + camera.height / 2 };
    });
    labels();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ground.destroy();
      this.cleanup.forEach(dispose => dispose()); this.cleanup = [];
      this.input.removeAllListeners();
    });
  }

  update(): void {
    this.ground.updateResidency(this.cameras.main.worldView);
    const start = performance.now();
    ChunkedRenderSurface.flushBakeBudget(this);
    this.bakeMs = Math.max(this.bakeMs * .98, performance.now() - start);
    const stats = this.ground.getStats();
    const text = `${stats.residentChunks} residente Chunks · ${stats.pendingRegions} ausstehende Bakes · ${(stats.allocatedPixels * 4 / 1048576).toFixed(1)} MiB Chunktexturen · Bake ${this.bakeMs.toFixed(1)} ms · ${Math.round(this.game.loop.actualFps)} FPS`;
    if (text !== this.lastStatus) element('status').textContent = this.lastStatus = text;
  }
}

const startup = createWebGLStartupContext();
if (!startup) throw new Error('WebGL ist für das Boden-Lab erforderlich.');
const game = new Phaser.Game({ type: Phaser.WEBGL, parent: 'stage', canvas: startup.canvas,
  context: startup.context as unknown as CanvasRenderingContext2D,
  width: GAME_WIDTH, height: GAME_HEIGHT, backgroundColor: '#172017',
  smoothPixelArt: startup.rendererType === 'webgl1',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: GroundLab,
});
game.events.once(Phaser.Core.Events.READY, () => new RenderResolutionController(game).install());
