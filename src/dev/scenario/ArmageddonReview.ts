import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import { MeteorRenderer } from '../../effects/MeteorRenderer';
import { getGraphicsQualityController } from '../../graphics/GraphicsQuality';
import type { GraphicsQuality } from '../../graphics/GraphicsQuality';
import { FogGpuTimer } from '../../effects/groundFog/FogGpuTimer';

/** Isolated presentation stress fixture, not a gameplay/host action. The ultimate command
 * remains the end-to-end test for damage, replicated explosions and burning chunks. */
export class ArmageddonReview {
  private readonly renderer: MeteorRenderer;
  private readonly cpu: number[]=[];
  private readonly frames: number[]=[];
  private readonly gpu: number[]=[];
  private readonly timer: FogGpuTimer;
  private lastFrame=0;
  private lastGpuSample=0;
  private lastBurst=-Infinity;
  private readonly started:number;
  private readonly quality:GraphicsQuality;
  constructor(private readonly scene:Phaser.Scene,private readonly runtime:ArenaRuntime,
    private readonly options:{count:number;x:number;y:number;progress:number;quality:GraphicsQuality;impacts:boolean;singleImpact?:boolean;variant:'normal'|'void'}) {
    const controller=getGraphicsQualityController(scene);
    this.quality=controller?.getProfile().level??'high';controller?.setLevel(options.quality);
    this.renderer=new MeteorRenderer(scene);this.renderer.registerGpuVfx(runtime.getScenarioMeteorTargets().gpuVfx);
    const targets=runtime.getScenarioMeteorTargets();this.renderer.setImpactSystems(targets.explosion,targets.lighting);
    targets.gpuVfx.resetProfiling();
    this.started=scene.time.now;
    this.timer=new FogGpuTimer((scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl);
    scene.events.on('postupdate',this.update,this);
    scene.game.events.on('prerender',this.beforeRender,this);
    scene.game.events.on('postrender',this.afterRender,this);
  }
  private beforeRender():void {this.timer.begin();}
  private afterRender():void {
    this.timer.end();this.timer.poll();
    if(this.timer.sample!==this.lastGpuSample && this.timer.ms!==null){
      this.lastGpuSample=this.timer.sample;
      if(this.gpu.length<900)this.gpu.push(this.timer.ms);
    }
    const now=performance.now();
    if(this.lastFrame && this.frames.length<900)this.frames.push(now-this.lastFrame);
    this.lastFrame=now;
  }
  private update():void {
    const {count,x,y,progress,variant,impacts}=this.options;
    const now=Date.now(), cols=Math.ceil(Math.sqrt(count)), spacing=count>16?42:130;
    const age=this.scene.time.now-this.started, phase=impacts?(age%1800)/1800:progress;
    const meteors=Array.from({length:count},(_,i)=>({id:i,x:x+(i%cols-(cols-1)/2)*spacing,
      y:y+(Math.floor(i/cols)-(cols-1)/2)*spacing,radius:60,spawnedAt:now-phase*1600,impactAt:now+(1-phase)*1600,ownerId:'review',variant}));
    const start=performance.now();
    if((this.options.singleImpact && this.lastBurst===-Infinity) || (!this.options.singleImpact && impacts && age-this.lastBurst>=1800)) {
      this.lastBurst=age;
      for(const m of meteors)this.renderer.playImpact(m.x,m.y,m.radius,variant);
    }
    this.renderer.sync(this.options.singleImpact?[]:meteors,Date.now());
    if(this.cpu.length<900)this.cpu.push(performance.now()-start);
  }
  status(){
    const summary=(values:number[])=>{const sorted=values.slice(30).sort((a,b)=>a-b);return {samples:sorted.length,
      median:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.floor(sorted.length*.95)]??null,max:sorted[sorted.length-1]??null};};
    return {options:this.options,cpuMs:summary(this.cpu),frameMs:summary(this.frames),gpuMs:summary(this.gpu),
      gpuTimerSupported:this.timer.supported,pools:this.runtime.getScenarioMeteorTargets().gpuVfx.getStats()};
  }
  destroy():void {
    this.scene.events.off('postupdate',this.update,this);
    this.scene.game.events.off('prerender',this.beforeRender,this);this.scene.game.events.off('postrender',this.afterRender,this);
    this.timer.destroy();this.renderer.destroy();getGraphicsQualityController(this.scene)?.setLevel(this.quality);
  }
}
