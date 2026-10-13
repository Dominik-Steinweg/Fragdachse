import type * as Phaser from 'phaser';
import { RuntimeFrameProbe } from '../../scenes/arena/RuntimeFrameProbe';
import { RuntimeRenderCounters } from '../../scenes/arena/RuntimeRenderCounters';
import { FogGpuTimer } from '../../effects/groundFog/FogGpuTimer';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { ScenarioClock } from './clock';

/** Dev-only capture. Fixed simulation steps; real callback/RAF durations. No readbacks. */
export class KrakenPerformanceMeasurement {
  private probe: RuntimeFrameProbe | null = null;
  private counters: RuntimeRenderCounters | null = null;
  private timer: FogGpuTimer | null = null;
  private restores: (() => void)[] = [];
  readonly frames: Record<string, unknown>[] = [];
  private phase = '';
  private previous = 0;
  private previousSimulation = -1;
  private switches = 0;
  private compiles = 0;
  private compileMs = 0;
  private shaderPrograms: string[] = [];
  private glStatus = { framebufferStatusCalls: 0, framebufferStatusMs: 0, programStatusCalls: 0, programStatusMs: 0, framebufferCreates: 0 };
  private gpuSample = 0;
  private program: WebGLProgram | null = null;
  private measuring = false;
  constructor(private readonly scene: Phaser.Scene, private readonly runtime: ArenaRuntime, private readonly clock: ScenarioClock) {}

  start(phase: string): void {
    this.stop(); this.frames.length = 0; this.phase = phase;
    this.previous = 0; this.previousSimulation = -1; this.gpuSample = 0;
    const gl = (this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
    this.counters = new RuntimeRenderCounters(gl);
    this.timer = new FogGpuTimer(gl);
    const hook = (key: 'useProgram' | 'compileShader' | 'linkProgram') => {
      const original = gl[key], own = Object.prototype.hasOwnProperty.call(gl, key), self = this;
      const wrapped = function(this: WebGLRenderingContext, arg: never) {
        const start = key === 'useProgram' ? 0 : performance.now();
        try { return (original as (arg: never) => void).call(this, arg); }
        finally {
          if (self.measuring) {
            if (key === 'useProgram') { if (self.program !== arg) self.switches++; self.program = arg; }
            else { self.compiles++; self.compileMs += performance.now() - start; }
          }
        }
      };
      (gl[key] as unknown) = wrapped;
      this.restores.push(() => { if (gl[key] === wrapped) { if (own) (gl[key] as unknown) = original; else delete (gl as unknown as Record<string, unknown>)[key]; } });
    };
    hook('useProgram'); hook('compileShader'); hook('linkProgram');
    const factory = (this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).shaderProgramFactory;
    const getProgram = factory.getShaderProgram, hadOwnProgram = Object.prototype.hasOwnProperty.call(factory, 'getShaderProgram'), self = this;
    const wrappedProgram: typeof getProgram = function(this: typeof factory, base, additions, features) {
      const key = this.getKey(base, additions, features);
      if (self.measuring && !this.has(key)) self.shaderPrograms.push(key);
      return getProgram.call(this, base, additions, features);
    };
    factory.getShaderProgram = wrappedProgram;
    this.restores.push(() => { if (factory.getShaderProgram === wrappedProgram) {
      if (hadOwnProgram) factory.getShaderProgram = getProgram; else Reflect.deleteProperty(factory, 'getShaderProgram');
    } });
    for (const key of ['checkFramebufferStatus', 'getProgramParameter', 'createFramebuffer'] as const) {
      const original = gl[key], own = Object.prototype.hasOwnProperty.call(gl, key), self = this;
      const wrapped = function(this: WebGLRenderingContext, ...args: unknown[]) {
        const start = performance.now();
        try { return Reflect.apply(original, this, args); }
        finally { if (self.measuring) {
          if (key === 'createFramebuffer') self.glStatus.framebufferCreates++;
          else if (key === 'checkFramebufferStatus') { self.glStatus.framebufferStatusCalls++; self.glStatus.framebufferStatusMs += performance.now() - start; }
          else { self.glStatus.programStatusCalls++; self.glStatus.programStatusMs += performance.now() - start; }
        } }
      };
      (gl[key] as unknown) = wrapped;
      this.restores.push(() => { if (gl[key] === wrapped) { if (own) (gl[key] as unknown) = original; else Reflect.deleteProperty(gl, key); } });
    }
    let id = 0;
    this.probe = new RuntimeFrameProbe(0, this.scene.game.loop, () => {
      this.measuring = this.clock.pendingSteps > 0 || !this.clock.paused;
      this.switches = this.compiles = this.compileMs = 0;
      this.shaderPrograms = [];
      for (const key of Object.keys(this.glStatus) as (keyof typeof this.glStatus)[]) this.glStatus[key] = 0;
      this.counters!.reset();
      if (this.measuring) this.timer!.begin();
      return ++id;
    }, work => {
      if (!this.measuring) { this.previous = 0; return; }
      this.timer!.end();
      this.measuring = false;
      const simulation = this.clock.now;
      if (simulation === this.previousSimulation) { this.previous = 0; return; }
      this.previousSimulation = simulation;
      const residency = this.runtime.getScenarioKrakenResidency();
      const state = residency?.state;
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      this.frames.push({ phase: this.phase, atMs: work.fromMs, simulationMs: simulation,
        frameMs: this.previous ? work.fromMs - this.previous : null, cpuMs: work.toMs - work.fromMs,
        gpuMs: this.timer!.sample !== this.gpuSample ? this.timer!.ms : null,
        ...this.counters!.snapshot(), switches: this.switches, shaderCompileLinkCalls: this.compiles, shaderCompileLinkMs: this.compileMs,
        ...this.glStatus,
        shaderPrograms: this.shaderPrograms,
        heapBytes: memory?.usedJSHeapSize ?? null, residentBytes: residency ? residency.atlasBytes + residency.rendererBytes : null,
        cpuMeshBytes: residency?.cpuMeshBytes ?? null, hostPhase: state?.phase.kind ?? null,
        bodyX: residency?.hostPosition?.x ?? null, bodyY: residency?.hostPosition?.y ?? null,
        enemies: this.runtime.getEnemyCount(), hatching: state?.eggs.filter(egg => egg.status === 'hatching').length ?? 0,
        action: state?.bodyAction?.kind ?? null, tentacles: state?.tentacles.length ?? 0, eggs: state?.eggs.length ?? 0,
        spines: state?.spines.length ?? 0, ink: state?.inkClouds.length ?? 0,
        spans: work.spans, errors: residency?.errors ?? [] });
      this.gpuSample = this.timer!.sample; this.previous = work.fromMs;
      if (this.frames.length >= 36000) this.stop();
    });
    this.probe.scene(this.scene);
    this.probe.scope(this.scene, 'update', 'arenaUpdate');
    this.probe.scope(this.scene.game.renderer, 'render', 'renderSubmit');
  }
  stop(): void {
    this.probe?.stop(); this.probe = null;
    this.timer?.destroy(); this.timer = null;
    this.counters?.stop(); this.counters = null;
    for (const restore of this.restores.reverse()) restore(); this.restores = [];
  }
  read() { return { phase: this.phase, active: this.probe !== null, frames: this.frames }; }
}
