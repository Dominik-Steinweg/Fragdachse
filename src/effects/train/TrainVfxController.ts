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
import type { GpuVfxSystem } from '../gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from '../gpu/GpuVfxSpawnSpec';
import { GpuVfxLaneId as Lane } from '../gpu/GpuVfxRenderLanes';
import { trainRandom, trainVfxSeed } from './TrainVfxModel';

export interface TrainVfxPorts {
  readonly lighting?: Pick<LightingSystem, 'setLight' | 'releaseLight'>;
  readonly gpu: GpuVfxSystem;
  readonly camera: Pick<CameraFeedbackController, 'request'>;
  readonly sampleGround?: (x: number, y: number) => number;
}

interface Burst { x: number; y: number; radius: number; at: number; seed: number; phase: number }
/** World-owned cosmetic controller. No FireSystem zones, collision bodies, or gameplay timers. */
export class TrainVfxController {
  private readonly specs = new Map<number, GpuVfxSpawnSpec>();
  private readonly source: number;
  private readonly unsubscribe: () => void;
  private generation: number;
  private readonly bursts: Burst[] = [];
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
    const now = this.ports.gpu.now();
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
    }
  }

  /** Called only from the existing replicated explosion presentation, on every peer including host. */
  playExplosion(x: number, y: number, radius: number): void {
    if (this.destroyed || !Number.isFinite(x + y + radius) || radius <= 0) return;
    if (this.bursts.length >= 64 || this.ports.gpu.isSuppressed()) return;
    this.bursts.push({ x, y, radius: Math.min(160, radius), at: this.ports.gpu.now(),
      seed: trainVfxSeed(x, y, radius), phase: 0 });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.clearLights();
    this.ports.gpu.releaseSource(this.source);
    this.bursts.length = 0;
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
      this.bursts.length = 0;
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
        (2.5 * hot + .3 * Math.max(0, 1 - age / 9000)) * (.94 + .06 * Math.sin(age * .031)));
      while (b.phase < times.length && now - b.at >= times[b.phase]) {
        const at = b.at + times[b.phase];
        this.burstPhase(b, b.phase++, at, now);
      }
      if (b.phase === times.length) this.bursts.splice(i, 1);
    }
    this.finishLights();
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
      // Dozens of charges per destruction: a thinned, quieter aftershock layer instead of a wall of sound.
      if (!main && b.seed % 3 === 0) this.audio?.playSound('sfx_explosion_rocket_aftershock', b.x, b.y, undefined, .22);
    }
    if (!this.visible(b.x, b.y, 360)) return;
    // Charges share one smoke column: only the hero blast and every third charge keep feeding it.
    if (!main && phase >= 3 && (b.seed + phase) % 3 !== 0) return;
    const random = trainRandom(b.seed ^ Math.imul(phase + 1, 2654435761));
    const factor = this.ports.gpu.quality.getEmissionFactor(Effect.TrainSmoke);
    const size = main ? 1.85 : 1.1;
    // The fireball itself is the shared combat burst (EffectSystem) and the burning wreckage is
    // the host's ordinary fire-chunk burst. This layer only adds what is specific to a train:
    // torn metal, earthy dust, a dark smoke column and soot. No free-floating flames.
    if (phase === 0) {
      this.particle(Effect.TrainDust, Frame.ExplosionRing, b.x, b.y, 0, 0, 35, b.radius * 3.2, 900, .5, this.dustColor(b.x, b.y), at, now);
      for (let i = 0; i < Math.ceil(8 * size * factor); i++) {
        const angle = random() * Math.PI * 2, speed = (70 + random() * 190) * size;
        this.particle(Effect.TrainHeat, Frame.ExplosionStreak, b.x, b.y,
          Math.cos(angle) * speed, Math.sin(angle) * speed, 9, .7, 700 + random() * 500, .9, 0xffb854, at, now);
      }
      for (let i = 0; i < Math.ceil(6 * size * factor); i++) {
        const angle = random() * Math.PI * 2, speed = (60 + random() * 140) * size;
        this.particle(Effect.TrainDebris, Frame.ExplosionChunk, b.x + (random() - .5) * 30, b.y + (random() - .5) * 60,
          Math.cos(angle) * speed, Math.sin(angle) * speed, 6 + random() * 5 * size, 2, 650 + random() * 350, .95,
          random() < .5 ? 0x2b2723 : 0x4a3d33, at, now);
      }
      this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, b.x, b.y, 0, 0, 90 * size, 140 * size, 9000, .8, 0x171611, at, now);
    } else if (phase <= 2) {
      for (let i = 0; i < Math.ceil((main ? 7 : 3) * size * factor); i++) {
        const angle = random() * Math.PI * 2, spread = 12 + random() * 33 * size;
        const x = b.x + Math.cos(angle) * spread, y = b.y + Math.sin(angle) * spread;
        const vx = Math.cos(angle) * 28, vy = Math.sin(angle) * 28;
        this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke, x, y, vx, vy, 48 * size, 115 * size, 2300, .9,
          i % 2 ? 0x2a211b : 0x3a3029, at, now);
      }
    } else {
      // A steady, thinning column drifting with the breeze instead of flames popping in the smoke.
      const remaining = Math.max(.12, 1 - (at - b.at) / 13500);
      for (let i = 0; i < Math.ceil(6 * size * factor); i++) {
        this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke,
          b.x + (random() - .5) * 40 * size, b.y + (random() - .5) * 70 * size,
          14 + random() * 10, -9 - random() * 9, 36 * size, 116 * size,
          3600 + random() * 550, .85 * remaining, i % 2 ? 0x272823 : 0x3b3931, at, now);
      }
    }
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
    size: number, endSize: number, life: number, alpha: number, color: number, at: number, now = at): boolean {
    const s = this.specs.get(effect)!;
    if (effect === Effect.TrainSmoke) s.lane = Lane.TrainAftermathSmoke;
    if (effect === Effect.TrainDebris) s.lane = Lane.TrainBody;
    const age = Math.max(0, now - at);
    if (age >= life || this.source < 0) return false;
    s.frame = frame; s.x = x; s.y = y; s.vx = vx; s.vy = vy;
    s.lifeMs = life; s.rotation = vx || vy ? Math.atan2(vy, vx) : 0;
    s.scaleStart = size / getGpuVfxFrame(frame).width;
    s.scaleEnd = endSize / getGpuVfxFrame(frame).width;
    s.scaleEase = Ease.QuadOut; s.alphaStart = alpha; s.alphaEnd = 0;
    s.alphaEase = effect === Effect.TrainSmoke ? Ease.CubicIn : Ease.Linear;
    s.tint = color;
    // White heat belongs to the detonation core; trails stay orange and read as burning metal.
    s.tintBlendStart = effect === Effect.TrainHeat && frame === Frame.ExplosionCore ? .3 : 1;
    s.tintBlendEnd = 1;
    s.stretchStart = frame === Frame.FlameTongue ? 1.6 : 1; s.stretchEnd = 1;
    return this.ports.gpu.spawn(s, this.source, now, age);
  }
}
