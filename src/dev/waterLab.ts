import * as Phaser from 'phaser';
import map00 from '../config/coopDefenseMaps/00-test.json';
import { WaterSurfaceRenderer } from '../arena/WaterSurfaceRenderer';
import { WaterGeometry } from '../arena/WaterGeometry';
import { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import { ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import { applyGridCornerAssist } from '../systems/GridCornerAssist';
import { PLAYER_SIZE } from '../config';
import { resolveCoopDefenseWorldMetrics } from '../world/WorldMetrics';
import { buildLobbyWorldLayout } from '../arena/LobbyWorldLayout';
import { WaterSurfaceModel } from '../arena/WaterSurfaceModel';
import { CELL_SIZE } from '../config';
import type { WaterCell } from '../types';

// A deliberately small, directly operable fixture. It imports production behavior;
// no debug hooks or alternative rules are installed in the actual game.
const width = 4096, height = 1024;
const metrics = { ...resolveCoopDefenseWorldMetrics(128, 32), offsetX: 0, offsetY: 0,
  widthPx: width, heightPx: height, maxX: width, maxY: height, gridCols: 128, gridRows: 32 };
// Select the largest connected pond from live authored data, without copying its silhouette.
function largestPond(cells: readonly WaterCell[]): WaterCell[] {
  const remaining = new Map(cells.map(c => [`${c.gridX},${c.gridY}`, c]));
  let largest: WaterCell[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!;
    const group = [first];
    remaining.delete(`${first.gridX},${first.gridY}`);
    for (let i = 0; i < group.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${group[i].gridX + dx},${group[i].gridY + dy}`;
      const cell = remaining.get(key);
      if (cell) { remaining.delete(key); group.push(cell); }
    }
    if (group.length > largest.length) largest = group;
  }
  return largest;
}
const lobby = buildLobbyWorldLayout();
const fixtures = [
  { name: 'Testkarte 00', seed: 183, water: map00.water.map(c => ({ gridX: c.gridX - 52, gridY: c.gridY - 9 })) },
  { name: 'Lobby-See', seed: lobby.seed, water: largestPond(lobby.water ?? []) },
  { name: 'Ufer / Chunk-Grenzen', seed: 183, water: [
    ...Array.from({ length: 16 }, (_, i) => ({ gridX: 12 + i % 4, gridY: 12 + Math.floor(i / 4) }))
      .filter(c => c.gridX !== 14 || c.gridY !== 12),
    { gridX: 11, gridY: 14 },
  ] },
];
const status = (message: string): void => { document.querySelector('output')!.textContent = message; };

class WaterLab extends Phaser.Scene {
  private surface!: WaterSurfaceRenderer;
  private host!: HostPhysicsSystem;
  private proxy!: Phaser.GameObjects.Zone;
  private actor!: Phaser.GameObjects.Image;
  private motion: Phaser.Time.TimerEvent | null = null;
  private movement: { speed: number; dx: number; dy: number; assist: boolean } | null = null;
  private readonly assistedDirection = { dx: 0, dy: 0 };
  private disposers: (() => void)[] = [];
  private fixtureIndex = 0;
  private geometry!: WaterGeometry;
  private startX = 400;
  private startY = 432;
  private farX = 1040;
  private wetX = 700;

  preload(): void {
    this.load.image('lab-grass', '/assets/sprites/gras_bg_tile.png');
    this.load.image('lab-detail', '/assets/sprites/gras_detail_tile.png');
    this.load.image('lab-badger', '/assets/sprites/pipeline-v2/badger/idle.png');
  }
  create(): void {
    const fixture = fixtures[this.fixtureIndex], water = fixture.water;
    const geometry = this.geometry = new WaterGeometry(water, metrics);
    const minX = Math.min(...water.map(c => c.gridX)) * CELL_SIZE;
    const maxX = (Math.max(...water.map(c => c.gridX)) + 1) * CELL_SIZE;
    const minY = Math.min(...water.map(c => c.gridY)) * CELL_SIZE;
    const maxY = (Math.max(...water.map(c => c.gridY)) + 1) * CELL_SIZE;
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const model = new WaterSurfaceModel(water);
    const tip = water.find(c => [1, 4, 16, 64].includes(model.masks.get(`${c.gridX},${c.gridY}`)!));
    this.startX = this.fixtureIndex === 0 ? 400 : minX - 64;
    this.startY = this.fixtureIndex === 0 ? 432 : ((tip?.gridY ?? Math.floor(centerY / CELL_SIZE)) + .5) * CELL_SIZE;
    this.farX = this.fixtureIndex === 0 ? 1040 : maxX + 64;
    const wetCell = water.find(c => c.gridY === Math.floor(this.startY / CELL_SIZE))!;
    this.wetX = this.fixtureIndex === 0 ? 700 : (wetCell.gridX + .5) * CELL_SIZE;
    this.motion = null;
    this.movement = null;
    document.getElementById('zoom')!.textContent = 'Zoom 100 %';
    document.getElementById('pan')!.textContent = 'Kamera weg';
    document.getElementById('light')!.textContent = 'Lichtprobe: Tag';
    document.getElementById('fixture')!.textContent = `Ansicht: ${fixture.name}`;
    const focusButton = document.getElementById('focus') as HTMLButtonElement;
    focusButton.disabled = !tip;
    this.add.tileSprite(0, 0, width, height, 'lab-grass').setOrigin(0).setDepth(1);
    this.add.tileSprite(0, 0, width, height, 'lab-detail').setOrigin(0).setDepth(2).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.surface = new WaterSurfaceRenderer(this, { offsetX: 0, offsetY: 0, width, height }, water, fixture.seed);
    this.proxy = this.add.zone(this.startX, this.startY, PLAYER_SIZE, PLAYER_SIZE);
    this.physics.add.existing(this.proxy);
    this.body.setCircle(PLAYER_SIZE / 2);
    this.actor = this.add.image(this.startX, this.startY, 'lab-badger').setDisplaySize(48, 48).setDepth(10).setAngle(90);
    const players = [{ active: true, physicsProxy: this.proxy }];
    this.host = new HostPhysicsSystem(this, { getAllPlayers: () => players } as never, { isHost: () => true } as never);
    this.host.setWorldMetrics(metrics);
    this.host.setWaterGeometry(geometry);
    const camera = this.cameras.main;
    camera.setBounds(0, 0, width, height).centerOn(centerX, centerY);
    const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: 0, offsetY: 0, width, height }),
      rocks: () => [], trunks: () => [], bases: () => [] });
    index.setWaterGeometry(geometry);
    const grid = this.add.graphics().setDepth(20).setVisible(false);
    grid.lineStyle(1, 0xf5d79c, .5);
    for (let x = 0; x <= width; x += 512) grid.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 512) grid.lineBetween(0, y, width, y);
    const cells = this.add.graphics().setDepth(21).setVisible(false);
    cells.lineStyle(1, 0xffffff, .25);
    for (let x = 0; x <= width; x += CELL_SIZE) cells.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += CELL_SIZE) cells.lineBetween(0, y, width, y);
    cells.lineStyle(1, 0xffa476, .9);
    for (const cell of water) cells.strokeRect(cell.gridX * CELL_SIZE, cell.gridY * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    if (tip) {
      cells.lineStyle(3, 0xffdb6e, 1);
      cells.strokeRect(tip.gridX * CELL_SIZE, tip.gridY * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
    const shade = this.add.rectangle(0, 0, width, height, 0x0d1739, 0).setOrigin(0).setDepth(30);
    const bind = (id: string, action: () => void): void => {
      const element = document.getElementById(id)!;
      element.addEventListener('click', action);
      this.disposers.push(() => element.removeEventListener('click', action));
    };
    bind('walk', () => this.move('Laufen', 220));
    bind('dash', () => this.move('Dash', 2400));
    bind('burrow', () => this.move('Buddeln', 400, true));
    bind('diagonal', () => this.move('Diagonal', 320, false, true));
    const teleport = (x: number): void => {
      this.motion?.remove(); this.movement = null; this.body.setVelocity(0);
      const allowed = this.host.canOccupyCircle(x, this.startY, PLAYER_SIZE / 2);
      if (allowed) this.body.reset(x, this.startY);
      status(allowed ? 'Teleport über den Teich: sicher auf Land gelandet.' : 'Wasserziel abgelehnt. Die Figur bleibt auf Land.');
    };
    bind('teleport', () => teleport(this.farX));
    bind('wet-teleport', () => teleport(this.wetX));
    bind('shots', () => {
      let hits = 0;
      index.querySegment(this.startX, this.startY, this.farX, this.startY, () => { hits++; return false; }, () => false);
      for (let i = 0; i < 8; i++) this.time.delayedCall(i * 140, () => {
        const bullet = this.add.rectangle(this.startX, this.startY, 18, 3, 0xffefac).setDepth(16);
        this.tweens.add({ targets: bullet, x: this.farX, duration: 750, onComplete: () => bullet.destroy() });
      });
      status(`Schussabfrage: ${hits} Hindernisse über dem Teich. Salve passiert das Wasser.`);
    });
    let zoom = 0;
    bind('zoom', () => { const value = [1, 1.5, .75][++zoom % 3]; camera.setZoom(value).centerOn(centerX, centerY);
      document.getElementById('zoom')!.textContent = `Zoom ${value * 100} %`; });
    let away = false;
    bind('pan', () => { away = !away; camera.pan(away ? 3200 : centerX, centerY, 800);
      document.getElementById('pan')!.textContent = away ? 'Zum Teich' : 'Kamera weg'; });
    bind('grid', () => grid.setVisible(!grid.visible));
    bind('cells', () => cells.setVisible(!cells.visible));
    bind('focus', () => {
      if (!tip) return;
      camera.centerOn((tip.gridX + .5) * CELL_SIZE, (tip.gridY + .5) * CELL_SIZE);
      status(`Schmaler Vorsprung: Rasterfeld (${tip.gridX}, ${tip.gridY}). Im Raster gelb markiert.`);
    });
    bind('fixture', () => { this.fixtureIndex = (this.fixtureIndex + 1) % fixtures.length; this.scene.restart(); });
    let light = 0;
    bind('light', () => { light = (light + 1) % 3; shade.setFillStyle([0, 0x513422, 0x0d1739][light], [0, .23, .55][light]);
      document.getElementById('light')!.textContent = `Lichtprobe: ${['Tag', 'Abend', 'Nacht'][light]}`; });
    bind('rebuild', () => this.scene.restart());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.host.setWaterGeometry(null); this.surface.destroy();
      this.disposers.forEach(dispose => dispose()); this.disposers = [];
    });
    const startedAt = this.time.now;
    this.time.addEvent({ delay: 250, loop: true, callback: () => {
      document.getElementById('elapsed')!.textContent = `Animation: ${((this.time.now - startedAt) / 1000).toFixed(1)} s`;
    } });
    status(`${fixture.name}: bereit. Raster zeigt gesperrte Wasserfelder; gelb markiert den schmalen Vorsprung.`);
  }
  private get body(): Phaser.Physics.Arcade.Body { return this.proxy.body as Phaser.Physics.Arcade.Body; }
  private move(label: string, speed: number, underground = false, diagonal = false): void {
    this.motion?.remove();
    this.body.reset(this.startX, this.startY - (diagonal ? 64 : 0));
    this.host.setPlayerBurrowed('lab', underground);
    this.actor.setAlpha(underground ? .45 : 1);
    this.movement = { speed, dx: 1, dy: diagonal ? 1 : 0, assist: !underground && label !== 'Dash' };
    this.motion = this.time.delayedCall(1600, () => {
      this.movement = null; this.body.setVelocity(0);
      status(`${label}: ${this.geometry.isCircleBlocked(this.body.center.x, this.body.center.y, PLAYER_SIZE / 2) ? 'FEHLER: Wasser betreten' : 'auf Land gestoppt'} · Position ${Math.round(this.body.center.x)}, ${Math.round(this.body.center.y)}.`);
    });
  }
  update(): void {
    if (this.movement) {
      const { speed, dx, dy, assist } = this.movement;
      const direction = this.assistedDirection;
      direction.dx = dx; direction.dy = dy;
      if (assist) applyGridCornerAssist(this.body.center.x, this.body.center.y, dx, dy, metrics,
        (gx, gy) => this.geometry.hasCell(gx, gy), direction);
      const scale = speed / Math.hypot(direction.dx, direction.dy);
      this.body.setVelocity(direction.dx * scale, direction.dy * scale);
    }
    this.actor.setPosition(this.proxy.x, this.proxy.y);
    this.surface.updateResidency(this.cameras.main.worldView);
  }
}

new Phaser.Game({ type: Phaser.WEBGL, parent: 'stage', backgroundColor: '#344f3a',
  scale: { mode: Phaser.Scale.RESIZE }, render: { antialias: true },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } }, scene: WaterLab });
