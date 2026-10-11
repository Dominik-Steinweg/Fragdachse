import * as Phaser from 'phaser';
import { WaterSurfaceModel } from '../../arena/WaterSurfaceModel';
import type { WaterCell } from '../../types';
import type { KrakenReviewSubmersion } from './KrakenReviewSubmersion';
import { advanceReviewClip, type ReviewPlayback } from './KrakenReviewPlayback';
import { CELL_SIZE, DEPTH } from '../../config';
import { EnemyClawRenderer, ENEMY_CLAW_HOSTILE_COLOR } from '../../effects/EnemyClawRenderer';
import { KrakenReviewAssets, type LoadedReviewAsset, type ReviewAssetSource } from './KrakenReviewAssets';
import { effectDefaults, effectOptions, effectPose, effectTiming, type KrakenEffectOptions } from './KrakenReviewEffectTimeline';
import { KrakenReviewEffectRenderer } from '../../effects/kraken/KrakenReviewEffectRenderer';
import { CameraFeedbackModel } from '../../effects/camera/CameraFeedbackModel';
import { planKrakenApproach } from './KrakenReviewApproach';
import { KrakenTentacleShadow } from '../../effects/kraken/KrakenTentacleShadow';
import { impactLight } from '../../effects/camera/cameraFeedbackPresets';
import { bodyEffectClip, bodyEffectTiming, isBodyEffect, reviewEggTargets, sampleReviewEgg } from './KrakenReviewChoreography';
import type { KrakenReviewDrainFilter } from '../../effects/kraken/KrakenReviewDrainFilter';

export interface KrakenReviewOptions extends ReviewAssetSource, KrakenEffectOptions {
  land: ReviewAssetSource | null;
  tentacle: ReviewAssetSource | null;
  egg: ReviewAssetSource | null;
  tentaclePivot: [number, number];
  tentacleClip: string;
  tentacleFrame: number;
  tentacleSequence: boolean;
  eggClip: string;
  eggFrame: number;
  clip: string;
  frame: number;
  playing: boolean;
  speed: number;
  waterLevel: number | null;
  submersion: boolean;
  phase: 'water' | 'land';
  direction: number;
  telegraphShape: 'lane' | 'bite' | 'cone';
  tentacleShadow: boolean;
  telegraphLength: number;
  telegraphWidth: number;
  telegraphProgress: number;
  grid: boolean;
  camera: 'overview' | 'body' | 'tentacle' | 'egg' | 'effect';
}
const defaults: KrakenReviewOptions = { ...effectDefaults, run: 'kraken-v7', asset: 'abyssal-kraken', size: 320,
  land: null, tentacle: null, egg: null, tentaclePivot: [.5, .85],
  tentacleClip: 'rise', tentacleFrame: 0, tentacleSequence: false, eggClip: 'idle', eggFrame: 0, clip: 'idle', frame: 0, playing: false,
  speed: 1, waterLevel: null, submersion: true, phase: 'water', direction: 90, telegraphShape: 'lane', tentacleShadow: true, telegraphLength: 320,
  telegraphWidth: 112, telegraphProgress: .5, grid: false, camera: 'overview' };

function source(value: ReviewAssetSource): void {
  if (value.previewFrame !== undefined && (!Number.isInteger(value.previewFrame) || value.previewFrame < 0 || value.previewFrame > 100000)) throw Error('previewFrame: nonnegative frame index');
  for (const key of ['run', 'asset'] as const) if (typeof value[key] !== 'string' || !/^[\w-]+$/.test(value[key])) throw Error(`Invalid ${key}`);
  if (!Number.isInteger(value.size) || value.size < 16 || value.size > 2048) throw Error('size: integer 16..2048');
  for (const key of ['atlas', 'elevationAtlas'] as const) {
    const name = value[key];
    if (name !== undefined && !(key === 'atlas' && name === false) && (typeof name !== 'string' || (!/^(?:[\w-]+\/)*[\w.-]+\.json$/.test(name) || name.includes('..')))) throw Error(`Invalid ${key} filename`);
  }
}
/** Command-boundary validation. Subsequent commands are patches; asset reloads are explicit. */
export function krakenReviewOptions(raw: Record<string, unknown>, previous = defaults): KrakenReviewOptions {
  const next = { ...previous };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'action') continue;
    if (!Object.prototype.hasOwnProperty.call(defaults, key) && key !== 'atlas' && key !== 'elevationAtlas' && key !== 'previewFrame') throw Error(`Unknown krakenReview option: ${key}`);
    Object.assign(next, { [key]: value });
  }
  source(next);
  Object.assign(next, effectOptions(raw, previous));
  if (raw.effect !== undefined && raw.effect !== previous.effect && raw.effectTime === undefined) next.effectTime = 0;
  if (raw.effectTime !== undefined && raw.playback === undefined) next.playback = 'manual';
  for (const key of ['land', 'tentacle', 'egg'] as const) if (next[key] !== null) {
    if (typeof next[key] !== 'object' || Array.isArray(next[key])) throw Error(`${key}: asset source or null`);
    next[key] = Object.assign({ run: next.run, size: next.size }, next[key]);
    source(next[key]);
  }
  for (const [key, min, max] of [ ['frame', 0, 100000], ['tentacleFrame', 0, 100000], ['eggFrame', 0, 100000], ['speed', 0, 8],
    ['direction', -360, 360], ['telegraphLength', 1, 1600], ['telegraphWidth', 1, 640], ['telegraphProgress', 0, 1] ] as const) {
    if (typeof next[key] !== 'number' || !Number.isFinite(next[key]) || next[key] < min || next[key] > max) throw Error(`${key}: ${min}..${max}`);
  }
  if (next.waterLevel !== null && (typeof next.waterLevel !== 'number' || !Number.isFinite(next.waterLevel) || next.waterLevel < 0 || next.waterLevel > 1)) throw Error('waterLevel: null or 0..1');
  if (!Number.isInteger(next.frame) || !Number.isInteger(next.tentacleFrame) || !Number.isInteger(next.eggFrame)) throw Error('frame: integer clip-local index');
  if (['clip', 'tentacleClip', 'eggClip'].some(k => typeof next[k as 'clip'] !== 'string' || !next[k as 'clip'])) throw Error('clip: name required');
  if (!['lane', 'bite', 'cone'].includes(next.telegraphShape) || typeof next.tentacleShadow !== 'boolean') throw Error('Invalid telegraphShape/tentacleShadow');
  if (next.effect === 'approach' && (next.phase !== 'water' || !next.submersion)) throw Error('approach requires water phase and submersion');
  if (!['water', 'land'].includes(next.phase) || !['overview', 'body', 'tentacle', 'egg', 'effect'].includes(next.camera)) throw Error('Invalid phase/camera');
  if (typeof next.grid !== 'boolean' || typeof next.playing !== 'boolean' || typeof next.tentacleSequence !== 'boolean' || typeof next.submersion !== 'boolean') throw Error('grid/playing/submersion/sequence: boolean');
  if (!Array.isArray(next.tentaclePivot) || next.tentaclePivot.length !== 2 || next.tentaclePivot.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw Error('tentaclePivot: [0..1, 0..1]');
  for (const [clip, frame] of [['clip', 'frame'], ['tentacleClip', 'tentacleFrame'], ['eggClip', 'eggFrame']] as const) {
    if (raw[clip] !== undefined && raw[clip] !== previous[clip] && raw[frame] === undefined) next[frame] = 0;
  }
  if (['frame', 'tentacleFrame', 'eggFrame'].some(k => raw[k] !== undefined) && raw.playing === undefined) next.playing = false;
  return next;
}

export function krakenAssetIdentity(options: KrakenReviewOptions): string {
  const { run, asset, size, atlas, elevationAtlas, previewFrame, land, tentacle, egg } = options;
  return JSON.stringify({ run, asset, size, atlas, elevationAtlas, previewFrame, land, tentacle, egg });
}

type Point = { x: number; y: number };
type ReviewVisual = { asset: LoadedReviewAsset; sprite: Phaser.GameObjects.Sprite; playback: ReviewPlayback; submersion?: KrakenReviewSubmersion; shadow?: KrakenTentacleShadow };
const tentacleSequence = ['rise', 'hover', 'slam', 'retract'];

/** Dev-only presentation, owned by the scenario rather than enemy/network state. */
export class KrakenBossReview {
  private readonly assets: KrakenReviewAssets;
  private readonly renderer: EnemyClawRenderer;
  private readonly grid: Phaser.GameObjects.Graphics;
  private readonly model: WaterSurfaceModel;
  private readonly effects: KrakenReviewEffectRenderer;
  private readonly feedback = new CameraFeedbackModel(undefined, () => .37);
  private readonly extraTentacles: ReviewVisual[] = [];
  private water: ReviewVisual | null = null;
  private land: ReviewVisual | null = null;
  private tentacle: ReviewVisual | null = null;
  private eggs: ReviewVisual[] = [];
  private disposed = false;
  private loaded = false;
  private time = 0;
  private approachPlan: ReturnType<typeof planKrakenApproach> | null = null;
  private eggPaths: { from: Point; target: Point }[] = [];
  private drain?: KrakenReviewDrainFilter;
  private submersionType!: typeof KrakenReviewSubmersion;

  constructor(private readonly scene: Phaser.Scene, public options: KrakenReviewOptions,
    private readonly center: Point, private readonly shore: Point, private readonly gridOrigin: Point,
    water: readonly WaterCell[], private readonly dimensions: { width: number; height: number }) {
    this.assets = new KrakenReviewAssets(scene);
    this.model = new WaterSurfaceModel(water, dimensions);
    // Resolve the south-facing contact against the same contour used by the mask.
    let y = center.y;
    while (y < shore.y + CELL_SIZE * 3 && this.model.sample(shore.x - gridOrigin.x, y - gridOrigin.y) > 0) y += .5;
    this.shore = { x: shore.x, y };
    this.effects = new KrakenReviewEffectRenderer(scene, (x, y) => this.model.sample(x - gridOrigin.x, y - gridOrigin.y));
    this.renderer = new EnemyClawRenderer(scene, () => 1000);
    this.grid = scene.add.graphics().setDepth(DEPTH.PLAYERS - .05).setVisible(false);
    this.grid.lineStyle(1, 0xc1e1dc, .25);
    for (let x = 0; x <= dimensions.width; x += CELL_SIZE) this.grid.lineBetween(gridOrigin.x + x, gridOrigin.y, gridOrigin.x + x, gridOrigin.y + dimensions.height);
    for (let y = 0; y <= dimensions.height; y += CELL_SIZE) this.grid.lineBetween(gridOrigin.x, gridOrigin.y + y, gridOrigin.x + dimensions.width, gridOrigin.y + y);
  }

  private visual(asset: LoadedReviewAsset): ReviewVisual {
    const pose = asset.pose(asset.clips[0].name, 0);
    const sprite = this.scene.add.sprite(this.center.x, this.center.y, pose.key, pose.frame)
      .setScale(asset.scale).setOrigin(...asset.pivot).setDepth(DEPTH.PLAYERS - .2);
    const submersion = asset.elevation && pose.elevationKey
      ? new this.submersionType(sprite, asset, pose, this.model, this.gridOrigin) : undefined;
    return { asset, sprite, submersion, playback: { clip: asset.clips[0].name, position: 0, playing: false, markers: [] } };
  }

  async initialize(): Promise<void> {
    this.submersionType = (await import('./KrakenReviewSubmersion')).KrakenReviewSubmersion;
    const load = async (request: ReviewAssetSource) => {
      const asset = await this.assets.load(request);
      if (this.disposed) throw Error('Kraken review ended during loading.');
      return asset;
    };
    this.water = this.visual(await load(this.options));
    if (this.water.asset.elevation && this.water.submersion) {
      const { addReviewDrain } = await import('../../effects/kraken/KrakenReviewDrainFilter');
      if (this.disposed) throw Error('Kraken review ended during filter loading.');
      this.drain = addReviewDrain(this.water.sprite, this.water.submersion.filter.elevationFrame, this.water.asset.elevation);
    }
    if (this.options.land) this.land = this.visual(await load(this.options.land));
    if (this.options.tentacle) {
      const asset = await load(this.options.tentacle);
      this.tentacle = this.visual(asset);
      for (let i = 0; i < 2; i++) this.extraTentacles.push(this.visual(asset));
      for (const v of [this.tentacle, ...this.extraTentacles]) v.shadow = new KrakenTentacleShadow(v.sprite, asset,
        (x, y) => this.model.sample(x - this.gridOrigin.x, y - this.gridOrigin.y));
    }
    if (this.options.egg) {
      const asset = await load(this.options.egg);
      for (let i = 0; i < 8; i++) this.eggs.push(this.visual(asset));
    }
    this.loaded = true; this.configure(this.options);
    this.scene.events.on('postupdate', this.update, this);
  }

  configure(options: KrakenReviewOptions): void {
    const body = options.phase === 'land' ? this.land ?? this.water : this.water;
    if (isBodyEffect(options.effect)) {
      if (options.phase !== 'water' || !options.submersion) throw Error('Body effects require water phase and submersion');
      if (!body?.asset.clips.some(c => c.name === bodyEffectClip(options.effect))) throw Error(`Missing clip ${bodyEffectClip(options.effect)}`);
      if (options.effect === 'egg-throw') {
        if (!this.eggs[0] || !['idle', 'hatch'].every(name => this.eggs[0].asset.clips.some(c => c.name === name))) throw Error('egg-throw requires egg idle/hatch assets');
        const angle = options.direction * Math.PI / 180;
        const waterAt = (x: number, y: number) => this.model.sample(x - this.gridOrigin.x, y - this.gridOrigin.y);
        const targets = options.eggTargets.length ? options.eggTargets.map(p => ({
          x: this.gridOrigin.x + (p.x + .5) * CELL_SIZE, y: this.gridOrigin.y + (p.y + .5) * CELL_SIZE,
        })) : reviewEggTargets(this.center, angle, options.eggFlight.count, options.eggFlight.landInset, waterAt);
        if (targets.some(p => waterAt(p.x, p.y) > 0 || p.x < this.gridOrigin.x || p.y < this.gridOrigin.y
          || p.x >= this.gridOrigin.x + this.dimensions.width || p.y >= this.gridOrigin.y + this.dimensions.height)) throw Error('eggTargets must be on land inside the world');
        this.eggPaths = targets.map((target, i) => {
          const socket = options.eggLaunches[i] ?? (() => {
            const p = body.asset.sockets[`egg${i + 1}`]; return p ? { x: p[0], y: p[1] } : undefined;
          })();
          const a = angle + i / targets.length * Math.PI * 2, rotation = angle + Math.PI / 2;
          const lx = socket ? (socket.x - body.asset.pivot[0]) * body.sprite.width * body.asset.scale : 0;
          const ly = socket ? (socket.y - body.asset.pivot[1]) * body.sprite.height * body.asset.scale : 0;
          return { target, from: socket ? { x: this.center.x + lx * Math.cos(rotation) - ly * Math.sin(rotation),
            y: this.center.y + lx * Math.sin(rotation) + ly * Math.cos(rotation) }
            : { x: this.center.x + Math.cos(a) * options.eggFlight.launchRadius, y: this.center.y + Math.sin(a) * options.eggFlight.launchRadius } };
        });
      }
    }
    const selections: [ReviewVisual | null, string, number][] = [[body, options.clip, options.frame],
      [this.tentacle, options.tentacleClip, options.tentacleFrame], ...this.eggs.map(v => [v, options.eggClip, options.eggFrame] as [ReviewVisual, string, number])];
    for (const [visual, name, frame] of selections) if (visual) {
      const clip = visual.asset.clips.find(c => c.name === name);
      if (!clip || frame >= clip.frames.length) throw Error(`Invalid pose ${name}/${frame}. Clips: ${visual.asset.clips.map(c => c.name).join(', ')}`);
    }
    if (options.effect === 'approach') {
      for (const name of ['move', 'ink-spit']) if (!body?.asset.clips.some(c => c.name === name)) throw Error('approach requires move and ink-spit clips');
      const socket = body!.asset.sockets.mouth;
      const mouthOffset = socket ? (body!.asset.pivot[1] - socket[1]) * body!.sprite.displayHeight : options.ink.mouthOffset;
      this.approachPlan = planKrakenApproach(this.center,
        { x: this.gridOrigin.x + (options.approach.targetX + .5) * CELL_SIZE, y: this.gridOrigin.y + (options.approach.targetY + .5) * CELL_SIZE },
        (x, y) => this.model.sample(x - this.gridOrigin.x, y - this.gridOrigin.y), options.approach, mouthOffset, options.direction);
    } else this.approachPlan = null;
    this.options = options;
    for (const [visual, clip, position] of selections) if (visual) visual.playback = { clip, position, playing: options.playing, markers: [] };
    this.grid.setVisible(options.grid); this.render();
  }

  private update(_time: number, delta: number): void {
    if (!this.loaded) return;
    this.time += delta / 1000;
    if (this.options.playback === 'play' && this.options.effect !== 'none') this.options.effectTime = Math.min(120, this.options.effectTime + delta / 1000 * this.options.speed);
    for (const visual of [this.body, this.tentacle, ...this.eggs]) if (visual) {
      advanceReviewClip(visual.playback, visual.asset.clips, delta / 1000 * this.options.speed,
        visual === this.tentacle && this.options.tentacleSequence ? tentacleSequence : undefined);
    }
    this.options.clip = this.body!.playback.clip; this.options.frame = Math.floor(this.body!.playback.position);
    if (this.tentacle) { this.options.tentacleClip = this.tentacle.playback.clip; this.options.tentacleFrame = Math.floor(this.tentacle.playback.position); }
    if (this.eggs[0]) { this.options.eggClip = this.eggs[0].playback.clip; this.options.eggFrame = Math.floor(this.eggs[0].playback.position); }
    this.render();
  }
  private get body(): ReviewVisual | null { return this.options.phase === 'land' ? this.land ?? this.water : this.water; }

  private pose(visual: ReviewVisual, position: Point, pivot = visual.asset.pivot, angle = 0): void {
    const { sprite, asset, playback } = visual;
    const pose = playback.rest ? asset.pose('__rest', 0) : asset.pose(playback.clip, Math.floor(playback.position));
    sprite.setTexture(pose.key, pose.frame).setOrigin(...pivot).setPosition(position.x, position.y).setAngle(angle);
    visual.submersion?.update(pose, this.options.waterLevel ?? asset.elevation?.previewWaterLevel ?? 0,
      this.options.effect === 'none' ? this.time : this.options.effectTime);
    if (visual.submersion) visual.submersion.filter.active = this.options.submersion;
  }

  private render(): void {
    const o = this.options, body = this.body!;
    const choreography = bodyEffectTiming(o, body.asset.clips), bodyEffect = isBodyEffect(o.effect);
    const approach = this.approachPlan?.sample(o.effectTime);
    if (approach) {
      const clip = body.asset.clips.find(c => c.name === (approach.attacking ? 'ink-spit' : 'move'))!;
      const frame = approach.attacking ? Math.min(clip.frames.length - 1, Math.floor(approach.attackTime * clip.frameRate))
        : Math.floor(o.effectTime * clip.frameRate) % clip.frames.length;
      body.playback = { clip: clip.name, position: frame, playing: false, markers: [] };
    } else if (bodyEffect) {
      const selected = effectPose(body.asset.clips, bodyEffectClip(o.effect), Math.max(0, o.effectTime - choreography.lead))!;
      body.playback = { clip: selected.clip, position: selected.frame, playing: false, markers: [] };
    } else if (o.effect !== 'none') {
      const visual = o.effect === 'ink' ? body : this.tentacle;
      if (visual) {
        const selected = effectPose(visual.asset.clips, o.effect === 'ink' ? o.clip : o.tentacleClip, o.effectTime, o.effect === 'erupt' || (o.effect === 'slam' && o.tentacleSequence));
        if (selected) visual.playback = { clip: selected.clip, position: selected.frame, playing: false, markers: [] };
      }
    }
    this.water?.sprite.setVisible(body === this.water); this.land?.sprite.setVisible(body === this.land);
    this.pose(body, approach ?? (o.phase === 'water' ? this.center : { x: this.shore.x, y: this.shore.y + 224 }), body.asset.pivot, (approach ? approach.angle * 180 / Math.PI : o.direction) + 90);
    body.sprite.setAlpha(bodyEffect && (o.effect === 'intro' || o.effect === 'surface') && o.effectTime < choreography.lead ? 0 : 1);
    if (o.effect === 'dive' && o.effectTime >= choreography.submerged.seconds) body.sprite.setAlpha(0);
    if (this.drain) {
      const rising = o.effect === 'intro' || o.effect === 'surface', look = o.effect === 'surface' ? o.surface : o.intro;
      this.drain.active = rising && o.effectTime >= choreography.armsBreak.seconds && o.effectTime < choreography.eyesOpen.seconds + look.drain;
      if (this.drain.active && body.submersion) {
        this.drain.elevation = body.submersion.filter.elevationFrame;
        this.drain.level = body.submersion.filter.params.waterLevel;
        this.drain.time = o.effectTime;
        this.drain.amount = look.foamOpacity * Math.max(0, 1 - Math.max(0, o.effectTime - choreography.eyesOpen.seconds) / look.drain);
      }
    }
    const preview = o.tentacle?.previewFrame !== undefined;
    const timing = this.effectTimings();
    const referenceVisible = o.effect === 'slam' && o.effectTime >= timing.impact.seconds && o.effectTime < timing.impact.seconds + .55;
    if (this.tentacle) {
      this.pose(this.tentacle, this.shore, this.tentacle.asset.sockets.waterEntry ?? o.tentaclePivot, o.direction + 90);
      this.tentacle.sprite.setVisible(!bodyEffect && o.effect !== 'ink' && o.effect !== 'approach' && (!preview || referenceVisible));
    }
    const eggFrames: NonNullable<Parameters<KrakenReviewEffectRenderer['render']>[0]['eggs']> = [];
    this.eggs.forEach((egg, i) => {
      egg.sprite.setScale(egg.asset.scale).setAlpha(1).setVisible(o.effect === 'none' && i < 3);
      if (o.effect === 'egg-throw' && i < this.eggPaths.length) {
        const state = sampleReviewEgg(o.effectTime, choreography.release.seconds, this.eggPaths[i].from, this.eggPaths[i].target,
          o.eggFlight, egg.asset.clips.find(c => c.name === 'hatch')!, egg.asset.clips.find(c => c.name === 'idle')!);
        egg.playback = { clip: state.clip, position: state.frame, playing: false, markers: [] };
        this.pose(egg, state);
        egg.sprite.setVisible(state.visible).setScale(egg.asset.scale * state.scale).setAlpha(state.alpha);
        if (egg.submersion) egg.submersion.filter.active = false;
        eggFrames.push({ point: state, ...state, radius: o.eggFlight.slimeRadius });
      } else this.pose(egg, { x: this.shore.x + (i - 1) * 96 + 240, y: this.shore.y + 176 });
    });
    const shores = this.effectShores();
    this.extraTentacles.forEach((v, index) => {
      v.sprite.setVisible(!bodyEffect && o.effect !== 'none' && o.effect !== 'ink' && o.effect !== 'approach' && index + 1 < shores.length && (!preview || referenceVisible));
      if (v.sprite.visible && this.tentacle) {
        v.playback = { ...this.tentacle.playback };
        this.pose(v, shores[index + 1], v.asset.sockets.waterEntry ?? o.tentaclePivot, o.direction + 90);
      }
    });
    for (const v of [this.tentacle, ...this.extraTentacles]) if (v?.shadow) {
      const clip = v.asset.clips.find(c => c.name === v.playback.clip)!;
      const impactFrame = clip.markers?.impact ?? clip.markers?.strike;
      const contact = clip.name === 'slam' && impactFrame !== undefined
        ? Math.max(0, 1 - v.playback.position / Math.max(1, impactFrame)) : 1;
      const pose = v.playback.rest ? v.asset.pose('__rest', 0) : v.asset.pose(clip.name, Math.floor(v.playback.position));
      v.shadow.update(pose, o.waterLevel ?? v.asset.elevation?.previewWaterLevel ?? 0, contact);
      if (!o.tentacleShadow) v.shadow.image.setVisible(false);
    }
    this.renderer.clear();
    if (o.effect === 'none') this.renderer.showAttack('kraken-review-telegraph', {
      ...(o.telegraphShape === 'lane' ? { shape: 'lane' as const, length: o.telegraphLength, width: o.telegraphWidth }
        : { range: o.telegraphShape === 'bite' ? o.telegraphLength : o.ink.range,
          halfArc: (o.telegraphShape === 'bite' ? 55 : o.ink.halfAngle) * Math.PI / 180, telegraphOnly: o.telegraphShape === 'cone' }),
      ...this.shore, angle: o.direction * Math.PI / 180,
      startedAt: 1000 - o.telegraphProgress * 1000, strikeAt: 1800 - o.telegraphProgress * 1000,
      hitAt: 2000 - o.telegraphProgress * 1000, color: ENEMY_CLAW_HOSTILE_COLOR });
    this.effects.render({ effect: approach ? (approach.attacking ? 'ink' : 'none') : o.effect as Exclude<typeof o.effect, 'approach'>,
      time: approach ? approach.attackTime : o.effectTime, angle: approach?.angle ?? o.direction * Math.PI / 180,
      mouth: this.mouth(), shores, charge: timing.charge.seconds, spit: timing.spit.seconds,
      impact: timing.impact.seconds, retract: timing.retract.seconds, length: o.telegraphLength, width: o.telegraphWidth,
      ink: o.ink, erupt: o.erupt, slam: o.slam, eggs: eggFrames,
      bodyMotion: bodyEffect && o.effect !== 'egg-throw' ? {
        center: this.center, ...(o.effect === 'surface' ? o.surface : o.intro),
        ...(o.effect === 'dive' ? o.dive : {}), shadowOpacity: o.dive.shadowOpacity,
        lead: choreography.lead, arms: choreography.armsBreak.seconds, keel: choreography.keelBreak.seconds,
        roar: choreography.roar.seconds, submerged: choreography.submerged.seconds,
      } : undefined });
  }

  private effectTimings() {
    return effectTiming(this.options, this.body?.asset.clips.find(c => c.name === (this.options.effect === 'approach' ? 'ink-spit' : this.options.clip)),
      this.tentacle?.asset.clips.find(c => c.name === (this.options.effect === 'slam' ? 'slam' : this.options.tentacleClip)), this.tentacle?.asset.clips,
      this.options.effect === 'slam' && this.options.tentacleSequence);
  }
  private mouth(): Point {
    const s = this.body!.sprite, socket = this.body!.asset.sockets.mouth;
    if (socket) {
      const p = s.getWorldTransformMatrix().transformPoint((socket[0] - s.originX) * s.width, (socket[1] - s.originY) * s.height);
      return { x: p.x, y: p.y };
    }
    const angle = s.rotation - Math.PI / 2;
    return { x: s.x + Math.cos(angle) * this.options.ink.mouthOffset, y: s.y + Math.sin(angle) * this.options.ink.mouthOffset };
  }
  private effectShores(): Point[] {
    return Array.from({ length: this.options.erupt.count }, (_, i) => {
      const x = this.shore.x + (i === 0 ? 0 : i === 1 ? -1 : 1) * this.options.erupt.spacing;
      let y = this.center.y;
      while (y < this.shore.y + CELL_SIZE * 3 && this.model.sample(x - this.gridOrigin.x, y - this.gridOrigin.y) > 0) y += .5;
      return { x, y };
    });
  }
  effectFocus(): Point {
    const o = this.options, angle = this.body!.sprite.rotation - Math.PI / 2;
    if (o.effect === 'egg-throw' && this.eggs[0]) return { x: this.eggs[0].sprite.x, y: this.eggs[0].sprite.y };
    if (isBodyEffect(o.effect)) return this.center;
    const ink = o.effect === 'ink' || o.effect === 'approach';
    const point = ink ? this.mouth() : this.shore;
    const distance = ink ? o.ink.range * .5 : o.effect === 'slam' || o.effect === 'none' ? o.telegraphLength * .45 : 0;
    return { x: point.x + Math.cos(angle) * distance, y: point.y + Math.sin(angle) * distance };
  }
  /** Reuse the camera model/preset at an absolute time, so reverse seeks remain pixel-identical. */
  cameraOffset(): Point {
    const o = this.options, intro = o.effect === 'intro';
    const age = o.effectTime - (intro ? bodyEffectTiming(o, this.body!.asset.clips).roar.seconds : this.effectTimings().impact.seconds);
    this.feedback.clear();
    if ((!intro && o.effect !== 'slam') || age < 0) return { x: 0, y: 0 };
    const request = impactLight({ dirX: Math.cos(o.direction * Math.PI / 180), dirY: Math.sin(o.direction * Math.PI / 180) });
    this.feedback.request({ ...request, id: 'kraken-review-impact', amplitudePx: request.amplitudePx * (intro ? o.intro.shakeScale : o.slam.shakeScale) }, 0);
    const sample = this.feedback.step(0, age * 1000, 0, 0, 1);
    return { x: sample.offsetX, y: sample.offsetY };
  }

  status() {
    const screenBounds = (s: Phaser.GameObjects.Sprite) => {
      const camera = this.scene.cameras.main, world = s.getWorldTransformMatrix();
      const project = (x: number, y: number) => {
        const p = world.transformPoint(x - s.displayOriginX, y - s.displayOriginY);
        // Phaser 4's combined matrix already contains scroll and viewport translation.
        const screen = camera.matrixCombined.transformPoint(p.x, p.y);
        return { x: screen.x, y: screen.y };
      };
      return { topLeft: project(0, 0), bottomRight: project(s.width, s.height) };
    };
    const describe = (v: ReviewVisual | null) => v ? { x: v.sprite.x, y: v.sprite.y, depth: v.sprite.depth,
      shadow: v.shadow ? { visible: v.shadow.image.visible, width: v.shadow.image.width } : null,
      texture: v.sprite.texture.key, frame: v.sprite.frame.name, format: v.asset.format,
      width: v.sprite.displayWidth, height: v.sprite.displayHeight, rotation: v.sprite.rotation,
      originX: v.sprite.originX, originY: v.sprite.originY, clips: v.asset.clips, playback: v.playback,
      elevationKey: v.submersion?.filter.elevationFrame.texture.key ?? null,
      elevationFrame: v.submersion?.filter.elevationFrame.name ?? null,
      waterLevel: v.submersion?.filter.params.waterLevel ?? null,
      screen: screenBounds(v.sprite),
      source: { url: v.asset.sourceUrl(v.sprite.texture.key),
        x: v.sprite.frame.cutX, y: v.sprite.frame.cutY, width: v.sprite.frame.cutWidth, height: v.sprite.frame.cutHeight,
        trimX: v.sprite.frame.x, trimY: v.sprite.frame.y, logicalWidth: v.sprite.frame.realWidth, logicalHeight: v.sprite.frame.realHeight } } : null;
    return { loaded: this.loaded, options: this.options, clips: this.body?.asset.clips ?? [],
      body: describe(this.body), tentacle: describe(this.tentacle), eggs: this.eggs.map(describe),
      choreography: { timing: bodyEffectTiming(this.options, this.body?.asset.clips ?? []), eggPaths: this.eggPaths,
        launchSource: this.options.eggLaunches.length ? 'eggLaunches' : this.body?.asset.sockets.egg1 ? 'egg sockets' : 'eggFlight.launchRadius fallback' },
      socketSource: this.tentacle?.asset.sockets.waterEntry ? 'waterEntry' : 'tentaclePivot fallback',
      shore: this.shore, submersion: this.body?.submersion ? 'world-mask' : 'missing-elevation',
      effects: { approach: this.approachPlan ? { duration: this.approachPlan.duration, target: this.approachPlan.target, shore: this.approachPlan.shore, ...this.approachPlan.sample(this.options.effectTime) } : null, timing: this.effectTimings(), mouth: this.mouth(), mouthSource: this.body?.asset.sockets.mouth ? 'mouth socket' : 'ink.mouthOffset fallback',
        shores: this.effectShores(), cameraOffset: this.cameraOffset(), tentacleAssetAvailable: !!this.tentacle,
        tentacleSource: this.options.tentacle?.previewFrame !== undefined ? 'static preview (slam contact only)' : this.tentacle ? 'export' : 'missing' },
      landUsesWaterAsset: this.options.phase === 'land' && !this.land };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.scene.events.off('postupdate', this.update, this);
    for (const v of [this.water, this.land, this.tentacle, ...this.extraTentacles, ...this.eggs]) if (v) { v.shadow?.destroy(); v.sprite.destroy(); v.submersion?.destroy(); }
    this.effects.destroy(); this.feedback.clear();
    this.grid.destroy(); this.renderer.destroy(); this.assets.destroy();
  }
}
