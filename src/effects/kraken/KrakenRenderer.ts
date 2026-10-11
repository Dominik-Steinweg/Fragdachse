import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { PipelineBossAsset, PipelineClip } from '../../config/pipelineAssetContracts';
import type { CombatPartHitReceipt, CombatPartIdentity } from '../../combat/CombatPartContact';
import { combatTargetInstanceKey } from '../../combat/CombatScope';
import type { CombatAreaPose } from '../../combat/CombatAreaAttack';
import type { EnemyAreaClawAttack, EnemyAreaClawEvent, EnemyAreaClawState } from '../../systems/EnemyClawAttack';
import type { KrakenState, KrakenTentacleState, KrakenEggState, KrakenInkCloud } from '../../systems/KrakenState';
import { EnemyClawRenderer } from '../EnemyClawRenderer';
import { registerGraphicsObject } from '../EffectUtils';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { KrakenSubmersion, krakenWaterMask } from './submersionShader';
import { addReviewDrain, type KrakenReviewDrainFilter } from './KrakenReviewDrainFilter';
import { KrakenTentacleShadow } from './KrakenTentacleShadow';
import { KRAKEN_REVIEW_FX_SHADER } from './reviewEffectShader';
import type { GrenadeEggVisual } from '../GrenadeRenderer';

export type KrakenPoint = { readonly x: number; readonly y: number };
export type KrakenPose = KrakenPoint & { readonly angle: number };
export interface KrakenAtlasPose {
  readonly key: string; readonly frame: string;
  readonly elevationKey: string; readonly elevationFrame: string;
}
/** D owns loading/residency. Both passes must be resident together; null means still loading.
 * No URLs, sheet indices or guessed page keys enter presentation. AP2 adapts D's leases here. */
export interface KrakenPresentationAsset {
  readonly metadata: PipelineBossAsset;
  frame(clip: string, index: number): KrakenAtlasPose | null;
}
export interface KrakenPresentationAssets {
  readonly water: KrakenPresentationAsset; readonly land: KrakenPresentationAsset;
  readonly tentacle: KrakenPresentationAsset; readonly egg: KrakenPresentationAsset;
}
export interface KrakenBodyPose extends KrakenPose {
  readonly moving?: boolean;
  readonly claw?: EnemyAreaClawState;
}
export interface KrakenRendererOptions {
  readonly assets: KrakenPresentationAssets | null;
  readonly waterAt: (x: number, y: number) => number;
  /** Read the matching egg Entity generation; the brood slice deliberately carries no pose. */
  readonly readEggPose: (egg: KrakenEggState) => KrakenPose | null;
  readonly diagnostic: (message: string) => void;
  /** Optional existing combat contact-FX adapter. Called once with the physical hit position. */
  readonly partContact?: (receipt: CombatPartHitReceipt) => void;
}

export const krakenClamp = (n: number): number => Math.max(0, Math.min(1, n));
export interface KrakenClipSample { readonly clip: string; readonly frame: number }
type Anchor = readonly [time: number, frame: number];
export function krakenClip(asset: PipelineBossAsset, name: string): PipelineClip {
  const clip = asset.clips.find(c => c.name === name);
  if (!clip) throw Error(`Kraken asset ${asset.id} lacks ${name}`);
  return clip;
}
function marker(clip: PipelineClip, name: string): number {
  const value = clip.markers?.[name];
  if (value === undefined) throw Error(`Kraken clip ${clip.name} lacks marker ${name}`);
  return value;
}
/** Retiming consumes semantic export markers and absolute host anchors, never clip.next. */
export function sampleKrakenClip(clip: PipelineClip, now: number, anchors: readonly Anchor[]): KrakenClipSample {
  let frame = anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [end, last] = anchors[i], [start, first] = anchors[i - 1];
    if (now >= end) { frame = last; continue; }
    frame = first + (last - first) * krakenClamp((now - start) / Math.max(1, end - start));
    break;
  }
  return { clip: clip.name, frame: Math.max(0, Math.min(clip.frames.length - 1, Math.floor(frame))) };
}
function loop(asset: PipelineBossAsset, name: string, age: number): KrakenClipSample {
  const clip = krakenClip(asset, name);
  return { clip: name, frame: Math.floor(Math.max(0, age) / 1000 * clip.frameRate) % clip.frames.length };
}
function timed(asset: PipelineBossAsset, name: string, now: number, start: number, end: number,
  markers: readonly (readonly [number, string])[] = []): KrakenClipSample {
  const clip = krakenClip(asset, name);
  return sampleKrakenClip(clip, now, [[start, 0], ...markers.map(([at, name]) => [at, marker(clip, name)] as const),
    [end, clip.frames.length - 1]]);
}
export function krakenRotation(asset: PipelineBossAsset, angle: number): number {
  return angle - ({ east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[asset.forward]);
}
/** Full-canvas socket; atlas trim never changes the water entry or launch point. */
export function krakenSocket(asset: PipelineBossAsset, pose: KrakenPose, socket: string): KrakenPoint {
  const xy = asset.sockets[socket];
  if (!xy) throw Error(`Kraken asset ${asset.id} lacks socket ${socket}`);
  const size = asset.targetSize * (asset.displayScale ?? 1), r = krakenRotation(asset, pose.angle);
  const dx = (xy[0] - asset.pivot[0]) * size, dy = (xy[1] - asset.pivot[1]) * size;
  return { x: pose.x + dx * Math.cos(r) - dy * Math.sin(r), y: pose.y + dx * Math.sin(r) + dy * Math.cos(r) };
}
export function krakenBodyVisible(state: KrakenState, now: number): boolean {
  const p = state.phase;
  if (['waiting', 'submerged', 'removed'].includes(p.kind)) return false;
  if (p.kind === 'intro') return now >= p.emergeAt;
  if (p.kind === 'dying') return !p.submerged && now < p.endsAt;
  if (p.kind === 'diving' && now >= p.submergedAt) return false;
  // A surface projection supersedes the preceding hidden-body epoch. Protection is not invisibility.
  return p.kind === 'surfacing' || state.bodyTargetability.mode !== 'hidden' || now < state.bodyTargetability.effectiveAt;
}
export function sampleKrakenBody(state: KrakenState, pose: KrakenBodyPose, assets: KrakenPresentationAssets, now: number):
  { asset: KrakenPresentationAsset; sample: KrakenClipSample; pose: KrakenPose; visible: boolean } {
  const p = state.phase;
  const land = p.kind === 'land' || p.kind === 'ashore' || (p.kind === 'dying' && p.asset === 'land');
  const asset = land ? assets.land : assets.water, a = asset.metadata;
  let sample: KrakenClipSample;
  if (p.kind === 'diving') sample = timed(a, 'dive', now, p.startedAt, p.endsAt, [[p.submergedAt, 'submerged']]);
  else if (p.kind === 'surfacing') sample = timed(a, 'surface', now, p.startedAt, p.endsAt, [[p.vulnerableAt, 'eyes-open']]);
  else if (p.kind === 'ashore') sample = timed(a, 'ashore', now, p.moveAt, p.endsAt, [[p.gripAt, 'grip'], [p.heaveAt, 'heave']]);
  else if (p.kind === 'dying') sample = timed(a, land ? 'death' : 'dive', now, p.startedAt, p.endsAt);
  else if (state.bodyAction?.kind === 'ink') {
    const action = state.bodyAction;
    sample = timed(a, 'ink-spit', now, action.startedAt, action.endsAt, [[action.chargeAt, 'charge'], [action.spitAt, 'spit']]);
  } else if (state.bodyAction?.kind === 'eggs') {
    const action = state.bodyAction;
    sample = timed(a, 'egg-throw', now, action.startedAt, action.endsAt, [[action.releaseAt, 'release']]);
  } else if (state.bodyAction?.kind === 'slam' && pose.claw?.attack?.attackId === state.bodyAction.attackId) {
    const action = pose.claw.attack;
    sample = timed(a, 'slam', now, action.startedAt, action.endsAt, [[action.strikeAt, 'strike'], [action.hitAt, 'impact']]);
  } else sample = loop(a, pose.moving && land ? 'move' : 'idle', now);
  return { asset, sample, pose: p.kind === 'dying' ? p.terminalPose : pose, visible: krakenBodyVisible(state, now) };
}
export function sampleKrakenTentacle(t: KrakenTentacleState, asset: PipelineBossAsset, now: number): KrakenClipSample {
  if (t.phase === 'retract' || now >= t.retractAt) return timed(asset, 'retract', now, t.retractAt, t.endsAt);
  if (now < t.hoverAt) return timed(asset, 'rise', now, t.startedAt, t.hoverAt);
  const attack = t.claw.attack;
  if (attack) {
    const slam = krakenClip(asset, 'slam');
    const start = Math.max(t.hoverAt, attack.strikeAt - marker(slam, 'strike') / slam.frameRate * 1000);
    if (now >= start) return timed(asset, 'slam', now, start, attack.endsAt,
      [[attack.strikeAt, 'strike'], [attack.hitAt, 'impact']]);
  }
  return loop(asset, 'hover', now - t.hoverAt);
}
export function sampleKrakenEgg(egg: KrakenEggState, asset: PipelineBossAsset, now: number): KrakenClipSample {
  return now < egg.hatchStartedAt ? loop(asset, 'idle', now - egg.landedAt)
    : timed(asset, 'hatch', now, egg.hatchStartedAt, egg.endsAt, [[egg.spawnAt, 'spawn']]);
}
export function krakenPartKey(part: CombatPartIdentity): string {
  return JSON.stringify([combatTargetInstanceKey(part.boss), part.partId, part.partGeneration, part.cycleId]);
}

/** Review look, now sampled from host timelines. These are visual decay/shape values only. */
const LOOK = {
  ink: { travel: .22, hold: 1, dissolve: .65, opacity: .98, waterSpread: 1.18,
    core: [18 / 255, 10 / 255, 28 / 255], edge: [58 / 255, 34 / 255, 82 / 255], warp: 1.3, sheen: .14 },
  erupt: { radius: 66, lifetime: 1.25, bulge: .15, retractScale: .55, sprayCount: 72, spraySpeed: 150, foam: .75 },
  slam: { dust: .85, decal: 2, whip: .18, bend: 12, width: 42 },
  intro: { radius: 112, lifetime: 1.65, foam: .72, sprayCount: 80, spraySpeed: 135, drain: .85 },
  surface: { radius: 96, lifetime: 1.1, foam: .62, sprayCount: 56, spraySpeed: 105, drain: .65 },
  dive: { radius: 110, lifetime: 1.5, foam: .65, shadow: .12 },
  egg: { arcScale: .65, pulse: .16, radius: 24 },
} as const;

/** Owns sprite/filter/shadow only. The asset lease must outlive this view. */
export class KrakenSpriteView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private submersion: KrakenSubmersion | null = null;
  private drain: KrakenReviewDrainFilter | null = null;
  private shadow: KrakenTentacleShadow | null = null;
  private missing = new Set<string>();
  private destroyed = false;
  constructor(private readonly scene: Phaser.Scene, readonly asset: KrakenPresentationAsset,
    private readonly waterAt: (x: number, y: number) => number,
    private readonly diagnostic: (message: string) => void, tentacle = false, depth: number = DEPTH.PLAYERS) {
    this.sprite = scene.add.sprite(0, 0, '__WHITE').setVisible(false).setDepth(depth);
    registerGraphicsObject(scene, 'bossIntro', this.sprite);
    if (tentacle) {
      this.shadow = new KrakenTentacleShadow(this.sprite, asset.metadata, waterAt);
      registerGraphicsObject(scene, 'bossIntro', this.shadow.image);
    }
  }
  show(sample: KrakenClipSample, pose: KrakenPose, now: number, options: {
    socket?: string; scale?: number; alpha?: number; shadowContact?: number; drain?: number; waterLevel?: number;
  } = {}): boolean {
    if (this.destroyed) return false;
    const a = this.asset.metadata;
    let frame = this.asset.frame(sample.clip, sample.frame);
    if (!frame) {
      if (!this.missing.has(sample.clip)) {
        this.missing.add(sample.clip); this.diagnostic(`Kraken ${a.id}/${sample.clip} unavailable; using resident rest pose`);
      }
      frame = this.asset.frame('__rest', 0);
    }
    if (!frame) { this.hide(); return false; }
    if (!this.scene.textures.exists(frame.key) || !this.scene.textures.exists(frame.elevationKey)) {
      const key = `${sample.clip}/residency`;
      if (!this.missing.has(key)) {
        this.missing.add(key); this.diagnostic(`Kraken ${a.id}/${sample.clip} textures unavailable; hiding view`);
      }
      this.hide(); return false;
    }
    const s = this.sprite, size = a.targetSize * (a.displayScale ?? 1) * (options.scale ?? 1);
    const origin = options.socket ? a.sockets[options.socket] : a.pivot;
    if (!origin) throw Error(`Kraken ${a.id} lacks ${options.socket}`);
    s.setTexture(frame.key, frame.frame).setOrigin(origin[0], origin[1]).setPosition(pose.x, pose.y)
      .setRotation(krakenRotation(a, pose.angle)).setDisplaySize(size, size).setAlpha(options.alpha ?? 1).setVisible(true);
    const elevation = this.scene.textures.getFrame(frame.elevationKey, frame.elevationFrame);
    if (!this.submersion) this.submersion = new KrakenSubmersion(s, elevation, a.elevation, this.waterAt);
    const level = options.waterLevel ?? a.elevation.previewWaterLevel ?? 0;
    this.submersion.update(elevation, level, now / 1000);
    if (options.drain && !this.drain) this.drain = addReviewDrain(s, elevation, a.elevation);
    if (this.drain) {
      this.drain.elevation = elevation; this.drain.level = level; this.drain.time = now / 1000;
      this.drain.amount = options.drain ?? 0; this.drain.active = this.drain.amount > 0;
    }
    this.shadow?.update(frame, level, options.shadowContact ?? 1);
    return true;
  }
  hide(): void { this.sprite.setVisible(false); this.shadow?.image.setVisible(false); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shadow?.destroy(); this.submersion?.destroy(); this.sprite.destroy();
  }
}

interface EffectQuad {
  object: Phaser.GameObjects.Shader; mode: number; age: number; opacity: number;
  shape: number[]; timing: number[]; detail: number[]; core: readonly number[]; edge: readonly number[];
  mask: Phaser.Textures.CanvasTexture | null; maskSignature: string; used: boolean;
}
let effectSerial = 0;
/** Bounded reusable shader quads. Same shader, shapes and layering as the review renderer;
 * each concurrent cloud has its own world-water mask. No emitters, timers or animation callbacks. */
export class KrakenEffects {
  private readonly quads: EffectQuad[] = [];
  private destroyed = false;
  constructor(private readonly scene: Phaser.Scene, private readonly waterAt: (x: number, y: number) => number) {}
  begin(): void { for (const q of this.quads) { q.used = false; q.object.setVisible(false); } }
  private take(mode: number, depth: number, point: KrakenPoint, angle: number, width: number, height: number,
    age: number, shift = 0): EffectQuad | null {
    if (this.destroyed) return null;
    let q = this.quads.find(q => !q.used && q.mode === mode);
    if (!q) {
      if (this.quads.length >= 96) return null;
      const mask = mode === 0 ? this.scene.textures.createCanvas(`kraken-cloud-mask-${++effectSerial}`, 128, 128)! : null;
      const quad: Omit<EffectQuad, 'object'> = { mode, age, opacity: 1, shape: [1, 1, 1, 1], timing: [1, 1, 1, 1], detail: [0, 0, 0, 0],
        core: [0, 0, 0], edge: [0, 0, 0], mask, maskSignature: '', used: true };
      const object = this.scene.add.shader({ name: 'KrakenReviewFX', shaderName: 'KrakenReviewFX', fragmentSource: KRAKEN_REVIEW_FX_SHADER,
        setupUniforms: (set: (name: string, value: number | readonly number[]) => void) => {
          set('uWater', 0); set('uMode', quad.mode); set('uAge', quad.age); set('uShape', quad.shape); set('uTiming', quad.timing);
          set('uOpacity', quad.opacity); set('uDetail', quad.detail); set('uCore', quad.core); set('uEdge', quad.edge);
        },
      }, 0, 0, 1, 1, [mask?.key ?? '__WHITE']);
      q = Object.assign(quad, { object });
      const node = q.object.renderNode;
      q.object.once('destroy', () => disposeShaderWarmupNode(node));
      registerGraphicsObject(this.scene, 'bossIntro', q.object);
      this.quads.push(q);
    }
    q.used = true; q.age = age; q.opacity = 1;
    q.shape = [width, height, 1, 1]; q.timing = [1, 1, 1, 1]; q.detail = [0, 0, 0, 0];
    q.object.setPosition(point.x + Math.cos(angle) * shift, point.y + Math.sin(angle) * shift)
      .setRotation(angle).setDisplaySize(width, height).setDepth(depth).setVisible(true);
    return q;
  }
  ink(cloud: KrakenInkCloud, now: number): void {
    const g = cloud.pose.geometry, age = (now - cloud.spitAt) / 1000;
    if (g.kind !== 'sector' || age < 0 || now >= cloud.cloudEndsAt) return;
    const look = LOOK.ink, size = g.range * 2.8;
    const q = this.take(0, DEPTH.PLAYERS + .2, { x: cloud.pose.originX, y: cloud.pose.originY },
      cloud.pose.angle, size, size, age, size * .25);
    if (!q) return;
    // Preserve the reviewed travel/hold/erosion proportions within the authoritative cloud lifetime.
    const scale = (cloud.cloudEndsAt - cloud.spitAt) / 1000 / (look.travel + look.hold + look.dissolve);
    q.shape[2] = g.range; q.shape[3] = Math.tan(g.arcDegrees * Math.PI / 360);
    q.timing = [look.travel * scale, look.hold * scale, look.dissolve * scale, look.waterSpread];
    q.detail = [look.warp, look.sheen, 0, 0]; q.opacity = look.opacity; q.core = look.core; q.edge = look.edge;
    const s = q.object, signature = [s.x, s.y, s.rotation, size].join(',');
    if (signature !== q.maskSignature) {
      q.maskSignature = signature;
      const pixels = q.mask!.context.createImageData(128, 128);
      pixels.data.set(krakenWaterMask(128, 128,
        { x: s.x, y: s.y, rotation: s.rotation, originX: .5, originY: .5, displayWidth: size, displayHeight: size }, this.waterAt));
      q.mask!.context.putImageData(pixels, 0, 0); q.mask!.refresh();
    }
  }
  erupt(point: KrakenPoint, angle: number, age: number, retracting: boolean, seed: number): void {
    const e = LOOK.erupt;
    if (age < -e.bulge || age >= e.lifetime) return;
    const radius = e.radius * (retracting ? e.retractScale : 1);
    const q = this.take(1, DEPTH.PLAYERS + .1, point, angle, radius * 5, radius * 5, age);
    if (!q) return;
    q.shape[2] = radius; q.shape[3] = seed;
    q.timing = [e.lifetime, e.bulge, retracting ? 1 : 0, e.foam];
    q.detail = [e.sprayCount, e.spraySpeed * (retracting ? e.retractScale : 1), 0, 0];
  }
  slam(pose: CombatAreaPose, hitAt: number, now: number): void {
    if (pose.geometry.kind !== 'lane') return;
    const age = (now - hitAt) / 1000, g = pose.geometry, look = LOOK.slam;
    for (const [mode, lifetime, depth] of [[2, look.dust, DEPTH.PLAYERS + .1], [3, look.decal, DEPTH.DECALS + .15]]) {
      if (age < 0 || age >= lifetime) continue;
      const width = g.length * 1.8;
      const q = this.take(mode, depth, { x: pose.originX, y: pose.originY }, pose.angle, width,
        Math.max(g.width * 3, look.width * 3 + look.bend * 2), age, width * .3);
      if (!q) continue;
      q.shape[2] = g.length; q.shape[3] = g.width; q.timing = [lifetime, look.whip, look.bend, look.width];
    }
  }
  dive(pose: KrakenPose, submergedAt: number, now: number): void {
    const age = (now - submergedAt) / 1000, d = LOOK.dive;
    if (age < 0 || age >= d.lifetime) return;
    const q = this.take(4, DEPTH.PLAYERS - .25, pose, pose.angle, d.radius * 5, d.radius * 5, age);
    if (!q) return;
    q.shape[2] = d.radius; q.shape[3] = 1; q.timing = [d.lifetime, d.shadow, d.foam, 0];
  }
  rise(pose: KrakenPose, timing: KrakenRiseTiming, now: number, intro: boolean): void {
    const b = intro ? LOOK.intro : LOOK.surface;
    const age = (now - timing.startedAt) / 1000, arms = (timing.armsAt - timing.startedAt) / 1000;
    if (now < timing.armsAt && now >= timing.startedAt) {
      const q = this.take(4, DEPTH.PLAYERS - .25, pose, pose.angle, b.radius * 5, b.radius * 5, age);
      if (q) { q.shape[2] = b.radius; q.shape[3] = 0; q.timing = [arms, LOOK.dive.shadow, b.foam, 0]; }
    }
    for (const [i, at] of [timing.armsAt, timing.keelAt, ...(intro ? [timing.roarAt] : [])].entries()) {
      const plumeAge = (now - at) / 1000;
      if (plumeAge < 0 || plumeAge >= b.lifetime) continue;
      const radius = b.radius * (i === 1 ? .7 : i === 2 ? 1.35 : 1);
      const q = this.take(1, DEPTH.PLAYERS + .1, pose, pose.angle, radius * 5, radius * 5, plumeAge);
      if (!q) continue;
      q.shape[2] = radius; q.shape[3] = i; q.timing = [b.lifetime, .1, 0, b.foam];
      q.detail = [b.sprayCount, b.spraySpeed, i === 2 ? 3.4 : 1.8, 1];
    }
  }
  egg(point: KrakenPoint, height: number, landingAge: number, hatchAge: number, alpha = 1, seed = 0): void {
    const radius = LOOK.egg.radius;
    const ground = this.take(5, DEPTH.PLAYERS - .3, point, 0, radius * 7, radius * 7, landingAge);
    if (ground) {
      ground.shape[2] = radius; ground.shape[3] = seed;
      ground.timing = [height, hatchAge, 0, 0]; ground.opacity = alpha;
    }
    if (hatchAge >= 0 && hatchAge < .55) {
      const flash = this.take(6, DEPTH.PLAYERS + .15, point, 0, radius * 7, radius * 7, hatchAge);
      if (flash) { flash.shape[2] = radius; flash.shape[3] = seed; flash.opacity = alpha; }
    }
  }
  clear(): void { this.begin(); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const q of this.quads) { q.object.destroy(); q.mask?.destroy(); }
    this.quads.length = 0;
  }
}

export interface KrakenRiseTiming {
  readonly startedAt: number; readonly clipStartedAt: number; readonly endsAt: number;
  readonly armsAt: number; readonly keelAt: number; readonly eyesAt: number; readonly roarAt: number;
}
/** Additional cosmetic water bursts follow the same retimed clip, with no gameplay side effects. */
export function krakenRiseTiming(asset: PipelineBossAsset, name: 'intro-rise' | 'surface', startedAt: number,
  clipStartedAt: number, endsAt: number, eyesAt?: number): KrakenRiseTiming {
  const c = krakenClip(asset, name), last = c.frames.length - 1;
  const timeOf = (frame: number): number => {
    const eye = c.markers?.['eyes-open'];
    if (eyesAt !== undefined && eye !== undefined) return frame <= eye
      ? clipStartedAt + frame / Math.max(1, eye) * (eyesAt - clipStartedAt)
      : eyesAt + (frame - eye) / Math.max(1, last - eye) * (endsAt - eyesAt);
    return clipStartedAt + frame / Math.max(1, last) * (endsAt - clipStartedAt);
  };
  // AP0 requires eyes-open; the additional splash markers are optional cosmetic export detail.
  const eye = marker(c, 'eyes-open'), intro = name === 'intro-rise';
  return { startedAt, clipStartedAt, endsAt, armsAt: timeOf(c.markers?.['arms-break'] ?? eye * (intro ? .875 / 2.0625 : .25 / .9)),
    keelAt: timeOf(c.markers?.['keel-break'] ?? eye * (intro ? 1.45 / 2.0625 : .55 / .9)), eyesAt: timeOf(eye),
    roarAt: timeOf(c.markers?.roar ?? last) };
}
export function krakenDrain(timing: KrakenRiseTiming, now: number, intro: boolean): number {
  const look = intro ? LOOK.intro : LOOK.surface;
  return now < timing.armsAt ? 0 : look.foam * (1 - krakenClamp((now - timing.eyesAt) / (look.drain * 1000)));
}

interface PartView { view: KrakenSpriteView; event: EnemyAreaClawEvent; state: KrakenTentacleState }
/** Activity presentation owner. sync is a full current projection; clear/destroy detach every view.
 * All positions are presentation-world coordinates and all times are synchronized host times. */
export class KrakenRenderer {
  private readonly claw: EnemyClawRenderer;
  private readonly effects: KrakenEffects;
  private body: KrakenSpriteView | null = null;
  private readonly parts = new Map<string, PartView>();
  private readonly fallbackSlots = new Map<string, EnemyAreaClawEvent>();
  private readonly eggs = new Map<string, KrakenSpriteView>();
  private readonly impacts = new Map<string, EnemyAreaClawAttack>();
  private readonly contacts = new Map<string, { until: number; key: string }>();
  private readonly contactSeen = new Set<string>();
  private bossKey = '';
  private revision = -1;
  private now = 0;
  private destroyed = false;
  private missingAssetsReported = false;
  private waterMotion: { pose: KrakenPose; diveAt?: number; rise?: KrakenRiseTiming } | null = null;
  constructor(private readonly scene: Phaser.Scene, private readonly options: KrakenRendererOptions) {
    this.claw = new EnemyClawRenderer(scene, () => this.now);
    this.effects = new KrakenEffects(scene, options.waterAt);
  }
  sync(state: KrakenState | null, body: KrakenBodyPose | null, now: number): void {
    if (this.destroyed) return;
    if (!state || state.phase.kind === 'removed') { this.clear(); return; }
    const key = combatTargetInstanceKey(state.boss);
    if (key !== this.bossKey) { this.clear(); this.bossKey = key; }
    if (state.revision < this.revision) return;
    this.revision = state.revision; this.now = now;
    this.effects.begin();
    if (!this.options.assets) {
      if (!this.missingAssetsReported) { this.missingAssetsReported = true; this.options.diagnostic('Kraken atlases are not imported/resident; showing authoritative attack geometry only.'); }
      const bodyEvent = this.event(state, { kind: 'body' }, body?.claw ?? { revision: 0, attack: null });
      if (state.phase.kind === 'dying') this.claw.releaseArea(bodyEvent);
      else if (body?.claw) this.claw.syncArea(bodyEvent, now);
      const current = new Set<string>();
      for (const part of state.tentacles) {
        const i = part.contact.identity, key = krakenPartKey(i);
        const event = this.event(state, { kind: 'part', partId: i.partId, partGeneration: i.partGeneration, cycleId: i.cycleId }, part.claw);
        current.add(key); this.fallbackSlots.set(key, event); this.claw.syncArea(event, now);
      }
      for (const [key, event] of this.fallbackSlots) if (!current.has(key)) {
        this.claw.releaseArea(event); this.fallbackSlots.delete(key);
      }
      return;
    }
    const terminal = state.phase.kind === 'dying' ? state.phase.terminalPose : null;
    const pose = terminal ?? body;
    if (pose) {
      const render = sampleKrakenBody(state, body ?? pose, this.options.assets, now);
      if (this.body?.asset !== render.asset) {
        this.body?.destroy(); this.body = this.view(render.asset);
      }
      const phase = state.phase;
      if (phase.kind === 'surfacing') this.waterMotion = { pose: render.pose,
        rise: krakenRiseTiming(render.asset.metadata, 'surface', phase.startedAt, phase.startedAt, phase.endsAt, phase.vulnerableAt) };
      if (phase.kind === 'diving') this.waterMotion = { pose: render.pose, diveAt: phase.submergedAt };
      if (phase.kind === 'dying' && phase.asset === 'water') this.waterMotion = { pose: render.pose, diveAt: phase.startedAt };
      if (render.visible) this.body.show(render.sample, render.pose, now, {
        drain: this.waterMotion?.rise ? krakenDrain(this.waterMotion.rise, now, false) : 0,
        alpha: phase.kind === 'dying' && phase.asset === 'water'
          ? 1 - krakenClamp((now - phase.startedAt) / (phase.endsAt - phase.startedAt)) : 1,
      });
      else this.body.hide();
    } else this.body?.hide();
    if (this.waterMotion) {
      if (this.waterMotion.rise) this.effects.rise(this.waterMotion.pose, this.waterMotion.rise, now, false);
      if (this.waterMotion.diveAt !== undefined) this.effects.dive(this.waterMotion.pose, this.waterMotion.diveAt, now);
    }
    const bodyEvent = this.event(state, { kind: 'body' }, body?.claw ?? { revision: 0, attack: null });
    if (state.phase.kind === 'dying') this.claw.releaseArea(bodyEvent);
    else if (body?.claw) this.claw.syncArea(bodyEvent, now, !!pose);
    this.rememberImpact(bodyEvent.state.attack, now);
    for (const cloud of state.inkClouds) this.effects.ink(cloud, now);
    const partKeys = new Set<string>();
    for (const part of state.tentacles) {
      if (now < part.startedAt || now >= part.endsAt) continue;
      const identity = part.contact.identity, key = krakenPartKey(identity);
      partKeys.add(key);
      const event = this.event(state, { kind: 'part', partId: identity.partId, partGeneration: identity.partGeneration,
        cycleId: identity.cycleId }, part.claw);
      let entry = this.parts.get(key);
      if (!entry) {
        entry = { view: this.view(this.options.assets.tentacle, true), event, state: part };
        this.parts.set(key, entry);
      }
      entry.event = event; entry.state = part;
      const sample = sampleKrakenTentacle(part, this.options.assets.tentacle.metadata, now);
      const attack = part.claw.attack;
      const contact = sample.clip === 'slam' && attack ? 1 - krakenClamp((now - attack.strikeAt) / (attack.hitAt - attack.strikeAt)) : 1;
      // Contact pose is the part's waterEntry frame; outgoing lane origin is independently frozen.
      entry.view.show(sample, part.contact, now, { socket: 'waterEntry', shadowContact: contact });
      entry.view.sprite.clearTint();
      this.claw.syncArea(event, now);
      const retract = part.phase === 'retract' || now >= part.retractAt;
      this.effects.erupt(part.contact, part.contact.angle, (now - (retract ? part.retractAt : part.startedAt)) / 1000, retract, identity.partGeneration);
      this.rememberImpact(attack, now);
    }
    for (const [key, part] of this.parts) if (!partKeys.has(key)) {
      this.claw.releaseArea(part.event); part.view.destroy(); this.parts.delete(key);
    }
    for (const [key, hit] of this.contacts) {
      if (now >= hit.until || !this.parts.has(hit.key)) { this.contacts.delete(key); continue; }
      this.parts.get(hit.key)!.view.sprite.setTint(0xffd8cb);
    }
    for (const [key, attack] of this.impacts) {
      if (now >= attack.hitAt + LOOK.slam.decal * 1000) { this.impacts.delete(key); continue; }
      this.effects.slam(attack.pose, attack.hitAt, now);
    }
    const eggKeys = new Set<string>();
    for (const egg of state.eggs) {
      const key = JSON.stringify([egg.eggId, egg.entityGeneration]);
      const pose = this.options.readEggPose(egg);
      if (!pose || now < egg.landedAt || now >= egg.endsAt || (egg.status === 'terminal' && now < egg.spawnAt)) continue;
      eggKeys.add(key);
      let view = this.eggs.get(key);
      if (!view) { view = this.view(this.options.assets.egg); this.eggs.set(key, view); }
      const landingAge = (now - egg.landedAt) / 1000, hatchAge = (now - egg.hatchStartedAt) / 1000;
      const incubation = krakenClamp((now - egg.landedAt) / (egg.hatchStartedAt - egg.landedAt));
      const pulse = hatchAge < 0 ? Math.sin(landingAge * (5 + incubation * 7)) * LOOK.egg.pulse * incubation : 0;
      view.show(sampleKrakenEgg(egg, view.asset.metadata, now), pose, now, { scale: 1 + pulse });
      this.effects.egg(pose, 0, landingAge, hatchAge, 1, egg.entityGeneration);
    }
    for (const [key, view] of this.eggs) if (!eggKeys.has(key)) { view.destroy(); this.eggs.delete(key); }
  }
  applyAreaClaw(event: EnemyAreaClawEvent, now: number): void {
    if (!this.destroyed) this.claw.syncArea(event, now);
  }
  /** Local contact feedback only; stale/cancelled parts are never recreated by a receipt. */
  confirmContact(receipt: CombatPartHitReceipt, now: number): void {
    if (this.destroyed || receipt.event.scope.worldRevision !== receipt.part.boss.scope.worldRevision
      || receipt.event.scope.runtimeGeneration !== receipt.part.boss.scope.runtimeGeneration
      || receipt.event.activityRevision !== receipt.part.boss.instance.activityRevision) return;
    const key = krakenPartKey(receipt.part), part = this.parts.get(key);
    if (!part || part.state.contact.contactId !== receipt.contactId
      || now < part.state.contact.targetableFrom || now >= part.state.contact.targetableUntil) return;
    const id = JSON.stringify([receipt.event.eventId, receipt.outcomeId, key]);
    if (this.contactSeen.has(id)) return;
    if (this.contactSeen.size >= 4096) this.contactSeen.delete(this.contactSeen.values().next().value!);
    this.contactSeen.add(id);
    this.contacts.set(id, { until: now + 160, key });
    this.options.partContact?.(receipt);
  }
  /** Presentation sockets only. Projectile authority must keep using its authored launch offsets. */
  socket(name: 'mouth' | `egg${1 | 2 | 3 | 4 | 5 | 6}`): KrakenPoint | null {
    const view = this.body;
    if (!view?.sprite.visible) return null;
    const s = view.sprite, a = view.asset.metadata;
    return krakenSocket(a, { x: s.x, y: s.y, angle: s.rotation - krakenRotation(a, 0) }, name);
  }
  clear(): void {
    this.body?.destroy(); this.body = null;
    for (const part of this.parts.values()) part.view.destroy();
    for (const egg of this.eggs.values()) egg.destroy();
    this.parts.clear(); this.fallbackSlots.clear(); this.eggs.clear(); this.contacts.clear(); this.contactSeen.clear(); this.impacts.clear();
    this.claw.clear(); this.effects.clear(); this.waterMotion = null; this.bossKey = ''; this.revision = -1;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.destroyed = true; this.claw.destroy(); this.effects.destroy();
  }
  private view(asset: KrakenPresentationAsset, tentacle = false): KrakenSpriteView {
    return new KrakenSpriteView(this.scene, asset, this.options.waterAt, this.options.diagnostic, tentacle);
  }
  private event(state: KrakenState, slot: EnemyAreaClawEvent['slot'], claw: EnemyAreaClawState): EnemyAreaClawEvent {
    return { worldRevision: state.boss.scope.worldRevision, activityRevision: state.boss.instance.activityRevision,
      enemyId: state.boss.id, entityGeneration: state.boss.instance.entityGeneration, slot, state: claw };
  }
  private rememberImpact(attack: EnemyAreaClawAttack | null, now: number): void {
    if (attack && attack.presentation !== 'ink' && attack.pose.geometry.kind === 'lane' && now >= attack.hitAt
      && now < attack.hitAt + LOOK.slam.decal * 1000) this.impacts.set(attack.attackId, attack);
  }
}

/** D-backed projectile view, owned through GrenadeRenderer.attachEggVisual. The trajectory
 * stays with WorldProjectileRuntime; height changes only displayed scale and ground shadow. */
export class KrakenEggFlightView implements GrenadeEggVisual {
  private readonly view: KrakenSpriteView;
  private readonly effects: KrakenEffects;
  private destroyed = false;
  constructor(scene: Phaser.Scene, asset: KrakenPresentationAsset, diagnostic: (message: string) => void,
    private readonly flight: { readonly releasedAt: number; readonly landsAt: number; readonly target?: KrakenPoint },
    private readonly clock: () => number) {
    this.view = new KrakenSpriteView(scene, asset, () => 0, diagnostic, false, DEPTH.PROJECTILES);
    this.effects = new KrakenEffects(scene, () => 0);
  }
  update(x: number, y: number, _size: number, vx: number, vy: number): void {
    if (this.destroyed) return;
    const now = this.clock();
    this.effects.begin();
    if (now < this.flight.releasedAt || now >= this.flight.landsAt) { this.view.hide(); return; }
    const progress = krakenClamp((now - this.flight.releasedAt) / Math.max(1, this.flight.landsAt - this.flight.releasedAt));
    const height = Math.sin(progress * Math.PI);
    this.view.show(loop(this.view.asset.metadata, 'idle', now - this.flight.releasedAt),
      { x, y, angle: Math.atan2(vy, vx) }, now, { scale: 1 + height * LOOK.egg.arcScale });
    this.effects.egg({ x, y }, height, -1, -1);
    // A slime-coloured brood marker, not a red damage lane. Target is an optional host projection.
    if (this.flight.target) this.effects.egg(this.flight.target, 1, -1, -1, .55);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.view.destroy(); this.effects.destroy();
  }
}
