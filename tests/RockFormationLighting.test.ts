import { WOODLAND_TRANSMISSION_KEY } from '../src/assets/WoodlandAssetManifest';
import { WOODLAND_ROCK_COVERAGE_KEY, WOODLAND_ROCK_HEIGHT_KEY } from '../src/assets/WoodlandAssetManifest';
import { afterEach, describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({quads:[] as any[],deleted:vi.fn()}));
vi.mock('phaser',()=>({
  BlendModes:{MULTIPLY:2,NORMAL:0},Utils:{Array:{Remove:()=>{}}},
  GameObjects:{Shader:class {
    renderNode={programManager:{programs:{}},vertexBufferLayout:{buffer:{}},renderer:{deleteBuffer:fake.deleted,glVAOWrappers:[]}};
    visible=false;destroy=vi.fn();config:any;
    constructor(_scene:unknown,config:unknown){this.config=config;fake.quads.push(this);}
    setTextures(){return this;}setOrigin(){return this;}setDepth(){return this;}setBlendMode(){return this;}
    setVisible(value:boolean){this.visible=value;return this;}setPosition(){return this;}setDisplaySize(){return this;}
  }},
}));
import { RockFormationLighting } from '../src/arena/rocks/RockFormationLighting';
import { FORMATION_SIDE } from '../src/arena/rocks/RockFormationField';
import type { RockLightingState } from '../src/arena/rocks/RockLightingState';


function fixture(width=512,height=512,gridX=4,gridY=4,heightKey?: string,colourKey?: string){
  class Worker {
    static instance:Worker; messages:any[]=[];onmessage:((e:any)=>void)|null=null;onerror:unknown;
    terminate=vi.fn();constructor(){Worker.instance=this;}
    postMessage(value:unknown){this.messages.push(value);}
    reply(){const request=this.messages.filter(m=>m.kind==='build').at(-1);
      this.onmessage?.({data:{...request,data:new Uint8Array(FORMATION_SIDE*FORMATION_SIDE*4).fill(255),occlusion:new Uint8Array(FORMATION_SIDE*FORMATION_SIDE*4).fill(255),buildMs:1}});}
  }
  vi.stubGlobal('Worker',Worker);
  vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(16).fill(255)})})})});
  const upload=vi.fn(),remove=vi.fn();
  const renderer={gl:{LINEAR:1,NEAREST:2,CLAMP_TO_EDGE:3,RGBA:4,TEXTURE_2D:5,UNSIGNED_BYTE:6,texSubImage2D:upload},
    createTexture2D:()=>({}),glTextureUnits:{bind(){}},glWrapper:{updateTexturing(){}}};
  const transmissionTexture={key:WOODLAND_TRANSMISSION_KEY,getSourceImage:()=>({width:512,height:512})};
  const getTexture=vi.fn((key:string)=>key===WOODLAND_TRANSMISSION_KEY?transmissionTexture:
    {getSourceImage:()=>({width:2,height:2})});
  const coverage=new Uint8Array([0,61,199,255]),getCoverage=vi.fn((key:string)=>key===WOODLAND_ROCK_COVERAGE_KEY?coverage:undefined);
  const scene={cache:{binary:{get:getCoverage}},sys:{renderer},textures:{get:getTexture,addGLTexture:()=>({}),remove},add:{existing:(x:unknown)=>x}};
  const states:any[]=[{id:0,gridX,gridY,active:true,frame:0,damageTint:0xffffff}];
  const state:RockLightingState={enabled:true,normals:false,strength:1,sun:[-.5,-.5,Math.SQRT1_2],material:'mineral',colourTextureKey:colourKey};
  const lighting=new RockFormationLighting(scene as never,{offsetX:0,offsetY:0,width,height},states,state,heightKey);
  lighting.updateView({x:0,y:0,width:400,height:400});lighting.tick();
  return{coverage,getCoverage,lighting,worker:Worker.instance,states,state,upload,remove,transmissionTexture,getTexture};
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();fake.quads.length=0;});
describe('formation lighting ownership and incremental updates',()=>{
  it('borrows the selected authored height source and leaves its lifetime to the asset cache',()=>{
    const key='optional-authored-height', colour='optional-authored-colour',f=fixture(512,512,4,4,key,colour);
    expect(f.getTexture).toHaveBeenCalledWith(key);
    expect(f.getTexture).not.toHaveBeenCalledWith(colour);
    expect(f.worker.messages[0].source.detail).toBeInstanceOf(Float32Array);
    f.lighting.destroy();expect(f.remove).not.toHaveBeenCalledWith(key);expect(f.remove).not.toHaveBeenCalledWith(colour);
  });
  const settle=(f:ReturnType<typeof fixture>):void=>{
    let guard=100;
    while(f.lighting.getDiagnostics().pendingChunks&&guard-->0){f.worker.reply();f.lighting.tick();}
    expect(f.lighting.getDiagnostics().pendingChunks).toBe(0);
  };

  it('rebuilds only for rim geometry edits, rejects stale work, and restores base geometry',async()=>{
    const {createSunTuning}=await import('../src/effects/sunlight/SunAtmosphere');
    const f=fixture();settle(f);f.upload.mockClear();
    const tuning=createSunTuning();f.state.clouds={tuning,timeSec:0,strength:0};f.state.mineralResponse=true;
    f.lighting.tick();expect(f.worker.messages.filter(m=>m.kind==='rim')).toHaveLength(1);
    tuning.rockRimHeight+=1;f.worker.reply();f.lighting.tick();
    expect(f.upload).not.toHaveBeenCalled();expect(f.lighting.getDiagnostics().discardedBuilds).toBeGreaterThan(0);
    settle(f);const uploads=f.lighting.getDiagnostics().uploadBytes;
    const jobs=f.worker.messages.filter(m=>m.kind==='build').length;
    for(let i=0;i<10;i++){f.state.clouds.timeSec+=.016;tuning.rockContactAO=.1+i*.01;f.lighting.tick();}
    expect(f.lighting.getDiagnostics().uploadBytes).toBe(uploads);
    expect(f.worker.messages.filter(m=>m.kind==='build')).toHaveLength(jobs);
    f.state.castShadow=false;f.lighting.tick();expect(fake.quads[1].visible).toBe(true);
    const uniforms=new Map();fake.quads[1].config.setupUniforms((k:string,v:unknown)=>uniforms.set(k,v));
    expect(uniforms.get('uRockContactAO')).toBe(tuning.rockContactAO);
    expect(uniforms.get('uOptions')[0]).toBe(0); // Night: contact remains, direct light is zero.
    f.state.clouds=undefined;f.lighting.tick();
    expect(f.worker.messages.filter(m=>m.kind==='rim').at(-1).rim).toBeNull();
    settle(f);expect(fake.quads[1].visible).toBe(false);f.lighting.destroy();
  });
  it('erases only the destroyed cell receiver rectangle while the worker rebuilds neighbouring lighting',()=>{
    const f=fixture();settle(f);f.upload.mockClear();
    const before=f.lighting.getDiagnostics().uploadBytes;
    f.states[0].active=false;f.lighting.invalidate([0]);
    expect(f.upload).toHaveBeenCalledTimes(2);
    for(const call of f.upload.mock.calls) {
      expect(call.slice(2,6)).toEqual([65,65,16,16]);
      const data=call[8] as Uint8Array;
      expect(data).toHaveLength(16*16*4);
    }
    const field=f.upload.mock.calls[0][8] as Uint8Array;
    expect(field.filter((_,i)=>i%4===2||i%4===3).every(v=>v===0)).toBe(true);
    const occlusion=f.upload.mock.calls[1][8] as Uint8Array;
    expect(occlusion.slice(0,4)).toEqual(new Uint8Array([255,0,0,255]));
    expect(f.lighting.getDiagnostics().uploadBytes-before).toBe(16*16*8);
    expect(f.lighting.getDiagnostics().pendingChunks).toBe(1);
    f.lighting.destroy();
  });
  it('also clears duplicated receiver samples in adjacent chunk gutters on destruction',()=>{
    const f=fixture(1024,512,16,4);settle(f);f.upload.mockClear();
    f.states[0].active=false;f.lighting.invalidate([0]);
    const widths=f.upload.mock.calls.map(call=>call[4]);
    expect(widths.sort((a,b)=>a-b)).toEqual([1,1,16,16]);
    f.lighting.destroy();
  });
  it('retains completed resident chunks across camera traversal without rebuilding or uploading on return',()=>{
    const f=fixture(2048,1024);settle(f);
    const first=f.lighting.getDiagnostics().builds;
    f.lighting.updateView({x:1536,y:512,width:400,height:400});f.lighting.tick();settle(f);
    expect(f.lighting.getDiagnostics().builds).toBeGreaterThan(first);
    const builds=f.worker.messages.filter(m=>m.kind==='build').length;f.upload.mockClear();
    f.lighting.updateView({x:0,y:0,width:400,height:400});f.lighting.tick();
    expect(f.worker.messages.filter(m=>m.kind==='build')).toHaveLength(builds);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.lighting.getDiagnostics().residentEvictions).toBe(0);
    f.lighting.destroy();
  });
  it('discards stale worker results on destruction and releases every listener, texture and shader on teardown',()=>{
    const f=fixture();f.states[0].active=false;f.lighting.invalidate([0]);f.upload.mockClear();
    f.worker.reply();f.lighting.tick();
    expect(f.upload).not.toHaveBeenCalled();expect(f.lighting.getDiagnostics().pendingChunks).toBe(1);
    expect(f.worker.messages.filter(m=>m.kind==='change')).toHaveLength(1);
    f.worker.reply();f.lighting.tick();expect(f.lighting.getDiagnostics().pendingChunks).toBe(0);
    f.lighting.destroy();f.lighting.destroy();
    expect(f.lighting.getReceiverBinding()).toBeNull();
    expect(f.worker.onmessage).toBeNull();expect(f.worker.onerror).toBeNull();
    expect(f.worker.terminate).toHaveBeenCalledOnce();expect(f.remove).toHaveBeenCalledTimes(3);
    for(const q of fake.quads)expect(q.destroy).toHaveBeenCalledOnce();expect(fake.deleted).toHaveBeenCalledTimes(2);
  });
});

it('rebakes only across azimuth bins, blends on the presentation clock and releases horizon history',async()=>{
  const {createSunPath,resolveSunPath}=await import('../src/effects/sunlight/SunPath');
  const {createSunTuning}=await import('../src/effects/sunlight/SunAtmosphere');
  const f=fixture(),settle=()=>{let guard=100;while(f.lighting.getDiagnostics().pendingChunks&&guard-->0){f.worker.reply();f.lighting.tick();}expect(guard).toBeGreaterThan(0);};settle();
  const path=resolveSunPath(720,90,createSunPath());f.state.clouds={tuning:createSunTuning(),timeSec:0,strength:1,sunPath:path};
  f.lighting.tick();settle();const before=f.worker.messages.filter(m=>m.kind==='build').length,bytes=f.lighting.getDiagnostics().uploadBytes;
  const binding=f.lighting.getReceiverBinding()!;expect(binding.horizonPrevious).toBeDefined();expect(binding.horizonBlend![0]).toBe(0);
  resolveSunPath(720,91,path);for(let i=0;i<20;i++)f.lighting.tick();
  expect(f.worker.messages.filter(m=>m.kind==='build')).toHaveLength(before);expect(f.lighting.getDiagnostics().uploadBytes).toBe(bytes);
  f.state.clouds.timeSec=.3;f.lighting.tick();expect(binding.horizonBlend![0]).toBeCloseTo(.5);
  f.state.clouds.timeSec=.6;f.lighting.tick();expect(binding.horizonBlend![0]).toBe(1);
  resolveSunPath(720,96,path);f.lighting.tick();resolveSunPath(720,102,path);f.worker.reply();f.lighting.tick();
  expect(f.lighting.getDiagnostics().discardedBuilds).toBe(0);settle();
  expect(f.lighting.getDiagnostics().horizonAzimuth).toBe(102);
  f.state.clouds=undefined;f.lighting.tick();settle();expect(f.lighting.getDiagnostics().horizonAzimuth).toBe(135);
  expect(f.lighting.getReceiverBinding()!.horizonPrevious).toBeUndefined();f.lighting.destroy();
});

it('uses quality bins and stops solar horizon jobs on low',async()=>{
  const {SUN_RENDER_QUALITY}=await import('../src/effects/sunlight/SunRenderQuality');
  const {createSunPath,resolveSunPath}=await import('../src/effects/sunlight/SunPath');
  const {createSunTuning}=await import('../src/effects/sunlight/SunAtmosphere');
  const f=fixture(),settle=()=>{let guard=100;while(f.lighting.getDiagnostics().pendingChunks&&guard-->0){f.worker.reply();f.lighting.tick();}expect(guard).toBeGreaterThan(0);};settle();
  const path=resolveSunPath(720,96,createSunPath());
  f.state.clouds={tuning:createSunTuning(),timeSec:0,strength:1,sunPath:path,quality:SUN_RENDER_QUALITY.medium};
  f.lighting.tick();settle();const jobs=()=>f.worker.messages.filter(m=>m.kind==='build').length,before=jobs();
  resolveSunPath(720,100,path);f.lighting.tick();expect(jobs()).toBe(before);
  resolveSunPath(720,103,path);f.lighting.tick();settle();expect(jobs()).toBeGreaterThan(before);
  f.state.clouds.quality=SUN_RENDER_QUALITY.low;f.lighting.tick();settle();const low=jobs();
  expect(f.worker.messages.filter(m=>m.kind==='build').at(-1).horizons).toBe(false);
  resolveSunPath(720,150,path);f.lighting.tick();expect(jobs()).toBe(low);
  expect(f.lighting.getReceiverBinding()!.options[2]).toBe(0);
  f.state.clouds.quality=SUN_RENDER_QUALITY.high;f.lighting.tick();settle();expect(jobs()).toBeGreaterThan(low);
  f.lighting.destroy();
});

it('uses canonical V7 coverage and transfers only a private copy, retaining it after teardown',()=>{
  const f=fixture(512,512,4,4,WOODLAND_ROCK_HEIGHT_KEY);
  expect(f.getCoverage).toHaveBeenCalledWith(WOODLAND_ROCK_COVERAGE_KEY);
  const source=f.worker.messages[0].source.alpha as Uint8Array;
  expect(source).toEqual(f.coverage);expect(source.buffer).not.toBe(f.coverage.buffer);
  structuredClone(source,{transfer:[source.buffer]});
  expect([...f.coverage]).toEqual([0,61,199,255]);
  f.lighting.destroy();expect(f.remove).not.toHaveBeenCalledWith(WOODLAND_ROCK_HEIGHT_KEY);
});


it('makes every chunk ready under a sun faster than the worker and converges when the clock stops',async()=>{
 const {createSunTuning}=await import('../src/effects/sunlight/SunAtmosphere');
 const {createSunPath,resolveSunPath}=await import('../src/effects/sunlight/SunPath');
 const f=fixture(2048,1024),path=createSunPath();f.state.clouds={tuning:createSunTuning(),timeSec:0,strength:1,sunPath:path};
 f.lighting.updateView({x:0,y:0,width:1400,height:600});
 for(let frame=0;frame<36;frame++){
  resolveSunPath(480+frame*24,null,path);f.state.clouds.timeSec=frame;
  f.worker.reply();f.lighting.tick();
 }
 const residents=(f.lighting as any).resident as Map<string,{ready:boolean}>;
 expect([...residents.values()].every(r=>r.ready)).toBe(true);
 for(let i=0;i<100&&f.lighting.getDiagnostics().pendingChunks;i++){f.worker.reply();f.lighting.tick();}
 expect(f.lighting.getDiagnostics().pendingChunks).toBe(0);
 const builds=f.lighting.getDiagnostics().builds;for(let i=0;i<20;i++)f.lighting.tick();expect(f.lighting.getDiagnostics().builds).toBe(builds);
 f.lighting.destroy();
});

it('reaches resident readiness at both ends of every authored world without exhausting the slot atlas',async()=>{
 const {COOP_DEFENSE_MAP_CONFIGS}=await import('../src/config/coopDefenseMaps');
 const {CELL_SIZE}=await import('../src/config');
 for(const map of COOP_DEFENSE_MAP_CONFIGS){
  const width=map.arenaWidthCells*CELL_SIZE,height=map.arenaHeightCells*CELL_SIZE,f=fixture(width,height);
  for(const x of [0,Math.max(0,width-1200),0]){
   f.lighting.updateView({x,y:0,width:Math.min(1200,width),height:Math.min(700,height)});
   let guard=100;while(f.lighting.getDiagnostics().pendingChunks&&guard-->0){f.worker.reply();f.lighting.tick();}
   const d=f.lighting.getDiagnostics();expect(d.pendingChunks,map.mapId).toBe(0);expect(d.overflow,map.mapId).toBe(false);expect(d.error,map.mapId).toBeNull();
   expect([...((f.lighting as any).resident as Map<string,{ready:boolean}>).values()].every(r=>r.ready),map.mapId).toBe(true);
  }
  f.lighting.destroy();
 }
});
