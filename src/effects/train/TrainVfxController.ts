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
import { trainRandom, trainVfxSeed, sampleTrainChunk, type TrainChunkPath } from './TrainVfxModel';

export interface TrainVfxPorts {
  readonly gpu: GpuVfxSystem;
  readonly camera: Pick<CameraFeedbackController, 'request'>;
  readonly sampleGround?: (x: number, y: number) => number;
}

interface Burst { x: number; y: number; radius: number; at: number; seed: number; phase: number }
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
  private audio: GameAudioSystem | null = null;
  private pose: { x: number; y: number; dir: 1 | -1; segments: readonly number[] } | null = null;
  private before: { x: number; y: number; dir: number } | null = null;
  private dustCarry = 0;
  private movementSequence = 0;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly ports: TrainVfxPorts) {
    const gpu = ports.gpu;
    for (const effect of [Effect.TrainDust, Effect.TrainSmoke, Effect.TrainHeat, Effect.TrainDebris, Effect.TrainResidue]) {
      this.specs.set(effect, gpu.createSpec(effect));
    }
    this.source = gpu.createSource(Effect.TrainDust);
    this.generation = gpu.emissionGeneration;
    this.unsubscribe = gpu.registerEmission((delta, now) => this.tick(delta, now));
  }

  setAudio(system: GameAudioSystem): void { this.audio = system; }
  setPose(x: number, y: number, dir: 1 | -1, segments: readonly number[]): void { this.pose = { x, y, dir, segments }; }
  stopMovement(): void { this.pose = this.before = null; this.dustCarry = 0; }

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
    this.ports.gpu.releaseSource(this.source);
    this.bursts.length = this.chunks.length = 0;
    this.stopMovement();
  }

  private visible(x: number, y: number, margin = 240): boolean {
    const v = this.scene.cameras.main.worldView;
    return x >= v.x - margin && x <= v.right + margin && y >= v.y - margin && y <= v.bottom + margin;
  }

  private tick(delta: number, now: number): void {
    const gpu = this.ports.gpu;
    if (this.generation !== gpu.emissionGeneration || gpu.isSuppressed()) {
      gpu.clearSource(this.source);
      this.bursts.length = this.chunks.length = 0;
      this.before = null;
      this.generation = gpu.emissionGeneration;
      return;
    }
    if (delta <= 0) return;
    this.movement(Math.min(delta, 100), now);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      const times = [0, 65, 150, 340, 700];
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
      gpu.updateTransform(c.body, p.x, p.y, 0, 0, p.rotation);
      gpu.updateTransform(c.shadow, p.x, p.groundY, 0, 0, 0);
      if (p.landed && !c.landed) {
        c.landed = true;
        this.particle(Effect.TrainDust, Frame.ExplosionSmoke, p.x, p.groundY, 0, 0, 12, 38, 500, .35, this.groundColor(p.x, p.groundY), now);
        this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, p.x, p.groundY, 0, 0, 20, 25, 7000, .5, 0x171511, now);
        this.particle(Effect.TrainHeat, Frame.ExplosionEmber, p.x, p.groundY, 0, 0, 7, 2, 1800, .75, 0xff7628, now);
      }
      if (now - c.nextTrail > 210) c.nextTrail += Math.floor((now - c.nextTrail) / 70) * 70;
      for (let samples = 0; samples < 4 && now >= c.nextTrail; samples++) {
        const at = c.nextTrail, trailAge = at - c.at;
        c.nextTrail += 70;
        if (trailAge >= c.flightMs + c.burnMs) break;
        const trail = sampleTrainChunk(c, trailAge);
        // Fixed-time positions: 30/60/144 Hz produce the same trail samples, with aged GPU spawns.
        if (trail.landed && Math.round(trailAge / 70) % 2) continue;
        const heat = trail.landed ? Math.max(0, 1 - (trailAge - c.flightMs) / c.burnMs) : 1;
        this.particle(Effect.TrainHeat, Frame.FlameBillow, trail.x, trail.y, 2, -5, 10 * heat, 3, 220, .85 * heat, 0xff882b, at, now);
        this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke, trail.x, trail.y, 9, -9, 10, 28, 1050, .32 * heat, 0x383732, at, now);
      }
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
    this.dustCarry += delta / 1000 * 80 * speed * factor;
    const count = Math.min(10, Math.floor(this.dustCarry));
    this.dustCarry -= Math.floor(this.dustCarry);
    // Sample visible bogies only: off-map wagons cannot consume the visible train's quota.
    const bogies: { x: number; y: number }[] = [];
    for (let i = 0; i < p.segments.length; i++) {
      const offset = (i === 0 ? TRAIN.LOCO_HEIGHT : TRAIN.WAGON_HEIGHT) * .33;
      for (const end of [-1, 1]) for (const side of [-1, 1]) {
        const x = p.x + side * 26, y = p.segments[i] + end * offset;
        if (this.visible(x, y, 100)) bogies.push({ x, y });
      }
    }
    if (!bogies.length) return;
    for (let i = 0; i < count; i++) {
      const sequence = this.movementSequence++;
      const b = bogies[sequence % bogies.length];
      const random = trainRandom(sequence), side = Math.sign(b.x - p.x);
      this.particle(Effect.TrainDust, Frame.ExplosionSmoke, b.x, b.y, side * (10 + random() * 16), -p.dir * 35,
        13, 35 + random() * 20, 850 + random() * 350, .26, this.groundColor(b.x, b.y), now);
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
    const size = main ? 1.6 : 1;
    if (phase === 0) {
      this.particle(Effect.TrainHeat, Frame.ExplosionCore, b.x, b.y, 0, 0, 14, b.radius * 1.25, 130, .95, 0xffebba, at, now);
      this.particle(Effect.TrainDust, Frame.ExplosionRing, b.x, b.y, 0, 0, 20, b.radius * 3, 620, .42, this.groundColor(b.x, b.y), at, now);
      for (let i = 0; i < (main ? 10 : 4); i++) {
        const angle = random() * Math.PI * 2, reach = (55 + random() * 110) * size;
        const path: TrainChunkPath = { x: b.x, y: b.y, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach,
          height: 30 + random() * 65, flightMs: 600 + random() * 600, spin: (random() - .5) * 14 };
        // Consume the full seeded stream before quality/culling, so shared chunks take identical paths.
        if (i < Math.ceil((main ? 10 : 4) * factor)) this.chunk(path, at, now);
      }
      for (let i = 0; i < Math.ceil(18 * size * factor); i++) {
        const angle = random() * Math.PI * 2, speed = (70 + random() * 190) * size;
        this.particle(Effect.TrainHeat, Frame.ExplosionStreak, b.x, b.y,
          Math.cos(angle) * speed, Math.sin(angle) * speed, 5, .3, 500 + random() * 350, .95, 0xffb854, at, now);
      }
      this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, b.x, b.y, 0, 0, 65 * size, 85 * size, 8500, .55, 0x171611, at, now);
    } else if (phase <= 2) {
      for (let i = 0; i < Math.ceil(5 * size * factor); i++) {
        const angle = random() * Math.PI * 2, spread = 10 + random() * 35 * size;
        this.particle(Effect.TrainHeat, i % 2 ? Frame.ExplosionFireballA : Frame.ExplosionFireballB,
          b.x + Math.cos(angle) * spread, b.y + Math.sin(angle) * spread,
          Math.cos(angle) * 28, Math.sin(angle) * 28, 20 * size, 75 * size, 480, .82, 0xff962f, at, now);
      }
    } else {
      for (let i = 0; i < Math.ceil(7 * size * factor); i++) {
        this.particle(Effect.TrainSmoke, Frame.ExplosionSmoke,
          b.x + (random() - .5) * 65 * size, b.y + (random() - .5) * 65 * size,
          6 + random() * 15, -5 - random() * 12, 30 * size, 95 * size,
          2100 + random() * 900, .42, phase === 3 ? 0x36332d : 0x55534b, at, now);
      }
    }
  }

  private chunk(path: TrainChunkPath, at: number, now: number): void {
    if (this.chunks.length >= 64) return;
    const body = createGpuVfxMemberHandle(), shadow = createGpuVfxMemberHandle();
    const life = path.flightMs + 2700;
    const p = sampleTrainChunk(path, now - at);
    if (!this.particle(Effect.TrainDebris, Frame.ExplosionChunk, p.x, p.y, 0, 0, 8, 6, life, 1, 0x453b31, at, now, body)) return;
    this.particle(Effect.TrainResidue, Frame.ExplosionSmoke, p.x, p.groundY, 0, 0, 12, 10, life, .45, 0x14130f, at, now, shadow);
    this.chunks.push({ ...path, at, nextTrail: at, burnMs: 1800, landed: false, body, shadow });
  }

  private groundColor(x: number, y: number): number {
    return this.ports.sampleGround?.(x, y) ?? 0x939080;
  }

  private particle(effect: number, frame: Frame, x: number, y: number, vx: number, vy: number,
    size: number, endSize: number, life: number, alpha: number, color: number, at: number, now = at,
    handle?: GpuVfxMemberHandle): boolean {
    const s = this.specs.get(effect)!;
    const age = Math.max(0, now - at);
    if (age >= life || this.source < 0) return false;
    s.frame = frame; s.x = x; s.y = y; s.vx = vx; s.vy = vy;
    s.lifeMs = life; s.rotation = vx || vy ? Math.atan2(vy, vx) : 0;
    s.scaleStart = size / getGpuVfxFrame(frame).width;
    s.scaleEnd = endSize / getGpuVfxFrame(frame).width;
    s.scaleEase = Ease.QuadOut; s.alphaStart = alpha; s.alphaEnd = 0;
    s.alphaEase = Ease.Linear; s.tint = color;
    return this.ports.gpu.spawn(s, this.source, now, age, handle);
  }
}
