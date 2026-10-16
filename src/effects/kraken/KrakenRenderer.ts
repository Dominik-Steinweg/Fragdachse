import { sampleKrakenClip, type KrakenClipSample } from './KrakenClipTimeline';
export { sampleKrakenClip, type KrakenClipSample } from './KrakenClipTimeline';
import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { PipelineBossAsset, PipelineClip, PipelineSocketPoint } from '../../config/pipelineAssetContracts';
import type { CombatPartHitReceipt, CombatPartIdentity } from '../../combat/CombatPartContact';
import { combatTargetInstanceKey } from '../../combat/CombatScope';
import type { CombatAreaPose } from '../../combat/CombatAreaAttack';
import type { EnemyAreaClawAttack, EnemyAreaClawEvent, EnemyAreaClawState } from '../../systems/EnemyClawAttack';
import type { KrakenState, KrakenTentacleState, KrakenEggState, KrakenInkCloud, KrakenSpineState } from '../../systems/KrakenState';
import { EnemyClawRenderer } from '../EnemyClawRenderer';
import { registerGraphicsObject } from '../EffectUtils';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { KRAKEN_BROOD, KRAKEN_DRY_SAMPLER, KRAKEN_LAND_EXPOSURE, KRAKEN_WORLD_EXPOSURE, KrakenSubmersion, krakenBroodBeat, krakenBroodGlow, krakenEggArc, krakenMaterialGrade, krakenWaterMask,
  type KrakenBroodMaterial } from './submersionShader';
import { addReviewDrain, type KrakenReviewDrainFilter } from './KrakenReviewDrainFilter';
import { KrakenShadowRenderer } from './KrakenShadowRenderer';
import { KrakenEmissionQuad } from './KrakenEmissionQuad';
import { krakenBodySuckers, krakenDeepEmber, krakenEggGlowState, krakenEyeDrive, krakenTentacleSuckers, KRAKEN_GLOW } from './KrakenGlowTimeline';
import { KrakenGlowLayer } from './KrakenGlowLayer';
import { KrakenLightRig } from './KrakenLightRig';
import { KRAKEN_GLOW_LOOK, lightKrakenArm, paintKrakenEgg, paintKrakenEyes, paintKrakenRoar, paintKrakenSuckers } from './KrakenGlowPresentation';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import type { LightingSystem } from '../LightingSystem';
import type { KrakenGlowPoint, KrakenGlowPointSet } from './KrakenGlowPoints';
import type { ShadowSystem } from '../ShadowSystem';
import { WaterDisturbanceField, type WaterDisturbance } from '../../arena/WaterDisturbanceField';
import type { KrakenPoseLease } from './KrakenAssetResidency';
import type { KrakenShadowMesh } from './KrakenLightShadowModel';
import { KRAKEN_REVIEW_FX_SHADER, krakenInkQuad, krakenInkSeed } from './reviewEffectShader';
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
  /** Visible sucker cups per master pose, once loaded (selected revision only). */
  glowPoints?(): KrakenGlowPointSet | null;
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
  /** Global post-FX accent for the roar onto land (whitelisted event). */
  readonly postFx?: (event: 'krakenRoar') => void;
  readonly shadows?: ShadowSystem;
  /** The boss lights the scene through borrowed ground-glow frames (eyes, cups, brood, roar). */
  readonly lighting?: LightingSystem | null;
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
  return discs.length ? { discs, tint: [egg.tint[0]! * ratio * match[0]!, egg.tint[1]! * ratio * match[1]!, egg.tint[2]! * ratio * match[2]!, egg.saturation],
    scale: KRAKEN_BROOD.carriedScale } : null;
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
  } else if (state.bodyAction?.kind === 'spines' && a.clips.some(c => c.name === 'spine-volley')) {
    // Land selections that predate detachable land spines simply keep idling while the spines fly.
    const action = state.bodyAction;
    sample = timed(a, 'spine-volley', now, action.startedAt, action.endsAt,
      [[action.raiseAt, 'raise'], ...action.releaseAt.map((at, i) => [at, `release-${i + 1}`] as const)]);
  } else if (state.bodyAction?.kind === 'slam' && pose.claw?.attack?.attackId === state.bodyAction.attackId) {
    const action = pose.claw.attack;
    sample = timed(a, 'slam', now, action.startedAt, action.endsAt, [[action.strikeAt, 'strike'], [action.hitAt, 'impact']]);
  } else sample = loop(a, pose.moving ? 'move' : 'idle', pose.moving ? pose.locomotionTimeMs ?? now : now);
  return { asset, sample, pose: p.kind === 'dying' ? p.terminalPose : pose, visible: krakenBodyVisible(state, now) };
}
/** True when the arm leaves straight from a strike (peeling off its lane) rather than from the upright lurk. */
function krakenRetractsFromStrike(t: KrakenTentacleState, struck: EnemyAreaClawAttack | null): struck is EnemyAreaClawAttack {
  return !!struck && t.retractAt <= struck.endsAt + 100;
}
/** `previous` is the last strike this arm was seen with: the host clears its claw when the arm retreats. */
export function sampleKrakenTentacle(t: KrakenTentacleState, asset: PipelineBossAsset, now: number,
  previous: EnemyAreaClawAttack | null = null): KrakenClipSample {
  const attack = t.claw.attack, struck = attack ?? previous;
  if (t.phase === 'retract' || now >= t.retractAt) {
    if (krakenRetractsFromStrike(t, struck)) return timed(asset, 'retract', now, t.retractAt, t.endsAt);
    // An upright arm lowers itself into the pond (the water level climbs over it, see krakenTentacleSink)
    // instead of coiling back up the way it rose.
    const rise = krakenClip(asset, 'rise'), last = rise.frames.length - 1;
    const u = krakenClamp((now - t.retractAt) / Math.max(1, t.endsAt - t.retractAt));
    return { clip: 'rise', frame: Math.round(last * (1 - .55 * u * u * (3 - 2 * u))) };
  }
  if (struck && now >= struck.endsAt) {
    // Between strikes the arm lifts back up by rewinding the slam to its raised first pose, then lurks again.
    if (now < t.hoverAt) {
      const slam = krakenClip(asset, 'slam'), last = slam.frames.length - 1;
      const u = krakenClamp((now - struck.endsAt) / Math.max(1, t.hoverAt - struck.endsAt));
      return { clip: 'slam', frame: Math.round(last * (1 - u * u * (3 - 2 * u))) };
    }
    return loop(asset, 'hover', now - t.hoverAt);
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
/** How far the pond has risen over a retreating arm (0 = authored waterline, 1 = fully under). */
export function krakenTentacleSink(t: KrakenTentacleState, now: number, previous: EnemyAreaClawAttack | null = null): number {
  if (now < t.retractAt) return 0;
  const u = krakenClamp((now - t.retractAt) / Math.max(1, t.endsAt - t.retractAt));
  // A peeling arm drags itself back first and only goes under at the end of its retreat.
  const s = krakenRetractsFromStrike(t, t.claw.attack ?? previous) ? krakenClamp((u - .55) / .45) : u;
  return s * s * (3 - 2 * s);
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
  ink: { travel: .22, hold: .6, dissolve: 1.6, opacity: .98, waterSpread: 1.18,
    core: [18 / 255, 10 / 255, 28 / 255], edge: [58 / 255, 34 / 255, 82 / 255], warp: 1.3, sheen: .14 },
  erupt: { radius: 66, lifetime: 1.25, bulge: .15, retractScale: .55, sprayCount: 26, spraySpeed: 120, foam: .75 },
  slam: { dust: .85, decal: 2, whip: .18, bend: 12, width: 42 },
  intro: { radius: 112, lifetime: 1.65, foam: .72, sprayCount: 80, spraySpeed: 135, drain: .85 },
  surface: { radius: 96, lifetime: 1.1, foam: .62, sprayCount: 56, spraySpeed: 105, drain: .65 },
  dive: { radius: 110, lifetime: 1.5, foam: .65, shadow: .12 },
  egg: { radius: 24 },
  // Sized to the whole animal: its trailing arms cover ~190 px, the visible V starts behind them.
  wake: { radius: 140, length: 560, lapPeriod: 2.6, minSpeedPxPerSec: 10, fullSpeedPxPerSec: 55, smoothingMs: 220 },
  slime: { life: 10, spacing: 26, maxStamps: 48, stamp: [62, 44] as const, aura: [96, 78] as const },
  tentacleTurnRadPerSec: Math.PI * 1.6,
  spineWake: { length: 150, width: 12, lead: 10, opacity: .75 },
} as const;

/** Owns sprite/filter/shadow only. The asset lease must outlive this view. */
export class KrakenSpriteView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private submersion: KrakenSubmersion | null = null;
  private drain: KrakenReviewDrainFilter | null = null;
  private shadow: KrakenShadowRenderer | null = null;
  /** Self-lit eyes/brood above the light map; only the bodies and the egg have emission to show. */
  private companion: KrakenEmissionQuad | null = null;
  private readonly emissive: boolean;
  private lease: KrakenPoseLease | null = null;
  private environment: ReturnType<ShadowSystem['borrowFigureEnvironment']> = null;
  private missing = new Set<string>();
  private destroyed = false;
  private framedSockets: Readonly<Record<string, PipelineSocketPoint>> | null = null;
  /** Master pose, water level and emission frame of the frame on screen (-1/null while hidden). */
  private shownSource = -1;
  private shownLevel = 0;
  private shownEmission: Phaser.Textures.Frame | null = null;
  /** World point of a full-canvas logical position in the frame on screen. */
  worldAt(x: number, y: number): KrakenPoint {
    const s = this.sprite, dx = (x - s.originX) * s.displayWidth, dy = (y - s.originY) * s.displayHeight;
    const c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
    return { x: s.x + dx * c - dy * sn, y: s.y + dx * sn + dy * c };
  }
  /** Centre and world span of the open eyes in the frame on screen (the emission trim); null while closed. */
  eyeAnchor(): { x: number; y: number; spanPx: number; rotation: number } | null {
    const e = this.shownEmission;
    if (!this.sprite.visible || !e || e.width <= 2 || e.height <= 2) return null;
    const centre = this.worldAt((e.x + e.width / 2) / e.realWidth, (e.y + e.height / 2) / e.realHeight);
    return { ...centre, spanPx: e.width / e.realWidth * this.sprite.displayWidth, rotation: this.sprite.rotation };
  }
  /** Sucker cups visible from above in the frame on screen. */
  glowPoints(): readonly KrakenGlowPoint[] {
    return this.sprite.visible && this.shownSource >= 0 ? this.asset.glowPoints?.()?.points(this.shownSource) ?? [] : [];
  }
  /** Display pixels per full-canvas source pixel. */
  get canvasScale(): number { return this.sprite.displayWidth / Math.max(1, this.asset.metadata.sourceSize); }
  get waterLevel(): number { return this.shownLevel; }
  /** World position and model height (BU) of a socket in the frame currently on screen. */
  socketWorld(name: string): { x: number; y: number; z: number } | null {
    const point = this.sprite.visible ? this.framedSockets?.[name] : undefined;
    if (!point) return null;
    const s = this.sprite, dx = (point.x - s.originX) * s.displayWidth, dy = (point.y - s.originY) * s.displayHeight;
    const c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
    return { x: s.x + dx * c - dy * sn, y: s.y + dx * sn + dy * c, z: point.z };
  }
  get gpuBytes(): number { return (this.shadow?.gpuBytes ?? 0) + (this.submersion ? 128 * 128 * 4 : 0); }
  /** Direction towards the sun (world x/y, up z) of the borrowed lighting environment, once lit. */
  get sun(): readonly number[] | null { return this.environment?.clouds.sunPath?.sun ?? null; }
  constructor(private readonly scene: Phaser.Scene, readonly asset: KrakenPresentationAsset,
    private readonly waterAt: (x: number, y: number) => number,
    private readonly diagnostic: (message: string) => void, tentacle = false, depth: number = DEPTH.PLAYERS,
    private readonly exposure = KRAKEN_WORLD_EXPOSURE, private readonly shadows?: ShadowSystem, castShadow = true) {
    this.emissive = ['abyssal-kraken', 'abyssal-kraken-land', 'abyssal-kraken-egg'].includes(asset.metadata.id);
    this.sprite = scene.add.sprite(0, 0, '__WHITE').setVisible(false).setDepth(depth);
    registerGraphicsObject(scene, 'bossIntro', this.sprite);
    // The shadow system also supplies sun/cloud lighting; projectiles draw their own ground marker instead.
    if (shadows && castShadow) this.shadow = new KrakenShadowRenderer(scene, shadows);
  }
  show(sample: KrakenClipSample, pose: KrakenPose, now: number, options: {
    socket?: string; scale?: number; alpha?: number; shadowContact?: number; drain?: number; waterLevel?: number; requireClip?: boolean;
    /** Ember strength of an egg view (default: carried pulse); body views derive their brood glow themselves. */
    glow?: number;
    /** Drive of the self-lit eyes (bodies) or hatching core (egg) above the light map; default 1. */
    eye?: number;
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
    let emissive: { glow: { strength: number; whole: boolean } | null; brood: KrakenBroodMaterial | null } | null = null;
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
      emissive = { glow: glow ? { strength: glow.strength, whole: egg } : null, brood };
    }
    this.submersion.update(elevation, level, now / 1000);
    if (this.emissive && emissive && frame.emissionKey) (this.companion ??= new KrakenEmissionQuad(this.scene)).sync({ sprite: s,
      emission: this.scene.textures.getFrame(frame.emissionKey, frame.emissionFrame), elevation, maskKey: this.submersion.maskKey,
      encoding: a.elevation, waterLevel: level }, { eye: options.eye ?? 1, ...emissive, alpha: options.alpha ?? 1,
      tone: a.id === 'abyssal-kraken-egg' ? 'brood' : 'eye' });
    else this.companion?.hide();
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
    this.shownSource = lease?.pose.sourceFrame ?? clipFrames?.[sample.frame] ?? -1;
    this.shownLevel = level;
    this.shownEmission = frame.emissionKey ? this.scene.textures.getFrame(frame.emissionKey, frame.emissionFrame) : null;
    this.lease?.release(); this.lease = lease;
    return true;
  }
  hide(): void { this.shownSource = -1; this.shownEmission = null; this.sprite.setVisible(false); this.companion?.hide(); this.shadow?.hide(); this.lease?.release(); this.lease = null; this.framedSockets = null; }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.companion?.destroy(); this.companion = null;
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
    const look = LOOK.ink, half = g.arcDegrees * Math.PI / 360, quad = krakenInkQuad(g.range, half);
    const q = this.take(0, DEPTH.PLAYERS + .2, { x: cloud.pose.originX, y: cloud.pose.originY },
      cloud.pose.angle, quad.width, quad.height, age, quad.shift);
    if (!q) return;
    // Preserve the reviewed travel/hold/erosion proportions within the authoritative cloud lifetime.
    const scale = (cloud.cloudEndsAt - cloud.spitAt) / 1000 / (look.travel + look.hold + look.dissolve);
    q.shape[2] = g.range; q.shape[3] = Math.tan(half);
    q.timing = [look.travel * scale, look.hold * scale, look.dissolve * scale, look.waterSpread];
    q.detail = [look.warp, look.sheen, krakenInkSeed(cloud.attackId), quad.shift];
    q.opacity = look.opacity; q.core = look.core; q.edge = look.edge;
    const s = q.object, signature = [s.x, s.y, s.rotation, quad.width, quad.height].join(',');
    if (signature !== q.maskSignature) {
      q.maskSignature = signature;
      const pixels = q.mask!.context.createImageData(128, 128);
      pixels.data.set(krakenWaterMask(128, 128,
        { x: s.x, y: s.y, rotation: s.rotation, originX: .5, originY: .5, displayWidth: quad.width, displayHeight: quad.height }, this.waterAt));
      q.mask!.context.putImageData(pixels, 0, 0); q.mask!.refresh();
    }
  }
  /** Disturbances of the pond surface itself go to the world water field (shaded by the water shader). */
  private water(d: WaterDisturbance): void { WaterDisturbanceField.for(this.scene)?.submit(d); }
  erupt(point: KrakenPoint, angle: number, age: number, retracting: boolean, seed: number): void {
    const e = LOOK.erupt;
    if (age < -e.bulge || age >= e.lifetime) return;
    const radius = e.radius * (retracting ? e.retractScale : 1);
    if (retracting) {
      // The arm drags the surface down after it: a small funnel and a few closing rings, no spray.
      this.water({ kind: 'vortex', x: point.x, y: point.y, age: Math.max(0, age), radius: e.radius * .9, strength: .75, param: seed % 2 ? 1 : -1 });
      this.water({ kind: 'ring', x: point.x, y: point.y, age: Math.max(0, age), radius: e.radius * .35, strength: .6 });
      return;
    }
    this.water({ kind: 'surge', x: point.x, y: point.y, age: age + e.bulge, radius: e.radius * .95, strength: 1, param: seed });
    if (age >= 0) this.water({ kind: 'ring', x: point.x, y: point.y, age, radius: e.radius * .35, strength: .9 });
    if (age < 0) return;
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
    this.water({ kind: 'vortex', x: pose.x, y: pose.y, age, radius: d.radius * 1.25, strength: 1, param: 1 });
    this.water({ kind: 'ring', x: pose.x, y: pose.y, age, radius: d.radius * .6, strength: .8 });
    const q = this.take(4, DEPTH.PLAYERS - .25, pose, pose.angle, d.radius * 5, d.radius * 5, age);
    if (!q) return;
    q.shape[2] = d.radius; q.shape[3] = 1; q.timing = [d.lifetime, d.shadow, d.foam, 0];
  }
  ashore(pose: KrakenPose, phase: KrakenExitPhase, now: number, gripPose = pose): void {
    const age = (now - phase.startedAt) / 1000;
    if (now < phase.gripAt) {
      if (now > phase.moveAt && !phase.blocked) this.wake(pose, 1, now);
      // A diffuse directional footprint, not an attack ring. Anchor it at the shore contact.
      const shore = this.take(10, DEPTH.PLAYERS - .24, gripPose, gripPose.angle, 300, 240, age, 115);
      if (shore) shore.opacity = .55;
    }
    const sprayAge = (now - phase.gripAt) / 1000;
    if (sprayAge >= 0 && sprayAge < 1.6) this.water({ kind: 'surge', x: gripPose.x, y: gripPose.y, age: sprayAge, radius: 120, strength: 1, param: 7 });
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
  /** Bow swell and diverging wake behind the swimming body; `intensity` follows its speed. */
  wake(pose: KrakenPose, intensity: number, now: number): void {
    // The running clock wraps: absolute host seconds lose all fractional precision in float32 shaders.
    this.water({ kind: 'wake', x: pose.x, y: pose.y, age: (now / 1000) % 600, radius: LOOK.wake.radius, strength: krakenClamp(intensity),
      angle: pose.angle, param: LOOK.wake.length });
  }
  /** Water lapping against the resting body: slow, faint rings. */
  lap(pose: KrakenPose, now: number): void {
    const period = LOOK.wake.lapPeriod, age = (now / 1000) % period;
    this.water({ kind: 'ring', x: pose.x, y: pose.y, age, radius: LOOK.wake.radius * .9, strength: .35 });
  }
  /** One slime stamp of the land trail; `aura` is the wet patch right under the moving body. */
  wetTrail(pose: KrakenPose, at: number, now: number, seed = 0, aura = false): void {
    const s = LOOK.slime, age = aura ? 0 : (now - at) / 1000;
    if (age < 0 || age > s.life) return;
    const [length, width] = aura ? s.aura : s.stamp;
    const q = this.take(8, DEPTH.DECALS + .1, pose, pose.angle, length * 3, width * 3, age);
    if (q) { q.shape[2] = length; q.shape[3] = width; q.timing = [s.life, 0, 0, 0]; q.detail[1] = seed; q.opacity = aura ? .9 : 1; }
  }
  rise(pose: KrakenPose, timing: KrakenRiseTiming, now: number, intro: boolean): void {
    const b = intro ? LOOK.intro : LOOK.surface;
    const age = (now - timing.startedAt) / 1000, arms = (timing.armsAt - timing.startedAt) / 1000;
    if (now < timing.armsAt && now >= timing.startedAt) {
      const q = this.take(4, DEPTH.PLAYERS - .25, pose, pose.angle, b.radius * 5, b.radius * 5, age);
      if (q) { q.shape[2] = b.radius; q.shape[3] = 0; q.timing = [arms, LOOK.dive.shadow, b.foam, 0]; }
    }
    if (now >= timing.startedAt && now < timing.armsAt + b.lifetime * 1000)
      this.water({ kind: 'surge', x: pose.x, y: pose.y, age: (now - timing.startedAt) / 1000 * Math.min(1, .6 / Math.max(.1, arms)),
        radius: b.radius * 1.15, strength: 1, param: intro ? 3 : 5 });
    for (const [i, at] of [timing.armsAt, timing.keelAt, ...(intro ? [timing.roarAt] : [])].entries()) {
      const plumeAge = (now - at) / 1000;
      if (plumeAge < 0 || plumeAge >= b.lifetime) continue;
      const radius = b.radius * (i === 1 ? .7 : i === 2 ? 1.35 : 1);
      this.water({ kind: 'ring', x: pose.x, y: pose.y, age: plumeAge, radius: radius * .7, strength: i === 2 ? 1 : .85 });
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

interface PartView {
  view: KrakenSpriteView; event: EnemyAreaClawEvent; state: KrakenTentacleState;
  /** Last strike seen on this arm and the smoothed drawn heading. */
  previous: EnemyAreaClawAttack | null; angle: number; at: number;
}
/** Activity presentation owner. sync is a full current projection; clear/destroy detach every view.
 * All positions are presentation-world coordinates and all times are synchronized host times. */
export class KrakenRenderer {
  private readonly claw: EnemyClawRenderer;
  private readonly effects: KrakenEffects;
  private readonly glow: KrakenGlowLayer;
  private readonly lights: KrakenLightRig;
  private body: KrakenSpriteView | null = null;
  private readonly parts = new Map<string, PartView>();
  private readonly fallbackSlots = new Map<string, EnemyAreaClawEvent>();
  private readonly eggs = new Map<string, KrakenSpriteView>();
  private readonly spines: KrakenSpineOverlay;
  /** Released part/egg views are reused: each new view would compile its own sun/shadow shader programs
   * (a visible hitch whenever an arm surfaces or an egg lands). */
  private readonly idleTentacles: KrakenSpriteView[] = [];
  private readonly idleEggs: KrakenSpriteView[] = [];
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
  private swimSpeed = 0;
  private locomotionTime = 0;
  private exitKey = '';
  private announcedExit = '';
  private trails: { pose: KrakenPose; at: number }[] = [];
  private wetUntil = 0;
  private exitVisual: { phase: KrakenExitPhase; grip: KrakenPose | null } | null = null;
  constructor(private readonly scene: Phaser.Scene, private readonly options: KrakenRendererOptions) {
    this.claw = new EnemyClawRenderer(scene, () => this.now);
    this.effects = new KrakenEffects(scene, options.waterAt);
    this.glow = new KrakenGlowLayer(scene);
    this.lights = new KrakenLightRig(options.lighting);
    this.spines = new KrakenSpineOverlay(scene, options.assets?.spine, options.waterAt, options.diagnostic, options.shadows);
  }
  sync(state: KrakenState | null, body: KrakenBodyPose | null, now: number): void {
    if (this.destroyed) return;
    if (!state || state.phase.kind === 'removed') { this.clear(); return; }
    const key = combatTargetInstanceKey(state.boss);
    if (key !== this.bossKey) { this.clear(); this.bossKey = key; }
    if (state.revision < this.revision) return;
    this.revision = state.revision; this.now = now;
    this.effects.begin(); this.glow.begin(); this.lights.begin();
    try { this.syncViews(state, body, now); } finally { this.glow.flush(); this.lights.commit(); }
  }
  private syncViews(state: KrakenState, body: KrakenBodyPose | null, now: number): void {
    const key = this.bossKey, quality = getGraphicsQualityProfile(this.scene).level, seconds = (now / 1000) % 600;
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
      // On land the kraken soaks the ground under it and drags a slime trail that slowly dries.
      const onLand = render.visible && render.asset === this.options.assets.land
        && (phase.kind === 'land' || phase.kind === 'dying' || phase.kind === 'ashore' && now >= phase.gripAt);
      // A leaping body leaves no slime until it lands again.
      const leap = body?.claw?.attack, airborne = !!leap && now >= leap.strikeAt && now < leap.hitAt;
      if (onLand && !airborne) {
        const last = this.trails[this.trails.length - 1];
        if (!last || Math.hypot(pose.x - last.pose.x, pose.y - last.pose.y) > LOOK.slime.spacing) {
          this.trails.push({ pose: { ...pose }, at: now });
          if (this.trails.length > LOOK.slime.maxStamps) this.trails.shift();
        }
        this.effects.wetTrail(render.pose, now, now, 0, true);
      }
      // The pond answers the body: a wake while it swims, faint lapping rings while it floats.
      // The speed is smoothed so the wake swells and settles, and it holds through repeated frames.
      if (render.asset === this.options.assets.water && render.visible && (phase.kind === 'surfaced' || phase.kind === 'surfacing')) {
        if (this.lastBody && elapsed > 0 && elapsed < 500) {
          this.swimSpeed += (distance / elapsed * 1000 - this.swimSpeed) * Math.min(1, elapsed / LOOK.wake.smoothingMs);
        }
        if (this.swimSpeed > LOOK.wake.minSpeedPxPerSec) this.effects.wake(render.pose, this.swimSpeed / LOOK.wake.fullSpeedPxPerSec, now);
        else this.effects.lap(render.pose, now);
      } else this.swimSpeed = 0;
      this.lastBody = { pose: { ...pose }, now };
      if (phase.kind === 'surfacing') this.waterMotion = { pose: render.pose,
        rise: krakenRiseTiming(render.asset.metadata, 'surface', phase.startedAt, phase.startedAt, phase.endsAt, phase.vulnerableAt) };
      if (phase.kind === 'diving') this.waterMotion = { pose: render.pose, diveAt: phase.submergedAt };
      if (phase.kind === 'dying' && phase.asset === 'water') this.waterMotion = { pose: render.pose, diveAt: phase.startedAt };
      const bodyAlpha = phase.kind !== 'dying' ? 1 : phase.asset === 'water'
        ? 1 - krakenClamp((now - phase.startedAt) / (phase.endsAt - phase.startedAt))
        : krakenDeathAlpha(render.asset.metadata, phase, now);
      const eye = krakenEyeDrive(state, now, config);
      if (render.visible) this.body.show(render.sample, render.pose, now, {
        drain: phase.kind === 'ashore' && now >= phase.gripAt
          ? 1 - krakenClamp((now - phase.heaveAt) / 1100)
          : this.waterMotion?.rise ? krakenDrain(this.waterMotion.rise, now, false) : 0,
        alpha: bodyAlpha, eye,
      });
      else this.body.hide();
      if (render.visible) {
        paintKrakenEyes(this.body, eye, this.glow, this.lights, bodyAlpha);
        const cups = krakenBodySuckers(state, now, config);
        paintKrakenSuckers(this.body, cups, seconds, this.glow, quality, false, bodyAlpha);
        const b = KRAKEN_GLOW_LOOK.body;
        if (cups.level > 0) this.lights.add(render.pose.x, render.pose.y, b.radius, (b.base + b.perLevel * cups.level) * bodyAlpha, b.color);
        if (phase.kind === 'ashore') paintKrakenRoar(render.pose.x, render.pose.y,
          Math.exp(-(((now - krakenExitRoarAt(phase, config.exit)) / KRAKEN_GLOW.sucker.roarWidthMs) ** 2)), this.glow, this.lights);
      }
      // Before a surfacing body opens its eyes, an ember glow rises through the water where it comes up.
      const deep = krakenDeepEmber(state, now), d = KRAKEN_GLOW_LOOK.deep;
      if (deep > 0) {
        this.glow.pool(render.pose.x, render.pose.y, d.pool, d.pool * .8, render.pose.angle, d.color, d.poolAlpha * deep);
        this.lights.add(render.pose.x, render.pose.y, d.lightRadius, d.lightIntensity * deep, d.color);
      }
      const volley = state.bodyAction?.kind === 'spines' ? state.bodyAction : null;
      // Bodies exported with detachable spines carry their sockets; older land selections keep them baked in.
      if (render.visible) this.spines.sync(this.body, state.spines, volley, now, bodyAlpha);
      else this.spines.hide();
    } else { this.body?.hide(); this.spines.hide(); }
    this.trails = this.trails.filter(t => now - t.at < LOOK.slime.life * 1000);
    for (const [i, trail] of this.trails.entries()) this.effects.wetTrail(trail.pose, trail.at, now, (trail.at * .37 + i) % 17);
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
        entry = { view: this.idleTentacles.pop() ?? this.view(this.options.assets.tentacle, true), event, state: part,
          previous: null, angle: part.contact.angle, at: now };
        this.parts.set(key, entry);
      }
      entry.event = event; entry.state = part;
      if (part.claw.attack) entry.previous = part.claw.attack;
      // Replicated aim arrives in steps; turn the drawn arm smoothly towards it.
      const turn = Math.atan2(Math.sin(part.contact.angle - entry.angle), Math.cos(part.contact.angle - entry.angle));
      const step = LOOK.tentacleTurnRadPerSec * Math.max(0, now - entry.at) / 1000;
      entry.angle += Math.max(-step, Math.min(step, turn)); entry.at = now;
      const meta = this.options.assets.tentacle.metadata;
      const sample = sampleKrakenTentacle(part, meta, now, entry.previous);
      const attack = part.claw.attack;
      const contact = sample.clip === 'slam' && attack ? 1 - krakenClamp((now - attack.strikeAt) / (attack.hitAt - attack.strikeAt)) : 1;
      const sink = krakenTentacleSink(part, now, entry.previous), base = meta.elevation.previewWaterLevel ?? 0;
      // Contact pose is the part's waterEntry frame; outgoing lane origin is independently frozen.
      entry.view.show(sample, { x: part.contact.x, y: part.contact.y, angle: entry.angle }, now, { socket: 'waterEntry', shadowContact: contact,
        waterLevel: base + sink * (meta.elevation.max - base + .5) });
      entry.view.sprite.clearTint();
      const cups = krakenTentacleSuckers(part, now, entry.previous);
      paintKrakenSuckers(entry.view, cups, seconds, this.glow, quality, true);
      lightKrakenArm(part.contact, cups, this.lights);
      this.claw.syncArea(event, now);
      const retract = part.phase === 'retract' || now >= part.retractAt;
      this.effects.erupt(part.contact, part.contact.angle, (now - (retract ? part.retractAt : part.startedAt)) / 1000, retract, identity.partGeneration);
      this.rememberImpact(attack, now);
    }
    for (const [key, part] of this.parts) if (!partKeys.has(key)) {
      this.claw.releaseArea(part.event); part.view.hide(); this.idleTentacles.push(part.view); this.parts.delete(key);
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
      // A landed egg's contact shadow is its brood pool; it needs light, not a shadow renderer.
      if (!view) { view = this.idleEggs.pop() ?? this.view(this.options.assets.egg, false, false); this.eggs.set(key, view); }
      const landingAge = (now - egg.landedAt) / 1000, hatchAge = (now - egg.hatchStartedAt) / 1000;
      // The ember swells with the heartbeat, flares while the shell splits and dies with the spawn.
      const eggGlow = krakenEggGlowState(egg, now);
      view.show(sampleKrakenEgg(egg, view.asset.metadata, now), pose, now, { scale: 1 + eggGlow.pulse, glow: eggGlow.glow });
      paintKrakenEgg(pose.x, pose.y, eggGlow, this.glow, this.lights);
      this.effects.egg(pose, 0, landingAge, hatchAge, 1, egg.entityGeneration);
    }
    for (const [key, view] of this.eggs) if (!eggKeys.has(key)) { view.hide(); this.idleEggs.push(view); this.eggs.delete(key); }
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
    this.lastBody = null; this.swimSpeed = 0; this.locomotionTime = 0; this.exitKey = ''; this.announcedExit = ''; this.exitVisual = null; this.trails = []; this.wetUntil = 0;
    this.body?.destroy(); this.body = null;
    for (const part of this.parts.values()) part.view.destroy();
    for (const egg of this.eggs.values()) egg.destroy();
    for (const view of [...this.idleTentacles, ...this.idleEggs]) view.destroy();
    this.idleTentacles.length = 0; this.idleEggs.length = 0;
    this.spines.clear();
    this.parts.clear(); this.fallbackSlots.clear(); this.eggs.clear(); this.contacts.clear(); this.contactSeen.clear(); this.impacts.clear();
    this.claw.clear(); this.effects.clear(); this.glow.clear(); this.lights.clear(); this.waterMotion = null; this.bossKey = ''; this.revision = -1;
  }
  private impulse(id: string, at: number, pose: KrakenPose, now: number): void {
    if (!this.lastBody || now - this.lastBody.now >= 150 || this.lastBody.now >= at || now < at || now - at >= 150) return;
    const impulse = impactLight({ sourceX: pose.x, sourceY: pose.y });
    this.options.feedback?.request({ ...impulse, id: `kraken-${id}`, amplitudePx: impulse.amplitudePx * .45 });
    if (id === 'roar') this.options.postFx?.('krakenRoar');
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.destroyed = true; this.claw.destroy(); this.effects.destroy(); this.glow.destroy();
  }
  get gpuBytes(): number { return (this.body?.gpuBytes ?? 0) + this.effects.gpuBytes
    + [...this.parts.values()].reduce((sum, p) => sum + p.view.gpuBytes, 0)
    + [...this.eggs.values()].reduce((sum, v) => sum + v.gpuBytes, 0)
    + this.spines.gpuBytes; }
  /** The water body's six front dorsal spikes are runtime parts: hidden from their release until they regrow
   * (scale-in with a slight overshoot), raised a little while a volley winds up, and submerged with the body. */
  private view(asset: KrakenPresentationAsset, tentacle = false, castShadow = true): KrakenSpriteView {
    const exposure = asset === this.options.assets?.land ? KRAKEN_LAND_EXPOSURE : KRAKEN_WORLD_EXPOSURE;
    return new KrakenSpriteView(this.scene, asset, this.options.waterAt, this.options.diagnostic, tentacle, DEPTH.PLAYERS, exposure, this.options.shadows, castShadow);
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

type KrakenSpineVolley = Extract<NonNullable<KrakenState['bodyAction']>, { kind: 'spines' }>;
/** The six detachable dorsal spines on a body view's per-frame sockets; shared by the fight and the intro. */
export class KrakenSpineOverlay {
  private readonly views: KrakenSpriteView[] = [];
  constructor(private readonly scene: Phaser.Scene, private readonly asset: KrakenPresentationAsset | undefined,
    private readonly waterAt: (x: number, y: number) => number, private readonly diagnostic: (message: string) => void,
    private readonly shadows?: ShadowSystem) {}
  get gpuBytes(): number { return this.views.reduce((sum, v) => sum + v.gpuBytes, 0); }
  /** Regrowing spines push slowly out of the back; released ones are gone until their regrowth starts. */
  sync(body: KrakenSpriteView | null, spines: readonly KrakenSpineState[], volley: KrakenSpineVolley | null, now: number, bodyAlpha = 1): void {
    const asset = this.asset;
    if (!asset || !body) { this.hide(); return; }
    const a = asset.metadata, base = a.sockets.base, tip = a.sockets.tip, size = a.targetSize * (a.displayScale ?? 1);
    if (!base || !tip) return;
    const authored = Math.hypot((tip[0] - base[0]) * size, (tip[1] - base[1]) * size);
    const bodyLevel = body.asset.metadata.elevation.previewWaterLevel ?? 0;
    const bristle = volley ? krakenClamp((now - volley.startedAt) / Math.max(1, volley.raiseAt - volley.startedAt)) : 0;
    for (let i = 0; i < 6; i++) {
      const view = this.views[i] ??= new KrakenSpriteView(this.scene, asset, this.waterAt, this.diagnostic,
        false, DEPTH.PLAYERS + .01, KRAKEN_WORLD_EXPOSURE, this.shadows);
      const from = body.socketWorld(`spine${i + 1}`), to = body.socketWorld(`spine${i + 1}Tip`);
      const regrow = spines.find(spine => spine.index === i);
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
        { socket: 'base', scale: authored > 0 ? length / authored * growth : growth, alpha: alpha * bodyAlpha, waterLevel: bodyLevel - from.z });
    }
  }
  hide(): void { for (const view of this.views) view.hide(); }
  clear(): void { for (const view of this.views) view.destroy(); this.views.length = 0; }
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
    this.view = new KrakenSpriteView(scene, asset, KRAKEN_DRY_SAMPLER, diagnostic, false, DEPTH.PROJECTILES, KRAKEN_WORLD_EXPOSURE, shadows, false);
    this.effects = new KrakenEffects(scene, () => 0);
  }
  update(x: number, y: number, _size: number, vx: number, vy: number): void {
    if (this.destroyed) return;
    const now = this.clock();
    this.effects.begin();
    if (now < this.flight.releasedAt || now >= this.flight.landsAt) { this.view.hide(); return; }
    const progress = krakenClamp((now - this.flight.releasedAt) / Math.max(1, this.flight.landsAt - this.flight.releasedAt));
    // The egg keeps (almost) its carried/landed size; the arc reads from its shadow drifting away from the sun.
    const height = Math.sin(progress * Math.PI), arc = krakenEggArc(height, this.view.sun);
    this.view.show(loop(this.view.asset.metadata, 'idle', now - this.flight.releasedAt),
      { x, y, angle: Math.atan2(vy, vx) }, now, { scale: arc.scale, waterLevel: -1000 });
    this.effects.egg({ x: x + arc.shadowX, y: y + arc.shadowY }, height, -1, -1);
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
    this.view = new KrakenSpriteView(scene, asset, KRAKEN_DRY_SAMPLER, diagnostic, false, DEPTH.PROJECTILES, KRAKEN_WORLD_EXPOSURE, shadows, false);
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
