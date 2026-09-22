import * as Phaser from 'phaser';
import { runFogGpuContracts } from './fogGpuContracts';
import { GroundFogSystem } from '../effects/groundFog/GroundFogSystem';
import { FOG, type FogDebug, type FogQuality } from '../effects/groundFog/FogConfig';
import { WaterSurfaceRenderer } from '../arena/WaterSurfaceRenderer';
import { AutoTiler, ROCK_AUTOTILE, DIRT_AUTOTILE } from '../arena/AutoTiler';
import { LightingSystem } from '../effects/LightingSystem';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { createMovementVisualSample, type MovementVisualSource } from '../effects/MovementStepSampler';
import { ProjectilePathCursor, type ProjectilePathPoint } from '../projectile/ProjectileFlightPath';
import { ProjectilePresentationRuntime } from '../projectile/ProjectilePresentationRuntime';
import { createBaseSurfaceImages } from '../entities/BaseVisuals';
import { resolveWorldMetrics } from '../world/WorldMetrics';
import { SmokeSystem } from '../effects/SmokeSystem';
import { PowerUpRenderer } from '../powerups/PowerUpRenderer';
import { AdrenalineEssenceGpuRenderer } from '../adrenalineEssence/AdrenalineEssenceGpuRenderer';
import { CameraFeedbackController } from '../effects/camera/CameraFeedbackController';
import { impactHeavy } from '../effects/camera/cameraFeedbackPresets';
import { DEPTH } from '../config';
import ballisticContent from '../loadout/content/data/weapons-ballistic.json';
import streamContent from '../loadout/content/data/weapons-flame-air.json';
import { FlameRenderer } from '../effects/FlameRenderer';
import { LeafBlowerRenderer } from '../effects/LeafBlowerRenderer';
import { GpuVfxSystem } from '../effects/gpu/GpuVfxSystem';
import { TerrainColorSnapshot } from '../arena/TerrainColorSnapshot';
import { TrainRenderer, preloadTrainMaterialAssets } from '../train/TrainRenderer';
import { TRAIN } from '../train/TrainConfig';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const value = (id: string): string => element<HTMLInputElement>(id).value;
const number = (id: string): number => Number(value(id));
const controlIds = ['scenario', 'seed', 'mode', 'quality', 'time', 'strength', 'debug', 'opacity', 'detail', 'windX', 'windY', 'reaction', 'weapon', 'motionPattern', 'shotPattern', 'shooters', 'pellets'];
const query = new URLSearchParams(location.search);
for (const id of controlIds) if (query.has(id)) element<HTMLInputElement>(id).value = query.get(id)!;
const frame = { offsetX: 0, offsetY: 0, width: 8192, height: 3072 };
const cells = (x: number, y: number, w: number, h: number) => Array.from({ length: w * h }, (_, i) => ({ gridX: x + i % w, gridY: y + Math.floor(i / w) }));

class FogLab extends Phaser.Scene {
  private fog!: GroundFogSystem;
  private water!: WaterSurfaceRenderer;
  private light!: LightingSystem;
  private smoke: SmokeSystem | null = null;
  private pickups: PowerUpRenderer | null = null;
  private essence: AdrenalineEssenceGpuRenderer | null = null;
  private fadingBase: { image: Phaser.GameObjects.Image; removeAt: number }[] = [];
  private quality!: GraphicsQualityController;
  private cameraFeedback!: CameraFeedbackController;
  private flame: FlameRenderer | null = null;
  private leaf: LeafBlowerRenderer | null = null;
  private leafPresentation: ProjectilePresentationRuntime | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private train: TrainRenderer | null = null;
  private baseScroll = { x: 0, y: 0 };
  private obstacles = new Map<string, Phaser.GameObjects.Image[]>();
  private elapsed = 0;
  private paused = false;
  private advance = 0;
  private motion = false;
  private firing = false;
  private fireOnce = false;
  private pan = false;
  private revision = 0;
  private actor!: Phaser.GameObjects.Image;
  private enemy!: Phaser.GameObjects.Image;
  private readonly playerSample = createMovementVisualSample();
  private readonly enemySample = createMovementVisualSample();
  private readonly playerSource: MovementVisualSource = { readMovementVisualSample: out => Object.assign(out, this.playerSample) };
  private readonly enemySource: MovementVisualSource = { readMovementVisualSample: out => Object.assign(out, this.enemySample) };
  private shots: { id: number; angle: number; image: Phaser.GameObjects.Rectangle; y: number; age: number; born: number; style: string; index: number; points: ProjectilePathPoint[]; cursor: ProjectilePathCursor }[] = [];
  private nextProjectileId = 1;
  private nextShot = 0;
  private nextExplosion = 0;
  private disposers: (() => void)[] = [];
  private report: unknown = null;
  private lastFrameAt = 0;
  private bench: { variant: number; run: number; start: number; samples: number[]; frames: number[]; gpu: number[]; gpuSample: number; results: unknown[]; settings: Record<string, string> } | null = null;
  preload(): void {
    preloadTrainMaterialAssets(this.load);
    this.load.image('fog-grass', '/assets/sprites/gras_bg_tile.png');
    this.load.image('fog-detail', '/assets/sprites/gras_detail_tile.png');
    this.load.image('powerup_hp', '/assets/sprites/16x16HP.png');
    this.load.image('fog-badger', '/assets/sprites/pipeline-v2/badger/idle.png');
    this.load.spritesheet('fog-rock', '/assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('fog-dirt', '/assets/sprites/dirt47blob.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('fog-base', '/assets/sprites/base47blob.png', { frameWidth: 32, frameHeight: 32 });
  }
  create(): void {
    frame.width = value('scenario') === 'camera' ? 12288 : 8192;
    frame.height = value('scenario') === 'camera' ? 4096 : 3072;
    this.elapsed = 0; this.shots = []; this.nextShot = 0; this.nextExplosion = 4000; this.obstacles.clear(); this.fadingBase = []; this.advance = 0;
    this.fireOnce = false; this.nextProjectileId = 1;
    if (!this.bench) { this.motion = this.firing = this.pan = this.paused = false; }
    element('pause').textContent = this.paused ? 'Weiter' : 'Pause';
    element('shots').textContent = this.firing ? 'Feuer stoppen' : 'Dauerfeuer';
    element('zoom').textContent = 'Zoom 100 %';
    this.lastFrameAt = performance.now(); if (this.bench) this.bench.start = this.lastFrameAt;
    this.quality = new GraphicsQualityController(value('quality') as FogQuality); this.quality.attach(this);
    this.add.tileSprite(0, 0, frame.width, frame.height, 'fog-grass').setOrigin(0).setDepth(DEPTH.GRASS);
    this.add.tileSprite(0, 0, frame.width, frame.height, 'fog-detail').setOrigin(0).setDepth(DEPTH.GRASS + .1).setBlendMode(Phaser.BlendModes.MULTIPLY);
    const water = cells(8, 13, 13, 14).filter(c => !(c.gridX < 11 && c.gridY < 16) && !(c.gridX > 18 && c.gridY > 23));
    this.water = new WaterSurfaceRenderer(this, frame, water, number('seed'));
    this.tiles(cells(27, 9, 14, 24), 'fog-dirt', DEPTH.DIRT);
    this.fog = new GroundFogSystem(this, frame, number('seed'), water);
    this.fog.measureGpu = true;
    const scenario = value('scenario');
    if (scenario === 'train') this.train = new TrainRenderer(this);
    if (value('weapon') === 'flame' || value('weapon') === 'leaf_blower') {
      this.gpuVfx = new GpuVfxSystem(this);
      this.flame = new FlameRenderer(this); this.flame.generateTextures(); this.flame.registerGpuVfx(this.gpuVfx);
      this.leaf = new LeafBlowerRenderer(this); this.leaf.generateTextures(); this.leaf.registerGpuVfx(this.gpuVfx);
      this.leaf.setTerrainMaterialLayout({ dirt: cells(27, 9, 14, 24), tracks: [] });
      this.leaf.setTerrainColorSnapshot(new TerrainColorSnapshot(1, 1, 0, 0, new Uint8Array([95, 112, 66])));
      this.leafPresentation = new ProjectilePresentationRuntime(this);
      this.leafPresentation.bindGroundFogSegments((segment, size, style, id) => this.fog.addProjectile(segment, size, style, id));
    }
    this.addObstacle('wall', cells(47, 5, 2, 33).filter(c => scenario !== 'barrier' || c.gridY !== 20));
    if (scenario === 'nuke') this.addObstacle('target', cells(25, 11, 19, 19));
    else if (scenario === 'base') {
      const footprint = cells(27, 15, 12, 9);
      const metrics = resolveWorldMetrics({ arenaWidth: frame.width, arenaHeight: frame.height, arenaOffsetX: 0, arenaOffsetY: 0,
        arenaViewportWidth: 1920, arenaViewportHeight: 1080, usesDynamicCamera: true, showStaticArenaFrames: false });
      this.obstacles.set('target', createBaseSurfaceImages(this, footprint, metrics, 'fog-base'));
      this.fog.terrain.setObstacle('target', footprint, true);
    }
    else this.addObstacle('target', cells(30, 17, 5, 6));
    this.addObstacle('small', cells(24, 12, 2, 3));
    this.actor = this.add.image(570, 680, 'fog-badger').setDisplaySize(48, 48).setDepth(DEPTH.PLAYERS).setAngle(90);
    this.enemy = this.add.image(710, 820, 'fog-badger').setDisplaySize(90, 90).setTint(0xc16e59).setDepth(DEPTH.PLAYERS).setAngle(90);
    Object.assign(this.playerSample, { id: 'player', x: 570, y: 680, visible: true, size: 40, player: true, mode: 'walk' });
    Object.assign(this.enemySample, { id: 'enemy', x: 710, y: 820, visible: true, size: 85, player: false, mode: 'walk' });
    this.light = new LightingSystem(this); this.light.setTimeOfDay(number('time')); this.light.setActive(true);
    if (scenario === 'readability') {
      this.smoke = new SmokeSystem(this); this.smoke.setLightingSystem(this.light);
      this.pickups = new PowerUpRenderer(this); this.pickups.setLightingSystem(this.light);
      this.pickups.sync([{ uid: 1, defId: 'HEALTH_PACK', x: 750, y: 550 }]);
      this.essence = new AdrenalineEssenceGpuRenderer(this, () => null);
      this.add.circle(820, 650, 70).setStrokeStyle(3, 0xff9148, .85).setDepth(DEPTH.PLAYERS - 1);
      this.add.text(735, 730, 'Smoke · Pickup · Essenz · Warnung', { fontSize: '18px', color: '#ffffff' }).setDepth(DEPTH.PLAYERS + 1);
    }
    this.cameras.main.setBounds(0, 0, frame.width, frame.height).centerOn(900, 660);
    this.baseScroll = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY };
    this.cameraFeedback = new CameraFeedbackController(this, { getListener: () => null, getMotionScale: () => 1 });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (p.rightButtonDown()) this.fog.addExplosion(p.worldX, p.worldY, 100); });
    const bind = (id: string, action: () => void, event = 'click'): void => {
      const el = element(id); el.addEventListener(event, action); this.disposers.push(() => el.removeEventListener(event, action));
    };
    bind('pause', () => { this.paused = !this.paused; element('pause').textContent = this.paused ? 'Weiter' : 'Pause'; });
    bind('step', () => { this.paused = true; this.advance = FOG.stepMs; element('pause').textContent = 'Weiter'; });
    bind('longframe', () => { this.advance = 2000; });
    bind('reset', () => this.scene.restart()); bind('scenario', () => this.scene.restart(), 'change');
    bind('seed', () => this.scene.restart(), 'change');
    bind('weapon', () => { if (this.gpuVfx || value('weapon') === 'flame' || value('weapon') === 'leaf_blower') this.scene.restart(); }, 'change');
    bind('destroy', () => this.openTarget());
    bind('explode', () => { this.openTarget(); this.fog.addExplosion(1050, 650, scenario === 'nuke' ? 420 : 140); });
    bind('build', () => this.obstacles.has('construction') ? this.removeObstacle('construction') : this.addObstacle('construction', cells(23, 18, 5, 5)));
    bind('motion', () => { this.motion = !this.motion; });
    bind('teleport', () => { this.revision++; this.actor.x += 400; this.playerSample.x = this.actor.x; this.playerSample.revision = this.revision; });
    bind('shots', () => { this.firing = !this.firing; element('shots').textContent = this.firing ? 'Feuer stoppen' : 'Dauerfeuer'; });
    bind('fire', () => { this.fireOnce = true; });
    bind('pan', () => { this.pan = !this.pan; });
    let zoom = 0;
    bind('zoom', () => { const z = [1, .75, 1.5, .2][++zoom % 4]; this.cameras.main.setZoom(z); element('zoom').textContent = `Zoom ${Math.round(z * 100)} %`; });
    bind('shake', () => this.cameraFeedback.request(impactHeavy()));
    bind('url', () => { const params = new URLSearchParams(); for (const id of controlIds) params.set(id, value(id)); history.replaceState(null, '', `?${params}`); });
    bind('export', () => this.export());
    bind('verify', () => this.verify());
    const startBenchmark = (variant: number): void => {
      if (this.bench) return;
      this.report = null; this.bench = { variant, run: 0, start: performance.now(), samples: [], frames: [], gpu: [], gpuSample: -1, results: [], settings: this.settings() };
      this.motion = this.firing = true; this.pan = false; this.paused = false; element<HTMLInputElement>('mode').value = variant === 2 ? 'full' : 'off';
      document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,select,button').forEach(el => { el.disabled = true; });
      this.scene.restart();
    };
    bind('benchmark', () => startBenchmark(0));
    bind('benchmarkFull', () => startBenchmark(2));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.disposers.forEach(dispose => dispose()); this.disposers = [];
      this.pickups?.clear(); this.pickups = null; this.smoke?.destroyAll(); this.smoke = null;
      this.essence?.destroy(); this.essence = null;
      this.cameraFeedback.destroy();
      this.flame?.destroyAll(); this.flame = null; this.leaf?.destroyAll(); this.leaf = null;
      this.leafPresentation?.releaseWorldPresentation(); this.leafPresentation = null;
      this.gpuVfx?.destroy(); this.gpuVfx = null; this.train?.destroy(); this.train = null;
      this.fog.destroy(); this.water.destroy(); this.light.destroy(); this.quality.destroy();
    });
  }
  private tiles(list: { gridX: number; gridY: number }[], key: string, depth: number): Phaser.GameObjects.Image[] {
    const occupied = new Set(list.map(c => `${c.gridX},${c.gridY}`));
    return list.map(c => this.add.image((c.gridX + .5) * 32, (c.gridY + .5) * 32, key,
      AutoTiler.getFrame(AutoTiler.computeMask(c.gridX, c.gridY, (x, y) => occupied.has(`${x},${y}`)), key === 'fog-rock' ? ROCK_AUTOTILE : DIRT_AUTOTILE)).setDepth(depth));
  }
  private addObstacle(id: string, list: { gridX: number; gridY: number }[]): void {
    this.obstacles.set(id, this.tiles(list, 'fog-rock', DEPTH.ROCKS)); this.fog.terrain.setObstacle(id, list);
  }
  private removeObstacle(id: string): void {
    this.obstacles.get(id)?.forEach(image => image.destroy()); this.obstacles.delete(id); this.fog.terrain.removeObstacle(id);
  }
  private openTarget(): void {
    if (value('scenario') !== 'base') { this.removeObstacle('target'); return; }
    // Physics opens at once; the production surface images disappear in spatial waves.
    this.fog.terrain.removeObstacle('target');
    const images = this.obstacles.get('target') ?? []; this.obstacles.delete('target');
    for (const image of images) this.fadingBase.push({ image, removeAt: this.elapsed + 200 + Math.hypot(image.x - 1050, image.y - 650) * 12 });
  }
  private tickShots(dt: number): void {
    if (this.fireOnce || (this.firing && this.elapsed >= this.nextShot)) {
      this.fireOnce = false;
      const stream = value('weapon') === 'flame' ? streamContent.weapons.FLAMETHROWER : value('weapon') === 'leaf_blower' ? streamContent.weapons.LEAF_BLOWER : null;
      this.nextShot = this.elapsed + (stream?.cooldown ?? (value('weapon') === 'p90' ? ballisticContent.weapons.P90.cooldown : value('weapon') === 'melee' ? 900 : 230));
      const pelletCount = value('weapon') === 'shotgun' ? 8 : number('pellets');
      const count = pelletCount * number('shooters');
      for (let i = 0; i < count; i++) {
        const pattern = value('shotPattern'), id = this.nextProjectileId++;
        const shooter = Math.floor(i / pelletCount), pellet = i % pelletCount;
        const spread = (pellet - (pelletCount - 1) / 2) * .055;
        const angle = (pattern === 'fan' ? -.75 + Math.sin(this.elapsed / 1300 + shooter * .8) * .45 : pattern === 'diagonal' ? -.65 : 0) + spread;
        const y = (pattern === 'straight' ? 480 : 1000) + shooter * 26, style = value('weapon');
        if (style === 'hitscan') { this.fog.addHitscan(250, y, 250 + Math.cos(angle) * 1150, y + Math.sin(angle) * 1150, 2); continue; }
        if (style === 'melee') { this.fog.addMelee(this.actor.x, this.actor.y, -.35, 110, 135); continue; }
        this.shots.push({ id, angle, image: this.add.rectangle(250, y, style === 'p90' || style === 'glock' ? 8 : 16, 3, 0xffd695).setRotation(angle).setDepth(DEPTH.PROJECTILES),
          y, age: 0, born: this.elapsed, style, index: i, cursor: new ProjectilePathCursor(),
          points: [{ sequence: 1, timeMs: this.elapsed, x: 250, y, vx: Math.cos(angle) * 1200, vy: Math.sin(angle) * 1200, breakBefore: true }] });
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i], old = p.age; p.age += dt;
      const stream = p.style === 'flame' ? streamContent.weapons.FLAMETHROWER : p.style === 'leaf_blower' ? streamContent.weapons.LEAF_BLOWER : null;
      const speed = p.style === 'p90' ? ballisticContent.weapons.P90.fire.projectileSpeed / 1000 : p.style === 'rocket' ? .75 : 2.1;
      const travel = (age: number): number => stream
        ? stream.fire.projectileSpeed * (Math.pow(stream.fire.velocityDecay, age / 1000) - 1) / Math.log(stream.fire.velocityDecay)
        : speed * age;
      const point = (age: number): ProjectilePathPoint => ({ sequence: p.points.length + 1, timeMs: p.born + age,
        x: 250 + Math.cos(p.angle) * travel(age), y: p.y + Math.sin(p.angle) * travel(age) + (p.style === 'bounce' ? Math.max(0, age - 220) * .8 : 0), vx: Math.cos(p.angle) * speed * 1000, vy: Math.sin(p.angle) * speed * 1000 });
      const lifetime = stream ? Math.log(1 + stream.range * Math.log(stream.fire.velocityDecay) / stream.fire.projectileSpeed) / Math.log(stream.fire.velocityDecay) * 1000
        : p.style === 'short' ? 12 : p.style === 'p90' ? ballisticContent.weapons.P90.range / speed : 560, end = Math.min(p.age, lifetime);
      const size = stream ? Math.min(stream.fire.hitboxEndSize, stream.fire.hitboxStartSize + stream.fire.hitboxGrowRate * end / 1000)
        : ['p90', 'glock', 'shotgun', 'short', 'bounce'].includes(p.style) ? 3 : 12;
      if (p.style === 'bounce' && old < 220 && end > 220) p.points.push({ ...point(220), bounceSequence: 1 });
      p.points.push(point(end));
      const head = p.points[p.points.length - 1]; p.image.setPosition(head.x, head.y);
      if (p.style === 'leaf_blower') {
        // Match the game's history-free stream path instead of inventing replicated flight data.
        const pose = { ...head, id: p.id, size, style: 'leaf_blower' as const, ownerId: 'lab', color: 0xb8caa3 };
        this.leafPresentation!.syncHostRenderers([pose], this.elapsed);
        if (p.age >= lifetime) this.leafPresentation!.destroyProjectileVisuals(pose);
      } else p.cursor.consume({ timeMs: p.born + end, points: p.points, ended: p.age >= lifetime }, p.born + end,
        segment => this.fog.addProjectile(segment, size, p.style, p.id));
      if (stream) {
        p.image.setVisible(false);
        if (p.style === 'flame') {
          if (!this.flame!.has(p.id)) this.flame!.createVisual(p.id, head.x, head.y, size, 0xff9933, `lab:${Math.floor(p.index / number('pellets'))}`);
          this.flame!.updateVisual(p.id, head.x, head.y, size, head.vx, head.vy);
        } else {
          this.leaf!.createVisual(p.id, head.x, head.y, size); this.leaf!.updateVisual(p.id, head.x, head.y, size, head.vx, head.vy);
        }
      }
      if (p.age >= lifetime) { this.flame?.destroyVisual(p.id); this.leaf?.destroyVisual(p.id); p.image.destroy(); this.shots.splice(i, 1); }
    }
  }
  update(_time: number, rawDelta: number): void {
    const dt = this.advance || (this.paused ? 0 : Math.min(rawDelta, 67)); this.advance = 0; this.elapsed += Math.min(dt, 67);
    const camera = this.cameras.main;
    camera.setScroll(this.baseScroll.x, this.baseScroll.y);
    if (this.pan && dt) camera.centerOn(960 + (1 - Math.cos(this.elapsed / 2500)) * (frame.width - 1920) / 2,
      700 + (1 - Math.cos(this.elapsed / 4700)) * (frame.height - 1500) / 2);
    this.baseScroll = { x: camera.scrollX, y: camera.scrollY };
    if (this.motion && dt) {
      const phase = this.elapsed % 7000, pattern = value('motionPattern');
      const dash = pattern === 'dash' || (pattern === 'cycle' && phase >= 3200 && phase < 3500);
      const travel = this.elapsed * (dash ? 1 : .15) % 1560;
      const distance = pattern !== 'cycle' ? (travel < 780 ? travel : 1560 - travel)
        : phase < 3200 ? phase * .15 : phase < 3500 ? 480 + (phase - 3200) : phase < 6000 ? 780 - (phase - 3500) * .312 : 0;
      this.actor.setPosition(350 + distance, 740);
      this.enemy.setPosition(780 + Math.sin(this.elapsed / 1600) * 500, 850);
      Object.assign(this.playerSample, { x: this.actor.x, y: this.actor.y, mode: dash ? 'dash' : pattern === 'cycle' && phase >= 6000 ? 'idle' : 'walk' });
      Object.assign(this.enemySample, { x: this.enemy.x, y: this.enemy.y });
    }
    const view = { x: camera.scrollX + camera.width * (1 - 1 / camera.zoom) / 2,
      y: camera.scrollY + camera.height * (1 - 1 / camera.zoom) / 2, width: camera.width / camera.zoom, height: camera.height / camera.zoom };
    this.fog.enabled = value('mode') !== 'off'; this.fog.reactions = value('mode') === 'full';
    this.fog.strength = number('strength'); this.fog.quality = value('quality') as FogQuality; this.fog.debug = value('debug') as FogDebug;
    Object.assign(this.fog.tuning, { opacity: number('opacity'), detail: number('detail'), windX: number('windX'), windY: number('windY'), reaction: number('reaction') });
    this.quality.setLevel(this.fog.quality);
    this.water.prepareMasks(); this.water.updateResidency(view);
    if (dt) { this.fog.captureMotion(dt, [this.playerSource], [this.enemySource], view); this.tickShots(Math.min(dt, 67)); }
    if (this.train) {
      const y = -100 + this.elapsed / 1000 * TRAIN.SPEED;
      this.train.update({ alive: y < frame.height + TRAIN.WAGON_COUNT * (TRAIN.WAGON_HEIGHT + TRAIN.SEGMENT_GAP), x: 1260, y, dir: 1, hp: TRAIN.HP_MAX, maxHp: TRAIN.HP_MAX });
      const state = this.train.getShadowState();
      if (dt) this.fog.captureTrain(dt, state, state ? this.train.computeSegYs(state.y, state.dir) : []);
    }
    this.gpuVfx?.update(dt);
    if (this.bench && this.elapsed >= this.nextExplosion) { this.nextExplosion += 4000; this.fog.addExplosion(1080, 800, 180); }
    for (const cell of this.fadingBase) if (cell.image.active && cell.removeAt <= this.elapsed) cell.image.destroy();
    this.fadingBase = this.fadingBase.filter(cell => cell.image.active);
    this.fog.setSurfaceImages([...this.obstacles.values()].flat().concat(this.fadingBase.map(cell => cell.image)));
    this.fog.update(dt, number('time'), view);
    this.cameraFeedback.applyToCamera(camera, this.baseScroll.x, this.baseScroll.y, dt);
    this.light.setTimeOfDay(number('time'));
    if (value('scenario') === 'readability') this.light.setLight('fog-lab-signals', 'baseGlow', 780, 600, { radiusPx: 460 });
    this.light.update();
    this.smoke?.syncVisuals([{ id: 1, x: 600, y: 480, radius: 125, alpha: .8, density: 1, phase: 'active' }], this.elapsed);
    this.essence?.update({ worldRevision: 1, activityRevision: 1, revision: 1, transfers: [], clusters: [{
      id: 'lab', accessGroup: { kind: 'coop' }, x: 900, y: 540, originX: 900, originY: 540,
      seed: 183, value: 20, createdAt: 0, landAt: 0, expiresAt: 1e9, state: 'grounded',
    }] }, this.elapsed);
    element('clock').textContent = `${Math.floor(number('time') / 60).toString().padStart(2, '0')}:${(number('time') % 60).toString().padStart(2, '0')}`;
    const stats = this.fog.getDiagnostics();
    element('status').textContent = `${stats.status} · ${(this.elapsed / 1000).toFixed(1)} s\nCPU Submission ${stats.cpuMs.toFixed(2)} ms · ${stats.gpuMs === null ? 'GPU-Zeit nicht verfügbar' : `GPU ${stats.gpuMs.toFixed(2)} ms`}\nChunks ${stats.activeChunks} aktiv / ${stats.cachedChunks} Cache · ${(stats.bytes / 1048576).toFixed(1)} MiB\nImpulse ${stats.submittedImpulses} / ${stats.pendingImpulses} wartend / ${stats.droppedImpulses} verworfen\nSpuren ${stats.trailSegments} / ${stats.visibleTraces} sichtbar · ${stats.trailDrawCalls} Draw`;
    const now = performance.now(), measuredFrame = now - this.lastFrameAt; this.lastFrameAt = now;
    if (this.bench) this.measure(measuredFrame, stats.cpuMs);
  }
  private verify(): void {
    if (this.bench) return;
    this.report = { type: 'GPU contracts', ...runFogGpuContracts(this), settings: this.settings() };
    element('report').textContent = JSON.stringify(this.report, null, 2);
  }
  private measure(frameMs: number, cpuMs: number): void {
    const b = this.bench!, age = performance.now() - b.start;
    const stats = this.fog.getDiagnostics();
    if (age > 10000) {
      b.samples.push(cpuMs); b.frames.push(frameMs);
      if (b.gpuSample !== stats.gpuSample && stats.gpuMs !== null) { b.gpu.push(stats.gpuMs); b.gpuSample = stats.gpuSample; }
    }
    element('report').textContent = `${['Aus', 'Grundnebel', 'Alle Reaktionen'][b.variant]} · Lauf ${b.run + 1}/3 · ${(age / 1000).toFixed(1)}/40 s · ${b.frames.length} Frames`;
    if (age < 40000) return;
    const distribution = (values: number[]) => { values.sort((a, c) => a - c); const at = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))]; return { median: at(.5), p95: at(.95), p99: at(.99), count: values.length }; };
    b.results.push({ mode: ['off', 'ambient', 'full'][b.variant], run: b.run + 1, cpu: distribution(b.samples), frame: distribution(b.frames),
      gpu: b.gpu.length ? distribution(b.gpu) : 'GPU-Zeit nicht verfügbar', resources: { ...stats },
      validCadence: b.frames.length >= 900 && this.elapsed >= 35000 });
    b.run++; if (b.run === 3) { b.run = 0; b.variant++; }
    if (b.variant === 3) {
      this.report = { settings: b.settings, viewport: { width: this.cameras.main.width, height: this.cameras.main.height }, results: b.results };
      this.bench = null; element('report').textContent = JSON.stringify(this.report, null, 2);
      document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,select,button').forEach(el => { el.disabled = false; }); return;
    }
    element<HTMLInputElement>('mode').value = ['off', 'ambient', 'full'][b.variant]; b.start = performance.now(); b.samples = []; b.frames = []; b.gpu = []; b.gpuSample = -1;
    this.scene.restart();
  }
  private settings(): Record<string, string> { return Object.fromEntries(controlIds.map(id => [id, value(id)])); }
  private export(): void {
    const blob = new Blob([JSON.stringify({ settings: this.settings(), report: this.report }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'fragdachse-fog-lab.json'; a.click(); URL.revokeObjectURL(url);
  }
}
new Phaser.Game({ type: Phaser.WEBGL, parent: 'stage', width: 1920, height: 1080, backgroundColor: '#334937',
  // A controlled 60 Hz lab cadence also runs when the embedded browser throttles RAF.
  // The report rejects runs where the host throttles timers as well.
  fps: { target: 60, forceSetTimeOut: true, smoothStep: false },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true }, scene: FogLab });
