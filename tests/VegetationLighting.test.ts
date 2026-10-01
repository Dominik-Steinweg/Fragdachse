import {expect,it,vi} from 'vitest';
vi.mock('phaser',async()=>({...(await import('./fakeArenaRenderScene')).createFakePhaserModule(),
 Renderer:{Events:{SET_PARALLEL_TEXTURE_UNITS:'units',RESIZE:'resize'},WebGL:{RenderNodes:{
  BatchHandlerQuadSingle:class {
   manager:any;vertexBufferLayout={buffer:{}};indexBuffer={};resize=vi.fn();updateTextureCount=vi.fn();setupUniforms=vi.fn();
   programManager={addAddition:vi.fn(),setUniform:vi.fn(),programs:{main:{vao:{destroy:vi.fn()}}}};
   constructor(manager:any){this.manager=manager;manager.renderer.glVAOWrappers.push(this.programManager.programs.main.vao);}
  },RenderNode:class {constructor(public name:string,public manager:any){}},
 }}},Utils:{Array:{Remove:(a:any[],v:any)=>a.splice(a.indexOf(v),1)}},
}));
import {createFakeArenaScene} from './fakeArenaRenderScene';
import {VegetationLighting} from '../src/effects/sunlight/VegetationLighting';
import {GroundSurfaceStreamer} from '../src/arena/chunks/GroundSurfaceStreamer';
import {getChunkBakeScheduler} from '../src/arena/chunks/ChunkBakeScheduler';
import {SUN_RENDER_QUALITY} from '../src/effects/sunlight/SunRenderQuality';
import {createSunTuning} from '../src/effects/sunlight/SunAtmosphere';
import {createSunPath,resolveSunPath} from '../src/effects/sunlight/SunPath';
import type {SunCloudState} from '../src/effects/sunlight/cloudShadow';
function fixture(){
 const renderer:any={gl:{RGBA:1,LINEAR:2,CLAMP_TO_EDGE:3,TEXTURE_2D:4,UNSIGNED_BYTE:5,texSubImage2D:vi.fn()},
  createTexture2D:vi.fn((...args:any[])=>({pixels:args[6]})),glTextureUnits:{bind:vi.fn()},glWrapper:{updateTexturing:vi.fn()},
  glVAOWrappers:[],deleteBuffer:vi.fn(),off:vi.fn()};
 renderer.renderNodes={renderer,finishBatch:vi.fn(),off:vi.fn()};
 const scene:any={sys:{renderer},cameras:{main:{worldView:{centerX:0,centerY:0}}},
  textures:{addGLTexture:vi.fn((key:string)=>({key})),remove:vi.fn()}};
 const fallback={name:'original',run:vi.fn((_context:any,image:any)=>image.customRenderNodes.BatchHandler?.setupUniforms({}))};
 const image:any={scene,visible:true,x:31,y:-17,width:512,height:512,frame:{u0:2/516,v0:2/516,u1:514/516,v1:514/516},
  customRenderNodes:{Submitter:fallback},defaultRenderNodes:{Submitter:fallback},renderNodeData:{original:{preserved:true}},
  setRenderNodeRole(role:string,node:any,data:any){if(node){this.customRenderNodes[role]=node;this.renderNodeData[node.name]=data;}else delete this.customRenderNodes[role];}};
 const clouds:SunCloudState={tuning:createSunTuning(),strength:1,timeSec:0,quality:SUN_RENDER_QUALITY.high,sunPath:resolveSunPath(480,null,createSunPath())};
 const draw=vi.fn(),light=new VegetationLighting(scene,512,clouds,draw),scheduler=getChunkBakeScheduler(scene);
 return {renderer,scene,image,fallback,clouds,draw,light,scheduler};
}
it('bakes only on queued placement/blur changes, reuses data, restores roles and cancels pending work',()=>{
 const h=fixture();h.light.schedule(h.image,'groundCover');h.light.schedule(h.image,'groundCover');
 expect(h.light.stats.pending).toBe(1);expect(h.renderer.createTexture2D).not.toHaveBeenCalled();
 h.scheduler.drain();expect(h.light.stats.bakes).toBe(1);expect(h.light.stats.dataTextureBytes).toBe(h.light.dataSize*h.light.dataSize*4);
 expect(h.light.stats.dataBackingBytes).toBe(h.light.dataSize*h.light.dataSize*4);
 const backing=h.renderer.createTexture2D.mock.results[0].value.pixels;
 expect(backing[2]).toBe(128);expect(backing[backing.length-1]).toBe(128); // Restore every uploaded tile, not initial zeros.
 for(let i=0;i<100;i++){h.clouds.timeSec++;h.light.schedule(h.image,'groundCover');}
 expect(h.scheduler.pendingJobs).toBe(0);
 h.clouds.tuning.vegDomeBlur=10;h.light.schedule(h.image,'groundCover');h.scheduler.drain();
 expect(h.light.stats.bakes).toBe(2);expect(h.renderer.createTexture2D).toHaveBeenCalledTimes(1);
 expect(h.renderer.gl.texSubImage2D).toHaveBeenCalledTimes(32);
 h.clouds.quality=SUN_RENDER_QUALITY.medium;h.light.schedule(h.image,'groundCover');
 expect(h.scheduler.pendingJobs).toBe(0); // Only uniforms change for high -> medium.
 h.image.x+=512;h.light.schedule(h.image,'groundCover');h.image.x+=512;h.scheduler.drain();
 expect(h.light.stats.bakes).toBe(2); // A recycled target rejects obsolete upload.
 h.light.schedule(h.image,'groundCover');h.light.destroy();h.scheduler.drain();h.light.destroy();
 expect(h.image.customRenderNodes.Submitter).toBe(h.fallback);
 expect(h.image.renderNodeData.original).toEqual({preserved:true});
 expect(h.scene.textures.remove).toHaveBeenCalledTimes(1);expect(h.light.stats.dataTextureBytes).toBe(0);
 expect(h.light.stats.dataBackingBytes).toBe(0);
 expect(h.light.stats.pending).toBe(0);expect(h.renderer.glVAOWrappers).toHaveLength(0);
 expect(h.renderer.deleteBuffer).toHaveBeenCalledTimes(2);
});
it('uses the original submitter at night and preserves parent/colour roles after daytime draws',()=>{
 const h=fixture();h.draw.mockImplementation((_layer,x,y,size,writer)=>writer.raw.fill(.5));
 h.light.schedule(h.image,'groundCover');h.scheduler.drain(1);
 const node=h.image.customRenderNodes.Submitter;
 node.run({},h.image); // Never expose partially uploaded data as a tiled material.
 expect(h.light.stats.pending).toBe(1);expect(h.light.stats.bakes).toBe(0);
 expect(h.renderer.renderNodes.finishBatch).not.toHaveBeenCalled();
 h.fallback.run.mockClear();h.scheduler.drain();h.clouds.strength=0;
 node.run({},h.image);expect(h.fallback.run).toHaveBeenCalledTimes(1);expect(h.renderer.renderNodes.finishBatch).not.toHaveBeenCalled();
 h.clouds.strength=1;node.run({},h.image);
 expect(h.fallback.run).toHaveBeenCalledTimes(2);expect(h.image.customRenderNodes.BatchHandler).toBeUndefined();
 expect(h.renderer.renderNodes.finishBatch).toHaveBeenCalledTimes(2);h.light.destroy();
});
it('low builds no auxiliary data, including after ground residency and teardown',()=>{
 const scene=createFakeArenaScene(),frame={offsetX:0,offsetY:0,width:512,height:512};
 const ground=new GroundSurfaceStreamer({scene:scene as never,frame,groundCoverPlacements:[],
  layout:{seed:1,rocks:[],trees:[],tracks:[],powerUpPedestals:[]}});
 ground.setVegetationLight({tuning:createSunTuning(),timeSec:0,strength:1,quality:SUN_RENDER_QUALITY.low});
 ground.updateResidency({x:0,y:0,width:512,height:512});getChunkBakeScheduler(scene).drain();
 expect(ground.getVegetationStats()).toBeNull();ground.destroy();
 expect(getChunkBakeScheduler(scene).pendingJobs).toBe(0);
});

it('empty and neutral chunks share the original batch without material draws',()=>{
 for(const empty of [true,false]){
  const h=fixture();
  if(!empty){h.draw.mockImplementation((_layer,x,y,size,writer)=>writer.raw.fill(.5));
   h.clouds.tuning.vegLight=0;h.clouds.tuning.vegShadow=0;}
  h.light.schedule(h.image,'groundCover');h.scheduler.drain();
  h.image.customRenderNodes.Submitter.run({},h.image);
  expect(h.fallback.run).toHaveBeenCalledOnce();
  expect(h.renderer.renderNodes.finishBatch).not.toHaveBeenCalled();
  expect(h.light.stats.materialDraws).toBe(0);h.light.destroy();
 }
});

it('turns shadow sampling off on medium without rebuilding and keeps the offset toward the source',()=>{
 const h=fixture();h.draw.mockImplementation((_layer,x,y,size,writer)=>writer.raw.fill(.5));
 h.light.schedule(h.image,'groundCover');h.scheduler.drain();
 const handler=(h.light as any).batch,set=handler.programManager.setUniform;
 h.image.customRenderNodes.Submitter.run({},h.image);
 const last=(key:string)=>set.mock.calls.filter((c:any[])=>c[0]===key).at(-1)?.[1];
 expect(last('uVegShadow')).toBe(.44);
 const direction=h.clouds.sunPath!.direction,offset=last('uVegShadowOffset');
 expect(offset[0]*direction[0]+offset[1]*direction[1]).toBeGreaterThan(0);
 h.clouds.quality=SUN_RENDER_QUALITY.medium;h.light.schedule(h.image,'groundCover');
 h.image.customRenderNodes.Submitter.run({},h.image);expect(last('uVegShadow')).toBe(0);
 expect(h.light.stats.bakes).toBe(1);h.light.destroy();
});
