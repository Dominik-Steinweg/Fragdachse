import * as Phaser from 'phaser';
import { getChunkBakeScheduler } from '../../arena/chunks/ChunkBakeScheduler';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from './cloudShadow';
import { SUN_VISIBILITY_GLSL } from './sunVisibility';
import { VEGETATION_SHADOW_GLSL } from './VegetationShadow';
import { packVegetationVolume, stampVegetationAlpha, vegetationShadowLength, VEGETATION_PAD,
 type VegetationAlpha } from './VegetationVolume';

type Image=Phaser.GameObjects.RenderTexture;
type Node=Phaser.Renderer.WebGL.RenderNodes.RenderNode;
type Roles=Record<string,Node|undefined>;
type Binding={id:number;image:Image;layer:string;x:number;y:number;blur:number;pending:boolean;tilesLeft:number;covered:boolean;
 texture:Phaser.Textures.Texture|null;wrapper:Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper|null;
 saved:Node|null;data:object|undefined};
type VegetationDraw=(layer:string,x:number,y:number,size:number,writer:VegetationLighting)=>void;
export const VEGETATION_LIGHT_HEADER=`
uniform sampler2D uVegData;
uniform vec4 uVegUV,uVegWorld;
uniform vec3 uVegSun;
uniform vec2 uVegShadowOffset;
uniform float uVegDataSize,uVegLight,uVegShadow,uVegStrength;
${CLOUD_SHADOW_GLSL}
${SUN_VISIBILITY_GLSL}
${VEGETATION_SHADOW_GLSL}
`;
export const VEGETATION_LIGHT_PROCESS=`
vec2 local=(outTexCoord-uVegUV.xy)/uVegUV.zw*uVegWorld.zw;
vec2 dataUV=(local+${VEGETATION_PAD}.0)/(uVegDataSize*2.0);
vec4 volume=texture2D(uVegData,dataUV);
float coverage=0.0;
if(uVegShadow>0.0&&volume.g<.18) {
 float reach=length(uVegShadowOffset);
 vec2 spread=vec2(-uVegShadowOffset.y,uVegShadowOffset.x)/max(.001,reach)*(1.5+reach*.12);
 vec2 texelScale=vec2(1.0/(uVegDataSize*2.0));
 coverage=.35*vegetationDome(dataUV+uVegShadowOffset*.55*texelScale)
  +.325*vegetationDome(dataUV+(uVegShadowOffset+spread)*texelScale)
  +.325*vegetationDome(dataUV+(uVegShadowOffset-spread)*texelScale);
}
if(volume.g>0.0 || coverage>0.0) {
vec2 nxy=volume.ba*2.0-1.0;
vec3 normal=vec3(nxy,sqrt(max(0.0,1.0-dot(nxy,nxy))));
float form=cloudFormStrength(uVegWorld.xy+local)*uVegStrength;
float vegetation=smoothstep(.02,.18,volume.g);
float delta=dot(normal,uVegSun)-uVegSun.z;
fragColor.rgb*=1.0+clamp(delta*uVegLight,-.20,.15)*form*vegetation;
if(uVegShadow>0.0&&coverage>.015&&volume.g<.18) {
 vec2 world=uVegWorld.xy+local;
 float shadow=vegetationShadowAlpha(coverage,volume.g,uVegSun.z,uVegStrength,uVegShadow,
   vegetationCanopy(world),1.0);
 // Cast onto flat colour in this layer and its transparent gaps exactly once.
 // Ambient/cloud colour is still owned by the world composite and lightmap.
 vec3 cool=vec3(0.0,.006,.012);
 fragColor.rgb=mix(fragColor.rgb,cool*fragColor.a,shadow)+cool*shadow*(1.0-fragColor.a);
 fragColor.a+=shadow*(1.0-fragColor.a);
}
}
`;
let nextId=0;

/** World-owned paired textures borrow the existing colour targets' residency.
 * CPU alpha bake + upload are scheduler jobs, never render/update work. */
export class VegetationLighting {
 readonly stats={dataTextureBytes:0,dataBackingBytes:0,alphaSourceBytes:0,bakes:0,bakeJobs:0,bakeMsTotal:0,bakeMsMax:0,pending:0,materialDraws:0};
 private readonly bindings=new Map<Image,Binding>();
 private readonly sources=new Map<string,VegetationAlpha>();
 private readonly scheduler;
 private readonly prefix=`Vegetation${nextId++}`;
 private readonly batch:Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle|null;
 private submitter:Node|null=null;
 private current:Binding|null=null;
 private disposed=false;
 private readonly uv=[0,0,1,1];private readonly world=[0,0,1,1];private readonly offset=[0,0];
 private readonly empty={};private readonly sunFallback=[0,0,1];
 private sourceCanvas:HTMLCanvasElement|null=null;
 private raw=new Float32Array(0);private a=new Float32Array(0);private b=new Float32Array(0);
 private packed=new Uint8Array(0);private side=0;private originX=0;private originY=0;
 private serial=0;
 readonly dataSize:number;
 private readonly tiles:number;
 constructor(private readonly scene:Phaser.Scene,private readonly chunkSize:number,
  public clouds:SunCloudState,private readonly draw:VegetationDraw) {
  this.tiles=Math.max(1,Math.ceil(chunkSize/128));
  this.dataSize=Math.ceil((chunkSize+VEGETATION_PAD*2)/2/this.tiles)*this.tiles;
  this.scheduler=getChunkBakeScheduler(scene);
  const renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if(!renderer?.gl||!renderer.renderNodes){this.batch=null;return;}
  const manager=renderer.renderNodes,batch=new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle(manager,{name:this.prefix});
  this.batch=batch;
  batch.programManager.addAddition({name:'VegetationVolumeR18',additions:{fragmentHeader:VEGETATION_LIGHT_HEADER,fragmentProcess:VEGETATION_LIGHT_PROCESS}});
  const setup=batch.setupUniforms,set=(name:string,value:unknown)=>batch.programManager.setUniform(name,value);
  batch.setupUniforms=context=>{
   setup.call(batch,context);const r=this.current;if(!r?.wrapper)return;
   const image=r.image,f=image.frame,state=this.clouds,t=state.tuning,path=state.sunPath;
   this.uv[0]=f.u0;this.uv[1]=f.v0;this.uv[2]=f.u1-f.u0;this.uv[3]=f.v1-f.v0;
   this.world[0]=image.x;this.world[1]=image.y;this.world[2]=image.width;this.world[3]=image.height;
   const length=vegetationShadowLength(path?.elevation??Math.PI/4,t.vegShadowLength);
   this.offset[0]=(path?.direction[0]??0)*length;this.offset[1]=(path?.direction[1]??0)*length;
   setCloudUniforms(set,state);renderer.glTextureUnits.bind(r.wrapper,1);
   set('uVegData',1);set('uVegDataSize',this.dataSize);set('uVegUV',this.uv);set('uVegWorld',this.world);
   set('uVegSun',path?.sun??this.sunFallback);set('uVegStrength',state.strength);
   set('uVegLight',t.vegLight);set('uVegShadow',state.quality?.vegetationShadows?t.vegShadow:0);
   set('uVegShadowOffset',this.offset);
  };
  const submitter=new Phaser.Renderer.WebGL.RenderNodes.RenderNode(this.prefix+'Submitter',manager);this.submitter=submitter;
  submitter.run=(context,object,parent,element,texturer,transformer,tinter,normalMap,normalRotation)=>{
   const image=object as Image,r=this.bindings.get(image);
   const fallback=r?.saved??(image.defaultRenderNodes as Roles).Submitter!;
   if(this.disposed||!r?.texture||!r.covered||r.pending||r.x!==image.x||r.y!==image.y||!(this.clouds.strength>0)
     ||(this.clouds.tuning.vegLight===0&&(!this.clouds.quality?.vegetationShadows||this.clouds.tuning.vegShadow===0))){
    fallback.run(context,object,parent,element,texturer,transformer,tinter,normalMap,normalRotation);return;
   }
   manager.finishBatch();this.current=r;this.stats.materialDraws++;
   const previous=(image.customRenderNodes as Roles).BatchHandler;
   const previousData=previous?(image.renderNodeData as Record<string,object>)[previous.name]:undefined;
   image.setRenderNodeRole('BatchHandler',batch,this.empty);
   try {fallback.run(context,object,parent,element,texturer,transformer,tinter,normalMap,normalRotation);manager.finishBatch();}
   finally {image.setRenderNodeRole('BatchHandler',previous??null,previousData??this.empty);this.current=null;}
  };
 }
 /** Small jobs share the colour scheduler; stale jobs cannot attach to a recycled slot.
  * Ground placements are immutable for this streamer's lifetime, so a dirt-only
  * colour rebake at the same coordinates does not invalidate vegetation data. */
 schedule(image:Image,layer:string):void {
  if(this.disposed||!this.batch)return;
  let r=this.bindings.get(image);
  if(!r){
   const node=(image.customRenderNodes as Roles).Submitter;
   r={id:this.serial++,image,layer,x:NaN,y:NaN,blur:NaN,pending:false,tilesLeft:0,covered:false,texture:null,wrapper:null,
    saved:node??null,data:node?(image.renderNodeData as Record<string,object>)[node.name]:undefined};
   this.bindings.set(image,r);image.setRenderNodeRole('Submitter',this.submitter!);
  }
  const blur=Math.max(1,Math.ceil(this.clouds.tuning.vegDomeBlur/2)),x=image.x,y=image.y,record=r;
  if(r.x===x&&r.y===y&&r.blur===blur){
   this.cancelPending(r);
   return;
  }
  if(!r.pending){r.pending=true;this.stats.pending++;}
  r.tilesLeft=this.tiles*this.tiles;
  r.covered=false;
  for(let ty=0;ty<this.tiles;ty++)for(let tx=0;tx<this.tiles;tx++)
  this.scheduler.enqueue({key:this.prefix+':'+r.id+':'+tx+':'+ty,owner:this,completionKey:r,urgent:()=>image.visible,
   priority:()=>{const c=this.scene.cameras.main;return Math.hypot(x-c.worldView.centerX,y-c.worldView.centerY);},
   run:()=>{
    if(this.disposed||!image.scene||image.x!==x||image.y!==y||Math.ceil(this.clouds.tuning.vegDomeBlur/2)!==blur){this.cancelPending(record);return;}
    this.bakeTile(record,x,y,blur,tx,ty);
    if(--record.tilesLeft===0){record.pending=false;this.stats.pending--;record.x=x;record.y=y;record.blur=blur;this.stats.bakes++;}
   }});
 }
 private cancelPending(r:Binding):void {
  if(!r.pending)return;
  for(let ty=0;ty<this.tiles;ty++)for(let tx=0;tx<this.tiles;tx++)this.scheduler.cancel(this.prefix+':'+r.id+':'+tx+':'+ty);
  r.pending=false;r.tilesLeft=0;this.stats.pending--;
 }
 private bakeTile(r:Binding,x:number,y:number,blur:number,tx:number,ty:number):void {
  const start=performance.now(),tile=this.dataSize/this.tiles,side=tile+4*blur;
  if(this.side!==side){this.side=side;this.raw=new Float32Array(side*side);this.a=new Float32Array(side*side);this.b=new Float32Array(side*side);
   this.packed=new Uint8Array(tile*tile*4);}
  this.raw.fill(0);this.originX=x-VEGETATION_PAD-4*blur+tx*tile*2;this.originY=y-VEGETATION_PAD-4*blur+ty*tile*2;
  this.draw(r.layer,this.originX,this.originY,side*2,this);
  packVegetationVolume(this.raw,this.a,this.b,side,blur,this.packed);
  if(!r.covered)for(let i=0;i<this.packed.length;i+=4)if(this.packed[i]>0||this.packed[i+1]>0){r.covered=true;break;}
  const renderer=this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer,gl=renderer.gl;
  if(!r.texture){
   r.wrapper=renderer.createTexture2D(0,gl.LINEAR,gl.LINEAR,gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE,gl.RGBA,
    new Uint8Array(this.dataSize*this.dataSize*4),this.dataSize,this.dataSize,false,false,false);
   r.texture=this.scene.textures.addGLTexture(this.prefix+':'+r.id,r.wrapper)!;
   this.stats.dataTextureBytes+=this.dataSize*this.dataSize*4;
   this.stats.dataBackingBytes+=this.dataSize*this.dataSize*4;
  }
  // Phaser retains these pixels for context restoration. Keep that backing current,
  // rather than restoring the initial zero texture after the incremental uploads.
  const backing=r.wrapper!.pixels as Uint8Array,rowBytes=tile*4;
  for(let row=0;row<tile;row++){
   const target=((ty*tile+row)*this.dataSize+tx*tile)*4,source=row*rowBytes;
   for(let byte=0;byte<rowBytes;byte++)backing[target+byte]=this.packed[source+byte];
  }
   renderer.glTextureUnits.bind(r.wrapper!,0);renderer.glWrapper.updateTexturing({texturing:{flipY:false,premultiplyAlpha:false}});
   gl.texSubImage2D(gl.TEXTURE_2D,0,tx*tile,ty*tile,tile,tile,gl.RGBA,gl.UNSIGNED_BYTE,this.packed);
  const ms=performance.now()-start;this.stats.bakeJobs++;this.stats.bakeMsTotal+=ms;this.stats.bakeMsMax=Math.max(this.stats.bakeMsMax,ms);
 }
 /** Explicit transforms match stampGroundCover / ArenaVisualFactory exactly. */
 stamp(key:string,x:number,y:number,width:number,height:number,rotation:number,alpha:number,flipX=false,flipY=false):void {
  let source=this.sources.get(key);
  if(!source){
   const f=this.scene.textures.getFrame(key);if(!f)return;
   const canvas=this.sourceCanvas??=document.createElement('canvas');canvas.width=f.cutWidth;canvas.height=f.cutHeight;
   const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
   ctx.drawImage(f.source.image as CanvasImageSource,f.cutX,f.cutY,f.cutWidth,f.cutHeight,0,0,canvas.width,canvas.height);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);
   for(let i=0;i<alpha.length;i++)alpha[i]=pixels[i*4+3];
   source={width:canvas.width,height:canvas.height,alpha};this.sources.set(key,source);this.stats.alphaSourceBytes+=alpha.byteLength;
  }
  stampVegetationAlpha(this.raw,this.side,this.originX,this.originY,source,x,y,width,height,rotation,alpha,flipX,flipY);
 }
 destroy():void {
  if(this.disposed)return;this.disposed=true;this.scheduler.cancelOwner(this);
  for(const r of this.bindings.values()){
   if(r.image.scene&&(r.image.customRenderNodes as Roles).Submitter===this.submitter)
    r.image.setRenderNodeRole('Submitter',r.saved,r.data??this.empty);
   if(r.texture)this.scene.textures.remove(r.texture.key);
  }
  this.bindings.clear();this.sources.clear();this.sourceCanvas=null;this.current=null;
  this.raw=new Float32Array(0);this.a=new Float32Array(0);this.b=new Float32Array(0);this.packed=new Uint8Array(0);
  this.stats.dataTextureBytes=0;this.stats.dataBackingBytes=0;this.stats.alphaSourceBytes=0;this.stats.pending=0;
  const batch=this.batch;if(!batch)return;
  const manager=batch.manager,renderer=manager.renderer;if(manager.currentBatchNode===batch)manager.finishBatch();
  (manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS,batch.updateTextureCount,batch);
  renderer.off(Phaser.Renderer.Events.RESIZE,batch.resize,batch);
  for(const suite of Object.values(batch.programManager.programs)){
   Phaser.Utils.Array.Remove(renderer.glVAOWrappers,suite.vao);suite.vao.destroy();
  }
  batch.programManager.programs={};renderer.deleteBuffer(batch.vertexBufferLayout.buffer);renderer.deleteBuffer(batch.indexBuffer);
 }
}
