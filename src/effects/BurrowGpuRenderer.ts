import type { TerrainColorSnapshot } from '../arena/TerrainColorSnapshot';
import { BURROW_FX } from '../config/burrowEffects';
import { mixColors } from './EffectUtils';
import { MovementParticleBudget } from './MovementParticleBudget';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GRAINS = [GpuVfxFrameId.DeathDustMoteB, GpuVfxFrameId.DeathDustMoteC, GpuVfxFrameId.DeathDustMoteE];
const ALWAYS_VISIBLE = (): boolean => true;

type EarthBurstKind = 'enter' | 'exit' | 'dash' | 'undergroundIdle' | 'undergroundMove';
interface BurrowEvent { kind: 'enter' | 'exit' | 'shockwave'; x: number; y: number; radius: number; heading: number; }

export interface BurrowUndergroundTarget {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly active: boolean;
}

interface UndergroundTrack {
  target: BurrowUndergroundTarget;
  x: number;
  y: number;
  nextAt: number;
  moving: boolean;
  movingUntil: number;
  heading: number;
}

interface Landing {
  dueMs: number;
  lifeMs: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  stretch: number;
  tint: number;
}

function createLanding(): Landing {
  return { dueMs: 0, lifeMs: 0, x: 0, y: 0, rotation: 0, scale: 0, stretch: 1, tint: 0 };
}

function between(min: number, max: number): number { return min + Math.random() * (max - min); }

function validUndergroundTarget(target: BurrowUndergroundTarget): boolean {
  return target?.active === true && Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.rotation);
}

function undergroundProfile(kind: EarthBurstKind) {
  return kind === 'undergroundIdle' ? BURROW_FX.underground.stationary
    : kind === 'undergroundMove' ? BURROW_FX.underground.moving : null;
}

/** Alternating shovelfuls peel away from the left and right paws behind the facing direction. */
function enterDirection(heading: number, index: number): number {
  const side = index % 2 === 0 ? 1 : -1;
  return heading + Math.PI - side * BURROW_FX.enter.fanOffset
    + between(-BURROW_FX.enter.fanHalfWidth, BURROW_FX.enter.fanHalfWidth);
}

/** Scene-owned GPU presentation. World ownership also covers the bounded flight-to-ground handoff. */
export class BurrowGpuRenderer {
  private readonly flight = new MovementParticleBudget(BURROW_FX.flightCapacity, BURROW_FX.clodReserve);
  private readonly ground = new MovementParticleBudget(BURROW_FX.groundCapacity, BURROW_FX.clodReserve);
  private readonly landings = Array.from({ length: BURROW_FX.flightCapacity }, createLanding);
  private readonly historicLanding = createLanding();
  private pendingCount = 0;
  private readonly events = Array.from({ length: BURROW_FX.eventCapacity }, (): BurrowEvent => (
    { kind: 'exit', x: 0, y: 0, radius: 0, heading: 0 }
  ));
  private eventCount = 0;
  private readonly underground = new Map<string, UndergroundTrack>();
  private readonly clod: GpuVfxSpawnSpec;
  private readonly grain: GpuVfxSpawnSpec;
  private readonly residue: GpuVfxSpawnSpec;
  private readonly dust: GpuVfxSpawnSpec;
  private readonly ring: GpuVfxSpawnSpec;
  private readonly clodSource: number;
  private readonly grainSource: number;
  private readonly residueSource: number;
  private readonly dustSource: number;
  private readonly ringSource: number;
  private world: object | null = null;
  private isVisible: (() => boolean) | null = null;
  private wasVisible = false;
  private terrain: TerrainColorSnapshot | null = null;
  private generation: number;
  private destroyed = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.clod = gpu.createSpec(GpuVfxEffectId.BurrowClod);
    this.grain = gpu.createSpec(GpuVfxEffectId.BurrowGrain);
    this.residue = gpu.createSpec(GpuVfxEffectId.BurrowResidue);
    this.dust = gpu.createSpec(GpuVfxEffectId.BurrowDust);
    this.ring = gpu.createSpec(GpuVfxEffectId.BurrowShockwave);
    this.clodSource = gpu.createSource(GpuVfxEffectId.BurrowClod);
    this.grainSource = gpu.createSource(GpuVfxEffectId.BurrowGrain);
    this.residueSource = gpu.createSource(GpuVfxEffectId.BurrowResidue);
    this.dustSource = gpu.createSource(GpuVfxEffectId.BurrowDust);
    this.ringSource = gpu.createSource(GpuVfxEffectId.BurrowShockwave);
    this.generation = gpu.emissionGeneration;
    gpu.registerEmission((deltaMs, now) => this.emitFrame(now, deltaMs));
  }

  openWorld(scope: object, isVisible: () => boolean = ALWAYS_VISIBLE): void {
    if (this.destroyed) return;
    this.clearAllUnderground();
    this.clear();
    this.world = scope;
    this.isVisible = isVisible;
    this.wasVisible = false;
  }

  closeWorld(scope: object): void {
    if (this.world !== scope) return;
    this.clearAllUnderground();
    this.clear();
    this.world = null;
    this.isVisible = null;
    this.wasVisible = false;
  }

  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void { this.terrain = snapshot; }

  /** Phase synchronization binds the hidden player sprite; its visible flag is intentionally irrelevant. */
  syncUnderground(id: string, target: BurrowUndergroundTarget): void {
    if (this.destroyed || !this.world) return;
    if (!validUndergroundTarget(target)) { this.clearUnderground(id); return; }
    const track = this.underground.get(id);
    if (track?.target === target) return;
    if (track) {
      track.target = target;
      this.rebaseUndergroundTrack(track, this.gpu.now());
    } else if (this.underground.size < BURROW_FX.underground.maxSources) {
      this.underground.set(id, { target, x: target.x, y: target.y, nextAt: this.gpu.now(), moving: false,
        movingUntil: this.gpu.now(), heading: target.rotation - Math.PI / 2 });
    }
  }

  /** Unbinding stops future churn while particles already thrown out finish landing and fading. */
  clearUnderground(id: string): void { this.underground.delete(id); }
  clearAllUnderground(): void { this.underground.clear(); }

  playEnter(x: number, y: number, heading: number): void {
    if (!Number.isFinite(heading) || !this.prepare(x, y)) return;
    this.queueEvent('enter', x, y, 0, heading);
  }

  playExit(x: number, y: number): void {
    if (!this.prepare(x, y)) return;
    this.queueEvent('exit', x, y, 0);
  }

  /** Called at distance-sampled contacts during the active burst of a burrow dash. */
  playDashTrail(x: number, y: number, heading: number, size: number, ageMs: number): void {
    if (!Number.isFinite(heading + size + ageMs) || !this.prepare(x, y)) return;
    const scale = Math.max(0.85, Math.min(1.5, Math.sqrt(Math.max(0, size) / 32)));
    this.spawnEarth(x, y, heading, scale, Math.max(0, ageMs), 'dash');
  }

  playShockwave(x: number, y: number, radius: number): void {
    if (!Number.isFinite(radius) || radius <= 0 || !this.prepare(x, y)) return;
    this.queueEvent('shockwave', x, y, radius);
  }

  private queueEvent(kind: BurrowEvent['kind'], x: number, y: number, radius: number, heading = 0): void {
    if (this.eventCount >= this.events.length) return;
    const event = this.events[this.eventCount++];
    event.kind = kind; event.x = x; event.y = y; event.radius = radius; event.heading = heading;
  }

  private spawnShockwave(x: number, y: number, radius: number): void {
    if (!this.scaledCount(GpuVfxEffectId.BurrowShockwave, 1)) return;
    const spec = this.ring;
    spec.x = x; spec.y = y;
    // The atlas ring is 64 px wide: a unit scale spans a 32 px radius.
    spec.scaleStart = radius / 32 * BURROW_FX.shockwave.startRadiusFactor;
    spec.scaleEnd = radius / 32;
    spec.scaleEase = GpuVfxEase.QuadOut;
    spec.alphaStart = BURROW_FX.shockwave.alpha; spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = BURROW_FX.shockwave.tint;
    spec.lifeMs = BURROW_FX.shockwave.lifeMs;
    this.gpu.spawn(spec, this.ringSource, this.gpu.now());
  }

  private prepare(x: number, y: number): boolean {
    if (this.destroyed || !this.world || !Number.isFinite(x + y)) return false;
    if (this.generation !== this.gpu.emissionGeneration) this.clear();
    if (!this.hasVisiblePresentation()) return false;
    if (this.gpu.isSuppressed()) return false;
    this.flight.retire(this.gpu.now()); this.ground.retire(this.gpu.now());
    return true;
  }

  private hasVisiblePresentation(): boolean {
    const visible = this.isVisible?.() ?? false;
    if (this.wasVisible && !visible) this.clear();
    if (!this.wasVisible && visible) this.rebaseUnderground(this.gpu.now());
    this.wasVisible = visible;
    return visible;
  }

  private scaledCount(effect: GpuVfxEffectId, count: number): number {
    // Each contact/event stands alone; changing quality cannot bank a later burst.
    const result = this.gpu.quality.scaleDiscreteBurst(effect, count);
    if (result < count) this.gpu.recordQualityDrop(effect, count - result);
    return result;
  }

  private spawnEarth(x: number, y: number, heading: number, size: number, age: number, kind: EarthBurstKind): void {
    const profile = undergroundProfile(kind);
    const tuning = profile ?? (kind === 'enter' ? BURROW_FX.enter : kind === 'dash' ? BURROW_FX.dash : BURROW_FX.exit);
    const entering = kind === 'enter';
    const directed = kind === 'dash' || kind === 'undergroundMove';
    const particleScale = size * (profile?.scale ?? (entering ? BURROW_FX.enter.scale : 1));
    const flightLifeFactor = profile?.flightLifeFactor ?? (entering ? BURROW_FX.enter.flightLifeFactor : 1);
    const now = this.gpu.now();
    const earth = this.terrain?.sample(x, y) ?? BURROW_FX.terrainFallback;
    const originPhase = between(0, TAU);
    const clods = this.scaledCount(GpuVfxEffectId.BurrowClod, tuning.clods);
    for (let i = 0; i < clods; i++) {
      const direction = entering ? enterDirection(heading, i) : directed
        ? heading + Math.PI + ((i + 0.5) / clods - 0.5) * BURROW_FX.dash.fan + between(-0.12, 0.12)
        : originPhase + i * GOLDEN_ANGLE + between(-0.2, 0.2);
      const spec = this.clod;
      spec.lifeMs = between(BURROW_FX.flightLifeMinMs, BURROW_FX.flightLifeMaxMs) * flightLifeFactor;
      const totalLife = between(BURROW_FX.clodLifeMinMs, BURROW_FX.clodLifeMaxMs);
      if (age >= totalLife) continue;
      const historic = age >= spec.lifeMs;
      if (!historic && (!this.flight.canSpawn(true) || this.pendingCount >= this.landings.length)) break;
      const nx = Math.cos(direction), ny = Math.sin(direction);
      const offset = between(0.25, 1) * tuning.originRadius * size;
      spec.x = x + nx * offset; spec.y = y + ny * offset;
      if (entering) this.placeAtDiggingPaw(spec, x, y, heading, i, size);
      const distance = between(tuning.spreadMin, tuning.spreadMax) * size;
      spec.vx = nx * distance * 1000 / spec.lifeMs; spec.vy = ny * distance * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = between(0, TAU);
      spec.angularVelocity = between(BURROW_FX.clod.spinMin, BURROW_FX.clod.spinMax) * (i % 2 === 0 ? 1 : -1);
      spec.rotationEase = GpuVfxEase.QuadOut;
      // Emit large clods first so lowered quality/capacity preserves the readable primary form.
      const fraction = i / tuning.clods;
      const baseScale = fraction < BURROW_FX.clod.largeFraction ? BURROW_FX.clod.largeScale
        : fraction < BURROW_FX.clod.mediumFraction ? BURROW_FX.clod.mediumScale : BURROW_FX.clod.smallScale;
      spec.scaleStart = baseScale * particleScale * between(1 - BURROW_FX.clod.scaleVariation, 1 + BURROW_FX.clod.scaleVariation);
      spec.scaleEnd = spec.scaleStart * BURROW_FX.clod.landingScale;
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = between(0.75, 1.3); spec.stretchEnd = spec.stretchStart;
      spec.alphaStart = BURROW_FX.clod.alpha; spec.alphaEnd = BURROW_FX.clod.landingAlpha;
      spec.tint = mixColors(earth, BURROW_FX.earthTint, BURROW_FX.earthTintMix + between(-0.1, 0.1));
      if (!historic && !this.gpu.spawn(spec, this.clodSource, now, age)) continue;
      const landing = historic ? this.historicLanding : this.landings[this.pendingCount++];
      landing.dueMs = now + spec.lifeMs - age;
      landing.lifeMs = totalLife - spec.lifeMs;
      // The endpoint must match the same amplitude/lifetime used by the GPU member writer.
      landing.x = spec.x + spec.vx * (spec.lifeMs / 1000);
      landing.y = spec.y + spec.vy * (spec.lifeMs / 1000);
      landing.rotation = spec.rotation + spec.angularVelocity * (spec.lifeMs / 1000);
      landing.scale = spec.scaleEnd; landing.stretch = spec.stretchEnd; landing.tint = spec.tint;
      if (historic) this.spawnResidue(landing, now);
      else this.flight.record(landing.dueMs);
    }

    const grains = this.scaledCount(GpuVfxEffectId.BurrowGrain, tuning.grains);
    for (let i = 0; i < grains && this.flight.canSpawn(false); i++) {
      const spec = this.grain;
      spec.lifeMs = between(BURROW_FX.flightLifeMinMs, BURROW_FX.flightLifeMaxMs) * flightLifeFactor;
      if (age >= spec.lifeMs) continue;
      const direction = entering ? enterDirection(heading, i)
        : directed ? heading + Math.PI + between(-BURROW_FX.dash.fan / 2, BURROW_FX.dash.fan / 2)
        : originPhase + i * GOLDEN_ANGLE;
      const distance = between(tuning.spreadMin, tuning.spreadMax) * size * BURROW_FX.grain.spreadFactor;
      spec.frame = GRAINS[i % GRAINS.length];
      spec.x = x; spec.y = y;
      if (entering) this.placeAtDiggingPaw(spec, x, y, heading, i, size);
      spec.vx = Math.cos(direction) * distance * 1000 / spec.lifeMs;
      spec.vy = Math.sin(direction) * distance * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = direction; spec.angularVelocity = between(-2, 2);
      spec.scaleStart = between(BURROW_FX.grain.scaleMin, BURROW_FX.grain.scaleMax) * particleScale;
      spec.scaleEnd = spec.scaleStart * 0.65;
      spec.alphaStart = BURROW_FX.grain.alpha; spec.alphaEnd = 0;
      spec.tint = mixColors(earth, BURROW_FX.earthTint, BURROW_FX.earthTintMix);
      if (this.gpu.spawn(spec, this.grainSource, now, age)) this.flight.record(now + spec.lifeMs - age);
    }
  }

  private placeAtDiggingPaw(spec: GpuVfxSpawnSpec, x: number, y: number, heading: number, index: number, size: number): void {
    const forward = BURROW_FX.enter.frontOffset * size;
    const side = (index % 2 === 0 ? 1 : -1) * BURROW_FX.enter.sideOffset * size;
    const nx = Math.cos(heading), ny = Math.sin(heading);
    const scatter = BURROW_FX.enter.originRadius * 0.25 * size;
    spec.x = x + nx * forward - ny * side + between(-scatter, scatter);
    spec.y = y + ny * forward + nx * side + between(-scatter, scatter);
  }

  private spawnDust(x: number, y: number, heading: number, kind: Exclude<EarthBurstKind, 'dash'>): void {
    const profile = undergroundProfile(kind);
    const entering = kind === 'enter';
    const count = this.scaledCount(GpuVfxEffectId.BurrowDust, (profile ?? (entering ? BURROW_FX.enter : BURROW_FX.exit)).dust);
    const size = profile?.dustScale ?? (entering ? BURROW_FX.enter.dustScale : 1);
    const earth = this.terrain?.sample(x, y) ?? BURROW_FX.terrainFallback;
    const phase = between(0, TAU);
    const spec = this.dust;
    for (let i = 0; i < count && this.ground.canSpawn(false); i++) {
      const body = i % 2 === 0;
      const direction = entering ? enterDirection(heading, Math.floor(i / 2))
        : kind === 'undergroundMove' ? heading + Math.PI + between(-1, 1) : phase + i * GOLDEN_ANGLE;
      const nx = Math.cos(direction), ny = Math.sin(direction);
      const distance = between(BURROW_FX.dust.travelMin, BURROW_FX.dust.travelMax) * size;
      spec.frame = body ? GpuVfxFrameId.ExplosionSmoke : GpuVfxFrameId.LeafBlowerDust;
      spec.lifeMs = between(BURROW_FX.dustLifeMinMs, BURROW_FX.dustLifeMaxMs)
        * (profile?.dustLifeFactor ?? (entering ? BURROW_FX.enter.dustLifeFactor : 1));
      spec.x = x + nx * (profile?.originRadius ?? 8); spec.y = y + ny * (profile?.originRadius ?? 8);
      if (entering) this.placeAtDiggingPaw(spec, x, y, heading, Math.floor(i / 2), 1);
      spec.vx = nx * distance * 1000 / spec.lifeMs; spec.vy = ny * distance * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = direction; spec.angularVelocity = BURROW_FX.dust.spin * (body ? 1 : -1);
      spec.rotationEase = GpuVfxEase.QuadOut;
      spec.scaleStart = between(BURROW_FX.dust.diameterMin, BURROW_FX.dust.diameterMax) * size / (body ? 56 : 18);
      spec.scaleEnd = spec.scaleStart * BURROW_FX.dust.growth;
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = 1.2; spec.stretchEnd = body ? 1.1 : 0.85;
      spec.alphaStart = BURROW_FX.dust.alpha * (body ? 1 : 0.8); spec.alphaEnd = 0;
      spec.tint = mixColors(earth, BURROW_FX.dustTint, BURROW_FX.dustTintMix + between(-0.1, 0.1));
      if (this.gpu.spawn(spec, this.dustSource, this.gpu.now())) this.ground.record(this.gpu.now() + spec.lifeMs);
    }
  }

  private emitFrame(now: number, deltaMs: number): void {
    if (this.destroyed || !this.world) return;
    if (this.generation !== this.gpu.emissionGeneration) { this.clear(); return; }
    if (!this.hasVisiblePresentation()) return;
    this.flight.retire(now); this.ground.retire(now);
    for (let i = this.pendingCount - 1; i >= 0; i--) {
      const landing = this.landings[i];
      if (now < landing.dueMs) continue;
      // Return this record to the fixed pool whether the ground spawn succeeds or is dropped.
      this.landings[i] = this.landings[--this.pendingCount];
      this.landings[this.pendingCount] = landing;
      this.spawnResidue(landing, now);
    }
    // Phaser advances its layer clocks before gameplay. Defer discrete events to this GPU
    // tick so member births, expiry budgets and landing times all use the same frame boundary.
    const count = this.eventCount;
    this.eventCount = 0;
    for (let i = 0; i < count; i++) {
      const event = this.events[i];
      if (event.kind === 'shockwave') this.spawnShockwave(event.x, event.y, event.radius);
      else {
        this.spawnEarth(event.x, event.y, event.heading, 1, 0, event.kind);
        this.spawnDust(event.x, event.y, event.heading, event.kind);
      }
    }
    this.advanceUnderground(now, deltaMs);
  }

  private rebaseUndergroundTrack(track: UndergroundTrack, now: number): void {
    track.x = track.target.x; track.y = track.target.y; track.moving = false;
    track.movingUntil = now; track.heading = track.target.rotation - Math.PI / 2;
    track.nextAt = now + BURROW_FX.underground.stationaryIntervalMs;
  }

  private rebaseUnderground(now: number): void {
    for (const [id, track] of this.underground) {
      if (!validUndergroundTarget(track.target)) this.underground.delete(id);
      else this.rebaseUndergroundTrack(track, now);
    }
  }

  private advanceUnderground(now: number, deltaMs: number): void {
    const tuning = BURROW_FX.underground;
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || deltaMs > tuning.maxFrameMs) {
      this.rebaseUnderground(now); return;
    }
    for (const [id, track] of this.underground) {
      const target = track.target;
      if (!validUndergroundTarget(target)) { this.underground.delete(id); continue; }
      const dx = target.x - track.x, dy = target.y - track.y;
      const distance = Math.hypot(dx, dy);
      track.x = target.x; track.y = target.y;
      if (distance > tuning.teleportDistance) { this.rebaseUndergroundTrack(track, now); continue; }
      if (deltaMs > 0 && distance * 1000 / deltaMs > tuning.minMoveSpeed) {
        track.movingUntil = now + tuning.motionHoldMs;
        track.heading = Math.atan2(dy, dx);
      }
      // Physics and snapshots need not move the sprite on every render frame. Retain its last
      // travel direction briefly so those gaps neither restart cadence nor turn a trail radial.
      const moving = now < track.movingUntil;
      const interval = moving ? tuning.movingIntervalMs : tuning.stationaryIntervalMs;
      if (moving !== track.moving) {
        track.moving = moving;
        if (moving) track.nextAt = Math.min(track.nextAt, now + interval);
      }
      if (now < track.nextAt) continue;
      // No catch-up loop: quality reductions, stalls and dropped particles cannot bank later pulses.
      track.nextAt = now + interval;
      const heading = moving ? track.heading : target.rotation - Math.PI / 2;
      const kind = moving ? 'undergroundMove' : 'undergroundIdle';
      this.spawnEarth(target.x, target.y, heading, 1, 0, kind);
      this.spawnDust(target.x, target.y, heading, kind);
    }
  }

  private spawnResidue(landing: Landing, now: number): void {
    const age = Math.max(0, now - landing.dueMs);
    if (age >= landing.lifeMs || !this.ground.canSpawn(true)) return;
    if (this.gpu.quality.getEmissionFactor(GpuVfxEffectId.BurrowResidue) <= 0) {
      this.gpu.recordQualityDrop(GpuVfxEffectId.BurrowResidue); return;
    }
    const spec = this.residue;
    spec.x = landing.x; spec.y = landing.y;
    spec.rotation = landing.rotation;
    spec.scaleStart = spec.scaleEnd = landing.scale;
    spec.stretchStart = spec.stretchEnd = landing.stretch;
    spec.alphaStart = BURROW_FX.clod.landingAlpha; spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = landing.tint; spec.lifeMs = landing.lifeMs;
    if (this.gpu.spawn(spec, this.residueSource, now, age)) this.ground.record(landing.dueMs + landing.lifeMs);
  }

  clear(): void {
    this.eventCount = this.pendingCount = 0; this.flight.clear(); this.ground.clear();
    this.rebaseUnderground(this.gpu.now());
    this.gpu.clearSource(this.clodSource); this.gpu.clearSource(this.grainSource);
    this.gpu.clearSource(this.residueSource); this.gpu.clearSource(this.dustSource); this.gpu.clearSource(this.ringSource);
    this.generation = this.gpu.emissionGeneration;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clearAllUnderground();
    this.clear(); this.destroyed = true; this.world = null; this.isVisible = null; this.wasVisible = false; this.terrain = null;
    this.gpu.releaseSource(this.clodSource); this.gpu.releaseSource(this.grainSource);
    this.gpu.releaseSource(this.residueSource); this.gpu.releaseSource(this.dustSource); this.gpu.releaseSource(this.ringSource);
  }
}
