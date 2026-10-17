import * as Phaser from 'phaser';
import { ALLIED_PALETTE } from '../config';
import { getVisibleWorldView } from '../graphics/CameraWorldView';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { emissiveAlpha } from './EmissiveScale';
import { mixColors } from './EffectUtils';
import { getGpuVfxFrame } from './gpu/GpuVfxAtlas';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { RestHealGpuLayer } from './gpu/RestHealGpuLayer';
import { REST_HEAL_KIND } from './gpu/RestHealShader';
import type { LightingSystem } from './LightingSystem';

interface Point { readonly x: number; readonly y: number }

/** One resting healer this frame: where its stream leaves, whom it reaches and when it ticks. */
export interface RestHealChannel {
  readonly id: string;
  readonly allied: boolean;
  /** Body centre and radius of the healer; the ground sigil circles it. */
  readonly body: Point & { readonly radius: number };
  /** Back-cross point the streams leave from. */
  readonly cross: Point;
  /** Body facing (world radians), used to orient the cross glyph. */
  readonly facing: number;
  readonly targets: readonly (Point & { readonly id: string; readonly radius: number })[];
  /** Eyes of the healer for the hypnotic rings; empty without eye anchors. */
  readonly eyes: readonly Point[];
  /** Hostile rings take the eye glow colour; allied healers use the allied palette. */
  readonly eyeColor: number;
  /** Host-synchronised rest start and heal tick interval; a dose lands at the ally on every tick. */
  readonly restAt: number;
  readonly tickMs: number;
}

interface LinkTrack {
  readonly key: string;
  readonly seed: number;
  /** Local presentation clock. */
  readonly bornAt: number;
  retractAt: number | null;
  from: Point;
  to: Point;
  toRadius: number;
  allied: boolean;
  restAt: number;
  tickMs: number;
  reach: number;
}

interface HealerTrack {
  readonly seed: number;
  readonly bornAt: number;
  endedAt: number | null;
  channel: RestHealChannel;
}

/** Live emitters of this frame for the particle tick (geometry already resolved). */
interface StreamEmitter { from: Point; to: Point; sag: number; allied: boolean }
interface PointEmitter { x: number; y: number; radius: number; allied: boolean; phase: number; tickMs: number }

const PLAGUE = { glow: 0x3dff8f, core: 0xd8ffe2 } as const;
const ALLIED = { glow: ALLIED_PALETTE.primary, core: ALLIED_PALETTE.core } as const;
const GROW_MS = 260;
const RETRACT_MS = 180;
const SIGIL_IN_MS = 220;
const SIGIL_OUT_MS = 380;
/** Ground sigil radius beyond the healer's body radius. */
const SIGIL_MARGIN_PX = 11;
/** The stream ends this share of the ally's radius before its centre: it reaches in, not over. */
const RECEIVER_INSET_SHARE = 0.55;
const RECEIVER_MARGIN_PX = 5;
const VIEW_MARGIN_PX = 80;
const LIGHT_RADIUS_PX = 130;
const LIGHT_COLOR = 0xc8ffd6;
/** Particle rates per second at full quality. */
const MOTES_PER_LINK_S = 16;
const SPARKS_PER_RECEIVER_S = 9;
const SPORES_PER_HEALER_S = 7;

/**
 * Presentation of rest heal links (Quacksalber toad) as one GPU layer plus GPU particles: a rune
 * sigil breathes under the resting toad, braided streams of light flow from its back cross to each
 * linked ally and carry one dose per heal tick into the ally's absorbing ring, the cross swells on
 * every tick and the eyes ring hypnotically. Spores rise off the toad, motes peel off the streams
 * and sparkles spiral into healed allies. Observes replicated links only; the host decides who is healed.
 */
export class RestHealTendrilRenderer {
  private layer: RestHealGpuLayer | null = null;
  private drawn = false;
  private readonly links = new Map<string, LinkTrack>();
  private readonly healers = new Map<string, HealerTrack>();
  private readonly litChannels = new Set<string>();
  private lighting: LightingSystem | null = null;
  private gpu: GpuVfxSystem | null = null;
  private moteSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;
  private moteSource = -1;
  private sparkSource = -1;
  private unregisterEmission: (() => void) | null = null;
  private generation = 0;
  private hasParticles = false;
  private readonly streams: StreamEmitter[] = [];
  private readonly receivers: PointEmitter[] = [];
  private readonly spores: PointEmitter[] = [];
  private moteCarry = 0;
  private sparkCarry = 0;
  private sporeCarry = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }

  /** The shared GPU particle backend of the scene; without it only the shader layer draws. */
  setGpuVfx(gpu: GpuVfxSystem | null): void {
    if (gpu === this.gpu) return;
    this.releaseParticles();
    this.gpu = gpu;
    if (!gpu) return;
    this.moteSpec = gpu.createSpec(GpuVfxEffectId.RestHealMote);
    this.sparkSpec = gpu.createSpec(GpuVfxEffectId.RestHealSpark);
    this.moteSource = gpu.createSource(GpuVfxEffectId.RestHealMote);
    this.sparkSource = gpu.createSource(GpuVfxEffectId.RestHealSpark);
    this.generation = gpu.emissionGeneration;
    this.unregisterEmission = gpu.registerEmission(delta => this.emit(delta));
  }

  /** `now` is the synchronized host clock of the channels' timestamps. */
  draw(channels: readonly RestHealChannel[], now: number): void {
    const local = this.scene.time.now;
    this.trackLinks(channels, local);
    this.trackHealers(channels, local);
    this.streams.length = 0; this.receivers.length = 0; this.spores.length = 0;
    if (!this.links.size && !this.healers.size) {
      if (this.drawn) { this.layer?.clear(); this.drawn = false; }
      this.syncLights(channels);
      return;
    }
    // The layer and its program load with the first channel; maps without healers never touch them.
    const layer = this.layer ??= new RestHealGpuLayer(this.scene);
    const view = getVisibleWorldView(this.scene.cameras.main);
    const visible = (x: number, y: number, reach: number) => x + reach >= view.x && x - reach <= view.x + view.width
      && y + reach >= view.y && y - reach <= view.y + view.height;
    layer.begin(local);

    for (const [id, track] of this.healers) {
      const intensity = track.endedAt === null ? Math.min(1, (local - track.bornAt) / SIGIL_IN_MS)
        : 1 - (local - track.endedAt) / SIGIL_OUT_MS;
      // A sigil cast this frame has intensity 0 and appears next frame; only a faded one is dropped.
      if (intensity <= 0) { if (track.endedAt !== null) this.healers.delete(id); continue; }
      const channel = track.channel, body = channel.body, palette = channel.allied ? 1 : 0;
      const radius = body.radius + SIGIL_MARGIN_PX;
      if (!visible(body.x, body.y, radius + VIEW_MARGIN_PX)) continue;
      const rest = Math.max(0, now - channel.restAt) / 1000, phase = tickPhase(now, channel.restAt, channel.tickMs);
      layer.add({ ax: body.x, ay: body.y, bx: body.x, by: body.y, halfWidth: radius * 1.6, kind: REST_HEAL_KIND.sigil,
        t: intensity, seed: track.seed, a1: radius, a2: rest, a3: palette });
      // A sigil left behind fades on the ground; cross, eyes and spores belong to the channelling body.
      if (track.endedAt !== null) continue;
      layer.add({ ax: channel.cross.x, ay: channel.cross.y, bx: channel.cross.x, by: channel.cross.y, halfWidth: 16,
        kind: REST_HEAL_KIND.cross, t: intensity, seed: track.seed, a1: 4.6, a2: phase, a3: palette, a4: channel.facing });
      const ringColor = channel.allied ? ALLIED.core : channel.eyeColor;
      for (const eye of channel.eyes) layer.add({ ax: eye.x, ay: eye.y, bx: eye.x, by: eye.y, halfWidth: 10,
        kind: REST_HEAL_KIND.eyes, t: intensity, seed: track.seed, a1: 8, a2: rest, a3: ringColor });
      this.spores.push({ x: channel.cross.x, y: channel.cross.y, radius: body.radius, allied: channel.allied, phase,
        tickMs: channel.tickMs });
    }

    for (const [key, track] of this.links) {
      const reach = track.retractAt === null ? Math.min(1, (local - track.bornAt) / GROW_MS)
        : 1 - (local - track.retractAt) / RETRACT_MS;
      // A link born this frame has reach 0 and starts growing next frame; only a withdrawn one is dropped.
      if (reach <= 0) { if (track.retractAt !== null) this.links.delete(key); continue; }
      track.reach = easeOut(Math.min(1, reach));
      const { from, to } = track;
      const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
      const inset = Math.min(distance - 4, track.toRadius * RECEIVER_INSET_SHARE);
      if (distance < 8 || inset <= 0) continue;
      const end = { x: to.x - dx / distance * inset, y: to.y - dy / distance * inset };
      const length = distance - inset;
      const sag = Math.min(26, length * 0.14) * (track.seed < 0.5 ? 1 : -1);
      if (!visible((from.x + end.x) / 2, (from.y + end.y) / 2, length / 2 + Math.abs(sag) + VIEW_MARGIN_PX)) continue;
      const palette = track.allied ? 1 : 0, phase = tickPhase(now, track.restAt, track.tickMs);
      layer.add({ ax: from.x, ay: from.y, bx: end.x, by: end.y, halfWidth: Math.abs(sag) + 14, kind: REST_HEAL_KIND.link,
        t: track.reach, seed: track.seed, a1: sag, a2: phase, a3: palette, a4: track.tickMs / 1000 });
      const ring = track.toRadius + RECEIVER_MARGIN_PX;
      layer.add({ ax: to.x, ay: to.y, bx: to.x, by: to.y, halfWidth: ring * 1.7, kind: REST_HEAL_KIND.receiver,
        t: track.reach, seed: track.seed, a1: ring, a2: phase, a3: palette });
      if (track.retractAt === null && track.reach >= 1) {
        this.streams.push({ from, to: end, sag, allied: track.allied });
        this.receivers.push({ x: to.x, y: to.y, radius: ring, allied: track.allied, phase, tickMs: track.tickMs });
      }
    }
    layer.flush();
    this.drawn = layer.size > 0;
    this.syncLights(channels);
  }

  clear(): void {
    this.links.clear(); this.healers.clear();
    this.streams.length = 0; this.receivers.length = 0; this.spores.length = 0;
    for (const id of this.litChannels) this.lighting?.releaseLight(lightKey(id), { immediate: true });
    this.litChannels.clear();
    this.layer?.clear(); this.drawn = false;
    if (this.hasParticles && this.gpu) { this.gpu.clearSource(this.moteSource); this.gpu.clearSource(this.sparkSource); }
    this.hasParticles = false;
    this.moteCarry = this.sparkCarry = this.sporeCarry = 0;
  }

  destroy(): void {
    this.clear();
    this.releaseParticles();
    this.layer?.destroy(); this.layer = null;
  }

  private trackLinks(channels: readonly RestHealChannel[], local: number): void {
    const seen = new Set<string>();
    for (const channel of channels) {
      for (const target of channel.targets) {
        const key = `${channel.id}>${target.id}`;
        seen.add(key);
        let track = this.links.get(key);
        if (!track || track.retractAt !== null) {
          track = { key, seed: hashSeed(key), bornAt: local, retractAt: null, from: channel.cross, to: target,
            toRadius: target.radius, allied: channel.allied, restAt: channel.restAt, tickMs: channel.tickMs, reach: 0 };
          this.links.set(key, track);
        }
        track.from = channel.cross; track.to = target; track.toRadius = target.radius; track.allied = channel.allied;
        track.restAt = channel.restAt; track.tickMs = channel.tickMs;
      }
    }
    for (const track of this.links.values()) if (!seen.has(track.key) && track.retractAt === null) track.retractAt = local;
  }

  private trackHealers(channels: readonly RestHealChannel[], local: number): void {
    const seen = new Set<string>();
    for (const channel of channels) {
      if (!channel.targets.length) continue;
      seen.add(channel.id);
      const track = this.healers.get(channel.id);
      // A new rest re-casts the sigil; the old one was left behind on the ground and fades there.
      if (!track || track.endedAt !== null || track.channel.restAt !== channel.restAt) {
        this.healers.set(channel.id, { seed: hashSeed(channel.id), bornAt: local, endedAt: null, channel });
      } else track.channel = channel;
    }
    for (const [id, track] of this.healers) if (!seen.has(id) && track.endedAt === null) track.endedAt = local;
  }

  private syncLights(channels: readonly RestHealChannel[]): void {
    const lit = new Set<string>();
    if (this.lighting) {
      const limit = getGraphicsQualityProfile(this.scene).level === 'low' ? 2 : 6;
      for (const channel of channels) {
        if (lit.size >= limit || !channel.targets.length) continue;
        lit.add(channel.id);
        this.lighting.setLight(lightKey(channel.id), 'arcaneField', channel.body.x, channel.body.y,
          { radiusPx: LIGHT_RADIUS_PX, color: channel.allied ? ALLIED.core : LIGHT_COLOR });
      }
    }
    for (const id of this.litChannels) if (!lit.has(id)) this.lighting?.releaseLight(lightKey(id));
    this.litChannels.clear();
    for (const id of lit) this.litChannels.add(id);
  }

  /** Particle tick of the GPU backend: rates carry over frames so low frame rates keep the density. */
  private emit(deltaMs: number): void {
    const gpu = this.gpu;
    if (!gpu || !this.moteSpec || !this.sparkSpec) return;
    if (this.generation !== gpu.emissionGeneration) { this.generation = gpu.emissionGeneration; this.hasParticles = false; }
    if (gpu.isSuppressed() || (!this.streams.length && !this.receivers.length && !this.spores.length)) return;
    const now = gpu.now(), dt = Math.min(0.1, Math.max(0, deltaMs) / 1000);
    const moteFactor = gpu.quality.getEmissionFactor(GpuVfxEffectId.RestHealMote);
    const sparkFactor = gpu.quality.getEmissionFactor(GpuVfxEffectId.RestHealSpark);
    this.moteCarry += this.streams.length * MOTES_PER_LINK_S * moteFactor * dt;
    for (; this.moteCarry >= 1; this.moteCarry--) this.spawnMote(this.streams[Math.floor(Math.random() * this.streams.length)]!, now);
    if (!this.streams.length) this.moteCarry = 0;
    this.sporeCarry += this.spores.length * SPORES_PER_HEALER_S * moteFactor * dt;
    for (; this.sporeCarry >= 1; this.sporeCarry--) this.spawnSpore(this.spores[Math.floor(Math.random() * this.spores.length)]!, now);
    if (!this.spores.length) this.sporeCarry = 0;
    this.sparkCarry += this.receivers.length * SPARKS_PER_RECEIVER_S * sparkFactor * dt;
    for (; this.sparkCarry >= 1; this.sparkCarry--) this.spawnSpark(this.receivers[Math.floor(Math.random() * this.receivers.length)]!, now);
    if (!this.receivers.length) this.sparkCarry = 0;
  }

  /** A mote peels off the stream and drifts aside while it flows on towards the ally. */
  private spawnMote(stream: StreamEmitter, now: number): void {
    const spec = this.moteSpec!, palette = stream.allied ? ALLIED : PLAGUE;
    const t = 0.1 + Math.random() * 0.8;
    const dx = stream.to.x - stream.from.x, dy = stream.to.y - stream.from.y, length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
    const offset = stream.sag * Math.sin(Math.PI * t) + (Math.random() - 0.5) * 5;
    const drift = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 14), flow = 22 + Math.random() * 30;
    spec.x = stream.from.x + dx * t + nx * offset; spec.y = stream.from.y + dy * t + ny * offset;
    spec.vx = ux * flow + nx * drift; spec.vy = uy * flow + ny * drift;
    spec.positionEase = GpuVfxEase.QuadOut;
    spec.lifeMs = 520 + Math.random() * 420;
    spec.scaleStart = (2.2 + Math.random() * 2.2) / getGpuVfxFrame(spec.frame).width; spec.scaleEnd = spec.scaleStart * 0.25;
    spec.scaleEase = GpuVfxEase.Linear; spec.stretchStart = 1; spec.stretchEnd = 1; spec.rotation = 0;
    spec.alphaStart = emissiveAlpha(0.85); spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = mixColors(palette.glow, palette.core, Math.random() * 0.5);
    spec.tintBlendStart = 0.35; spec.tintBlendEnd = 1;
    this.hasParticles = this.gpu!.spawn(spec, this.moteSource, now) || this.hasParticles;
  }

  /** Slow spores breathing out of the back cross while the toad channels. */
  private spawnSpore(healer: PointEmitter, now: number): void {
    const spec = this.moteSpec!, palette = healer.allied ? ALLIED : PLAGUE;
    const angle = Math.random() * Math.PI * 2, speed = 10 + Math.random() * 16;
    spec.x = healer.x + Math.cos(angle) * 3; spec.y = healer.y + Math.sin(angle) * 3;
    spec.vx = Math.cos(angle) * speed; spec.vy = Math.sin(angle) * speed;
    spec.positionEase = GpuVfxEase.QuadOut;
    spec.lifeMs = 750 + Math.random() * 300;
    spec.scaleStart = (1.6 + Math.random() * 1.8) / getGpuVfxFrame(spec.frame).width; spec.scaleEnd = spec.scaleStart * 1.6;
    spec.scaleEase = GpuVfxEase.QuadOut; spec.stretchStart = 1; spec.stretchEnd = 1; spec.rotation = 0;
    spec.alphaStart = emissiveAlpha(0.7); spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = palette.glow; spec.tintBlendStart = 0.5; spec.tintBlendEnd = 1;
    this.hasParticles = this.gpu!.spawn(spec, this.moteSource, now) || this.hasParticles;
  }

  /** Sparkles spiral into the healed ally; right after a dose lands they burst out a little brighter. */
  private spawnSpark(receiver: PointEmitter, now: number): void {
    const spec = this.sparkSpec!, palette = receiver.allied ? ALLIED : PLAGUE;
    const fresh = receiver.phase < 0.3;
    const angle = Math.random() * Math.PI * 2, radius = receiver.radius * (fresh ? 0.3 : 1.05 + Math.random() * 0.3);
    const inward = fresh ? -(46 + Math.random() * 30) : 30 + Math.random() * 18, swirl = 34 + Math.random() * 18;
    const cx = Math.cos(angle), cy = Math.sin(angle);
    spec.x = receiver.x + cx * radius; spec.y = receiver.y + cy * radius;
    spec.vx = -cx * inward - cy * swirl; spec.vy = -cy * inward + cx * swirl;
    spec.positionEase = fresh ? GpuVfxEase.QuadOut : GpuVfxEase.Linear;
    spec.lifeMs = fresh ? 340 + Math.random() * 160 : 420 + Math.random() * 220;
    spec.rotation = Math.atan2(spec.vy, spec.vx);
    spec.scaleStart = (2.6 + Math.random() * 1.6) / getGpuVfxFrame(spec.frame).width; spec.scaleEnd = spec.scaleStart * 0.3;
    spec.scaleEase = GpuVfxEase.Linear; spec.stretchStart = 2.4; spec.stretchEnd = 1;
    spec.alphaStart = emissiveAlpha(fresh ? 1 : 0.8); spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = palette.glow; spec.tintBlendStart = 0; spec.tintBlendEnd = 1;
    this.hasParticles = this.gpu!.spawn(spec, this.sparkSource, now) || this.hasParticles;
  }

  private releaseParticles(): void {
    this.unregisterEmission?.(); this.unregisterEmission = null;
    if (this.gpu) { this.gpu.releaseSource(this.moteSource); this.gpu.releaseSource(this.sparkSource); }
    this.moteSource = this.sparkSource = -1;
    this.moteSpec = this.sparkSpec = null;
    this.hasParticles = false;
  }
}

/** 0 when a heal tick applies, rising to 1 just before the next one. */
function tickPhase(now: number, restAt: number, tickMs: number): number {
  if (tickMs <= 0) return 0;
  return (((now - restAt) % tickMs) + tickMs) % tickMs / tickMs;
}

function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }

/** Deterministic seed in [0, 1) so neighbouring channels do not look stamped. */
function hashSeed(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 10007) / 10007;
}

function lightKey(id: string): string { return `rest-heal:${id}`; }
