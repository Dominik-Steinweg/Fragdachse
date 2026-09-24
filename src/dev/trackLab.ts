import { preloadGroundMaterials } from '../arena/GroundMaterialConfig';
import { createArenaBackground } from '../arena/ArenaBackgroundRenderer';
import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import type { ArenaLayout } from '../types';
import { ArenaVisualFactory } from '../arena/ArenaVisualFactory';
import { createOrganicDirtMargin } from '../arena/OrganicDirtMargin';
import { GroundSurfaceStreamer } from '../arena/chunks/GroundSurfaceStreamer';
import { ARENA_RENDER_CHUNK_SIZE } from '../arena/chunks/ArenaChunkGrid';
import { ChunkedRenderSurface } from '../arena/chunks/ChunkedRenderSurface';
import { preloadTrackGravelAssets } from '../arena/TrackGravelConfig';
import { hashSeededCell01 } from '../arena/CellHash';

/** Operable visual fixture using production terrain, material and streaming paths. */
class TrackLab extends Phaser.Scene {
  private ground!: GroundSurfaceStreamer;
  private seed = 17;
  private shifted = false;
  private disposers: (() => void)[] = [];
  private lastStatus = '';

  preload(): void {
    preloadGroundMaterials(this.load);
    this.load.image('bg_tracks', '/assets/sprites/BahnstreckeSchienen.png');
    preloadTrackGravelAssets(this.load);
  }

  create(): void {
    const frame = { offsetX: this.shifted ? 37 : 0, offsetY: this.shifted ? 19 : 0, width: 4096, height: 2048 };
    const tracks = [8, 16, 24].flatMap(gridX => Array.from({ length: frame.height / CELL_SIZE }, (_, gridY) => ({ gridX, gridY })));
    const soilSources = tracks.flatMap(cell => [cell, { ...cell, gridX: cell.gridX + 1 }]);
    // Small seed-dependent side pockets keep the fixture's soil margin organic.
    for (const cell of tracks) {
      if (hashSeededCell01(this.seed, cell.gridX, cell.gridY, 0x81) > 0.7) {
        soilSources.push({ ...cell, gridX: cell.gridX - 1 });
      }
      if (hashSeededCell01(this.seed, cell.gridX, cell.gridY, 0x82) > 0.7) {
        soilSources.push({ ...cell, gridX: cell.gridX + 2 });
      }
    }
    const layout: ArenaLayout = { seed: this.seed, rocks: [], trees: [], tracks, powerUpPedestals: [],
      dirt: createOrganicDirtMargin(soilSources, { maxCols: frame.width / CELL_SIZE,
        maxRows: frame.height / CELL_SIZE, rng: () => 0.5 }) };
    createArenaBackground(this, frame.offsetX + frame.width / 2, frame.offsetY + frame.height / 2, frame.width, frame.height);
    this.ground = new GroundSurfaceStreamer({ scene: this, frame, layout, groundCoverPlacements: [] });
    const rails = ArenaVisualFactory.createTracks(this, tracks, frame);
    const camera = this.cameras.main;
    const centerX = frame.offsetX + 17 * CELL_SIZE, centerY = frame.offsetY + 512;
    camera.setBounds(frame.offsetX, frame.offsetY, frame.width, frame.height).setZoom(1).centerOn(centerX, centerY);
    const grid = this.add.graphics().setDepth(20).setVisible(false).lineStyle(1, 0xffcf80, 0.7);
    for (let x = 0; x <= frame.width; x += ARENA_RENDER_CHUNK_SIZE) grid.lineBetween(frame.offsetX + x, frame.offsetY, frame.offsetX + x, frame.offsetY + frame.height);
    for (let y = 0; y <= frame.height; y += ARENA_RENDER_CHUNK_SIZE) grid.lineBetween(frame.offsetX, frame.offsetY + y, frame.offsetX + frame.width, frame.offsetY + y);
    const bind = (id: string, label: string, action: (button: HTMLElement) => void): void => {
      const button = document.getElementById(id)!;
      button.textContent = label;
      const listener = () => action(button);
      button.addEventListener('click', listener);
      this.disposers.push(() => button.removeEventListener('click', listener));
    };
    let zoomIndex = 0, away = false, railsVisible = true;
    bind('zoom', 'Zoom 100 %', button => {
      const zoom = [1, 2, 3, 0.75][++zoomIndex % 4];
      camera.setZoom(zoom).centerOn(centerX, centerY);
      button.textContent = `Zoom ${zoom * 100} %`;
    });
    bind('seed', `Seed ${this.seed}`, () => { this.seed += 1; this.scene.restart(); });
    bind('rails', 'Schienen ausblenden', button => {
      railsVisible = !railsVisible;
      rails.forEach(rail => rail.setVisible(railsVisible));
      button.textContent = railsVisible ? 'Schienen ausblenden' : 'Schienen einblenden';
    });
    bind('grid', 'Chunkgrenzen', () => grid.setVisible(!grid.visible));
    bind('pan', 'Kamera weg', button => {
      away = !away;
      camera.centerOn(away ? frame.offsetX + 3500 : centerX, centerY);
      button.textContent = away ? 'Zurück zu den Gleisen' : 'Kamera weg';
    });
    bind('offset', `Weltversatz ${frame.offsetX}, ${frame.offsetY}`, () => { this.shifted = !this.shifted; this.scene.restart(); });
    bind('rebuild', 'Neu aufbauen', () => this.scene.restart());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ground.destroy();
      this.disposers.forEach(dispose => dispose());
      this.disposers = [];
    });
  }

  update(): void {
    this.ground.updateResidency(this.cameras.main.worldView);
    ChunkedRenderSurface.drainBakeQueue(this);
    const stats = this.ground.getStats();
    const status = `Seed ${this.seed} · Zoom ${Math.round(this.cameras.main.zoom * 100)} % · ${stats.residentChunks} residente Chunks · ${stats.pendingRegions} ausstehende Bereiche`;
    if (status !== this.lastStatus) document.getElementById('status')!.textContent = this.lastStatus = status;
  }
}

new Phaser.Game({ type: Phaser.WEBGL, parent: 'stage', backgroundColor: '#354e36',
  scale: { mode: Phaser.Scale.RESIZE }, render: { antialias: true }, scene: TrackLab });
