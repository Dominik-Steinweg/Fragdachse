import * as Phaser from 'phaser';
import map00 from '../config/coopDefenseMaps/00-test.json';
import { WaterSurfaceRenderer } from '../arena/WaterSurfaceRenderer';
import { WaterGeometry } from '../arena/WaterGeometry';
import { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import { ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import { resolveCoopDefenseWorldMetrics } from '../world/WorldMetrics';

// A deliberately small, directly operable fixture. It imports production behavior;
// no debug hooks or alternative rules are installed in the actual game.
const width = 4096, height = 1024;
const metrics = { ...resolveCoopDefenseWorldMetrics(128, 32), offsetX: 0, offsetY: 0,
  widthPx: width, heightPx: height, maxX: width, maxY: height, gridCols: 128, gridRows: 32 };
const water = map00.water.map(c => ({ gridX: c.gridX - 52, gridY: c.gridY - 9 }));
const geometry = new WaterGeometry(water, metrics);
const status = (message: string): void => { document.querySelector('output')!.textContent = message; };

class WaterLab extends Phaser.Scene {
  private surface!: WaterSurfaceRenderer;
  private host!: HostPhysicsSystem;
  private proxy!: Phaser.GameObjects.Zone;
  private actor!: Phaser.GameObjects.Image;
  private motion: Phaser.Time.TimerEvent | null = null;
  private disposers: (() => void)[] = [];

  preload(): void {
    this.load.image('lab-grass', '/assets/sprites/gras_bg_tile.png');
    this.load.image('lab-detail', '/assets/sprites/gras_detail_tile.png');
    this.load.image('lab-badger', '/assets/sprites/pipeline-v2/badger/idle.png');
  }
  create(): void {
    this.motion = null;
    document.getElementById('zoom')!.textContent = 'Zoom 100 %';
    document.getElementById('pan')!.textContent = 'Kamera weg';
    document.getElementById('light')!.textContent = 'Lichtprobe: Tag';
    this.add.tileSprite(0, 0, width, height, 'lab-grass').setOrigin(0).setDepth(1);
    this.add.tileSprite(0, 0, width, height, 'lab-detail').setOrigin(0).setDepth(2).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.surface = new WaterSurfaceRenderer(this, { offsetX: 0, offsetY: 0, width, height }, water, 183);
    this.proxy = this.add.zone(400, 432, 24, 24);
    this.physics.add.existing(this.proxy);
    this.actor = this.add.image(400, 432, 'lab-badger').setDisplaySize(48, 48).setDepth(10).setAngle(90);
    const players = [{ active: true, physicsProxy: this.proxy }];
    this.host = new HostPhysicsSystem(this, { getAllPlayers: () => players } as never, { isHost: () => true } as never);
    this.host.setWorldMetrics(metrics);
    this.host.setWaterGeometry(geometry);
    const camera = this.cameras.main;
    camera.setBounds(0, 0, width, height).centerOn(704, 448);
    const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: 0, offsetY: 0, width, height }),
      rocks: () => [], trunks: () => [], bases: () => [] });
    index.setWaterGeometry(geometry);
    const grid = this.add.graphics().setDepth(20).setVisible(false);
    grid.lineStyle(1, 0xf5d79c, .5);
    for (let x = 0; x <= width; x += 512) grid.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 512) grid.lineBetween(0, y, width, y);
    const shade = this.add.rectangle(0, 0, width, height, 0x0d1739, 0).setOrigin(0).setDepth(30);
    const bind = (id: string, action: () => void): void => {
      const element = document.getElementById(id)!;
      element.addEventListener('click', action);
      this.disposers.push(() => element.removeEventListener('click', action));
    };
    bind('walk', () => this.move('Laufen', 220));
    bind('dash', () => this.move('Dash', 2400));
    bind('burrow', () => this.move('Buddeln', 400, true));
    bind('diagonal', () => this.move('Diagonal', 600, false, true));
    const teleport = (x: number): void => {
      this.motion?.remove(); this.body.setVelocity(0);
      const allowed = this.host.canOccupyCircle(x, 432, 12);
      if (allowed) this.body.reset(x, 432);
      status(allowed ? 'Teleport über den Teich: sicher auf Land gelandet.' : 'Wasserziel abgelehnt. Die Figur bleibt auf Land.');
    };
    bind('teleport', () => teleport(1040));
    bind('wet-teleport', () => teleport(700));
    bind('shots', () => {
      let hits = 0;
      index.querySegment(400, 432, 1050, 432, () => { hits++; return false; }, () => false);
      for (let i = 0; i < 8; i++) this.time.delayedCall(i * 140, () => {
        const bullet = this.add.rectangle(400, 432, 18, 3, 0xffefac).setDepth(16);
        this.tweens.add({ targets: bullet, x: 1050, duration: 750, onComplete: () => bullet.destroy() });
      });
      status(`Schussabfrage: ${hits} Hindernisse über dem Teich. Salve passiert das Wasser.`);
    });
    let zoom = 0;
    bind('zoom', () => { const value = [1, 1.5, .75][++zoom % 3]; camera.setZoom(value).centerOn(704, 448);
      document.getElementById('zoom')!.textContent = `Zoom ${value * 100} %`; });
    let away = false;
    bind('pan', () => { away = !away; camera.pan(away ? 3200 : 704, 448, 800);
      document.getElementById('pan')!.textContent = away ? 'Zum Teich' : 'Kamera weg'; });
    bind('grid', () => grid.setVisible(!grid.visible));
    let light = 0;
    bind('light', () => { light = (light + 1) % 3; shade.setFillStyle([0, 0x513422, 0x0d1739][light], [0, .23, .55][light]);
      document.getElementById('light')!.textContent = `Lichtprobe: ${['Tag', 'Abend', 'Nacht'][light]}`; });
    bind('rebuild', () => this.scene.restart());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.host.setWaterGeometry(null); this.surface.destroy();
      this.disposers.forEach(dispose => dispose()); this.disposers = [];
    });
    status('Bereit. Die Schaltflächen bewegen die Figur gezielt auf das Ufer zu.');
  }
  private get body(): Phaser.Physics.Arcade.Body { return this.proxy.body as Phaser.Physics.Arcade.Body; }
  private move(label: string, speed: number, underground = false, diagonal = false): void {
    this.motion?.remove();
    this.body.reset(400, diagonal ? 210 : 432);
    this.host.setPlayerBurrowed('lab', underground);
    this.actor.setAlpha(underground ? .45 : 1);
    this.body.setVelocity(speed, diagonal ? speed : 0);
    this.motion = this.time.delayedCall(1600, () => {
      this.body.setVelocity(0);
      status(`${label}: ${geometry.isCircleBlocked(this.body.center.x, this.body.center.y, 12) ? 'FEHLER: Wasser betreten' : 'auf Land gestoppt'} · Position ${Math.round(this.body.center.x)}, ${Math.round(this.body.center.y)}.`);
    });
  }
  update(): void {
    this.actor.setPosition(this.proxy.x, this.proxy.y);
    this.surface.updateResidency(this.cameras.main.worldView);
  }
}

new Phaser.Game({ type: Phaser.WEBGL, parent: 'stage', backgroundColor: '#344f3a',
  scale: { mode: Phaser.Scale.RESIZE }, render: { antialias: true },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } }, scene: WaterLab });
