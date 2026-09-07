import type { TerrainColorSnapshot } from '../arena/TerrainColorSnapshot';
import { MOVEMENT_FX } from '../config/movementEffects';
import { mixColors } from './EffectUtils';
import { MovementParticleBudget } from './MovementParticleBudget';
import {
  createMovementVisualSample, MovementStepSampler,
  type MovementContactSink, type MovementVisualSample, type MovementVisualSource,
} from './MovementStepSampler';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { GpuVfxSystem } from './gpu/GpuVfxSystem';

interface Track {
  readonly sample: MovementVisualSample;
  readonly sampler: MovementStepSampler;
  frame: number;
  footprintCarry: number;
  footprintCycle: boolean;
  dustCarry: number;
  dashCarry: number;
  contacts: number;
}

interface MovementView { x: number; y: number; width: number; height: number; }
const PAW_FRAMES = {
  compact: GpuVfxFrameId.MovementPawCompact,
  clawed: GpuVfxFrameId.MovementPawClawed,
  broad: GpuVfxFrameId.MovementPawBroad,
};

/** Existing atlas textures form one layered puff: soft body, rolling edge, then loose grains.
 * Scale compensates for their different source dimensions; these are never opaque disks. */
const DUST_COMPONENTS = [
  { frame: GpuVfxFrameId.ExplosionSmoke, scale: 18 / 56 * 0.85, alpha: 1, life: 1,
    speed: 0.62, side: 0.15, spin: 0.35, expansion: 1, stretchStart: 1.15, stretchEnd: 1.45,
    fade: GpuVfxEase.Linear },
  { frame: GpuVfxFrameId.LeafBlowerDust, scale: 1, alpha: 0.74, life: 0.78,
    speed: 1, side: 0.55, spin: 1.6, expansion: 0.85, stretchStart: 1.3, stretchEnd: 0.9,
    fade: GpuVfxEase.Linear },
  { frame: GpuVfxFrameId.DeathDustMoteB, scale: 0.65, alpha: 0.9, life: 0.52,
    speed: 1.4, side: 0.9, spin: 0.55, expansion: 0.2, stretchStart: 1, stretchEnd: 1,
    fade: GpuVfxEase.QuadOut },
] as const;
const DUST_GRAINS = [GpuVfxFrameId.DeathDustMoteB, GpuVfxFrameId.DeathDustMoteC, GpuVfxFrameId.DeathDustMoteE];

/** Shared scene-lifetime renderer. A world binding owns its samples, material and residuals. */
export class MovementEffectsRenderer {
  private readonly tracks = new Map<MovementVisualSource, Track>();
  private readonly players: Track[] = [];
  private readonly enemies: Track[] = [];
  private readonly prints = new MovementParticleBudget(MOVEMENT_FX.footprintCapacity, MOVEMENT_FX.playerFootprintReserve);
  private readonly dust = new MovementParticleBudget(MOVEMENT_FX.dustCapacity, MOVEMENT_FX.playerDustReserve);
  private readonly footprint: GpuVfxSpawnSpec;
  private readonly walkDust: GpuVfxSpawnSpec;
  private readonly dashDust: GpuVfxSpawnSpec;
  private readonly footprintSource: number;
  private readonly walkSource: number;
  private readonly dashSource: number;
  private terrain: TerrainColorSnapshot | null = null;
  private world: object | null = null;
  private generation: number;
  private frame = 0;
  private delta = 0;
  private captured = false;
  private destroyed = false;
  private current: Track | null = null;
  private now = 0;
  private dustSequence = 0;
  /** Teleport FX can arrive before the position snapshot; discard that interpolation tail. */
  private readonly interruptions = new Map<string, number>();

  constructor(private readonly gpu: GpuVfxSystem) {
    this.footprint = gpu.createSpec(GpuVfxEffectId.MovementFootprint);
    this.walkDust = gpu.createSpec(GpuVfxEffectId.MovementWalkDust);
    this.dashDust = gpu.createSpec(GpuVfxEffectId.MovementDashDust);
    this.footprintSource = gpu.createSource(GpuVfxEffectId.MovementFootprint);
    this.walkSource = gpu.createSource(GpuVfxEffectId.MovementWalkDust);
    this.dashSource = gpu.createSource(GpuVfxEffectId.MovementDashDust);
    this.generation = gpu.emissionGeneration;
    gpu.registerEmission((_delta, now) => this.emitFrame(now));
  }

  openWorld(scope: object): void {
    if (this.destroyed) return;
    this.clear();
    // Authored terrain may be handed off; its explicit teardown clears the snapshot.
    this.world = scope;
  }

  closeWorld(scope: object): void {
    if (this.world !== scope) return;
    this.clear();
    this.world = null;
  }

  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void { this.terrain = snapshot; }

  interruptSource(id: string): void {
    if (this.world) this.interruptions.set(id, this.gpu.now() + 500);
  }

  /** Call once after both role-specific pose syncs, before the common GPU retire/emission tick. */
  captureFrame(
    delta: number, visible: boolean, players: readonly MovementVisualSource[],
    enemies: readonly MovementVisualSource[], view: MovementView,
  ): void {
    if (this.destroyed) return;
    if (this.generation !== this.gpu.emissionGeneration) this.clear();
    if (!this.world || !visible || this.gpu.isSuppressed()) {
      if (this.tracks.size || this.prints.liveCount || this.dust.liveCount) this.clear();
      return;
    }
    this.frame++;
    this.delta = delta;
    this.players.length = this.enemies.length = 0;
    for (const source of players) this.capture(source, this.players, view);
    for (const source of enemies) this.capture(source, this.enemies, view);
    for (const [source, track] of this.tracks) {
      if (track.frame !== this.frame) this.tracks.delete(source);
    }
    for (const [id, until] of this.interruptions) {
      if (until <= this.gpu.now()) this.interruptions.delete(id);
    }
    this.captured = true;
  }

  private capture(source: MovementVisualSource, output: Track[], view: MovementView): void {
    let track = this.tracks.get(source);
    if (!track) {
      track = { sample: createMovementVisualSample(), sampler: new MovementStepSampler(),
        frame: this.frame, footprintCarry: 0, footprintCycle: false, dustCarry: 0, dashCarry: 0, contacts: 0 };
      this.tracks.set(source, track);
    }
    source.readMovementVisualSample(track.sample);
    const s = track.sample;
    const margin = MOVEMENT_FX.cullMargin;
    s.visible = s.visible && s.x >= view.x - margin && s.y >= view.y - margin
      && s.x <= view.x + view.width + margin && s.y <= view.y + view.height + margin
      && (this.interruptions.get(s.id) ?? 0) <= this.gpu.now();
    track.frame = this.frame;
    output.push(track);
  }

  private emitFrame(now: number): void {
    if (this.destroyed || !this.captured || !this.world) return;
    this.captured = false;
    if (this.generation !== this.gpu.emissionGeneration) { this.clear(); return; }
    this.now = now;
    this.prints.retire(now); this.dust.retire(now);
    for (const track of this.players) this.advance(track);
    // Changing the first enemy avoids permanently starving the tail of a large wave.
    for (let i = 0; i < this.enemies.length; i++) {
      this.advance(this.enemies[(i + this.frame) % this.enemies.length]);
    }
    this.current = null;
  }

  private advance(track: Track): void {
    this.current = track;
    track.sampler.advance(track.sample, this.delta, this.contact);
  }

  private readonly contact: MovementContactSink = (kind, x, y, heading, paw, age, facing) => {
    const track = this.current!;
    const s = track.sample;
    if (kind === 'step') {
      const factor = this.gpu.quality.getEmissionFactor(GpuVfxEffectId.MovementFootprint);
      // Thin complete gait cycles: dropping every other contact would erase one side of a biped.
      if (paw === 0) {
        track.footprintCarry += factor;
        track.footprintCycle = track.footprintCarry >= 1;
        if (track.footprintCycle) track.footprintCarry -= 1;
      }
      if (factor <= 0) track.footprintCycle = false;
      if (track.footprintCycle) {
        this.spawnFootprint(s, x, y, facing, age);
      } else this.gpu.recordQualityDrop(GpuVfxEffectId.MovementFootprint);
      if (++track.contacts % 2 !== 0) return;
      track.dustCarry += this.gpu.quality.getEmissionFactor(GpuVfxEffectId.MovementWalkDust);
      if (track.dustCarry < 1) { this.gpu.recordQualityDrop(GpuVfxEffectId.MovementWalkDust); return; }
      track.dustCarry -= 1;
      this.spawnDust(s, x, y, heading, age, false, MOVEMENT_FX.walkDust.count, 1);
      return;
    }
    if (kind === 'dashTrail') {
      track.dashCarry += this.gpu.quality.getEmissionFactor(GpuVfxEffectId.MovementDashDust);
      if (track.dashCarry < 1) { this.gpu.recordQualityDrop(GpuVfxEffectId.MovementDashDust); return; }
      track.dashCarry -= 1;
      this.spawnDust(s, x, y, heading, age, true, MOVEMENT_FX.dashDust.trailCount, 1);
      return;
    }
    const dash = MOVEMENT_FX.dashDust;
    const count = kind === 'dashStart'
      ? (s.player ? dash.playerStartCount : dash.enemyStartCount)
      : (s.player ? dash.playerEndCount : dash.enemyEndCount);
    const scaled = this.gpu.quality.scaleDiscreteBurst(GpuVfxEffectId.MovementDashDust, count);
    if (scaled === 0) this.gpu.recordQualityDrop(GpuVfxEffectId.MovementDashDust);
    this.spawnDust(s, x, y, heading, age, true, scaled, kind === 'dashStart' ? 1.5 : kind === 'dashEnd' ? 0.8 : 1);
  };

  private spawnFootprint(s: MovementVisualSample, x: number, y: number, facing: number, age: number): void {
    if (!this.prints.canSpawn(s.player)) return;
    const spec = this.footprint;
    const tuning = MOVEMENT_FX.footprint;
    const size = Math.max(0.85, Math.min(1.5, Math.sqrt(s.size / 32)));
    spec.frame = PAW_FRAMES[s.footprint];
    spec.x = x; spec.y = y;
    spec.rotation = facing + Math.PI / 2 + (Math.random() - 0.5) * 0.13;
    spec.scaleStart = spec.scaleEnd = tuning.scale * size * (0.94 + Math.random() * 0.12);
    spec.alphaStart = tuning.alphaMin + Math.random() * (tuning.alphaMax - tuning.alphaMin); spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = mixColors(this.terrain?.sample(x, y) ?? 0x8c8874, tuning.ink, tuning.inkMix);
    spec.lifeMs = MOVEMENT_FX.footprintLifeMinMs + Math.random()
      * (MOVEMENT_FX.footprintLifeMaxMs - MOVEMENT_FX.footprintLifeMinMs);
    if (this.gpu.spawn(spec, this.footprintSource, this.now, age)) this.prints.record(this.now + spec.lifeMs - age);
  }

  private spawnDust(
    s: MovementVisualSample, x: number, y: number, heading: number, age: number,
    dash: boolean, count: number, strength: number,
  ): void {
    const spec = dash ? this.dashDust : this.walkDust;
    const tuning = dash ? MOVEMENT_FX.dashDust : MOVEMENT_FX.walkDust;
    const size = Math.max(0.85, Math.min(1.5, Math.sqrt(s.size / 32)));
    const nx = Math.cos(heading), ny = Math.sin(heading);
    const diameter = 18 * tuning.scale * size * strength;
    const ground = this.terrain?.sample(x, y) ?? 0xa69e87;
    const swirl = ++this.dustSequence % 2 === 0 ? -1 : 1;
    const groups = Math.ceil(count / DUST_COMPONENTS.length);
    for (let i = 0; i < count && this.dust.canSpawn(s.player); i++) {
      const componentIndex = i % DUST_COMPONENTS.length;
      const component = DUST_COMPONENTS[componentIndex];
      const grain = componentIndex === 2;
      const fan = ((Math.floor(i / DUST_COMPONENTS.length) + 0.5) / groups - 0.5) * (dash ? 1.65 : 1.9);
      const direction = heading + Math.PI + fan + swirl * component.side + (Math.random() - 0.5) * 0.3;
      const speed = (tuning.speedMin + Math.random() * (tuning.speedMax - tuning.speedMin)) * strength * component.speed;
      const lateral = diameter * (swirl * component.side * 0.3 + (Math.random() - 0.5) * 0.16);
      const along = (Math.random() - 0.5) * diameter * 0.25;
      spec.frame = grain ? DUST_GRAINS[Math.floor(Math.random() * DUST_GRAINS.length)] : component.frame;
      // Body, edge and grains peel away from the same contact at different speeds and offsets.
      spec.x = x - nx * s.size * 0.2 - ny * lateral + nx * along;
      spec.y = y - ny * s.size * 0.2 + nx * lateral + ny * along;
      spec.vx = Math.cos(direction) * speed; spec.vy = Math.sin(direction) * speed;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = direction + (Math.random() - 0.5) * 0.5;
      spec.angularVelocity = swirl * component.spin * (0.8 + Math.random() * 0.4);
      spec.rotationEase = GpuVfxEase.QuadOut;
      spec.scaleStart = size * tuning.scale * strength * component.scale * (0.82 + Math.random() * 0.36);
      spec.scaleEnd = spec.scaleStart * (1 + (MOVEMENT_FX.dustGrowth - 1) * component.expansion);
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = component.stretchStart; spec.stretchEnd = component.stretchEnd;
      spec.alphaStart = tuning.alpha * component.alpha * (s.player ? 1 : 0.9); spec.alphaEnd = 0;
      spec.alphaEase = component.fade;
      spec.tint = grain ? mixColors(ground, 0x6e604b, 0.35)
        : mixColors(ground, MOVEMENT_FX.dustTint, MOVEMENT_FX.dustTintMix + (Math.random() - 0.5) * 0.16);
      spec.lifeMs = (MOVEMENT_FX.dustLifeMinMs + Math.random() * (MOVEMENT_FX.dustLifeMaxMs - MOVEMENT_FX.dustLifeMinMs))
        * tuning.lifeFactor * component.life;
      if (this.gpu.spawn(spec, dash ? this.dashSource : this.walkSource, this.now, age)) {
        this.dust.record(this.now + spec.lifeMs - age);
      }
    }
  }

  clear(): void {
    this.tracks.clear(); this.players.length = this.enemies.length = 0;
    this.prints.clear(); this.dust.clear(); this.interruptions.clear();
    this.captured = false; this.current = null;
    this.dustSequence = 0;
    this.gpu.clearSource(this.footprintSource);
    this.gpu.clearSource(this.walkSource);
    this.gpu.clearSource(this.dashSource);
    this.generation = this.gpu.emissionGeneration;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.destroyed = true; this.world = null; this.terrain = null;
    this.gpu.releaseSource(this.footprintSource);
    this.gpu.releaseSource(this.walkSource);
    this.gpu.releaseSource(this.dashSource);
  }
}
