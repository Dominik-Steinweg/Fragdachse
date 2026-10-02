import type { LightingSystem } from '../LightingSystem';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import type * as Phaser from 'phaser';
import type { GameAudioSystem } from '../../audio/GameAudioSystem';
import type { CameraFeedbackController } from '../camera/CameraFeedbackController';
import { impactExceptional, impactLight } from '../camera/cameraFeedbackPresets';
import { TRAIN } from '../../train/TrainConfig';
import { GpuVfxFrameId as Frame, getGpuVfxFrame } from '../gpu/GpuVfxAtlas';
import { GpuVfxEffectId as Effect } from '../gpu/GpuVfxEffects';
import { GpuVfxEase as Ease } from '../gpu/GpuVfxEase';
import { createGpuVfxMemberHandle, type GpuVfxMemberHandle, type GpuVfxSystem } from '../gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from '../gpu/GpuVfxSpawnSpec';
import { GpuVfxLaneId as Lane } from '../gpu/GpuVfxRenderLanes';
import { trainRandom, trainVfxSeed, sampleTrainChunk, sampleTrainEjection, type TrainChunkPath } from './TrainVfxModel';

export interface TrainVfxPorts {
  readonly lighting?: Pick<LightingSystem, 'setLight' | 'releaseLight'>;
  readonly gpu: GpuVfxSystem;
  readonly camera: Pick<CameraFeedbackController, 'request'>;
  readonly sampleGround?: (x: number, y: number) => number;
}

interface Burst { x: number; y: number; radius: number; at: number; seed: number; phase: number }
interface Ejection extends TrainChunkPath { at: number; body: GpuVfxMemberHandle; shadow: GpuVfxMemberHandle }
interface Chunk extends TrainChunkPath {
  at: number; nextTrail: number; burnMs: number; landed: boolean;
  body: GpuVfxMemberHandle; shadow: GpuVfxMemberHandle;
}

/** World-owned cosmetic controller. No FireSystem zones, collision bodies, or gameplay timers. */
export class TrainVfxController {
  private readonly specs = new Map<number, GpuVfxSpawnSpec>();
  private readonly source: number;
  private readonly unsubscribe: () => void;
  private generation: number;
  private readonly bursts: Burst[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly ejections: Ejection[] = [];
  private disintegrated = false;
  private audio: GameAudioSystem | null = null;
  private pose: { x: number; y: number; dir: 1 | -1; segments: readonly number[] } | null = null;
  private before: { x: number; y: number; dir: number } | null = null;
  private dustCarry = 0;
  private movementSequence = 0;
  private destroyed = false;
  private lighting: TrainVfxPorts['lighting'];
  private readonly lights = new Set<string>();
  private readonly refreshedLights = new Set<string>();

  constructor(private readonly scene: Phaser.Scene, private readonly ports: TrainVfxPorts) {
    this.lighting = ports.lighting;
    const gpu = ports.gpu;
    for (const effect of [Effect.TrainDust, Effect.TrainSmoke, Effect.TrainHeat, Effect.TrainDebris, Effect.TrainResidue]) {
      this.specs.set(effect, gpu.createSpec(effect));
    }
    this.source = gpu.createSource(Effect.TrainDust);
    this.generation = gpu.emissionGeneration;
    this.unsubscribe = gpu.registerEmission((delta, now) => this.tick(delta, now));
  }

  setLighting(system: NonNullable<TrainVfxPorts['lighting']>): void { this.clearLights(); this.lighting = system; }
  private clearLights(): void {
    for (const key of this.lights) this.lighting?.releaseLight(key, { immediate: true });
    this.lights.clear(); this.refreshedLights.clear();
  }
  private light(key: string, x: number, y: number, radius: number, intensity: number): void {
    if (!this.lighting || this.refreshedLights.size >= 12 || !this.visible(x, y, radius)) return;
    this.refreshedLights.add(key); this.lights.add(key);
    this.lighting.setLight(key, 'groundFire', x, y, { radiusPx: radius, intensity, color: 0xffa04a });
  }

  setAudio(system: GameAudioSystem): void { this.audio = system; }
  setPose(x: number, y: number, dir: 1 | -1, segments: readonly number[]): void { this.pose = { x, y, dir, segments }; }
  stopMovement(): void { this.pose = this.before = null; this.dustCarry = 0; }

  resetDestruction(): void { this.disintegrated = false; }

  /** Brief scattered rupture flashes; the main fireball hides the removal, never a luminous train silhouette. */
  disintegrate(x: number, segments: readonly number[]): void {
    if (this.disintegrated || this.destroyed || this.ports.gpu.isSuppressed()) return;
    this.disintegrated = true;
    const now = this.ports.gpu.now(), factor = this.ports.gpu.quality.getEmissionFactor(Effect.TrainDebris);
    const view = getVisibleWorldView(this.scene.cameras.main, this.cameraView);
    const centerY = (view.y + view.bottom) / 2;
    const heroSegments = new Set(segments.map((y, i) => ({ y, i }))
      .filter(p => this.visible(x, p.y, 100)).sort((a, b) => Math.abs(a.y - centerY) - Math.abs(b.y - centerY))
      .slice(0, 4).map(p => p.i));
    for (let i = 0; i < Math.min(segments.length, TRAIN.WAGON_COUNT + 1); i++) {
      const y = segments[i], height = i ? TRAIN.WAGON_HEIGHT : TRAIN.LOCO_HEIGHT;
      const random = trainRandom(trainVfxSeed(x, y, 64));
      // Sparse, offset islands with gaps: the common flash is gone before the chained fireballs peak.
      const cells = i ? 3 : 1;
      for (let n = 0; n < cells; n++) {
        const cx = x + (random() - .5) * 58;
        const cy = y - height / 2 + (n + .5) * height / cells + (random() - .5) * 26;
        const width = 43 + random() * 37, life = 40 + random() * 18;
        const vx = (random() - .5) * 100, vy = (random() - .5) * 100;
        if (!this.visible(cx, cy, 140)) continue;
        this.particle(Effect.TrainHeat, n % 2 ? Frame.GroundFireSurfaceB : Frame.GroundFireSurfaceC,
          cx, cy, vx, vy, width, width * .35, life, .95, 0xffbd55, now);
        if (n % 2 === 0) this.particle(Effect.TrainHeat, Frame.ExplosionCore, cx, cy, vx, vy,
          width * .6, width * .2, life * .8, .85, 0xffedb9, now);
        this.particle(Effect.TrainHeat, Frame.ExplosionStreak, cx, cy, vx * 1.5, vy * 1.5,
          4, .5, 280 + random() * 160, .85, 0xffa438, now);
        this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke, cx, cy, 12, -6, 38, 85, 1700, .65, 0x393027, now);
        this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, cx, cy, 0, 0, 40, 66, 9000, .5, 0x211c14, now);
      }
      for (let j = 0; j < 2; j++) {
        const path: TrainChunkPath = { x, y: y + (random() - .5) * height * .7,
          dx: (j ? 1 : -1) * (75 + random() * 90), dy: (random() - .5) * 100,
          height: 70 + random() * 45, flightMs: 650 + random() * 140, spin: (random() - .5) * 8 };
        if (j >= Math.ceil(2 * factor) || !this.visible(path.x, path.y, 180) || !heroSegments.has(i) || this.ejections.length >= 8) continue;
        const body = createGpuVfxMemberHandle(), shadow = createGpuVfxMemberHandle();
        if (!this.particle(Effect.TrainDebris, Frame.ExplosionChunk, path.x, path.y, 0, 0,
          29, 66, path.flightMs, 1, 0x3e3932, now, now, body)) continue;
        this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, path.x, path.y, 0, 0,
          18, 54, path.flightMs, .65, 0x171512, now, now, shadow);
        this.ejections.push({ ...path, at: now, body, shadow });
      }
    }
  }

  /** Called only from the existing replicated explosion presentation, on every peer including host. */
  playExplosion(x: number, y: number, radius: number): void {
    if (this.destroyed || !Number.isFinite(x + y + radius) || radius <= 0) return;
    if (this.bursts.length >= 16 || this.ports.gpu.isSuppressed()) return;
    this.bursts.push({ x, y, radius: Math.min(160, radius), at: this.ports.gpu.now(),
      seed: trainVfxSeed(x, y, radius), phase: 0 });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.clearLights();
    this.ports.gpu.releaseSource(this.source);
    this.bursts.length = this.chunks.length = this.ejections.length = 0;
    this.stopMovement();
  }

  private readonly cameraView = createVisibleWorldView();

  private visible(x: number, y: number, margin = 240): boolean {
    const v = getVisibleWorldView(this.scene.cameras.main, this.cameraView);
    return x >= v.x - margin && x <= v.right + margin && y >= v.y - margin && y <= v.bottom + margin;
  }

  private tick(delta: number, now: number): void {
    const gpu = this.ports.gpu;
    if (this.generation !== gpu.emissionGeneration || gpu.isSuppressed()) {
      gpu.clearSource(this.source);
      this.clearLights();
      this.bursts.length = this.chunks.length = this.ejections.length = 0;
      this.disintegrated = false;
      this.before = null;
      this.generation = gpu.emissionGeneration;
      return;
    }
    if (delta <= 0) return;
    this.refreshedLights.clear();
    this.movement(Math.min(delta, 100), now);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      const times = [0, 65, 210, 430, 850, 1400, 2100, 3000, 4000, 5200, 6600, 8200, 10000, 11500];
      const age = now - b.at;
      const hot = Math.exp(-age / 470);
      this.light(`train-afterburn-${b.seed}`, b.x, b.y, 150 + 330 * hot,
        (2.5 * hot + .72 * Math.max(0, 1 - age / 11000)) * (.94 + .06 * Math.sin(age * .031)));
      while (b.phase < times.length && now - b.at >= times[b.phase]) {
        const at = b.at + times[b.phase];
        this.burstPhase(b, b.phase++, at, now);
      }
      if (b.phase === times.length) this.bursts.splice(i, 1);
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i], age = now - c.at;
      if (age >= c.flightMs + c.burnMs + 900) { this.chunks.splice(i, 1); continue; }
      const p = sampleTrainChunk(c, age);
      if (i < 6 && age < c.flightMs + c.burnMs) this.light(`train-chunk-${trainVfxSeed(c.x, c.y, 80)}-${c.spin}`, p.x, p.groundY, 65,
        .6 * Math.max(0, 1 - Math.max(0, age - c.flightMs) / c.burnMs));
      gpu.updateTransform(c.body, p.x, p.y, 0, 0, p.rotation);
      gpu.updateTransform(c.shadow, p.x, p.groundY, 0, 0, 0);
      if (p.landed && !c.landed) {
        c.landed = true;
        gpu.releaseMember(c.body);
        // Only a tiny static chip remains, under figures; airborne material never becomes a prop.
        this.particle(Effect.TrainResidue, Frame.ExplosionChunk, p.x, p.groundY, 0, 0,
          4 + Math.abs(c.spin) * .35, 1.5, c.burnMs + 900, .8, 0x514439, now);
        this.particle(Effect.TrainDust, Frame.ExplosionSmoke, p.x, p.groundY, 0, 0, 22, 65, 750, .55, this.groundColor(p.x, p.groundY), now);
        this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, p.x, p.groundY, 0, 0, 30, 42, 8500, .8, 0x171511, now);
        this.particle(Effect.TrainHeat, Frame.GroundFireBedB, p.x, p.groundY, 0, 0, 12, 4, 1800, .85, 0xff7628, now);
      }
      if (now - c.nextTrail > 300) c.nextTrail += Math.floor((now - c.nextTrail) / 100) * 100;
      for (let samples = 0; samples < 4 && now >= c.nextTrail; samples++) {
        const at = c.nextTrail, trailAge = at - c.at;
        c.nextTrail += 100;
        if (trailAge >= c.flightMs + c.burnMs) break;
        const trail = sampleTrainChunk(c, trailAge);
        // Fixed-time positions: 30/60/144 Hz produce the same trail samples, with aged GPU spawns.
        if (trail.landed && Math.round(trailAge / 100) % 2) continue;
        const heat = trail.landed ? Math.max(0, 1 - Math.pow((trailAge - c.flightMs) / c.burnMs, 2)) : 1;
        const flicker = .8 + .2 * Math.sin(trailAge * .037 + c.spin);
        this.particle(Effect.TrainHeat, trail.landed ? Frame.GroundFireSurface : Frame.FlameTongue,
          trail.x, trail.y, trail.landed ? 3 : -c.dx / c.flightMs * 160, trail.landed ? -9 : -c.dy / c.flightMs * 160,
          (trail.landed ? 14 : 24) * flicker * heat, 9 * heat, trail.landed ? 480 : 280, .92 * heat, 0xff5c0a, at, now);
        this.particle(Effect.TrainHeat, Frame.FlameTongue, trail.x, trail.y, 2, -12,
          9 * flicker * heat, 4, 210, .96 * heat, 0xffed9a, at, now);
        if (Math.round(trailAge / 100) % (trail.landed ? 6 : 3) === 0) {
          this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke, trail.x, trail.y, 12, -16,
            19, 60, 2800, .82 * heat, 0x292720, at, now);
        }
      }
    }
    this.updateEjections(now);
    this.finishLights();
  }

  private updateEjections(now: number): void {
    const gpu = this.ports.gpu;
    for (let i = this.ejections.length - 1; i >= 0; i--) {
      const c = this.ejections[i], p = sampleTrainEjection(c, now - c.at);
      if (!p.broken) {
        gpu.updateTransform(c.body, p.x, p.y, 0, 0, p.rotation);
        gpu.updateTransform(c.shadow, p.x, p.groundY, 0, 0, 0);
        continue;
      }
      gpu.releaseMember(c.body); gpu.releaseMember(c.shadow);
      const at = c.at + c.flightMs, random = trainRandom(trainVfxSeed(c.x, c.y, 32));
      const count = Math.ceil(3 * gpu.quality.getEmissionFactor(Effect.TrainDebris));
      for (let j = 0; j < 3; j++) {
        const angle = random() * Math.PI * 2, reach = 18 + random() * 46;
        const path = { x: p.x, y: p.y, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach,
          height: 15 + random() * 25, flightMs: 380 + random() * 240, spin: (random() - .5) * 9 };
        if (j < count) this.chunk(path, at, now);
      }
      this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke, p.x, p.y, 10, -8, 20, 50, 1500, .6, 0x34302a, at, now);
      this.ejections.splice(i, 1);
    }
  }

  private finishLights(): void {
    for (const key of this.lights) if (!this.refreshedLights.has(key)) {
      this.lighting?.releaseLight(key, { immediate: true }); this.lights.delete(key);
    }
  }

  private movement(delta: number, now: number): void {
    const p = this.pose, before = this.before;
    this.before = p;
    if (!p || !before || p.x !== before.x || p.dir !== before.dir) return;
    const distance = Math.abs(p.y - before.y);
    if (distance > TRAIN.SPEED * delta / 1000 * 2.5 + 12) { this.dustCarry = 0; return; }
    const speed = Math.min(1, distance / delta * 1000 / TRAIN.SPEED);
    const factor = this.ports.gpu.quality.getEmissionFactor(Effect.TrainDust);
    this.dustCarry += delta / 1000 * 55 * Math.sqrt(speed) * factor;
    const count = Math.min(10, Math.floor(this.dustCarry));
    this.dustCarry -= Math.floor(this.dustCarry);
    // Sample visible bogies only: off-map wagons cannot consume the visible train's quota.
    const bogies: { x: number; y: number }[] = [];
    for (let i = 0; i < p.segments.length; i++) {
      const offset = (i === 0 ? TRAIN.LOCO_HEIGHT : TRAIN.WAGON_HEIGHT) * .33;
      for (const end of [-1, 1]) for (const side of [-1, 1]) {
        const x = p.x + side * 34, y = p.segments[i] + end * offset;
        if (this.visible(x, y, 100)) bogies.push({ x, y });
      }
    }
    if (!bogies.length) return;
    for (let i = 0; i < count; i++) {
      const sequence = this.movementSequence++;
      const random = trainRandom(sequence ^ 0x49fe7);
      const b = bogies[Math.floor(random() * bogies.length)], side = Math.sign(b.x - p.x);
      this.particle(Effect.TrainDust, Frame.ExplosionSmoke, b.x + (random() - .5) * 12, b.y + (random() - .5) * 42, side * (12 + random() * 22), -p.dir * (12 + random() * 32),
        12 + random() * 14, 50 + random() * 65, 1700 + random() * 900, .24 + random() * .28, this.dustColor(b.x, b.y), now);
      if (sequence % 3 === 0) this.particle(Effect.TrainDebris, Frame.ExplosionChunk, b.x, b.y,
        side * 45, -p.dir * 25, 2, .4, 260, .7, 0x77766c, now);
      if (sequence % 9 === 0) this.particle(Effect.TrainHeat, Frame.ExplosionStreak, b.x, b.y,
        side * 35, -p.dir * 100, 3, .2, 140, .6, 0xffbe67, now);
    }
  }

  private burstPhase(b: Burst, phase: number, at: number, now: number): void {
    const main = b.radius >= 140;
    if (phase === 0) {
      this.ports.camera.request(main ? impactExceptional({ sourceX: b.x, sourceY: b.y })
        : impactLight({ sourceX: b.x, sourceY: b.y }));
      if (!main) this.audio?.playSound('sfx_explosion_rocket_aftershock', b.x, b.y, undefined, .28);
    }
    if (!this.visible(b.x, b.y, 360)) return;
    const random = trainRandom(b.seed ^ Math.imul(phase + 1, 2654435761));
    const factor = this.ports.gpu.quality.getEmissionFactor(Effect.TrainSmoke);
    const size = main ? 1.85 : 1.1;
    if (phase === 0) {
      this.particle(Effect.TrainHeat, Frame.ExplosionCore, b.x, b.y, 0, 0, 60 * size, b.radius * .8, 190, 1, 0xffefb9, at, now);
      this.particle(Effect.TrainDust, Frame.ExplosionRing, b.x, b.y, 0, 0, 35, b.radius * 3.4, 850, .65, this.groundColor(b.x, b.y), at, now);
      for (let i = 0; i < (main ? 10 : 4); i++) {
        const angle = random() * Math.PI * 2, reach = (65 + random() * 130) * size;
        const path: TrainChunkPath = { x: b.x, y: b.y, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach,
          height: 55 + random() * 100, flightMs: 950 + random() * 850, spin: (random() - .5) * 14 };
        // Consume the full seeded stream before quality/culling, so shared chunks take identical paths.
        if (i < Math.ceil((main ? 10 : 4) * factor)) this.chunk(path, at, now);
      }
      for (let i = 0; i < Math.ceil(18 * size * factor); i++) {
        const angle = random() * Math.PI * 2, speed = (70 + random() * 190) * size;
        this.particle(Effect.TrainHeat, Frame.ExplosionStreak, b.x, b.y,
          Math.cos(angle) * speed, Math.sin(angle) * speed, 9, .7, 900 + random() * 650, .95, 0xffb854, at, now);
      }
      this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, b.x, b.y, 0, 0, 90 * size, 140 * size, 9000, .85, 0x171611, at, now);
    } else if (phase <= 2) {
      this.particle(Effect.TrainHeat, Frame.GroundFireSurfaceC, b.x, b.y, 4, -6,
        92 * size, 60 * size, 580, .95, 0xee650f, at, now);
      for (let i = 0; i < Math.ceil(7 * size * factor); i++) {
        const angle = random() * Math.PI * 2, spread = 12 + random() * 33 * size;
        const x = b.x + Math.cos(angle) * spread, y = b.y + Math.sin(angle) * spread;
        const vx = Math.cos(angle) * 28, vy = Math.sin(angle) * 28;
        const frame = i % 2 ? Frame.GroundFireSurfaceB : Frame.GroundFireSurfaceC;
        this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke, x, y, vx, vy, 48 * size, 115 * size, 2300, .94, 0x30241c, at, now);
        this.particle(Effect.TrainHeat, frame, x, y, vx, vy, 65 * size, 26 * size, 700, .95, 0xb83208, at, now);
        this.particle(Effect.TrainHeat, frame, x - 3, y - 3, vx * .6, vy * .6, 44 * size, 14 * size, 490, 1, 0xff871e, at, now);
        if (i % 3 === 0) this.particle(Effect.TrainHeat, Frame.GroundFireSurfaceC, x - 5, y - 5, vx * .4, vy * .4,
          29 * size, 7 * size, 270, .93, 0xffec98, at, now);
      }
    } else {
      const remaining = Math.max(.12, 1 - (at - b.at) / 13500);
      for (let i = 0; i < Math.ceil(7 * size * factor); i++) {
        this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke,
          b.x + (random() - .5) * 50 * size, b.y + (random() - .5) * 80 * size,
          13 + random() * 11, -9 - random() * 10, 36 * size, 112 * size,
          3600 + random() * 550, .93 * remaining, i % 2 ? 0x272823 : 0x3b3931, at, now);
      }
      for (let i = 0; i < Math.ceil(3 * factor); i++) {
        const x = b.x + (random() - .5) * 28, y = b.y + (random() - .5) * 110;
        this.particle(Effect.TrainHeat, Frame.GroundFireSurfaceB, x, y, 2, -4,
          28 * remaining, 8, 1700, .88 * remaining, 0xef560c, at, now);
        this.particle(Effect.TrainHeat, Frame.FlameTongue, x, y, 2, -6,
          11 * remaining, 3, 1100, .9 * remaining, 0xffdf7b, at, now);
      }
    }
  }

  private chunk(path: TrainChunkPath, at: number, now: number): void {
    if (this.chunks.length >= 64) return;
    const body = createGpuVfxMemberHandle(), shadow = createGpuVfxMemberHandle();
    const burnMs = 5200 + Math.abs(path.spin) * 100;
    const life = path.flightMs + burnMs + 900;
    const p = sampleTrainChunk(path, now - at);
    const size = 4 + Math.abs(path.spin) * .35;
    if (!this.particle(Effect.TrainDebris, Frame.ExplosionChunk, p.x, p.y, 0, 0, size, 1.5, path.flightMs, 1, 0x827666, at, now, body)) return;
    this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, p.x, p.groundY, 0, 0, size * 1.3, size, life, .65, 0x14130f, at, now, shadow);
    this.chunks.push({ ...path, at, nextTrail: at, burnMs, landed: false, body, shadow });
  }

  private dustColor(x: number, y: number): number {
    // Keep the sampled terrain hue, but mix out white ballast and vegetation green.
    const color = this.groundColor(x, y);
    const r = Math.round((color >>> 16) * .6 + 108 * .4);
    const g = Math.round(((color >>> 8) & 255) * .6 + 83 * .4);
    const b = Math.round((color & 255) * .6 + 54 * .4);
    return (r << 16) | (g << 8) | b;
  }

  private groundColor(x: number, y: number): number {
    return this.ports.sampleGround?.(x, y) ?? 0x939080;
  }

  private particle(effect: number, frame: Frame, x: number, y: number, vx: number, vy: number,
    size: number, endSize: number, life: number, alpha: number, color: number, at: number, now = at,
    handle?: GpuVfxMemberHandle): boolean {
    const s = this.specs.get(effect)!;
    if (effect === Effect.TrainSmoke) s.lane = Lane.TrainAftermathSmoke;
    if (effect === Effect.TrainDebris) s.lane = handle ? Lane.TrainAftermathDebris : Lane.TrainBody;
    const age = Math.max(0, now - at);
    if (age >= life || this.source < 0) return false;
    s.frame = frame; s.x = x; s.y = y; s.vx = vx; s.vy = vy;
    s.lifeMs = life; s.rotation = vx || vy ? Math.atan2(vy, vx) : 0;
    s.scaleStart = size / getGpuVfxFrame(frame).width;
    s.scaleEnd = endSize / getGpuVfxFrame(frame).width;
    s.scaleEase = Ease.QuadOut; s.alphaStart = alpha; s.alphaEnd = 0;
    s.alphaEase = effect === Effect.TrainSmoke || (effect === Effect.TrainDebris && handle) ? Ease.CubicIn : Ease.Linear;
    s.tint = color;
    // White heat belongs to the detonation core; trails stay orange and read as burning metal.
    s.tintBlendStart = effect === Effect.TrainHeat && frame === Frame.ExplosionCore ? .3 : 1;
    s.tintBlendEnd = 1;
    s.stretchStart = frame === Frame.FlameTongue ? 1.6 : 1; s.stretchEnd = 1;
    return this.ports.gpu.spawn(s, this.source, now, age, handle);
  }
}
