import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { DEFAULT_FOG_STRENGTH } from '../../config/groundFog';
import type { WaterCell, ExplosionVisualStyle } from '../../types';
import { createMovementVisualSample, type MovementVisualSource } from '../MovementStepSampler';
import type { ProjectileTrailSegment } from '../../projectile/ProjectileFlightPath';
import { FOG, fogDensityAt, fogTuning, type FogDebug, type FogFrame, type FogQuality, type FogRect, type FogTuning } from './FogConfig';
import { FogTerrainModel } from './FogTerrainModel';
import { FogGpuField } from './FogGpuField';
import { FogImpulses } from './FogImpulses';
import { FogGpuTimer } from './FogGpuTimer';

interface Motion { id: string; x: number; y: number; revision: number; frame: number }
export interface FogDiagnostics {
  status: string; cpuMs: number; activeChunks: number; cachedChunks: number; bytes: number;
  pendingImpulses: number; submittedImpulses: number; droppedImpulses: number; steps: number;
  gpuMs: number | null; gpuSample: number;
}

/** One local World's cosmetic state. No global clock, gameplay writes, or network messages. */
export class GroundFogSystem {
  readonly terrain: FogTerrainModel;
  readonly impulses = new FogImpulses();
  tuning: FogTuning;
  debug: FogDebug = 'normal';
  reactions = true;
  quality: FogQuality = 'high';
  strength: number;
  enabled = true;
  measureGpu = false;
  private timer: FogGpuTimer | null = null;
  private surfaces: readonly Phaser.GameObjects.Image[] = [];
  private gpu: FogGpuField | null = null;
  private accumulator = 0;
  private elapsed = 0;
  private density: readonly [number, number] | null = null;
  private readonly tracks = new Map<MovementVisualSource, Motion>();
  private readonly sample = createMovementVisualSample();
  private motionFrame = 0;
  private destroyed = false;
  private failed = '';
  private stats: FogDiagnostics = { status: 'preparing', cpuMs: 0, activeChunks: 0, cachedChunks: 0, bytes: 0,
    pendingImpulses: 0, submittedImpulses: 0, droppedImpulses: 0, steps: 0, gpuMs: null, gpuSample: 0 };
  private readonly onContextRestore = (): void => { this.releaseGpu(); this.failed = ''; this.stats.status = 'preparing'; };
  constructor(private readonly scene: Phaser.Scene, readonly frame: FogFrame, readonly seed: number,
    water: readonly WaterCell[], strength = DEFAULT_FOG_STRENGTH) {
    this.terrain = new FogTerrainModel(frame, water); this.strength = strength; this.tuning = fogTuning(seed);
    scene.sys.renderer?.on('restorewebgl', this.onContextRestore);
  }
  private get active(): boolean { return !this.destroyed && this.enabled && this.strength > 0 && !this.failed; }
  addExplosion(x: number, y: number, radius: number, style: ExplosionVisualStyle = 'default'): void {
    if (!this.active || !this.reactions) return;
    const scale = ['mini_rocket', 'mini_rocket_cascade', 'he_cluster_shard', 'he_demolition_shard', 'timebomb_pop'].includes(style) ? .6
      : style === 'nuke' || style === 'void_nuke' ? 1.15 : 1;
    this.impulses.add({ x, y, endX: x, endY: y, radius: radius * 1.3, strength: Math.min(.95, (.4 + radius / 500) * scale), kind: 'explosion', priority: 100 + radius });
  }
  addProjectile(segment: ProjectileTrailSegment, size: number, style: string): void {
    if (!this.active || !this.reactions || this.quality === 'low' || segment.ageMs > 220 || segment.to.breakBefore) return;
    const large = ['rocket', 'fireball', 'plasma', 'bfg', 'energy_ball', 'hydra'].includes(style);
    const { from, to } = segment;
    if (!Number.isFinite(from.x + from.y + to.x + to.y) || from === to) return;
    this.impulses.add({ x: from.x, y: from.y, endX: to.x, endY: to.y,
      radius: large ? Math.max(9, Math.min(28, size * 1.1)) : 4,
      strength: large ? .36 : .13, kind: 'projectile', priority: large ? 55 : 10 });
  }
  captureMotion(delta: number, players: readonly MovementVisualSource[], enemies: readonly MovementVisualSource[], view: FogRect): void {
    if (!this.active || !this.reactions || delta <= 0 || delta > 150) { this.tracks.clear(); return; }
    this.motionFrame++;
    const capture = (source: MovementVisualSource, player: boolean): void => {
      source.readMovementVisualSample(this.sample); const s = this.sample;
      if (!s.visible || s.isBurrowDash || !Number.isFinite(s.x + s.y + s.size)
        || s.x < view.x - 128 || s.y < view.y - 128 || s.x > view.x + view.width + 128 || s.y > view.y + view.height + 128) {
        this.tracks.delete(source); return;
      }
      const before = this.tracks.get(source), distance = before ? Math.hypot(s.x - before.x, s.y - before.y) : 0;
      if (before && before.id === s.id && before.revision === s.revision && distance > .08
        && distance < Math.max(s.size * 4, delta * (s.mode === 'dash' ? 2.8 : 1))) {
        const speed = distance / delta * 1000;
        this.impulses.add({ x: before.x, y: before.y, endX: s.x, endY: s.y, radius: Math.max(10, s.size * .55),
          strength: Math.min(.5, distance / Math.max(24, s.size) * (.1 + speed / 1700)),
          kind: 'motion', priority: player ? 90 : 40 + Math.min(30, s.size / 4) });
      }
      if (before) { before.id = s.id; before.x = s.x; before.y = s.y; before.revision = s.revision; before.frame = this.motionFrame; }
      else this.tracks.set(source, { id: s.id, x: s.x, y: s.y, revision: s.revision, frame: this.motionFrame });
    };
    for (const p of players) capture(p, true);
    if (this.quality !== 'low') for (const e of enemies) capture(e, false);
    for (const [key, track] of this.tracks) if (track.frame !== this.motionFrame) this.tracks.delete(key);
  }
  update(delta: number, minutes: number, view: FogRect, visible = true): void {
    const start = performance.now(); this.stats.steps = 0;
    if (!this.active) { this.releaseGpu(); this.stats.status = this.failed || 'off'; this.stats.cpuMs = performance.now() - start; return; }
    if (!visible) { this.gpu?.hide(); this.impulses.clear(); this.tracks.clear(); return; }
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (!renderer?.gl || typeof Phaser.GameObjects?.Shader !== 'function') { this.failed = this.stats.status = 'WebGL unavailable'; return; }
    try {
      if (!this.gpu) this.gpu = new FogGpuField(this.scene, this.terrain, this.seed, this.tuning, DEPTH.GROUND_FOG);
      if (this.measureGpu) { this.timer ??= new FogGpuTimer(renderer.gl); this.timer.begin(); }
      // Geometry is accepted even when simulation is paused. New slots initialize once below.
      this.gpu.prepare(view, this.elapsed);
      const target = fogDensityAt(minutes).map(x => x * this.strength * FOG.densityScale) as [number, number];
      if (!this.density) this.density = target;
      if (delta > 150) { this.impulses.clear(); this.tracks.clear(); }
      const dt = Math.max(0, Math.min(delta, FOG.stepMs * FOG.maxSteps));
      const blend = 1 - Math.exp(-dt / 1500);
      this.density = [this.density[0] + (target[0] - this.density[0]) * blend, this.density[1] + (target[1] - this.density[1]) * blend];
      this.accumulator = Math.min(FOG.stepMs * FOG.maxSteps, this.accumulator + dt);
      const fresh = [...this.gpu.residency.chunks.values()].some(c => c.active && c.fresh);
      if (fresh && this.accumulator < FOG.stepMs) this.accumulator = FOG.stepMs;
      while (this.accumulator >= FOG.stepMs && this.stats.steps < FOG.maxSteps) {
        if (delta > 0) this.elapsed += FOG.stepMs;
        this.accumulator -= FOG.stepMs;
        const expanded = { x: view.x - FOG.margin, y: view.y - FOG.margin, width: view.width + FOG.margin * 2, height: view.height + FOG.margin * 2 };
        this.gpu.step(delta > 0 ? this.impulses.drain(this.quality, expanded) : [], this.density, this.tuning, this.elapsed, delta <= 0); this.stats.steps++;
      }
      const camera = this.scene.cameras.main, scale = this.quality === 'low' ? .25 : .5;
      const margin = FOG.materialMargin / camera.zoom;
      const output = { x: view.x - margin, y: view.y - margin, width: view.width + margin * 2, height: view.height + margin * 2 };
      this.gpu.render(output, (camera.width + FOG.materialMargin * 2) * scale,
        (camera.height + FOG.materialMargin * 2) * scale, this.debug, this.accumulator / FOG.stepMs, this.surfaces, this.quality);
      this.timer?.end(); this.stats.gpuMs = this.timer?.ms ?? null; this.stats.gpuSample = this.timer?.sample ?? 0;
      const active = [...this.gpu.residency.chunks.values()].filter(c => c.active).length;
      Object.assign(this.stats, { status: this.gpu.residency.overflow ? 'view capacity exceeded' : 'ready',
        activeChunks: active, cachedChunks: this.gpu.residency.chunks.size - active, bytes: this.gpu.bytes,
        submittedImpulses: this.gpu.submitted, droppedImpulses: this.impulses.dropped + this.gpu.dropped + this.gpu.trails.dropped, pendingImpulses: this.impulses.size });
    } catch (error) {
      this.timer?.end();
      this.failed = `Fog unavailable: ${error instanceof Error ? error.message : String(error)}`;
      console.warn('[GroundFogSystem]', this.failed); this.releaseGpu(); this.stats.status = this.failed;
    }
    this.stats.cpuMs = performance.now() - start;
  }
  readDensity(x: number, y: number): { density: number; reached: boolean } { return this.gpu?.readDensity(x, y) ?? { density: 0, reached: false }; }
  getDiagnostics(): Readonly<FogDiagnostics> { return this.stats; }
  setSurfaceImages(images: readonly Phaser.GameObjects.Image[]): void { this.surfaces = images; }
  prepare(minutes: number, view: FogRect): boolean {
    if (this.stats.status === 'preparing') { this.update(0, minutes, view); this.gpu?.hide(); }
    return this.stats.status !== 'preparing';
  }
  freeze(): void { this.impulses.clear(); this.tracks.clear(); }
  private releaseGpu(): void {
    this.gpu?.destroy(); this.gpu = null; this.accumulator = 0; this.impulses.clear(); this.tracks.clear();
    this.timer?.destroy(); this.timer = null; this.stats.gpuMs = null;
    this.stats.activeChunks = this.stats.cachedChunks = this.stats.bytes = this.stats.pendingImpulses = this.stats.submittedImpulses = 0;
  }
  destroy(): void {
    if (this.destroyed) return; this.destroyed = true;
    this.scene.sys.renderer?.off('restorewebgl', this.onContextRestore); this.releaseGpu(); this.terrain.clear(); this.surfaces = [];
  }
}
