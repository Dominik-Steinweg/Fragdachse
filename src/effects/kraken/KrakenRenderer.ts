import { sampleKrakenClip, type KrakenClipSample } from './KrakenClipTimeline';
export { sampleKrakenClip, type KrakenClipSample } from './KrakenClipTimeline';
import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { PipelineBossAsset, PipelineClip, PipelineSocketPoint } from '../../config/pipelineAssetContracts';
import type { CombatPartHitReceipt, CombatPartIdentity } from '../../combat/CombatPartContact';
import { combatTargetInstanceKey } from '../../combat/CombatScope';
import type { CombatAreaPose } from '../../combat/CombatAreaAttack';
import type { EnemyAreaClawAttack, EnemyAreaClawEvent, EnemyAreaClawState } from '../../systems/EnemyClawAttack';
import type { KrakenState, KrakenTentacleState, KrakenEggState, KrakenInkCloud } from '../../systems/KrakenState';
import { EnemyClawRenderer } from '../EnemyClawRenderer';
import { registerGraphicsObject } from '../EffectUtils';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { KRAKEN_BROOD, KRAKEN_LAND_EXPOSURE, KRAKEN_WORLD_EXPOSURE, KrakenSubmersion, krakenBroodBeat, krakenBroodGlow, krakenMaterialGrade, krakenWaterMask,
  type KrakenBroodMaterial } from './submersionShader';
import { addReviewDrain, type KrakenReviewDrainFilter } from './KrakenReviewDrainFilter';
import { KrakenShadowRenderer } from './KrakenShadowRenderer';
import type { ShadowSystem } from '../ShadowSystem';
import type { KrakenPoseLease } from './KrakenAssetResidency';
import type { KrakenShadowMesh } from './KrakenLightShadowModel';
import { KRAKEN_REVIEW_FX_SHADER } from './reviewEffectShader';
import type { GrenadeEggVisual } from '../GrenadeRenderer';
import { KRAKEN_BOSS_DEFAULTS, type KrakenBossConfig } from '../../config/krakenBoss';
import { krakenExitRoarAt, type KrakenExitPhase } from '../../systems/CoopDefenseKrakenMotion';
import type { CameraFeedbackController } from '../camera/CameraFeedbackController';
import { impactLight } from '../camera/cameraFeedbackPresets';

export type KrakenPoint = { readonly x: number; readonly y: number };
export type KrakenPose = KrakenPoint & { readonly angle: number };
export interface KrakenAtlasPose {
  readonly key: string; readonly frame: string;
  readonly elevationKey: string; readonly elevationFrame: string;
  readonly emissionKey?: string; readonly emissionFrame?: string; readonly mesh?: KrakenShadowMesh;
}
/** D owns loading/residency. Both passes must be resident together; null means still loading.
 * No URLs, sheet indices or guessed page keys enter presentation. AP2 adapts D's leases here. */
export interface KrakenPresentationAsset {
  readonly metadata: PipelineBossAsset;
  acquire?(clip: string, index: number): KrakenPoseLease | null;
  frame(clip: string, index: number): KrakenAtlasPose | null;
}
export interface KrakenPresentationAssets {
  readonly water: KrakenPresentationAsset; readonly land: KrakenPresentationAsset;
  readonly tentacle: KrakenPresentationAsset; readonly egg: KrakenPresentationAsset;
  /** Detachable dorsal spike drawn at the water body's spine sockets (absent before its import). */
  readonly spine?: KrakenPresentationAsset;
}
export interface KrakenBodyPose extends KrakenPose {
  readonly hpRatio?: number;
  readonly moving?: boolean;
  readonly locomotionTimeMs?: number;
  readonly claw?: EnemyAreaClawState;
}
export interface KrakenRendererOptions {
  readonly assets: KrakenPresentationAssets | null;
  readonly waterAt: (x: number, y: number) => number;
  /** Read the matching egg Entity generation; the brood slice deliberately carries no pose. */
  readonly readEggPose: (egg: KrakenEggState) => KrakenPose | null;
  readonly diagnostic: (message: string) => void;
  readonly config?: KrakenBossConfig;
  readonly feedback?: CameraFeedbackController;
  readonly shadows?: ShadowSystem;
  readonly announceExit?: () => void;
  /** Optional existing combat contact-FX adapter. Called once with the physical hit position. */
  readonly partContact?: (receipt: CombatPartHitReceipt) => void;
}

export const krakenClamp = (n: number): number => Math.max(0, Math.min(1, n));
/** 0..1 with a small overshoot near the end: a regrowing spike pops into place. */
/** Regrowing spine scale: a slow, even push out of the back (half size at half time), then a short pop. */
export function krakenRegrowth(t: number): number {
  const u = krakenClamp(t);
  return u * u * (3 - 2 * u) + .12 * Math.sin(Math.PI * krakenClamp((u - .82) / .18));
}

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
/** The land death plays at its authored speed; the remaining dying time holds the last pose while it fades. */
export function krakenDeathClipEnd(asset: PipelineBossAsset, phase: { startedAt: number; endsAt: number }): number {
  const clip = krakenClip(asset, 'death');
  return Math.min(phase.endsAt, phase.startedAt + clip.frames.length / clip.frameRate * 1000);
}
export function krakenDeathAlpha(asset: PipelineBossAsset, phase: { startedAt: number; endsAt: number }, now: number): number {
  const fadeAt = Math.max(krakenDeathClipEnd(asset, phase), phase.endsAt - 900);
  return 1 - krakenClamp((now - fadeAt) / Math.max(1, phase.endsAt - fadeAt));
}
/** Brood eggs baked into a body throw frame, regraded to the egg's grade around their per-frame sockets. */
export function krakenBroodDiscs(asset: PipelineBossAsset, bodyExposure: number,
  sockets: Readonly<Record<string, PipelineSocketPoint>> | null): KrakenBroodMaterial | null {
  const egg = krakenMaterialGrade('abyssal-kraken-egg', { exposure: bodyExposure });
  if (!sockets) return null;
  const radius = KRAKEN_BROOD.radiusPx / (asset.targetSize * (asset.displayScale ?? 1));
  const discs = [1, 2, 3, 4, 5, 6].flatMap(i => {
    const p = sockets[`egg${i}`];
    return p ? [[p.x, p.y, radius, p.z] as const] : [];
  });
  // Exposure is applied per sprite in display space; fold the egg/body ratio into the linear tint. The body render
  // bakes the brood's shell brighter than the egg asset's own render (albedoMatch, tuned against the flying egg).
  const ratio = Math.pow(egg.exposure / Math.max(.001, bodyExposure), 2.2), match = KRAKEN_BROOD.albedoMatch;
  return discs.length ? { discs, tint: [egg.tint[0]! * ratio * match[0]!, egg.tint[1]! * ratio * match[1]!, egg.tint[2]! * ratio * match[2]!, egg.saturation] } : null;
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
export function sampleKrakenBody(state: KrakenState, pose: KrakenBodyPose, assets: KrakenPresentationAssets, now: number, config = KRAKEN_BOSS_DEFAULTS):
  { asset: KrakenPresentationAsset; sample: KrakenClipSample; pose: KrakenPose; visible: boolean } {
  const p = state.phase;
  const land = p.kind === 'land' || (p.kind === 'ashore' && now >= p.gripAt) || (p.kind === 'dying' && p.asset === 'land');
  const asset = land ? assets.land : assets.water, a = asset.metadata;
  let sample: KrakenClipSample;
  if (p.kind === 'diving') sample = timed(a, 'dive', now, p.startedAt, p.endsAt, [[p.submergedAt, 'submerged']]);
  else if (p.kind === 'surfacing') sample = timed(a, 'surface', now, p.startedAt, p.endsAt, [[p.vulnerableAt, 'eyes-open']]);
  else if (p.kind === 'ashore') {
    if (!land) sample = loop(a, now < p.moveAt || p.blocked ? 'idle' : 'move', now - p.startedAt);
    else { const clip = krakenClip(a, 'ashore'); sample = sampleKrakenClip(clip, now,
      [[p.gripAt, marker(clip, 'grip')], [p.gripAt + config.exit.gripHoldMs, marker(clip, 'grip')],
        [p.heaveAt, marker(clip, 'heave')], [p.endsAt, clip.frames.length - 1]]); }
  }
  else if (p.kind === 'dying') sample = timed(a, land ? 'death' : 'dive', now, p.startedAt, land ? krakenDeathClipEnd(a, p) : p.endsAt);
  else if (state.bodyAction?.kind === 'ink') {
    const action = state.bodyAction;
    sample = timed(a, 'ink-spit', now, action.startedAt, action.endsAt, [[action.chargeAt, 'charge'], [action.spitAt, 'spit']]);
  } else if (state.bodyAction?.kind === 'eggs') {
    const action = state.bodyAction;
    sample = timed(a, 'egg-throw', now, action.startedAt, action.endsAt, [[action.releaseAt, krakenClip(a, 'egg-throw').markers?.['release-1'] !== undefined ? 'release-1' : 'release']]);
  } else if (state.bodyAction?.kind === 'spines' && !land) {
    const action = state.bodyAction;
    sample = timed(a, 'spine-volley', now, action.startedAt, action.endsAt,
      [[action.raiseAt, 'raise'], ...action.releaseAt.map((at, i) => [at, `release-${i + 1}`] as const)]);
  } else if (state.bodyAction?.kind === 'slam' && pose.claw?.attack?.attackId === state.bodyAction.attackId) {
    const action = pose.claw.attack;
    sample = timed(a, 'slam', now, action.startedAt, action.endsAt, [[action.strikeAt, 'strike'], [action.hitAt, 'impact']]);
  } else sample = loop(a, pose.moving ? 'move' : 'idle', pose.moving ? pose.locomotionTimeMs ?? now : now);
  return { asset, sample, pose: p.kind === 'dying' ? p.terminalPose : pose, visible: krakenBodyVisible(state, now) };
}
export function sampleKrakenTentacle(t: KrakenTentacleState, asset: PipelineBossAsset, now: number): KrakenClipSample {
  const attack = t.claw.attack;
  if (t.phase === 'retract' || now >= t.retractAt) {
    // A lurk that found no target sinks back the way it came instead of peeling off a lane it never struck.
    if (!attack) {
      const rise = krakenClip(asset, 'rise'), last = rise.frames.length - 1;
      return { clip: 'rise', frame: Math.round(last * (1 - krakenClamp((now - t.retractAt) / Math.max(1, t.endsAt - t.retractAt)))) };
    }
    return timed(asset, 'retract', now, t.retractAt, t.endsAt);
  }
  if (now < t.hoverAt) return timed(asset, 'rise', now, t.startedAt, t.hoverAt);
  const hover = krakenClip(asset, 'hover'), period = hover.frames.length / hover.frameRate * 1000;
  if (attack) {
    const slam = krakenClip(asset, 'slam');
    const start = Math.max(t.hoverAt, attack.strikeAt - marker(slam, 'strike') / slam.frameRate * 1000);
    if (now >= start) return timed(asset, 'slam', now, start, attack.endsAt,
      [[attack.strikeAt, 'strike'], [attack.hitAt, 'impact']]);
    // The lurk loop keeps its own clock until the telegraph appears; from then on it is retimed to arrive
    // exactly on hover frame 0 (the slam's first pose) when the slam begins, without jumping.
    const from = Math.max(t.hoverAt, Math.min(attack.startedAt, start)), lurked = from - t.hoverAt, span = start - from;
    if (now < from) return loop(asset, 'hover', now - t.hoverAt);
    const arrive = Math.max(Math.ceil(lurked / period), Math.round((lurked + span) / period)) * period;
    return loop(asset, 'hover', span > 0 ? lurked + (now - from) * (arrive - lurked) / span : arrive);
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
  spineWake: { length: 150, width: 9, lead: 10, opacity: .9 },
} as const;

/** Owns sprite/filter/shadow only. The asset lease must outlive this view. */
export class KrakenSpriteView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private submersion: KrakenSubmersion | null = null;
  private drain: KrakenReviewDrainFilter | null = null;
  private shadow: KrakenShadowRenderer | null = null;
  private lease: KrakenPoseLease | null = null;
  private environment: ReturnType<ShadowSystem['borrowFigureEnvironment']> = null;
  private missing = new Set<string>();
  private destroyed = false;
  private framedSockets: Readonly<Record<string, PipelineSocketPoint>> | null = null;
  /** World position and model height (BU) of a socket in the frame currently on screen. */
  socketWorld(name: string): { x: number; y: number; z: number } | null {
    const point = this.sprite.visible ? this.framedSockets?.[name] : undefined;
    if (!point) return null;
    const s = this.sprite, dx = (point.x - s.originX) * s.displayWidth, dy = (point.y - s.originY) * s.displayHeight;
    const c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
    return { x: s.x + dx * c - dy * sn, y: s.y + dx * sn + dy * c, z: point.z };
  }
  get gpuBytes(): number { return (this.shadow?.gpuBytes ?? 0) + (this.submersion ? 128 * 128 * 4 : 0); }
  constructor(private readonly scene: Phaser.Scene, readonly asset: KrakenPresentationAsset,
    private readonly waterAt: (x: number, y: number) => number,
    private readonly diagnostic: (message: string) => void, tentacle = false, depth: number = DEPTH.PLAYERS,
    private readonly exposure = KRAKEN_WORLD_EXPOSURE, private readonly shadows?: ShadowSystem, castShadow = true) {
    this.sprite = scene.add.sprite(0, 0, '__WHITE').setVisible(false).setDepth(depth);
    registerGraphicsObject(scene, 'bossIntro', this.sprite);
    // The shadow system also supplies sun/cloud lighting; projectiles draw their own ground marker instead.
    if (shadows && castShadow) this.shadow = new KrakenShadowRenderer(scene, shadows);
  }
  show(sample: KrakenClipSample, pose: KrakenPose, now: number, options: {
    socket?: string; scale?: number; alpha?: number; shadowContact?: number; drain?: number; waterLevel?: number; requireClip?: boolean;
    /** Ember strength of an egg view (default: carried pulse); body views derive their brood glow themselves. */
    glow?: number;
  } = {}): boolean {
    if (this.destroyed) return false;
    const a = this.asset.metadata;
    const lease = this.asset.acquire?.(sample.clip, sample.frame) ?? null;
    // The residency owner reports actual load failures. A pending lease during
    // cold entry is expected and must not raise a false visible error.
    if (this.asset.acquire && !lease) { this.hide(); return false; }
    let frame = lease?.pose ?? this.asset.frame(sample.clip, sample.frame);
    // An intro rest fallback would expose the whole body before its authored emergence.
    if (options.requireClip && (!frame || lease?.pose.fallback)) { lease?.release(); this.hide(); return false; }
    if (!frame) {
      if (!this.missing.has(sample.clip)) {
        this.missing.add(sample.clip); this.diagnostic(`Kraken ${a.id}/${sample.clip} unavailable; using resident rest pose`);
      }
      frame = this.asset.frame('__rest', 0);
    }
    if (!frame) { lease?.release(); this.hide(); return false; }
    if (!this.scene.textures.exists(frame.key) || !this.scene.textures.exists(frame.elevationKey)) {
      const key = `${sample.clip}/residency`;
      if (!this.missing.has(key)) {
        this.missing.add(key); this.diagnostic(`Kraken ${a.id}/${sample.clip} textures unavailable; hiding view`);
      }
      lease?.release(); this.hide(); return false;
    }
    const s = this.sprite, size = a.targetSize * (a.displayScale ?? 1) * (options.scale ?? 1);
    const origin = options.socket ? a.sockets[options.socket] : a.pivot;
    if (!origin) throw Error(`Kraken ${a.id} lacks ${options.socket}`);
    s.setTexture(frame.key, frame.frame).setOrigin(origin[0], origin[1]).setPosition(pose.x, pose.y)
      .setRotation(krakenRotation(a, pose.angle)).setDisplaySize(size, size).setAlpha(options.alpha ?? 1).setVisible(true);
    const elevation = this.scene.textures.getFrame(frame.elevationKey, frame.elevationFrame);
    if (!this.submersion) this.submersion = new KrakenSubmersion(s, elevation, a.elevation, this.waterAt, this.exposure);
    const level = options.waterLevel ?? a.elevation.previewWaterLevel ?? 0;
    const clipFrames = a.clips.find(c => c.name === sample.clip)?.frames;
    const sockets = lease?.pose.sockets ?? (clipFrames ? a.socketFrames?.[clipFrames[sample.frame] ?? -1] : undefined) ?? null;
    if (a.materialPass && a.elevationPass.encoding === 'linear-unorm8-z-oct-normal-v1' && frame.emissionKey) {
      this.environment ??= this.shadows?.borrowFigureEnvironment(() => {
        this.environment = null; if (this.submersion) this.submersion.filter.material = null;
      }) ?? null;
      const grade = krakenMaterialGrade(a.id, a.materialPass), egg = a.id === 'abyssal-kraken-egg';
      const brood = !egg && sample.clip === 'egg-throw' && !lease?.pose.fallback ? krakenBroodDiscs(a, grade.exposure, sockets) : null;
      const glow = egg || brood ? { color: KRAKEN_BROOD.glowColor, falloff: KRAKEN_BROOD.glowFalloff, whole: egg,
        strength: options.glow ?? krakenBroodGlow(krakenBroodBeat(now / 1000)) } : undefined;
      if (this.environment) this.submersion.filter.material = { clouds: this.environment.clouds,
        emission: this.scene.textures.getFrame(frame.emissionKey, frame.emissionFrame), emissionRange: a.materialPass.emissionRange, tint: grade.tint, saturation: grade.saturation,
        highlightRollOff: !egg, highlightRole: a.id === 'abyssal-kraken-tentacle' ? 'tentacle' : 'body', glow, brood };
      this.submersion.filter.params.exposure = grade.exposure;
    }
    this.submersion.update(elevation, level, now / 1000);
    if (options.drain && !this.drain) this.drain = addReviewDrain(s, elevation, a.elevation);
    if (this.drain) {
      this.drain.elevation = elevation; this.drain.level = level; this.drain.time = now / 1000;
      this.drain.amount = options.drain ?? 0; this.drain.active = this.drain.amount > 0;
    }
    if (frame.mesh && a.materialPass) this.shadow?.update(s, frame.mesh, a.sourceSize, a.materialPass.worldPxPerBU, level,
      a.id.endsWith('-egg') ? 'egg' : a.id.endsWith('-tentacle') ? 'tentacle' : a.id.endsWith('-land') ? 'land'
        : a.id.endsWith('-spine') ? 'spine' : 'water');
    else this.shadow?.hide();
    this.framedSockets = sockets;
    this.lease?.release(); this.lease = lease;
    return true;
  }
  hide(): void { this.sprite.setVisible(false); this.shadow?.hide(); this.lease?.release(); this.lease = null; this.framedSockets = null; }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shadow?.destroy(); this.environment?.release(); this.environment = null; this.submersion?.destroy(); this.sprite.destroy(); this.lease?.release(); this.lease = null;
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
  get gpuBytes(): number { return this.quads.filter(q => q.mask).length * 128 * 128 * 4; }
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
  slam(pose: CombatAreaPose, hitAt: number, now: number, bend: number = LOOK.slam.bend): void {
    if (pose.geometry.kind !== 'lane') return;
    const age = (now - hitAt) / 1000, g = pose.geometry, look = LOOK.slam;
    for (const [mode, lifetime, depth] of [[2, look.dust, DEPTH.PLAYERS + .1], [3, look.decal, DEPTH.DECALS + .15]]) {
      if (age < 0 || age >= lifetime) continue;
      const width = g.length * 1.8;
      const q = this.take(mode, depth, { x: pose.originX, y: pose.originY }, pose.angle, width,
        Math.max(g.width * 3, look.width * 3 + look.bend * 2), age, width * .3);
      if (!q) continue;
      q.shape[2] = g.length; q.shape[3] = g.width; q.timing = [lifetime, look.whip, bend, look.width];
    }
  }
  dive(pose: KrakenPose, submergedAt: number, now: number): void {
    const age = (now - submergedAt) / 1000, d = LOOK.dive;
    if (age < 0 || age >= d.lifetime) return;
    const q = this.take(4, DEPTH.PLAYERS - .25, pose, pose.angle, d.radius * 5, d.radius * 5, age);
    if (!q) return;
    q.shape[2] = d.radius; q.shape[3] = 1; q.timing = [d.lifetime, d.shadow, d.foam, 0];
  }
  ashore(pose: KrakenPose, phase: KrakenExitPhase, now: number, gripPose = pose): void {
    const age = (now - phase.startedAt) / 1000;
    if (now < phase.gripAt) {
      const q = this.take(7, DEPTH.PLAYERS - .25, pose, pose.angle, 560, 360, age);
      if (q) q.detail[0] = now > phase.moveAt && !phase.blocked ? 1 : 0;
      // A diffuse directional footprint, not an attack ring. Anchor it at the shore contact.
      const shore = this.take(10, DEPTH.PLAYERS - .24, gripPose, gripPose.angle, 300, 240, age, 115);
      if (shore) shore.opacity = .55;
    }
    const sprayAge = (now - phase.gripAt) / 1000;
    if (sprayAge >= 0 && sprayAge < 1.3) {
      const splash = this.take(9, DEPTH.PLAYERS + .1, gripPose, gripPose.angle, 420, 420, sprayAge, 55);
      if (splash) splash.opacity = .8;
    }
    if (now >= phase.gripAt) {
      const contact = { x: gripPose.x + Math.cos(gripPose.angle) * 96, y: gripPose.y + Math.sin(gripPose.angle) * 96 };
      if (this.waterAt(contact.x, contact.y) <= 0) this.slam({ originX: contact.x, originY: contact.y,
        angle: gripPose.angle, geometry: { kind: 'lane', length: 90, width: 100 } }, phase.gripAt, now, 0);
      this.dive({ ...gripPose, x: gripPose.x - Math.cos(gripPose.angle) * 100,
        y: gripPose.y - Math.sin(gripPose.angle) * 100 }, phase.gripAt, now);
    }
  }
  /** Ichor wake of a flying spine; `curvature` (1/px) bends it along the homing turn. */
  spineWake(head: KrakenPose, lengthPx: number, curvature: number, age: number, seed: number): void {
    const w = LOOK.spineWake, width = lengthPx + w.lead + 8;
    const q = this.take(11, DEPTH.PROJECTILES - .01, head, head.angle, width, w.width * 6, age, -width / 2);
    if (!q) return;
    q.shape[2] = lengthPx; q.shape[3] = w.width; q.timing = [w.lead, curvature, seed, 0]; q.opacity = w.opacity;
  }
  wetTrail(pose: KrakenPose, at: number, now: number): void {
    const age = (now - at) / 1000;
    if (age < 0 || age > 4) return;
    const q = this.take(8, DEPTH.DECALS + .1, pose, pose.angle, 220, 160, age);
    if (q) { q.shape[2] = 72; q.shape[3] = 36; q.timing = [4, 0, 0, 0]; }
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
  private readonly spineViews: KrakenSpriteView[] = [];
  private readonly impacts = new Map<string, EnemyAreaClawAttack>();
  private readonly contacts = new Map<string, { until: number; key: string }>();
  private readonly contactSeen = new Set<string>();
  private bossKey = '';
  private revision = -1;
  private now = 0;
  private destroyed = false;
  private missingAssetsReported = false;
  private waterMotion: { pose: KrakenPose; diveAt?: number; rise?: KrakenRiseTiming } | null = null;
  private lastBody: { pose: KrakenPose; now: number } | null = null;
  private locomotionTime = 0;
  private exitKey = '';
  private announcedExit = '';
  private trails: { pose: KrakenPose; at: number }[] = [];
  private wetUntil = 0;
  private exitVisual: { phase: KrakenExitPhase; grip: KrakenPose | null } | null = null;
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
    const cuePhase = state.phase, cueConfig = this.options.config ?? KRAKEN_BOSS_DEFAULTS;
    if (body) {
      if (cuePhase.kind === 'ashore') {
        const cueKey = `${key}/${cuePhase.startedAt}`;
        if (cueKey !== this.announcedExit) { this.announcedExit = cueKey;
          if (now >= cuePhase.startedAt && now < cuePhase.moveAt) this.options.announceExit?.(); }
        this.impulse('roar', krakenExitRoarAt(cuePhase, cueConfig.exit), body, now);
        this.impulse('grip', cuePhase.gripAt, body, now);
      }
      if (body.claw?.attack?.presentation === 'slam') this.impulse('claw', body.claw.attack.hitAt, body, now);
    }
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
      if (body) this.lastBody = { pose: { ...body }, now };
      return;
    }
    const terminal = state.phase.kind === 'dying' ? state.phase.terminalPose : null;
    const pose = terminal ?? body;
    if (pose) {
      const config = this.options.config ?? KRAKEN_BOSS_DEFAULTS;
      const elapsed = this.lastBody ? now - this.lastBody.now : 0;
      const distance = this.lastBody ? Math.hypot(pose.x - this.lastBody.pose.x, pose.y - this.lastBody.pose.y) : 0;
      const moving = (state.phase.kind === 'land' || state.movement === 'water-approach')
        && !state.bodyAction && elapsed > 0 && elapsed < 500 && distance > .01;
      if (moving) this.locomotionTime += distance / (state.phase.kind === 'land' ? config.landMoveSpeedPxPerSec : config.waterApproachSpeedPxPerSec) * 1000;
      const render = sampleKrakenBody(state, { ...(body ?? pose), moving, locomotionTimeMs: this.locomotionTime }, this.options.assets, now, config);
      if (this.body?.asset !== render.asset) {
        this.body?.destroy(); this.body = this.view(render.asset);
      }
      const phase = state.phase;
      if (phase.kind === 'ashore') {
        const key = `${this.bossKey}/${phase.startedAt}`;
        if (key !== this.exitKey) { this.exitKey = key; this.exitVisual = { phase, grip: null }; }
        this.exitVisual!.phase = phase;
        if (now >= phase.gripAt && !this.exitVisual!.grip) this.exitVisual!.grip = { ...render.pose };
        this.wetUntil = phase.endsAt + 3200;
      }
      if (this.exitVisual && (phase.kind === 'ashore' || phase.kind === 'land')) {
        this.effects.ashore(render.pose, this.exitVisual.phase, now, this.exitVisual.grip ?? render.pose);
      }
      if (now < this.wetUntil && (phase.kind === 'land' || phase.kind === 'ashore' && now >= phase.gripAt)
        && (!this.trails.length || Math.hypot(pose.x - this.trails[this.trails.length - 1].pose.x, pose.y - this.trails[this.trails.length - 1].pose.y) > 28)) {
        this.trails.push({ pose: { ...pose }, at: now });
        if (this.trails.length > 24) this.trails.shift();
      }
      this.lastBody = { pose: { ...pose }, now };
      if (phase.kind === 'surfacing') this.waterMotion = { pose: render.pose,
        rise: krakenRiseTiming(render.asset.metadata, 'surface', phase.startedAt, phase.startedAt, phase.endsAt, phase.vulnerableAt) };
      if (phase.kind === 'diving') this.waterMotion = { pose: render.pose, diveAt: phase.submergedAt };
      if (phase.kind === 'dying' && phase.asset === 'water') this.waterMotion = { pose: render.pose, diveAt: phase.startedAt };
      if (render.visible) this.body.show(render.sample, render.pose, now, {
        drain: phase.kind === 'ashore' && now >= phase.gripAt
          ? 1 - krakenClamp((now - phase.heaveAt) / 1100)
          : this.waterMotion?.rise ? krakenDrain(this.waterMotion.rise, now, false) : 0,
        alpha: phase.kind !== 'dying' ? 1 : phase.asset === 'water'
          ? 1 - krakenClamp((now - phase.startedAt) / (phase.endsAt - phase.startedAt))
          : krakenDeathAlpha(render.asset.metadata, phase, now),
      });
      else this.body.hide();
      this.syncSpines(state, render.asset === this.options.assets.water && render.visible, now);
    } else { this.body?.hide(); this.syncSpines(state, false, now); }
    this.trails = this.trails.filter(t => now - t.at < 4000);
    for (const trail of this.trails) this.effects.wetTrail(trail.pose, trail.at, now);
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
      const beat = Math.sin(landingAge * (5 + incubation * 7));
      const pulse = hatchAge < 0 ? beat * LOOK.egg.pulse * incubation : 0;
      // The ember swells with the heartbeat, flares while the shell splits and dies with the spawn.
      const glow = hatchAge < 0 ? krakenBroodGlow(beat, incubation) : now < egg.spawnAt
        ? KRAKEN_BROOD.incubatedGlow + (KRAKEN_BROOD.hatchGlow - KRAKEN_BROOD.incubatedGlow) * krakenClamp((now - egg.hatchStartedAt) / Math.max(1, egg.spawnAt - egg.hatchStartedAt))
        : KRAKEN_BROOD.hatchGlow * (1 - krakenClamp((now - egg.spawnAt) / 250));
      view.show(sampleKrakenEgg(egg, view.asset.metadata, now), pose, now, { scale: 1 + pulse, glow });
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
    for (const id of ['roar', 'grip', 'claw']) this.options.feedback?.cancel(`kraken-${id}`);
    this.lastBody = null; this.locomotionTime = 0; this.exitKey = ''; this.announcedExit = ''; this.exitVisual = null; this.trails = []; this.wetUntil = 0;
    this.body?.destroy(); this.body = null;
    for (const part of this.parts.values()) part.view.destroy();
    for (const egg of this.eggs.values()) egg.destroy();
    for (const view of this.spineViews) view.destroy();
    this.spineViews.length = 0;
    this.parts.clear(); this.fallbackSlots.clear(); this.eggs.clear(); this.contacts.clear(); this.contactSeen.clear(); this.impacts.clear();
    this.claw.clear(); this.effects.clear(); this.waterMotion = null; this.bossKey = ''; this.revision = -1;
  }
  private impulse(id: string, at: number, pose: KrakenPose, now: number): void {
    if (!this.lastBody || now - this.lastBody.now >= 150 || this.lastBody.now >= at || now < at || now - at >= 150) return;
    const impulse = impactLight({ sourceX: pose.x, sourceY: pose.y });
    this.options.feedback?.request({ ...impulse, id: `kraken-${id}`, amplitudePx: impulse.amplitudePx * .45 });
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.destroyed = true; this.claw.destroy(); this.effects.destroy();
  }
  get gpuBytes(): number { return (this.body?.gpuBytes ?? 0) + this.effects.gpuBytes
    + [...this.parts.values()].reduce((sum, p) => sum + p.view.gpuBytes, 0)
    + [...this.eggs.values()].reduce((sum, v) => sum + v.gpuBytes, 0)
    + this.spineViews.reduce((sum, v) => sum + v.gpuBytes, 0); }
  /** The water body's six front dorsal spikes are runtime parts: hidden from their release until they regrow
   * (scale-in with a slight overshoot), raised a little while a volley winds up, and submerged with the body. */
  private syncSpines(state: KrakenState, bodyShown: boolean, now: number): void {
    const asset = this.options.assets?.spine, body = this.body;
    if (!asset || !body || !bodyShown) { for (const view of this.spineViews) view.hide(); return; }
    const a = asset.metadata, base = a.sockets.base, tip = a.sockets.tip, size = a.targetSize * (a.displayScale ?? 1);
    if (!base || !tip) return;
    const authored = Math.hypot((tip[0] - base[0]) * size, (tip[1] - base[1]) * size);
    const bodyLevel = body.asset.metadata.elevation.previewWaterLevel ?? 0;
    const volley = state.bodyAction?.kind === 'spines' ? state.bodyAction : null;
    const bristle = volley ? krakenClamp((now - volley.startedAt) / Math.max(1, volley.raiseAt - volley.startedAt)) : 0;
    for (let i = 0; i < 6; i++) {
      const view = this.spineViews[i] ??= new KrakenSpriteView(this.scene, asset, this.options.waterAt, this.options.diagnostic,
        false, DEPTH.PLAYERS + .01, KRAKEN_WORLD_EXPOSURE, this.options.shadows);
      const from = body.socketWorld(`spine${i + 1}`), to = body.socketWorld(`spine${i + 1}Tip`);
      const regrow = state.spines.find(spine => spine.index === i);
      const released = volley !== null && now >= volley.releaseAt[i]!;
      let growth = 1, alpha = 1;
      if (regrow) {
        const t = krakenClamp((now - regrow.regrowStartsAt) / Math.max(1, regrow.readyAt - regrow.regrowStartsAt));
        growth = now < regrow.regrowStartsAt ? 0 : krakenRegrowth(t);
        alpha = .55 + .45 * t;
      } else if (released) growth = 0;
      else if (volley) growth = 1 + .12 * bristle;
      if (!from || !to || growth <= .02) { view.hide(); continue; }
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      view.show({ clip: 'idle', frame: 0 }, { x: from.x, y: from.y, angle: Math.atan2(to.y - from.y, to.x - from.x) + Math.PI }, now,
        { socket: 'base', scale: authored > 0 ? length / authored * growth : growth, alpha, waterLevel: bodyLevel - from.z });
    }
  }
  private view(asset: KrakenPresentationAsset, tentacle = false): KrakenSpriteView {
    const exposure = asset === this.options.assets?.land ? KRAKEN_LAND_EXPOSURE : KRAKEN_WORLD_EXPOSURE;
    return new KrakenSpriteView(this.scene, asset, this.options.waterAt, this.options.diagnostic, tentacle, DEPTH.PLAYERS, exposure, this.options.shadows);
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
    private readonly clock: () => number, shadows?: ShadowSystem) {
    // Lit like the landed egg; without the material pass the albedo atlas reads as a dark blot.
    this.view = new KrakenSpriteView(scene, asset, () => 0, diagnostic, false, DEPTH.PROJECTILES, KRAKEN_WORLD_EXPOSURE, shadows, false);
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
      { x, y, angle: Math.atan2(vy, vx) }, now, { scale: 1 + height * LOOK.egg.arcScale, waterLevel: -1000 });
    this.effects.egg({ x, y }, height, -1, -1);
    // A slime-coloured brood marker, not a red damage lane. Target is an optional host projection.
    if (this.flight.target) this.effects.egg(this.flight.target, 1, -1, -1, .55);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.view.destroy(); this.effects.destroy();
  }
}

/** A fired dorsal spine in flight: the same detachable spike art, tip leading along its velocity, trailing a
 * GPU ichor wake that bends with its homing turn. Trajectory and homing stay with the projectile runtime. */
export class KrakenSpineFlightView implements GrenadeEggVisual {
  private readonly view: KrakenSpriteView;
  private readonly effects: KrakenEffects;
  private readonly startedAt: number;
  private last: { x: number; y: number; heading: number } | null = null;
  private travelled = 0;
  private curvature = 0;
  private destroyed = false;
  constructor(scene: Phaser.Scene, asset: KrakenPresentationAsset, diagnostic: (message: string) => void,
    private readonly clock: () => number, shadows?: ShadowSystem, private readonly seed = 0) {
    this.view = new KrakenSpriteView(scene, asset, () => 0, diagnostic, false, DEPTH.PROJECTILES, KRAKEN_WORLD_EXPOSURE, shadows, false);
    this.effects = new KrakenEffects(scene, () => 0);
    this.startedAt = clock();
  }
  update(x: number, y: number, _size: number, vx: number, vy: number): void {
    if (this.destroyed) return;
    const now = this.clock(), heading = Math.atan2(vy, vx);
    if (this.last) {
      const step = Math.hypot(x - this.last.x, y - this.last.y);
      const turn = Math.atan2(Math.sin(heading - this.last.heading), Math.cos(heading - this.last.heading));
      this.travelled += step;
      if (step > .5) this.curvature += (Math.max(-.02, Math.min(.02, turn / step)) - this.curvature) * .35;
    }
    this.last = { x, y, heading };
    // The spike's tip points away from its base; lead with the tip.
    this.view.show({ clip: 'idle', frame: 0 }, { x, y, angle: heading + Math.PI }, now, { waterLevel: -1000 });
    this.effects.begin();
    this.effects.spineWake({ x, y, angle: heading }, Math.min(LOOK.spineWake.length, this.travelled),
      this.curvature, (now - this.startedAt) / 1000, this.seed);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.view.destroy(); this.effects.destroy();
  }
}
