import { loadingTimeline } from '../../diagnostics/LoadingTimeline';
import { WOODLAND_ROCK_COLOUR_KEY, WOODLAND_TRANSMISSION_KEY } from '../../assets/WoodlandAssetManifest';
import { WOODLAND_ROCK_COVERAGE_KEY, WOODLAND_ROCK_HEIGHT_KEY } from '../../assets/WoodlandAssetManifest';
import { quantizeSunAzimuth } from '../../effects/sunlight/SunPath';
import type { RockRimGeometry } from './RockRimGeometry';
import { packPreviousHorizons } from './FormationHorizonTransition';
import { setCloudUniforms } from '../../effects/sunlight/cloudShadow';
import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import type { RockWorldFrame } from '../ArenaBuilder';
import type { ChunkWorldRect } from '../chunks/ArenaChunkGrid';
import type { RockVisualState } from './RockVisualState';
import { type RockLightingState } from './RockLightingState';
import { FORMATION, FORMATION_SIDE, type FormationRock } from './RockFormationField';
import type { FormationWorkerRequest, FormationWorkerResult, FormationWorkerInitialized, FormationWorkerRepair } from './RockFormationWorker';
import { formationSurfaceFactor, ROCK_FORMATION_FRAGMENT } from './rockFormationShader';
import type { FormationReceiverBinding } from './RockFoliageLighting';
import { RockFormationGpuRepair } from './RockFormationGpuRepair';

/** Borrowed geometry and optical inputs; consumers never own or retune these textures. */
export type FormationCoverageBinding = Pick<FormationReceiverBinding, 'field' | 'lookup' | 'frame'> & {
  /** Optional optical data; valid under the same geometry/repair barrier as coverage. */
  fogShadows?: {
    occlusion: Phaser.Textures.Texture;
    horizonPrevious?: Phaser.Textures.Texture;
    horizonBlend: Float32Array;
    sun: [number, number, number];
    strength: number;
    solarEnabled: boolean;
  };
};

let nextId = 0;

class FormationDataTexture {
  readonly texture: Phaser.Textures.Texture;
  private readonly wrapper: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;
  private readonly pixels: Uint8Array;
  constructor(private readonly scene: Phaser.Scene, readonly key: string, readonly width: number, readonly height: number, linear: boolean) {
    const renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl=renderer.gl;
    this.pixels=new Uint8Array(width*height*4);
    this.wrapper=renderer.createTexture2D(0,linear?gl.LINEAR:gl.NEAREST,linear?gl.LINEAR:gl.NEAREST,
      gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE,gl.RGBA,this.pixels,width,height,false,false,false);
    this.texture=scene.textures.addGLTexture(key,this.wrapper)!;
  }
  /** Phaser restores this same buffer after context loss, including partial uploads. */
  remember(x:number,y:number,width:number,height:number,data:Uint8Array):void {
    for(let row=0;row<height;row++)this.pixels.set(data.subarray(row*width*4,(row+1)*width*4),((y+row)*this.width+x)*4);
  }
  upload(x: number, y: number, width: number, height: number, data: Uint8Array): void {
    this.remember(x,y,width,height,data);
    const renderer=this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl=renderer.gl;
    renderer.glTextureUnits.bind(this.wrapper,0);
    renderer.glWrapper.updateTexturing({texturing:{flipY:false,premultiplyAlpha:false}});
    gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);
  }
  destroy(): void { this.scene.textures.remove(this.key); }
  get webGLTexture(): WebGLTexture { return this.wrapper.webGLTexture!; }
}
interface Resident { cx: number; cy: number; slot: number; ready: boolean; dirty: boolean; lastUse: number; revision: number; data?: Uint8Array; occlusion?: Uint8Array; previous?: Uint8Array; azimuth?: number; repair?: boolean; gpuRepaired?: boolean; gpuAzimuth?: number }
const signature=(s: FormationRock): string => `${s.gridX},${s.gridY},${s.active},${s.material},${s.frame}`;
const snapshot=(s: RockVisualState): FormationRock => ({id:s.id,gridX:s.gridX,gridY:s.gridY,active:s.active,material:s.material,frame:s.frame});

/** A bounded resident height projection shared by the rock surface, its attached
 * vegetation and its ground shadow. Workers build static data; each frame draws
 * only two quads and updates uniforms. The existing lightmap still colours once. */
export class RockFormationLighting {
  private debugSurfaceSuppressed = false;
  private debugGroundSuppressed = false;
  private debugFoliageSuppressed = false;
  /** Isolate receivers without changing formation bytes, readiness or workers. */
  setDebugSuppressed(surface: boolean, ground: boolean, foliage: boolean): void {
    this.debugSurfaceSuppressed=surface;this.debugGroundSuppressed=ground;this.debugFoliageSuppressed=foliage;
    const active=this.state.material==='mineral'&&!this.error&&!this.overflow;
    this.surface.setVisible(active&&!surface);
    this.ground.setVisible(active&&!ground&&(this.state.castShadow!==false||!!this.rim));
  }
  private readonly gpuRepair: RockFormationGpuRepair | null;
  private frameNumber = 0;
  private repairFrame = 0;
  private repairLatencyFrames: number | null = null;
  private repairPath: 'gpu' | 'worker' | null = null;
  private pendingRepair: FormationWorkerRepair | null = null;
  private repairStartedAt: number | null = null;
  private repairMainThreadMs = 0;
  private maxRepairPublishMs = 0;
  private lastRepairPublishMs = 0;
  private repairWorkerMs = 0;
  private repairLatencyMs = 0;
  private repairBatches = 0;
  private readonly uploadScratch = new Uint8Array(FORMATION_SIDE*FORMATION_SIDE*4);
  private readonly field: FormationDataTexture;
  private readonly occlusion: FormationDataTexture;
  private readonly lookup: FormationDataTexture;
  private readonly lookupData: Uint8Array;
  private readonly worker: Worker;
  private readonly surface: Phaser.GameObjects.Shader;
  private readonly ground: Phaser.GameObjects.Shader;
  private readonly resident = new Map<string, Resident>();
  private readonly signatures = new Map<number,string>();
  private readonly slots: (Resident | null)[] = Array(FORMATION.atlasColumns*FORMATION.atlasRows).fill(null);
  private wanted: string[] = [];
  private view: ChunkWorldRect = {x:0,y:0,width:1,height:1};
  private viewKey = '';
  private revision = 0;
  private rim: RockRimGeometry | null = null;
  private readonly viewUniform = new Float32Array(4);
  private readonly frameUniform: Float32Array;
  private readonly optionsUniform = new Float32Array(4);
  private busy = false;
  private buildCursor = 0;
  private pending: FormationWorkerResult | null = null;
  private disposed = false;
  private sequence = 0;
  private error: string | null = null;
  private overflow = false;
  private uploadBytes = 0;
  private builds = 0;
  private workerMs = 0;
  private maxWorkerBuildMs = 0;
  private discardedBuilds = 0;
  private eraseUploadBytes = 0;
  private lookupUploadBytes = 0;
  private residentEvictions = 0;
  private receiver: (FormationReceiverBinding & FormationCoverageBinding) | null = null;
  private previous: FormationDataTexture | null = null;
  private qualityHorizons=true;
  private azimuth = 135;
  private readonly horizonBlend = new Float32Array(64).fill(1);
  private readonly horizonDuration = new Float64Array(64).fill(.6);
  private readonly horizonSince = new Float64Array(64);
  private directionChanges = 0;
  private directionBuildMs = 0;
  private directionBuilds = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly frame: RockWorldFrame,
    private readonly states: readonly (RockVisualState | undefined)[], private readonly state: RockLightingState,
    private readonly heightTextureKey = WOODLAND_ROCK_HEIGHT_KEY) {
    this.frameUniform=new Float32Array([frame.offsetX,frame.offsetY,frame.width,frame.height]);
    const prefix=`__rock_formation_${nextId++}_`;
    // Every mineral atlas preserves this original coverage, including 2x colour.
    // Geometry stays on the authored 32px frame lattice regardless of skin size.
    const detailImage=this.readImage(heightTextureKey);
    const alpha = (scene.cache.binary.get(WOODLAND_ROCK_COVERAGE_KEY) as Uint8Array).slice();
    const detail=Float32Array.from({length:detailImage.length/4},(_,i)=>-32+(detailImage[i*4]*256+detailImage[i*4+1])/65535*64);
    const rollback:(()=>void)[]=[];
    try {
    this.field=new FormationDataTexture(scene,`${prefix}field`,FORMATION_SIDE*FORMATION.atlasColumns,FORMATION_SIDE*FORMATION.atlasRows,true);
    rollback.push(()=>this.field.destroy());
    this.occlusion=new FormationDataTexture(scene,`${prefix}occlusion`,FORMATION_SIDE*FORMATION.atlasColumns,FORMATION_SIDE*FORMATION.atlasRows,true);
    rollback.push(()=>this.occlusion.destroy());
    this.lookup=new FormationDataTexture(scene,`${prefix}lookup`,Math.ceil(frame.width/FORMATION.chunk),Math.ceil(frame.height/FORMATION.chunk),false);
    rollback.push(()=>this.lookup.destroy());
    this.lookupData=new Uint8Array(this.lookup.width*this.lookup.height*4);
    this.receiver={field:this.field.texture,lookup:this.lookup.texture,occlusion:this.occlusion.texture,
      mineralHeight:scene.textures.get(this.heightTextureKey),
      frame:[frame.offsetX,frame.offsetY,frame.width,frame.height],sun:state.sun,options:[0,0,1,1],
      fogShadows:{occlusion:this.occlusion.texture,horizonBlend:this.horizonBlend,sun:state.sun,strength:0,solarEnabled:false},
      };
    this.gpuRepair=RockFormationGpuRepair.create(scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer,
      frame.width,frame.height,states,{alpha,detail});
    rollback.push(()=>this.gpuRepair?.destroy());
    const timing = loadingTimeline.capture(), workerStarted = performance.now();
    this.worker=new Worker(new URL('./RockFormationWorker.ts',import.meta.url),{type:'module'});
    rollback.push(()=>{this.worker.onmessage=null;this.worker.onerror=null;this.worker.terminate();});
    const initial=states.map(s=>s?snapshot(s):undefined);
    for(const s of initial) if(s) this.signatures.set(s.id,signature(s));
    this.post({kind:'init',width:frame.width,height:frame.height,states:initial,source:{alpha,detail}},[alpha.buffer,detail.buffer]);
    this.worker.onmessage=(event: MessageEvent<FormationWorkerResult | FormationWorkerInitialized | FormationWorkerRepair>)=>{
      if(this.disposed) return;
      if ('initMs' in event.data) {
        timing?.add('rock-worker/startup-including-module-load', performance.now()-workerStarted, 'elapsed');
        timing?.add('rock-worker/init', event.data.initMs, 'worker');
        timing?.add('rock-worker/module-startup-and-delivery', Math.max(0, performance.now()-workerStarted-event.data.initMs), 'elapsed');
        // Cross-realm monotonic timestamps distinguish module startup from a result
        // sitting in the main-thread queue during World preparation.
        timing?.add('rock-worker/module-startup', Math.max(0, event.data.startedAt-performance.timeOrigin-workerStarted), 'elapsed');
        timing?.add('rock-worker/main-thread-delivery', Math.max(0, performance.timeOrigin+performance.now()-event.data.finishedAt), 'elapsed');
        return;
      }
      timing?.add('rock-worker/build', event.data.buildMs, 'worker');
      if ('kind' in event.data && event.data.kind === 'repair') this.pendingRepair=event.data;
      else this.pending=event.data as FormationWorkerResult;
      this.busy=false;
    };
    this.worker.onerror=(event)=>{this.error=event.message;this.busy=false;};
    this.surface=this.makeQuad(false);
    rollback.push(()=>this.destroyQuad(this.surface));
    this.ground=this.makeQuad(true);
    } catch(error) {
      for(const dispose of rollback.reverse())dispose();
      throw error;
    }
  }
  private readImage(key: string): Uint8ClampedArray {
    const image=this.scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d',{willReadFrequently:true})!;
    context.drawImage(image,0,0);return context.getImageData(0,0,canvas.width,canvas.height).data;
  }

  private makeQuad(ground: boolean): Phaser.GameObjects.Shader {
    const quad=new Phaser.GameObjects.Shader(this.scene,{
      name:'RockFormation',shaderName:'RockFormation',fragmentSource:ROCK_FORMATION_FRAGMENT,
      setupUniforms:(set:(name:string,value:unknown)=>void)=>{
        setCloudUniforms(set,this.state.clouds);
        set('uField',0);set('uLookup',1);set('uOcclusion',2);set('uGround',Number(ground));
        set('uCastShadow',Number(this.state.castShadow!==false));
        set('uMineralResponse',Number(this.state.mineralResponse===true));
        set('uFineMineral',Number(this.state.mineralResponse===true && !!this.state.clouds));
        set('uMineralHeight',4);
        set('uRockContactAO',this.state.mineralResponse && this.state.clouds ? this.state.clouds.tuning.rockContactAO : 0);
        this.viewUniform[0]=this.view.x;this.viewUniform[1]=this.view.y;
        this.viewUniform[2]=this.view.width;this.viewUniform[3]=this.view.height;
        set('uView',this.viewUniform);set('uFrame',this.frameUniform);
        set('uSun',this.state.sun);
        set('uHorizonPrevious',5);set('uHorizonBlend[0]',this.horizonBlend);
        this.optionsUniform[0]=this.state.enabled?(this.state.clouds?.strength??this.state.strength):0;
        this.optionsUniform[1]=Number(this.state.normals);this.optionsUniform[2]=Number(this.state.selfShadow!==false&&this.state.clouds?.quality?.horizons!==false);
        this.optionsUniform[3]=Number(this.state.softShadow!==false);set('uOptions',this.optionsUniform);
      },
    },0,0,1,1,[this.field.texture,this.lookup.texture,this.occlusion.texture,this.scene.textures.get(WOODLAND_TRANSMISSION_KEY),this.scene.textures.get(this.heightTextureKey),this.field.texture]);
    // Mineral, moss and decals share surface lighting. Overhanging foliage receives
    // its own alpha-correct, broad response and must not be cut by the mineral mask.
    // Ground shadows precede fog: fog scatters over the shadow, never gets stamped black.
    return this.scene.add.existing(quad).setOrigin(0).setDepth(ground?DEPTH.GROUND_FOG-.01:DEPTH.ROCK_VEGETATION-.01)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
  }

  invalidate(ids: readonly number[]): void {
    if(this.disposed || !ids.length) return;
    const changes:FormationRock[]=[];
    for(const id of ids) {
      const s=this.states[id];if(!s) continue;
      const next=signature(s);if(this.signatures.get(id)===next) continue;
      this.signatures.set(id,next);changes.push(snapshot(s));
    }
    if(!changes.length) return;
    const started = performance.now();
    this.syncSunDirection();this.syncRimGeometry();
    this.repairStartedAt ??= started;
    this.repairFrame=this.frameNumber;this.repairLatencyFrames=null;this.repairPath='worker';
    this.revision++;this.post({kind:'change',states:changes});
    const reach=FORMATION.envelopeReach+FORMATION.horizonReach;
    for(const r of this.resident.values()) for(const cell of changes) {
      const x=cell.gridX*CELL_SIZE,y=cell.gridY*CELL_SIZE;
      if(x>=r.cx*FORMATION.chunk-reach-CELL_SIZE && x<=(r.cx+1)*FORMATION.chunk+reach
        && y>=r.cy*FORMATION.chunk-reach-CELL_SIZE && y<=(r.cy+1)*FORMATION.chunk+reach) {
        r.dirty=true;r.repair=true;r.revision=this.revision;break;
      }
    }
    this.gpuRepair?.change(changes);
    const repairs=[...this.resident.values()].filter(r=>r.repair&&r.ready);
    if(this.gpuRepair?.repair(repairs,this.azimuth,this.qualityHorizons,this.rim,
      {field:this.field.webGLTexture,occlusion:this.occlusion.webGLTexture})) {
      for(const r of repairs) {this.horizonBlend[r.slot]=1;r.gpuRepaired=true;r.gpuAzimuth=this.azimuth;}
      this.repairLatencyFrames=0;this.repairLatencyMs=performance.now()-started;this.repairPath='gpu';
    }
    // Capability/parity failures explicitly report the existing worker fallback.
    // Never publish a knowingly different approximation.
    this.repairMainThreadMs += performance.now()-started;
  }

  updateView(view: ChunkWorldRect): void {
    if(this.disposed) return;
    this.view=view;
    for(const quad of [this.surface,this.ground]) quad.setPosition(view.x,view.y).setDisplaySize(view.width,view.height);
    const minX=Math.max(0,Math.floor((view.x-this.frame.offsetX-384)/FORMATION.chunk));
    const maxX=Math.min(this.lookup.width-1,Math.floor((view.x+view.width-this.frame.offsetX+384)/FORMATION.chunk));
    const minY=Math.max(0,Math.floor((view.y-this.frame.offsetY-384)/FORMATION.chunk));
    const maxY=Math.min(this.lookup.height-1,Math.floor((view.y+view.height-this.frame.offsetY+384)/FORMATION.chunk));
    const key=`${minX},${maxX},${minY},${maxY}`;if(this.viewKey===key) return;this.viewKey=key;
    const wanted:{cx:number;cy:number;distance:number}[]=[];
    const centerX=(view.x+view.width*.5-this.frame.offsetX)/FORMATION.chunk,centerY=(view.y+view.height*.5-this.frame.offsetY)/FORMATION.chunk;
    for(let cy=minY;cy<=maxY;cy++)for(let cx=minX;cx<=maxX;cx++) {
      const visible=(cx+1)*FORMATION.chunk>view.x-this.frame.offsetX && cx*FORMATION.chunk<view.x+view.width-this.frame.offsetX
        && (cy+1)*FORMATION.chunk>view.y-this.frame.offsetY && cy*FORMATION.chunk<view.y+view.height-this.frame.offsetY;
      wanted.push({cx,cy,distance:Math.hypot(cx+.5-centerX,cy+.5-centerY)+(visible?0:1000)});
    }
    wanted.sort((a,b)=>a.distance-b.distance);
    this.overflow=wanted.filter(w=>w.distance<1000).length>this.slots.length;
    this.wanted=wanted.slice(0,this.slots.length).map(w=>`${w.cx},${w.cy}`);
    const keep=new Set(this.wanted);
    for(const key of this.wanted) {const r=this.resident.get(key);if(r)r.lastUse=++this.sequence;}
    const cached=[...this.resident.values()].filter(r=>!keep.has(`${r.cx},${r.cy}`)).sort((a,b)=>a.lastUse-b.lastUse);
    let lookupChanged=false;
    for(const w of wanted.slice(0,this.slots.length)) {
      const k=`${w.cx},${w.cy}`;if(this.resident.has(k))continue;
      let slot=this.slots.indexOf(null);
      if(slot<0 && cached.length) {
        const old=cached.shift()!;slot=old.slot;this.resident.delete(`${old.cx},${old.cy}`);
        this.lookupData[(old.cy*this.lookup.width+old.cx)*4]=0;
        lookupChanged=true;this.residentEvictions++;
      }
      if(slot<0)continue;
      const r={cx:w.cx,cy:w.cy,slot,ready:false,dirty:true,lastUse:++this.sequence,revision:this.revision};
      this.slots[slot]=r;this.resident.set(k,r);
    }
    // Newly allocated slots are already absent from the lookup. Publish only
    // completed uploads, or remove evicted mappings; cached camera moves write nothing.
    if(lookupChanged)this.uploadLookup();
  }

  /** Only explicit geometry edits enqueue rebuilds. Keep completed chunks visible
   * while the existing one-job worker queue refreshes them; reject stale jobs. */
  private syncRimGeometry(): void {
    const tuning=this.state.mineralResponse ? this.state.clouds?.tuning : undefined;
    if(!tuning && !this.rim)return;
    if(tuning && this.rim && tuning.rockRimWidth===this.rim.rockRimWidth
      && tuning.rockRimHeight===this.rim.rockRimHeight && tuning.rockRimLip===this.rim.rockRimLip)return;
    this.rim=tuning?{rockRimWidth:tuning.rockRimWidth,rockRimHeight:tuning.rockRimHeight,rockRimLip:tuning.rockRimLip}:null;
    this.post({kind:'rim',rim:this.rim});
    this.revision++;
    for(const resident of this.resident.values()){resident.dirty=true;resident.revision=this.revision;}
  }

  tick(): void {
    if(this.disposed) return;
    this.frameNumber++;this.gpuRepair?.poll();
    this.syncSunDirection();
    this.syncRimGeometry();
    const now=this.state.clouds?.timeSec??0;
    for(let slot=0;slot<64;slot++)if(this.horizonBlend[slot]<1 && !this.slots[slot]?.repair) {
      const t=Math.max(0,Math.min(1,(now-this.horizonSince[slot])/this.horizonDuration[slot]));
      this.horizonBlend[slot]=t*t*(3-2*t);
    }
    const active=this.state.material==='mineral'&&!this.error&&!this.overflow;
    this.surface.setVisible(active&&!this.debugSurfaceSuppressed);
    this.ground.setVisible(active&&!this.debugGroundSuppressed&&(this.state.castShadow!==false||!!this.rim));
    this.surface.setBlendMode(this.state.normals?Phaser.BlendModes.NORMAL:Phaser.BlendModes.MULTIPLY);
    if(this.pending) {
      const result=this.pending;this.pending=null;
      this.publish(result,false,now);
    }
    if(this.pendingRepair) {
      const batch=this.pendingRepair;this.pendingRepair=null;
      // Superseding explosions invalidate the entire transaction, including chunks
      // whose own cells did not change. Never expose a mixture of geometry revisions.
      if(batch.revision===this.revision && batch.results.every(result=>{
        const r=this.resident.get(`${result.cx},${result.cy}`);
        return !r || r.revision===result.revision;
      })) {
        const started=performance.now();
        for(const result of batch.results)this.publish(result,true,now);
        this.lastRepairPublishMs=performance.now()-started;
        this.maxRepairPublishMs=Math.max(this.maxRepairPublishMs,this.lastRepairPublishMs);
        this.repairMainThreadMs+=this.lastRepairPublishMs;
        this.repairWorkerMs+=batch.buildMs;this.repairBatches++;
        if(this.repairPath!=='gpu') {
          this.repairLatencyMs=this.repairStartedAt===null?0:performance.now()-this.repairStartedAt;
          this.repairLatencyFrames=this.frameNumber-this.repairFrame;
        }
        this.repairStartedAt=null;
      } else this.discardedBuilds+=batch.results.length;
    }
    if(!active||this.busy)return;
    // One worker transaction, one publication, also across resident chunk borders.
    if(this.repairStartedAt!==null) {
      const repairs=[...this.resident.values()].filter(r=>r.repair&&r.dirty);
      if(repairs.length) {
        this.busy=true;this.post({kind:'repair',revision:this.revision,
          chunks:repairs.map(({cx,cy,revision})=>({cx,cy,revision})),azimuth:this.azimuth,horizons:this.qualityHorizons});return;
      }
      this.repairStartedAt=null;
    }
    // Round-robin prevents a moving sun from starving later resident chunks.
    for(let i=0;i<this.wanted.length;i++) {
      const index=(this.buildCursor+i)%this.wanted.length;
      const r=this.resident.get(this.wanted[index]);if(!r?.dirty)continue;
      this.buildCursor=(index+1)%this.wanted.length;
      this.busy=true;this.post({kind:'build',cx:r.cx,cy:r.cy,revision:r.revision,azimuth:this.azimuth,horizons:this.qualityHorizons});break;
    }
  }

  private publish(result:FormationWorkerResult,repair:boolean,now:number):void {
    this.builds++;this.workerMs+=result.buildMs;
    this.maxWorkerBuildMs=Math.max(this.maxWorkerBuildMs,result.buildMs);
    const r=this.resident.get(`${result.cx},${result.cy}`);
    if(!r || result.revision!==r.revision){this.discardedBuilds++;return;}
    this.gpuRepair?.validate(r,result.azimuth,this.qualityHorizons,this.rim,result.data,result.occlusion);
    if(!repair&&this.previous&&r.ready&&r.data&&r.occlusion&&r.azimuth!==result.azimuth) {
      r.previous??=new Uint8Array(result.data.length);
      packPreviousHorizons(r.data,r.occlusion,r.previous,this.horizonBlend[r.slot]);
      this.previous.upload(r.slot%FORMATION.atlasColumns*FORMATION_SIDE,Math.floor(r.slot/FORMATION.atlasColumns)*FORMATION_SIDE,
        FORMATION_SIDE,FORMATION_SIDE,r.previous);
      this.uploadBytes+=r.previous.byteLength;this.horizonBlend[r.slot]=0;this.horizonSince[r.slot]=now;this.horizonDuration[r.slot]=.6;
    } else this.horizonBlend[r.slot]=1;
    if(r.azimuth!==undefined&&r.azimuth!==result.azimuth){this.directionBuildMs+=result.buildMs;this.directionBuilds++;}
    let x0=0,y0=0,x1=FORMATION_SIDE,y1=FORMATION_SIDE;
    if(repair&&r.gpuRepaired&&this.gpuRepair?.available&&r.gpuAzimuth===result.azimuth) {
      // The correctly repaired GPU field is already final within channel precision.
      // Refresh both CPU mirrors without another GPU write. Context loss invalidates
      // the GPU repair, so an outstanding result must instead publish normally below.
      const x=r.slot%FORMATION.atlasColumns*FORMATION_SIDE,y=Math.floor(r.slot/FORMATION.atlasColumns)*FORMATION_SIDE;
      this.field.remember(x,y,FORMATION_SIDE,FORMATION_SIDE,result.data);
      this.occlusion.remember(x,y,FORMATION_SIDE,FORMATION_SIDE,result.occlusion);
      x1=y1=0;
    } else if(repair&&!r.gpuRepaired&&r.ready&&r.data&&r.occlusion) {
      x0=y0=FORMATION_SIDE;x1=y1=0;
      const oldData=new Uint32Array(r.data.buffer,r.data.byteOffset,r.data.byteLength/4);
      const oldOcclusion=new Uint32Array(r.occlusion.buffer,r.occlusion.byteOffset,r.occlusion.byteLength/4);
      const newData=new Uint32Array(result.data.buffer,result.data.byteOffset,result.data.byteLength/4);
      const newOcclusion=new Uint32Array(result.occlusion.buffer,result.occlusion.byteOffset,result.occlusion.byteLength/4);
      for(let y=0;y<FORMATION_SIDE;y++)for(let x=0;x<FORMATION_SIDE;x++) {
        const p=y*FORMATION_SIDE+x;
        if(oldData[p]!==newData[p]||oldOcclusion[p]!==newOcclusion[p]){
          x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);
        }
      }
    }
    if(x1>x0&&y1>y0) {
      const width=x1-x0,height=y1-y0;
      const upload=(texture:FormationDataTexture,source:Uint8Array):void=>{
        for(let y=0;y<height;y++)this.uploadScratch.set(source.subarray(((y0+y)*FORMATION_SIDE+x0)*4,
          ((y0+y)*FORMATION_SIDE+x1)*4),y*width*4);
        texture.upload(r.slot%FORMATION.atlasColumns*FORMATION_SIDE+x0,Math.floor(r.slot/FORMATION.atlasColumns)*FORMATION_SIDE+y0,
          width,height,this.uploadScratch.subarray(0,width*height*4));
        this.uploadBytes+=width*height*4;
      };
      upload(this.field,result.data);upload(this.occlusion,result.occlusion);
    }
    r.azimuth=result.azimuth;r.repair=false;r.gpuRepaired=false;
    r.dirty=this.qualityHorizons&&result.azimuth!==this.azimuth;r.data=result.data;r.occlusion=result.occlusion;
    if(!r.ready){r.ready=true;this.lookupData[(r.cy*this.lookup.width+r.cx)*4]=r.slot+1;this.uploadLookup();}
  }

  private syncSunDirection(): void {
    const path=this.state.clouds?.sunPath;
    const history=path&&this.state.clouds?.quality?.horizons!==false;
    if(history&&!this.previous) {
      this.previous=new FormationDataTexture(this.scene,`${this.field.key}_previous`,this.field.width,this.field.height,true);
      this.setHistoryTexture(this.previous.texture);
    } else if(!history&&this.previous) {
      this.setHistoryTexture(this.field.texture);this.previous.destroy();this.previous=null;
      this.horizonBlend.fill(1);for(const r of this.resident.values())r.previous=undefined;
    }
    const quality=this.state.clouds?.quality;
    const next=path?quantizeSunAzimuth(path.azimuth,quality?.horizonStep):135;
    const horizons=quality?.horizons!==false;
    if(this.qualityHorizons!==horizons){this.qualityHorizons=horizons;this.revision++;for(const r of this.resident.values()){r.dirty=true;r.revision=this.revision;}}
    if(!horizons)return;
    if(next===this.azimuth || (path&&path.strength===0))return;
    this.azimuth=next;this.directionChanges++;
    // Direction changes do not invalidate geometry. Accept the in-flight horizon
    // as an interim result, then converge to the newest angle without blocking readiness.
    for(const r of this.resident.values())r.dirty=true;
  }
  private setHistoryTexture(texture: Phaser.Textures.Texture): void {
    const textures=[this.field.texture,this.lookup.texture,this.occlusion.texture,
      this.scene.textures.get(WOODLAND_TRANSMISSION_KEY),this.scene.textures.get(this.heightTextureKey),texture];
    this.surface.setTextures(textures);this.ground.setTextures(textures);
  }

  private uploadLookup(): void {this.lookup.upload(0,0,this.lookup.width,this.lookup.height,this.lookupData);this.uploadBytes+=this.lookupData.byteLength;this.lookupUploadBytes+=this.lookupData.byteLength;}
  private post(request:FormationWorkerRequest,transfer:Transferable[]=[]):void {this.worker.postMessage(request,transfer);}

  destructionLight(worldX:number,worldY:number):number {
    let sum=0,count=0;
    for(const dy of [-10,0,10])for(const dx of [-10,0,10]) {
      const x=worldX+dx-this.frame.offsetX,y=worldY+dy-this.frame.offsetY;
      const r=this.resident.get(`${Math.floor(x/FORMATION.chunk)},${Math.floor(y/FORMATION.chunk)}`);
      if(!r?.data)continue;
      const px=Math.floor((x-r.cx*FORMATION.chunk)/FORMATION.step)+FORMATION.gutter;
      const py=Math.floor((y-r.cy*FORMATION.chunk)/FORMATION.step)+FORMATION.gutter;
      const i=(py*FORMATION_SIDE+px)*4;if(r.data[i+3]<128)continue;
      const mix=this.horizonBlend[r.slot],old=r.previous;
      const centre=old&&mix<1?old[i]+(r.data[i+2]-old[i])*mix:r.data[i+2];
      const left=old&&mix<1?old[i+1]+((r.occlusion?.[i+1]??0)-old[i+1])*mix:r.occlusion?.[i+1]??0;
      const right=old&&mix<1?old[i+2]+((r.occlusion?.[i+2]??0)-old[i+2])*mix:r.occlusion?.[i+2]??0;
      sum+=formationSurfaceFactor(r.data[i]/127.5-1,r.data[i+1]/127.5-1,centre/255*Math.PI/2,this.state,
        r.occlusion?[r.occlusion[i]/255,left/255*Math.PI/2,right/255*Math.PI/2,r.occlusion[i+3]/255]:undefined);count++;
    }
    let light=count?sum/count:1;
    return light;
  }
  /** The current start view includes the bounded residency halo, not the whole map. */
  getPreparationState(): { ready: boolean; pending: number; resident: number } {
    const pendingChunks = this.wanted.filter(key => {
      const chunk = this.resident.get(key);
      return !chunk?.ready || chunk.dirty || chunk.repair;
    }).length;
    const publicationPending = this.busy || this.pending !== null || this.pendingRepair !== null;
    const pending = pendingChunks + (publicationPending ? 1 : 0);
    return {
      ready: !this.disposed && !this.error && !this.overflow && this.viewKey !== '' && pending === 0,
      pending,
      resident: this.resident.size,
    };
  }

  getDiagnostics() {
    return {residentChunks:this.resident.size,pendingChunks:this.wanted.filter(key=>this.resident.get(key)?.dirty).length,
      textureBytes:this.field.width*this.field.height*(this.previous?12:8)+this.lookupData.byteLength+(this.gpuRepair?.textureBytes??0),uploadBytes:this.uploadBytes,
      horizonAzimuth:this.azimuth,directionChanges:this.directionChanges,directionBuildMs:this.directionBuildMs,directionBuilds:this.directionBuilds,
      sharedSunTextureBytes:512*512*4,
      light:{strength:this.state.strength,sun:[...this.state.sun]},
      builds:this.builds,workerBuildMs:this.workerMs,maxWorkerBuildMs:this.maxWorkerBuildMs,
      discardedBuilds:this.discardedBuilds,eraseUploadBytes:this.eraseUploadBytes,lookupUploadBytes:this.lookupUploadBytes,
      repairMainThreadMs:this.repairMainThreadMs,lastRepairPublishMs:this.lastRepairPublishMs,maxRepairPublishMs:this.maxRepairPublishMs,
      repairWorkerMs:this.repairWorkerMs,repairLatencyMs:this.repairLatencyMs,repairBatches:this.repairBatches,
      repairLatencyFrames:this.repairLatencyFrames,repairPath:this.repairPath,
      gpuRepair:this.gpuRepair?.diagnostics??{available:false,reason:'WebGL float repair unavailable'},
      residentEvictions:this.residentEvictions,overflow:this.overflow,error:this.error};
  }
  getCoverageBinding(): FormationCoverageBinding | null {
    if(this.disposed||this.error||this.overflow||this.state.material!=='mineral'||!this.receiver)return null;
    // A worker-only repair must not lend the previous silhouette as current geometry.
    // GPU repairs already update the borrowed field synchronously in invalidate().
    for(const r of this.resident.values()) if(r.repair&&(this.repairPath!=='gpu'||!r.gpuRepaired||!this.gpuRepair?.available))return null;
    const shadows=this.receiver.fogShadows!;
    shadows.horizonPrevious=this.previous?.texture;
    shadows.sun=this.state.sun;
    shadows.strength=this.state.enabled?(this.state.clouds?.strength??this.state.strength):0;
    shadows.solarEnabled=this.state.castShadow!==false&&this.state.selfShadow!==false&&this.state.clouds?.quality?.horizons!==false;
    return this.receiver;
  }
  getReceiverBinding(): FormationReceiverBinding | null {
    if(this.disposed||this.error||this.overflow||this.debugFoliageSuppressed||this.state.material!=='mineral'||!this.receiver)return null;
    const binding=this.receiver;
    binding.sun=this.state.sun;
    binding.horizonPrevious=this.previous?.texture;binding.horizonBlend=this.horizonBlend;
    binding.clouds=this.state.clouds;
    binding.options[0]=this.state.enabled?(this.state.clouds?.strength??this.state.strength):0;
    binding.options[1]=Number(this.state.normals);
    binding.options[2]=Number(this.state.selfShadow!==false&&this.state.clouds?.quality?.horizons!==false);
    binding.options[3]=Number(this.state.softShadow!==false);
    binding.mineralResponse=this.state.mineralResponse===true;
    binding.fineMineral=binding.mineralResponse && !!this.state.clouds;
    return binding;
  }
  destroy():void {
    if(this.disposed)return;this.disposed=true;this.receiver=null;this.worker.onmessage=null;this.worker.onerror=null;this.worker.terminate();
    for(const quad of [this.surface,this.ground]) this.destroyQuad(quad);
    this.previous?.destroy();this.previous=null;
    this.gpuRepair?.destroy();
    this.field.destroy();this.occlusion.destroy();this.lookup.destroy();this.resident.clear();this.slots.fill(null);this.signatures.clear();this.pending=null;this.pendingRepair=null;
  }
  private destroyQuad(quad:Phaser.GameObjects.Shader):void {
      // Phaser 4.2.1 Shader.preDestroy omits its private VAOs and vertex buffer.
      const node=quad.renderNode;
      for(const suite of Object.values(node.programManager.programs)) {
        Phaser.Utils.Array.Remove(node.renderer.glVAOWrappers,suite.vao);suite.vao.destroy();
      }
      node.programManager.programs={};node.renderer.deleteBuffer(node.vertexBufferLayout.buffer);quad.destroy();
  }
}
