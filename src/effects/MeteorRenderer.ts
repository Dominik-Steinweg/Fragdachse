import type * as Phaser from 'phaser';
import type { SyncedMeteorStrike } from '../types';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx } from './camera/cameraFeedbackPresets';
import { MeteorGpuLayer } from './gpu/MeteorGpuLayer';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { ExplosionGpuRenderer } from './ExplosionGpuRenderer';
import type { LightingSystem } from './LightingSystem';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';

let nextRendererId = 0;
interface MeteorImpactVisual { x:number; y:number; radius:number; variant:'normal'|'void'; born:number; seed:number }

/** Snapshots own anticipation; the existing explosion RPC owns impact presentation.
 * Neither snapshot removal nor client wall time can create an explosion. */
export class MeteorRenderer {
  private readonly layer: MeteorGpuLayer;
  private readonly impacts: MeteorImpactVisual[] = [];
  private readonly lightKeys = new Set<string>();
  private readonly lightPrefix = `meteor-${nextRendererId++}-`;
  private impactSequence = 0;
  private cameraFeedback: CameraFeedbackController | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private explosion: ExplosionGpuRenderer | null = null;
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) { this.layer = new MeteorGpuLayer(scene); }
  registerGpuVfx(system: GpuVfxSystem): void { this.gpuVfx = system; }
  setImpactSystems(explosion: ExplosionGpuRenderer, lighting: LightingSystem): void {
    this.explosion = explosion; this.lighting = lighting;
  }
  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }

  /** Called once by the existing reliable explosion presentation event, including late observers.
   * The shared combat burst and its light are spawned by EffectSystem; this adds the meteor signature. */
  playImpact(x:number, y:number, radius:number, variant:'normal'|'void'='normal'):void {
    if (this.gpuVfx?.isSuppressed() || radius<=0) return;
    if (this.impacts.length===64) this.impacts.shift();
    this.impacts.push({x,y,radius,variant,born:this.scene.time.now,seed:(++this.impactSequence*37)%997});
    this.explosion?.spawnMeteorDebris(x,y,radius,variant);
    this.cameraFeedback?.request({channel:'impact',amplitudePx:legacyShakeAmplitudePx(Math.min(.007,.003*Math.sqrt(radius/60))),
      durationMs:310,priority:CAMERA_FEEDBACK_PRIORITY.mediumImpact,decay:'impulse',sourceX:x,sourceY:y});
  }

  sync(meteors: SyncedMeteorStrike[]): void {
    const now=Date.now(), camera=this.scene.cameras.main;
    const visible=(m:{x:number;y:number;radius:number})=>camera.worldView.contains(m.x,m.y)
      || (m.x+m.radius*4>=camera.worldView.x && m.x-m.radius*4<=camera.worldView.right
        && m.y+m.radius*4>=camera.worldView.y && m.y-m.radius*4<=camera.worldView.bottom);
    const suppressed=this.gpuVfx?.isSuppressed()??false;
    const nextLights=new Set<string>();
    const lightLimit=getGraphicsQualityProfile(this.scene).level==='low'?4:12;
    this.layer.begin();
    // Reserve batch space for the actual impact, then admit decorative anticipation.
    for(let i=this.impacts.length-1;i>=0;i--) {
      const m=this.impacts[i],age=(this.scene.time.now-m.born)/1000;
      if(age>=7) {this.impacts.splice(i,1);continue;}
      if(suppressed || !visible(m))continue;
      this.layer.add({x:m.x,y:m.y,radius:m.radius,progress:1,seed:m.seed,void:m.variant==='void',age});
      if(age>.25 && age<4 && nextLights.size<lightLimit) {
        const key=this.lightPrefix+'impact-'+m.seed;
        nextLights.add(key);
        this.lighting?.setLight(key,'explosion',m.x,m.y,{radiusPx:m.radius*1.3,color:m.variant==='void'?0x9344ec:0xff7328,
          intensity:.32*(1-age/4),occludes:false});
      }
    }
    for(const m of meteors) {
      if(suppressed || !visible(m))continue;
      const progress=Math.max(0,Math.min(1,(now-m.spawnedAt)/Math.max(1,m.impactAt-m.spawnedAt)));
      this.layer.add({x:m.x,y:m.y,radius:m.radius,progress,seed:(Math.imul(m.id+1,2654435761)>>>0)%997,void:m.variant==='void',age:-1});
      if(progress>.15 && nextLights.size<lightLimit) {
        const key=this.lightPrefix+'warning-'+m.id;
        nextLights.add(key);
        this.lighting?.setLight(key,'explosion',m.x,m.y,{radiusPx:m.radius*(1.2-.55*progress),
          color:m.variant==='void'?0x964cda:0xffbd75,intensity:.045+.22*progress*progress,occludes:false});
      }
    }
    for(const key of this.lightKeys) if(!nextLights.has(key)) this.lighting?.releaseLight(key,{immediate:true});
    this.lightKeys.clear();for(const key of nextLights)this.lightKeys.add(key);
    this.layer.flush();
  }
  clear(): void {
    this.impacts.length=0;this.layer.clear();
    for(const key of this.lightKeys)this.lighting?.releaseLight(key,{immediate:true});
    this.lightKeys.clear();
  }
  destroy(): void { this.clear(); this.layer.destroy(); }
}
