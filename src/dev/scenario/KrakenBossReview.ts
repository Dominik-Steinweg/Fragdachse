import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import { EnemyClawRenderer, ENEMY_CLAW_HOSTILE_COLOR } from '../../effects/EnemyClawRenderer';
import { KrakenReviewAssets, type LoadedReviewAsset, type ReviewAssetSource } from './KrakenReviewAssets';

export interface KrakenReviewOptions extends ReviewAssetSource {
  land: ReviewAssetSource | null;
  tentacle: ReviewAssetSource | null;
  tentaclePivot: [number, number];
  clip: string;
  frame: number;
  playing: boolean;
  speed: number;
  waterLevel: number;
  phase: 'water' | 'land';
  direction: number;
  telegraphLength: number;
  telegraphWidth: number;
  telegraphProgress: number;
  grid: boolean;
  camera: 'overview' | 'body';
}
const defaults: KrakenReviewOptions = { run: 'kraken-v7', asset: 'abyssal-kraken', size: 320,
  land: null, tentacle: null, tentaclePivot: [.5, 1], clip: 'idle', frame: 0, playing: false,
  speed: 1, waterLevel: .5, phase: 'water', direction: 90, telegraphLength: 320,
  telegraphWidth: 112, telegraphProgress: .5, grid: false, camera: 'overview' };

function source(value: ReviewAssetSource): void {
  for (const key of ['run', 'asset'] as const) if (typeof value[key] !== 'string' || !/^[\w-]+$/.test(value[key])) throw Error(`Invalid ${key}`);
  if (!Number.isInteger(value.size) || value.size < 16 || value.size > 2048) throw Error('size: integer 16..2048');
  for (const key of ['atlas', 'elevationAtlas'] as const) {
    const name = value[key];
    if (name !== undefined && !(key === 'atlas' && name === false) && (typeof name !== 'string' || !/^[\w.-]+\.json$/.test(name))) throw Error(`Invalid ${key} filename`);
  }
}
/** Command-boundary validation. Subsequent commands are patches; asset reloads are explicit. */
export function krakenReviewOptions(raw: Record<string, unknown>, previous = defaults): KrakenReviewOptions {
  const next = { ...previous };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'action') continue;
    if (!Object.prototype.hasOwnProperty.call(defaults, key) && key !== 'atlas' && key !== 'elevationAtlas') throw Error(`Unknown krakenReview option: ${key}`);
    Object.assign(next, { [key]: value });
  }
  source(next);
  for (const key of ['land', 'tentacle'] as const) if (next[key] !== null) {
    if (typeof next[key] !== 'object' || Array.isArray(next[key])) throw Error(`${key}: asset source or null`);
    next[key] = Object.assign({ run: next.run, size: next.size }, next[key]);
    source(next[key]);
  }
  for (const [key, min, max] of [ ['frame', 0, 100000], ['speed', 0, 8], ['waterLevel', 0, 1],
    ['direction', -360, 360], ['telegraphLength', 1, 1600], ['telegraphWidth', 1, 640], ['telegraphProgress', 0, 1] ] as const) {
    if (typeof next[key] !== 'number' || !Number.isFinite(next[key]) || next[key] < min || next[key] > max) throw Error(`${key}: ${min}..${max}`);
  }
  if (!Number.isInteger(next.frame)) throw Error('frame: integer clip-local index');
  if (typeof next.clip !== 'string' || !next.clip) throw Error('clip: name required');
  if (!['water', 'land'].includes(next.phase) || !['overview', 'body'].includes(next.camera)) throw Error('Invalid phase/camera');
  if (typeof next.grid !== 'boolean' || typeof next.playing !== 'boolean') throw Error('grid/playing: boolean');
  if (!Array.isArray(next.tentaclePivot) || next.tentaclePivot.length !== 2 || next.tentaclePivot.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw Error('tentaclePivot: [0..1, 0..1]');
  if (raw.clip !== undefined && raw.clip !== previous.clip && raw.frame === undefined) next.frame = 0;
  if (raw.frame !== undefined && raw.playing === undefined) next.playing = false;
  return next;
}

export function krakenAssetIdentity(options: KrakenReviewOptions): string {
  const { run, asset, size, atlas, elevationAtlas, land, tentacle } = options;
  return JSON.stringify({ run, asset, size, atlas, elevationAtlas, land, tentacle });
}

/** TODO: consume the matching elevation frame in the future submersion shader. */
export function applySubmersion(_sprite: Phaser.GameObjects.Sprite, _level: number): void {}

type Point = { x: number; y: number };
type ReviewVisual = { asset: LoadedReviewAsset; sprite: Phaser.GameObjects.Sprite };

/** Dev-only presentation: no enemy, physics body, hit registration or replicated state. */
export class KrakenBossReview {
  private readonly assets: KrakenReviewAssets;
  private readonly renderer: EnemyClawRenderer;
  private readonly grid: Phaser.GameObjects.Graphics;
  private water: ReviewVisual | null = null;
  private land: ReviewVisual | null = null;
  private tentacle: ReviewVisual | null = null;
  private disposed = false;
  private loaded = false;
  private framePosition = 0;

  constructor(private readonly scene: Phaser.Scene, public options: KrakenReviewOptions,
    private readonly center: Point, private readonly shore: Point, gridOrigin: Point) {
    this.assets = new KrakenReviewAssets(scene);
    // A fixed presentation clock lets the command select any windup progress, including 1.
    this.renderer = new EnemyClawRenderer(scene, () => 1000);
    this.grid = scene.add.graphics().setDepth(DEPTH.PLAYERS - .05).setVisible(false);
    this.grid.lineStyle(1, 0xc1e1dc, .25);
    for (let x = 0; x <= 70; x++) this.grid.lineBetween(gridOrigin.x + x * CELL_SIZE, gridOrigin.y, gridOrigin.x + x * CELL_SIZE, gridOrigin.y + 48 * CELL_SIZE);
    for (let y = 0; y <= 48; y++) this.grid.lineBetween(gridOrigin.x, gridOrigin.y + y * CELL_SIZE, gridOrigin.x + 70 * CELL_SIZE, gridOrigin.y + y * CELL_SIZE);
  }

  async initialize(): Promise<void> {
    const visual = async (request: ReviewAssetSource): Promise<ReviewVisual> => {
      const asset = await this.assets.load(request);
      if (this.disposed) throw Error('Kraken review ended during loading.');
      // Above the water and below players/telegraphs: shoreline silhouettes remain readable.
      const sprite = this.scene.add.sprite(this.center.x, this.center.y, asset.key, asset.frame(asset.clips[0].frames[0]))
        .setScale(asset.scale).setOrigin(...asset.pivot).setDepth(DEPTH.PLAYERS - .2);
      return { asset, sprite };
    };
    this.water = await visual(this.options);
    if (this.options.land) this.land = await visual(this.options.land);
    if (this.options.tentacle) this.tentacle = await visual(this.options.tentacle);
    this.loaded = true;
    this.configure(this.options);
    this.scene.events.on('postupdate', this.update, this);
  }

  configure(options: KrakenReviewOptions): void {
    const body = options.phase === 'land' ? this.land ?? this.water : this.water;
    const clip = body?.asset.clips.find(c => c.name === options.clip);
    if (!clip) throw Error(`Unknown clip: ${options.clip}. Available: ${body?.asset.clips.map(c => c.name).join(', ')}`);
    if (options.frame >= clip.frames.length) throw Error(`frame: 0..${clip.frames.length - 1} for ${clip.name}`);
    this.options = options;
    this.framePosition = options.frame;
    this.grid.setVisible(options.grid);
    this.render();
  }

  private update(_time: number, delta: number): void {
    if (!this.loaded || !this.options.playing) return;
    const clip = this.body!.asset.clips.find(c => c.name === this.options.clip)!;
    this.framePosition += delta / 1000 * clip.frameRate * this.options.speed;
    if (clip.loop) this.framePosition %= clip.frames.length;
    else if (this.framePosition >= clip.frames.length - 1) {
      this.framePosition = clip.frames.length - 1; this.options.playing = false;
    }
    this.options.frame = Math.floor(this.framePosition);
    this.render();
  }
  private get body(): ReviewVisual | null { return this.options.phase === 'land' ? this.land ?? this.water : this.water; }

  private render(): void {
    const o = this.options, body = this.body!;
    this.water?.sprite.setVisible(body === this.water);
    this.land?.sprite.setVisible(body === this.land);
    const clip = body.asset.clips.find(c => c.name === o.clip)!;
    body.sprite.setFrame(body.asset.frame(clip.frames[o.frame]));
    const position = o.phase === 'water' ? this.center : { x: this.shore.x, y: this.shore.y + 224 };
    body.sprite.setPosition(position.x, position.y);
    applySubmersion(body.sprite, o.phase === 'water' ? o.waterLevel : 0);
    if (this.tentacle) {
      const { sprite, asset } = this.tentacle;
      const secondaryClip = asset.clips.find(c => c.name === o.clip) ?? asset.clips[0];
      sprite.setFrame(asset.frame(secondaryClip.frames[Math.min(o.frame, secondaryClip.frames.length - 1)]))
        .setOrigin(...o.tentaclePivot).setPosition(this.shore.x, this.shore.y)
        .setAngle(o.direction + 90); // authored forward north, lane forward +x
      applySubmersion(sprite, o.waterLevel);
    }
    this.renderer.showAttack('kraken-review-lane', { shape: 'lane', ...this.shore,
      angle: o.direction * Math.PI / 180, length: o.telegraphLength, width: o.telegraphWidth,
      startedAt: 1000 - o.telegraphProgress * 1000, strikeAt: 1800 - o.telegraphProgress * 1000,
      hitAt: 2000 - o.telegraphProgress * 1000, color: ENEMY_CLAW_HOSTILE_COLOR });
  }

  status() {
    return { loaded: this.loaded, options: this.options, clips: this.body?.asset.clips ?? [],
      body: this.body ? { x: this.body.sprite.x, y: this.body.sprite.y, depth: this.body.sprite.depth,
        texture: this.body.asset.key, frame: this.body.sprite.frame.name, format: this.body.asset.format,
        elevationKey: this.body.asset.elevationKey ?? null } : null,
      tentacle: this.tentacle ? { x: this.tentacle.sprite.x, y: this.tentacle.sprite.y,
        rotation: this.tentacle.sprite.rotation, originX: this.tentacle.sprite.originX, originY: this.tentacle.sprite.originY,
        texture: this.tentacle.asset.key, frame: this.tentacle.sprite.frame.name } : null,
      shore: this.shore, submersion: 'hook-only', landUsesWaterAsset: this.options.phase === 'land' && !this.land };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.events.off('postupdate', this.update, this);
    this.water?.sprite.destroy(); this.land?.sprite.destroy(); this.tentacle?.sprite.destroy();
    this.grid.destroy(); this.renderer.destroy(); this.assets.destroy();
  }
}
