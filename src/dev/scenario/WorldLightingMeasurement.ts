import { WOODLAND_ROCK_COLOUR_KEY, WOODLAND_ROCK_HEIGHT_KEY } from '../../assets/WoodlandAssetManifest';
import { createSunTuning } from '../../effects/sunlight/SunAtmosphere';
import { ROCK_ECOLOGY_ATLASES } from '../../arena/rocks/RockEcologyAssets';
import { CANOPY_ATLASES } from '../../arena/trees/CanopyAssets';
import { WOODLAND_ATLASES } from '../../arena/WoodlandEcologyField';
import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import { RuntimeRenderCounters } from '../../scenes/arena/RuntimeRenderCounters';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';

type Targets = ReturnType<ArenaRuntime['getScenarioLightingTargets']>;
export interface WorldLightingWorkload {
  mode: 'destruction' | 'explosion' | 'traverse' | 'walk';
  durationMs: number;
  start(): unknown;
  advance(elapsedMs: number): void;
  restore(): void;
  pending?(): boolean;
}

/** Debug measurement and local tuning; production owns the render graph. */
export class WorldLightingMeasurement {
 private disposed=false;
 private tunedOwner:ReturnType<ArenaRuntime['getScenarioLightingTargets']>['sunlight']=null;
 private lastMinute=480;
 private cancelMeasurement:(()=>void)|null=null;
 measurement:Record<string,unknown>|null=null;
 private readonly fallbackTuning=createSunTuning();
 constructor(private readonly scene:Phaser.Scene,private readonly targets:()=>Targets){}
 get sunTuning(){return this.targets().sunlight?.sunTuning??this.fallbackTuning;}
 get clouds(){return this.targets().sunlight?.clouds;}
 get sunStatus(){return this.targets().sunlight?.sunStatus??null;}
 get presentationMinute(){return this.targets().sunlight?.presentationMinute??this.lastMinute;}
 private get vegetationTarget(){return this.targets().ground;}
 private get sunComposite(){const owner=this.targets().sunlight;return owner?{diagnostics:owner.diagnostics}:null;}
 private get woodland(){return {count:this.targets().sunlight?.woodlandCount??0};}

 update(minutes:number,_sceneTimeMs=0):void{if(!this.disposed)this.lastMinute=minutes;}
 tuneSun(values:unknown,reset=false):void{if(!this.disposed){this.cancelMeasurement?.();this.tunedOwner=this.targets().sunlight;this.tunedOwner?.tuneSun(values,reset);}}
 reset():void{this.cancelMeasurement?.();this.tunedOwner?.tuneSun({},true);this.tunedOwner=null;}
 destroy():void{if(this.disposed)return;this.reset();this.disposed=true;}
  stopMeasurement(): void { this.cancelMeasurement?.(); }

  measure(workload?: WorldLightingWorkload): void {
    this.cancelMeasurement?.();
    const renderer = this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (!renderer.gl) throw new Error('Messung benötigt WebGL.');
    const counters = new RuntimeRenderCounters(renderer.gl), camera = this.scene.cameras.main;
    const signature = () => JSON.stringify([this.lastMinute, this.sunTuning, workload?null:camera.scrollX, workload?null:camera.scrollY,
      camera.zoom, this.scene.game.canvas.width, this.scene.game.canvas.height, getGraphicsQualityProfile(this.scene).level]);
    const initial = signature(), frames: number[] = [], draws: number[] = [], offscreen: number[] = [];
    const uploaded = () => this.targets().rocks?.getGpuDiagnostics()?.estimatedUploadBytes ?? 0;
    let started = performance.now(), previous = started, initialUpload = uploaded();
    let initialFormationUpload = this.targets().rocks?.getFormationDiagnostics()?.uploadBytes ?? 0;
    let initialBuilds=0,initialWorkerMs=0,initialErase=0,initialEvictions=0;
    let previousPresentationCpuMs=0;
    const presentationFrameCpuMs:number[]=[];
    let recordingAt:number|null=null,settleAt:number|null=null,quietSince:number|null=null,workloadResult:unknown=null;
    const requestedAt=started;
    this.measurement = { status: 'warming' };
    const stop = () => {
      this.scene.game.events.off('prerender', before); this.scene.game.events.off('postrender', after);
      counters.stop(); this.cancelMeasurement = null;
      workload?.restore();
    };
    const before = () => counters.reset();
    const after = () => {
      const now = performance.now(), delta = now - previous; previous = now;
      if (signature() !== initial) { this.cancelMeasurement?.(); return; }
      const formation = this.targets().rocks?.getFormationDiagnostics();
      const pending=Boolean(formation?.pendingChunks||this.vegetationTarget?.getVegetationStats()?.pending||workload?.pending?.());
      if (formation?.error || formation?.overflow) {
        this.measurement = { status: 'failed', reason: formation.error ?? 'Sichtbereich überschreitet die Kapazität der Formationsprobe.' };
        stop(); return;
      }
      if(recordingAt===null) {
        if(now-requestedAt>60000) {this.measurement={status:'failed',reason:'Warmup did not settle within 60 seconds.'};stop();return;}
        if (pending) started = now;
        if (now - started < 2000) { initialUpload = uploaded(); initialFormationUpload = formation?.uploadBytes ?? 0; return; }
        recordingAt=now;initialUpload=uploaded();initialFormationUpload=formation?.uploadBytes??0;
        initialBuilds=formation?.builds??0;initialWorkerMs=formation?.workerBuildMs??0;
        initialErase=formation?.eraseUploadBytes??0;initialEvictions=formation?.residentEvictions??0;
        previousPresentationCpuMs=formation?.presentationCpuMs??0;
        this.measurement={status:'recording',mode:workload?.mode??'stationary'};
        if(workload) {
          try {workloadResult=workload.start();} catch(error) {this.measurement={status:'failed',reason:String(error)};stop();}
          return; // First recorded interval includes all work done by start().
        }
      }
      const counts = counters.snapshot(); frames.push(delta);
      const cpu=formation?.presentationCpuMs??0;
      presentationFrameCpuMs.push(Math.max(0,cpu-previousPresentationCpuMs));previousPresentationCpuMs=cpu;
      if (counts.drawCalls !== null) draws.push(counts.drawCalls);
      if (counts.offscreenDrawCalls !== null) offscreen.push(counts.offscreenDrawCalls);
      const elapsed=now-recordingAt;
      if(workload) {
        try {workload.advance(Math.min(elapsed,workload.durationMs));} catch(error) {this.measurement={status:'failed',reason:String(error)};stop();return;}
        if(pending||(workload.mode!=='destruction'&&workload.mode!=='explosion'&&elapsed<workload.durationMs)) {quietSince=null;settleAt=null;}
        else {
          quietSince??=now;
          if(now-quietSince>=200)settleAt??=quietSince-recordingAt;
        }
        if(elapsed<workload.durationMs||((settleAt===null||frames.length<180)&&elapsed<workload.durationMs+20000))return;
      } else if (frames.length < 180) return;
      const summary = (values: number[]) => {
        if (!values.length) return null;
        const sorted = values.slice().sort((a, b) => a - b);
        return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max:sorted[sorted.length-1] };
      };
      const mineralColour = this.scene.textures.exists(WOODLAND_ROCK_COLOUR_KEY) ? this.scene.textures.get(WOODLAND_ROCK_COLOUR_KEY).source[0] : null;
      const mineralBytes = (mineralColour ? mineralColour.width * mineralColour.height * 4 : 0)
        + (this.scene.textures.exists(WOODLAND_ROCK_HEIGHT_KEY) ? 512*512*4 : 0);
      this.measurement = { status: workload&&(settleAt===null||frames.length<180)?'failed':'complete', mode:workload?.mode??'stationary',
        reason:workload&&settleAt===null?'Streaming work did not settle within the recorded 20-second tail.':
          workload&&frames.length<180?'Fewer than 180 rendered frames were observed before the recording deadline.':null,
        view: JSON.parse(initial), warmupMs: 2000, samples: frames.length, recordedMs:elapsed,
        workload:workloadResult, workloadDurationMs:workload?.durationMs??null, settleTimeMs:workload?settleAt:null,
        postWorkSettleMs:workload&&settleAt!==null?Math.max(0,settleAt-(workload.mode!=='destruction'&&workload.mode!=='explosion'?workload.durationMs:0)):null,
        framesOver16_7Ms:frames.filter(ms=>ms>16.7).length,framesOver33_3Ms:frames.filter(ms=>ms>33.3).length,
        formationBuilds:(formation?.builds??0)-initialBuilds, workerBuildMs:(formation?.workerBuildMs??0)-initialWorkerMs,
        eraseUploadBytes:(formation?.eraseUploadBytes??0)-initialErase,residentEvictions:(formation?.residentEvictions??0)-initialEvictions,
        frameIntervalMs: summary(frames), drawCalls: summary(draws), offscreenDrawCalls: summary(offscreen),
        rockPresentationFrameCpuMs: summary(presentationFrameCpuMs), rawRockPresentationFrameCpuMs: presentationFrameCpuMs,
        rockRepair: formation ? {path:formation.repairPath,latencyFrames:formation.repairLatencyFrames,
          latencyMs:formation.repairLatencyMs,gpu:formation.gpuRepair} : null,
        rockPresentationCpuScope: 'RockVisualSystem.flush: dirty renderer updates, formation invalidation and texture publication; excludes worker CPU, GPU execution and other chunk bakes.',
        rockGeometryUploadBytes: uploaded() - initialUpload,
        mineralColourSize: mineralColour ? [mineralColour.width, mineralColour.height] : null,
        mineralColourScale: mineralColour ? mineralColour.width / 2176 : null,
        mineralTextureRGBABytes: mineralBytes,
        canopyTextureRGBABytes: CANOPY_ATLASES.reduce((bytes,a)=>bytes+(this.scene.textures.exists(a.key)?a.rgbaBytes:0),0),
        ecologyTextureRGBABytes: [...ROCK_ECOLOGY_ATLASES,...WOODLAND_ATLASES].reduce((bytes,a)=>bytes+(this.scene.textures.exists(a.key)?a.rgbaBytes:0),0),
        woodlandSprites: this.woodland?.count??0,
        formation: this.targets().rocks?.getFormationDiagnostics() ?? null,
        formationUploadBytes: (formation?.uploadBytes ?? 0) - initialFormationUpload,
        vegetation:this.vegetationTarget ? {...this.vegetationTarget.getVegetationStats()} : null,
        sunRendering:this.sunComposite?.diagnostics??null,graphicsQuality:getGraphicsQualityProfile(this.scene).level,
        gpuTimeMs: null, note: 'Wall-clock intervals incl. browser scheduling; not GPU time.', rawFrameIntervalsMs: frames };
      stop();
    };
    this.cancelMeasurement = () => { this.measurement = { status: 'cancelled' }; stop(); };
    this.scene.game.events.on('prerender', before); this.scene.game.events.on('postrender', after);
  }
}
