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
    reply(){const request=this.messages.filter(m=>m.kind==='build'||m.kind==='repair').at(-1);
      const result=(chunk:any)=>({...chunk,azimuth:request.azimuth,data:new Uint8Array(FORMATION_SIDE*FORMATION_SIDE*4).fill(request.kind==='repair'?100:255),occlusion:new Uint8Array(FORMATION_SIDE*FORMATION_SIDE*4).fill(request.kind==='repair'?200:255),buildMs:1});
      this.onmessage?.({data:request.kind==='repair'?{kind:'repair',revision:request.revision,results:request.chunks.map(result),buildMs:1}:result(request)});}
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
  it('lends geometry independently of light debug and rejects stale worker-only repairs',()=>{
    const f=fixture();settle(f);
    const coverage=f.lighting.getCoverageBinding();expect(coverage).not.toBeNull();
    expect(coverage!.fogShadows!.occlusion).toBe(f.lighting.getReceiverBinding()!.occlusion);
    expect(coverage!.fogShadows!.solarEnabled).toBe(true);
    f.lighting.setDebugSuppressed(true,true,true);f.state.enabled=false;
    expect(f.lighting.getReceiverBinding()).toBeNull();
    expect(f.lighting.getCoverageBinding()).toBe(coverage);
    expect(coverage!.fogShadows!.strength).toBe(0);
    f.state.enabled=true;f.state.castShadow=false;
    expect(f.lighting.getCoverageBinding()!.fogShadows!.solarEnabled).toBe(false);
    f.states[0].active=false;f.lighting.invalidate([0]);
    expect(f.lighting.getCoverageBinding()).toBeNull();
    settle(f);expect(f.lighting.getCoverageBinding()).toBe(coverage);
    f.lighting.destroy();expect(f.lighting.getCoverageBinding()).toBeNull();
  });
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
  it('keeps exact resident bytes untouched until an entire geometry repair is available',()=>{
    const f=fixture();settle(f);f.upload.mockClear();
    const before=f.lighting.getDiagnostics().uploadBytes;
    f.states[0].active=false;f.lighting.invalidate([0]);
    expect(f.upload).not.toHaveBeenCalled();expect(f.lighting.getDiagnostics().uploadBytes).toBe(before);
    expect(f.lighting.getDiagnostics().pendingChunks).toBe(1);
    f.lighting.tick();expect(f.upload).not.toHaveBeenCalled();
    f.worker.reply();expect(f.upload).not.toHaveBeenCalled();
    f.lighting.tick();expect(f.upload).toHaveBeenCalledTimes(2);
    expect(f.lighting.getDiagnostics().pendingChunks).toBe(0);
    expect(f.lighting.getDiagnostics().repairBatches).toBe(1);
    expect(f.lighting.getReceiverBinding()!.horizonBlend![0]).toBe(1);
    f.lighting.destroy();
  });
  it('publishes all chunk-border receivers together and discards superseded explosion transactions',()=>{
    const f=fixture(1024,512,16,4);settle(f);f.upload.mockClear();
    f.states[0].active=false;f.lighting.invalidate([0]);f.lighting.tick();
    const first=f.worker.messages.at(-1);expect(first.kind).toBe('repair');expect(first.chunks).toHaveLength(2);
    f.states.push({...f.states[0],id:1,gridX:15});f.lighting.invalidate([1]);
    f.worker.reply();f.lighting.tick();expect(f.upload).not.toHaveBeenCalled();
    expect(f.lighting.getDiagnostics().discardedBuilds).toBe(2);
    const second=f.worker.messages.at(-1);expect(second.revision).toBeGreaterThan(first.revision);
    f.worker.reply();expect(f.upload).not.toHaveBeenCalled();f.lighting.tick();
    expect(f.upload).toHaveBeenCalledTimes(4);expect(f.lighting.getDiagnostics().pendingChunks).toBe(0);
    expect(f.lighting.getDiagnostics().repairBatches).toBe(1);
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
  it('uploads the union of changed normal/coverage and occlusion samples, preserving atlas coordinates',()=>{
    const f=fixture();settle(f);f.upload.mockClear();
    f.states[0].active=false;f.lighting.invalidate([0]);f.lighting.tick();
    const request=f.worker.messages.at(-1), chunk=request.chunks[0];
    const data=new Uint8Array(FORMATION_SIDE**2*4).fill(255),occlusion=data.slice();
    data[(20*FORMATION_SIDE+100)*4]=128;
    occlusion[(22*FORMATION_SIDE+105)*4+3]=180;
    f.worker.onmessage?.({data:{kind:'repair',revision:request.revision,buildMs:1,
      results:[{...chunk,azimuth:request.azimuth,data,occlusion,buildMs:1}]}});
    f.lighting.tick();expect(f.upload).toHaveBeenCalledTimes(2);
    for(const call of f.upload.mock.calls)expect(call.slice(2,6)).toEqual([100,20,6,3]);
    expect(f.lighting.getDiagnostics().lastRepairPublishMs).toBeGreaterThanOrEqual(0);
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
  const fog=f.lighting.getCoverageBinding()!.fogShadows!;
  expect(fog.solarEnabled).toBe(false);expect(fog.occlusion).toBeDefined();
  expect(fog.horizonPrevious).toBeUndefined();
  f.state.clouds.quality=SUN_RENDER_QUALITY.high;f.lighting.tick();settle();expect(jobs()).toBeGreaterThan(low);
  expect(f.lighting.getCoverageBinding()!.fogShadows!.solarEnabled).toBe(true);
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

it('never fades from a fabricated or obsolete geometry repair, even during a sun transition',async()=>{
 const {createSunPath,resolveSunPath}=await import('../src/effects/sunlight/SunPath');
 const {createSunTuning}=await import('../src/effects/sunlight/SunAtmosphere');
 const settle=(f:ReturnType<typeof fixture>)=>{let guard=100;while(f.lighting.getDiagnostics().pendingChunks&&guard-->0){f.worker.reply();f.lighting.tick();}expect(guard).toBeGreaterThan(0);};
 const f=fixture();f.state.clouds={tuning:createSunTuning(),timeSec:0,strength:1,sunPath:resolveSunPath(720,null,createSunPath())};
 settle(f);f.state.clouds.timeSec=1;f.lighting.tick();
 f.states[0].active=false;f.lighting.invalidate([0]);settle(f);
 const binding=f.lighting.getReceiverBinding()!;expect(binding.horizonBlend![0]).toBe(1);
 f.state.clouds.timeSec=1.09;f.lighting.tick();expect(binding.horizonBlend![0]).toBe(1);
 f.state.clouds.timeSec=1.18;f.lighting.tick();expect(binding.horizonBlend![0]).toBeCloseTo(1);
 f.lighting.destroy();
});

import { RockFormationGpuRepair } from '../src/arena/rocks/RockFormationGpuRepair';
import { FORMATION_REPAIR_LIGHT, FORMATION_REPAIR_SHADERS, formationRepairLightTaps, REPAIR_DISTANCE_PASSES } from '../src/arena/rocks/formationRepairShaders';
import { RockFormationField } from '../src/arena/rocks/RockFormationField';

function gpuFixture(error=0) {
  let id=1,unit=0,texture:any,program:any,attachment:any,read=0;
  const bindings=new Map<number,any>(),draws:any[]=[];
  const gl:any={createVertexArray:vi.fn(), // Phaser's WebGL1 shim, NOT WebGL2.
    getExtension:(name:string)=>name==='OES_vertex_array_object'?{createVertexArrayOES:()=>({}),bindVertexArrayOES(){},deleteVertexArrayOES(){}}:
      name==='OES_texture_float'||name==='WEBGL_color_buffer_float'?{}:null,
    getShaderPrecisionFormat:()=>({precision:23}),isEnabled:()=>true,
    createFramebuffer:()=>({}),createBuffer:()=>({}),createTexture:()=>({id:id++}),
    createProgram:()=>({source:'',uniforms:new Map()}),createShader:()=>({source:''}),
    shaderSource:(s:any,source:string)=>s.source=source,attachShader:(p:any,s:any)=>p.source+=s.source,
    getShaderParameter:()=>true,getProgramParameter:()=>true,checkFramebufferStatus:()=>gl.FRAMEBUFFER_COMPLETE,
    activeTexture:(n:number)=>unit=n-gl.TEXTURE0,bindTexture:(_target:number,t:any)=>{texture=t;bindings.set(unit,t);},
    texImage2D:(_target:number,_level:number,format:number,w:number,h:number)=>{expect([gl.RGBA,gl.LUMINANCE]).toContain(format);texture.width=w;texture.height=h;},
    framebufferTexture2D:(_target:number,_attachment:number,_type:number,t:any)=>attachment=t,
    useProgram:(p:any)=>program=p,
    getUniformLocation:(p:any,key:string)=>(p.source.match(new RegExp('\\b'+key+'\\b','g'))??[]).length>1?{p,key}:null,
    uniform1i:(l:any,value:number)=>{if(l)l.p.uniforms.set(l.key,value);},
    drawArrays:()=>{
      for(const [key,n] of program.uniforms)if(['uA','uB','uC','uD','uNoise'].includes(key))expect(bindings.get(n)).not.toBe(attachment);
      draws.push({target:attachment,source:program.source});
    },
    readPixels:vi.fn((_x:number,_y:number,_w:number,_h:number,_format:number,_type:number,out:Uint8Array)=>{
      out.fill(128);if(error&&read++===0)out[0]+=error;
    }),copyTexSubImage2D:vi.fn(),texSubImage2D:vi.fn(),
  };
  for(const key of ['RGBA','LUMINANCE','FLOAT','UNSIGNED_BYTE','FRAMEBUFFER','FRAMEBUFFER_COMPLETE','COLOR_ATTACHMENT0','ARRAY_BUFFER','STATIC_DRAW','VERTEX_SHADER','FRAGMENT_SHADER','HIGH_FLOAT','COMPILE_STATUS','LINK_STATUS','TEXTURE_2D','TEXTURE0','NEAREST','CLAMP_TO_EDGE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','UNPACK_PREMULTIPLY_ALPHA_WEBGL','UNPACK_FLIP_Y_WEBGL','TRIANGLES','BLEND','SCISSOR_TEST','DEPTH_TEST','STENCIL_TEST','CULL_FACE','DITHER'])gl[key]=id++;
  for(const key of ['bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','bindFramebuffer','texParameteri','pixelStorei','compileShader','bindAttribLocation','linkProgram','deleteShader','deleteProgram','deleteTexture','deleteBuffer','deleteFramebuffer','uniform1f','uniform2f','uniform4f','viewport','disable','enable','colorMask'])gl[key]=vi.fn();
  const renderer:any={gl,canvas:{addEventListener:vi.fn(),removeEventListener:vi.fn()},renderNodes:{finishBatch:vi.fn()},
    glTextureUnits:{units:[],bindUnits:vi.fn()},glWrapper:{update:vi.fn()}};
  const repair=RockFormationGpuRepair.create(renderer,1024,1024,[],{alpha:new Uint8Array(2176*1870),detail:new Float32Array(16)})!;
  const reference=new Uint8Array(FORMATION_SIDE**2*4).fill(128);
  return {repair,renderer,gl,draws,reference};
}

describe('GPU formation transaction',()=>{
  it('publishes before the destruction frame and rejects a superseded worker repair across a chunk edge',()=>{
    const gpu:any={change:vi.fn(),repair:vi.fn(()=>true),validate:vi.fn(),poll:vi.fn(),destroy:vi.fn(),diagnostics:{available:true}};
    const create=vi.spyOn(RockFormationGpuRepair,'create').mockReturnValue(gpu);
    try {
      const f=fixture(1024,512,15,5);let guard=20;
      while(f.lighting.getDiagnostics().pendingChunks&&guard--){f.worker.reply();f.lighting.tick();}
      f.states[0].active=false;f.lighting.invalidate([0]);
      expect(gpu.change).toHaveBeenLastCalledWith([expect.objectContaining({active:false})]);
      expect(gpu.repair.mock.calls.at(-1)[0].map((c:any)=>c.cx)).toEqual([0,1]);
      expect(f.lighting.getDiagnostics()).toMatchObject({repairLatencyFrames:0,repairPath:'gpu'});
      f.lighting.tick();f.worker.reply(); // old reply is queued, not yet published
      f.states[0].active=true;f.lighting.invalidate([0]);f.upload.mockClear();f.lighting.tick();
      expect(f.upload).not.toHaveBeenCalled();
      expect(f.lighting.getDiagnostics().discardedBuilds).toBeGreaterThan(0);
      f.worker.reply();f.lighting.tick();
      expect(f.upload).not.toHaveBeenCalled(); // worker refreshes CPU mirror only
      expect(f.lighting.getDiagnostics().pendingChunks).toBe(0);
      f.lighting.destroy();expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {create.mockRestore();}
  });
  it('requires actual-channel validation, uses WebGL1 float formats despite Phaser VAO shims, and never reads back during repair',()=>{
    const f=gpuFixture(1),chunk={cx:0,cy:0,slot:0},atlas={field:{} as WebGLTexture,occlusion:{} as WebGLTexture};
    expect(f.repair.available).toBe(false);
    expect(f.repair.repair([chunk],135,true,null,atlas)).toBe(false);
    f.repair.validate(chunk,135,true,null,f.reference,f.reference);
    expect(f.repair.diagnostics.maxChannelError).toBe(1);expect(f.repair.available).toBe(true);
    f.gl.readPixels.mockClear();
    const chunks=[chunk,{cx:1,cy:0,slot:1},{cx:0,cy:1,slot:8},{cx:1,cy:1,slot:9}];
    for(let explosion=0;explosion<2;explosion++) {
      f.repair.change([{id:0,gridX:15,gridY:15,active:false,frame:0}]);
      expect(f.repair.repair(chunks,explosion?35:135,true,{rockRimWidth:14,rockRimHeight:12,rockRimLip:2},atlas)).toBe(true);
    }
    expect(f.gl.copyTexSubImage2D).toHaveBeenCalledTimes(16);expect(f.gl.readPixels).not.toHaveBeenCalled();
    expect(f.gl.copyTexSubImage2D.mock.calls.map((c:any[])=>c.slice(2,4))).toContainEqual([258,258]);
    expect(f.renderer.glWrapper.update).toHaveBeenLastCalledWith(undefined,true,true);
    expect(f.renderer.glTextureUnits.bindUnits).toHaveBeenCalled();
    f.repair.destroy();expect(f.gl.deleteTexture).toHaveBeenCalledTimes(13);
    f.repair.destroy();expect(f.gl.deleteTexture).toHaveBeenCalledTimes(13);
  });
  it('rejects data beyond quantization tolerance and does not publish an unverified result',()=>{
    const f=gpuFixture(2),chunk={cx:0,cy:0,slot:0};
    f.repair.validate(chunk,135,true,null,f.reference,f.reference);
    expect(f.repair.available).toBe(false);expect(f.repair.reason).toContain('parity failed');
    expect(f.gl.copyTexSubImage2D).not.toHaveBeenCalled();f.repair.destroy();
  });
  it('restores Phaser state even if a private pass throws',()=>{
    const f=gpuFixture();f.repair.validate({cx:0,cy:0,slot:0},135,true,null,f.reference,f.reference);
    f.gl.drawArrays=()=>{throw Error('draw failed');};
    expect(()=>f.repair.repair([{cx:0,cy:0,slot:0}],135,true,null,{field:{} as WebGLTexture,occlusion:{} as WebGLTexture})).toThrow('draw failed');
    expect(f.renderer.glWrapper.update).toHaveBeenLastCalledWith(undefined,true,true);f.repair.destroy();
  });
});

describe('repair numerical contract',()=>{
  it('the bounded min-plus passes reproduce the chamfer metric rather than a jump-flood approximation',()=>{
    const side=31,sources=[[8,9],[24,25],[2,27]];
    let a=new Float32Array(side*side).fill(49),b=new Float32Array(a.length);
    for(const [x,y] of sources)a[y*side+x]=0;
    for(const {direction:[dx,dy],stride} of REPAIR_DISTANCE_PASSES) {
      const cost=Math.fround(Math.hypot(dx,dy)*stride);
      for(let y=0;y<side;y++)for(let x=0;x<side;x++) {
        const sample=(xx:number,yy:number)=>xx>=0&&yy>=0&&xx<side&&yy<side?a[yy*side+xx]:49;
        b[y*side+x]=Math.min(a[y*side+x],Math.fround(Math.min(sample(x-dx*stride,y-dy*stride),sample(x+dx*stride,y+dy*stride))+cost));
      }
      [a,b]=[b,a];
    }
    for(let y=0;y<side;y++)for(let x=0;x<side;x++) {
      const expected=Math.min(...sources.map(([sx,sy])=>{const dx=Math.abs(x-sx),dy=Math.abs(y-sy);return Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy);}));
      expect(Math.abs(a[y*side+x]-expected)).toBeLessThan(1e-5);
    }
  });
  it('uses the worker ray lattice including cyclic and axial sun angles',()=>{
    for(const azimuth of [0,35,90,135,180,270,359]) {
      const taps=formationRepairLightTaps(azimuth);
      for(let direction=0;direction<3;direction++)for(let r=0;r<56;r++) {
        const a=(azimuth===135?-Math.PI*.75:-azimuth*Math.PI/180)+[-.045,0,.045][direction];
        const x=Math.round(Math.cos(a)*(r+1)*Math.SQRT2),y=Math.round(Math.sin(a)*(r+1)*Math.SQRT2),i=(direction*56+r)*4;
        expect(taps[i]).toBe(x);expect(taps[i+1]).toBe(y);expect(taps[i+2]).toBe(Math.fround(Math.hypot(x,y)*2));
      }
    }
  });
  it('agrees with reference horizon bytes after repeated holes near a chunk boundary (float32 tap distances)',()=>{
    const states=Array.from({length:25},(_,id)=>({id,gridX:13+id%5,gridY:4+Math.floor(id/5),frame:0,active:true}));
    const field=new RockFormationField(1024,512,states,{alpha:new Uint8Array(2176*1870).fill(255),detail:new Float32Array(16)});
    field.setRimGeometry({rockRimHeight:12,rockRimWidth:14,rockRimLip:2});
    for(const id of [12,13]) {
      states[id].active=false;field.invalidate([id]);
      for(const azimuth of [0,135,270]) {
        const ref=field.build(0,0,azimuth),taps=formationRepairLightTaps(azimuth);
        // Receivers/rays fully inside this independently built reference chunk.
        for(let y=60;y<170;y+=7)for(let x=80;x<170;x+=7) {
          const z=ref.heights[y*FORMATION_SIDE+x],p=(y*FORMATION_SIDE+x)*4;
          for(let direction=0;direction<3;direction++) {
            let slope=0;
            for(let r=0;r<56;r++) {
              const i=(direction*56+r)*4,dx=taps[i],dy=taps[i+1],d=taps[i+2];
              if(ref.data[p+3]>102&&d<6)continue;
              slope=Math.max(slope,(ref.heights[(y+dy)*FORMATION_SIDE+x+dx]-z-.2)/d);
            }
            const byte=Math.round(Math.atan(slope)/(Math.PI/2)*255);
            const expected=direction===1?ref.data[p+2]:ref.occlusion[p+(direction===0?1:2)];
            expect(Math.abs(byte-expected)).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  },30000);
  it('declares every sampler used by every composed repair fragment',()=>{
    for(const source of [...Object.values(FORMATION_REPAIR_SHADERS),FORMATION_REPAIR_LIGHT]) {
      const declarations=[...source.matchAll(/uniform\s+sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(',').map(s=>s.trim()));
      for(const match of source.matchAll(/texture2D\(\s*(\w+)/g))expect(declarations).toContain(match[1]);
      // GLSL ES 1.00 fragment arrays must not require dynamic indexing support.
      const loops=[...source.matchAll(/for\s*\(\s*int\s+(\w+)\s*=/g)].map(m=>m[1]);
      for(const array of source.matchAll(/\b(?:vec[234]|float|int)\s+(\w+)\s*\[\d+\]/g)) {
        for(const index of source.matchAll(new RegExp('\\b'+array[1]+'\\[([^\\]]+)\\]','g')))
          expect(/^\d+$/.test(index[1])||loops.includes(index[1])).toBe(true);
      }
    }
  });
});


it('preserves Phaser indexed geometry and atlas bindings through multi-chunk preparation and GPU repair', async()=>{
  const {createRequire}=await import('node:module'),{resolve}=await import('node:path');
  const require=createRequire(resolve('package.json'));
  const Wrapper=require(resolve('node_modules/phaser/src/renderer/webgl/wrappers/WebGLGlobalWrapper.js'));
  const Units=require(resolve('node_modules/phaser/src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js'));
  const f=gpuFixture(),r=f.renderer;
  let vao:any=null,active=0;const indices=new Map<any,any>(),textures=new Map<number,any>();
  const gl:any=new Proxy({...f.gl,ELEMENT_ARRAY_BUFFER:34963,
    bindVertexArray:(v:any)=>{vao=v;},
    bindBuffer:(target:number,buffer:any)=>{if(target===34963)indices.set(vao,buffer);},
    activeTexture:(n:number)=>{active=n-f.gl.TEXTURE0;f.gl.activeTexture(n);},
    bindTexture:(target:number,t:any)=>{textures.set(active,t);f.gl.bindTexture(target,t);},
  },{get:(o,k)=>o[k]??(()=>{})});
  r.gl=gl;r.blendModes=[{enable:true,equation:[32774,32774],func:[1,771,1,771],color:[0,0,0,0]}];r.maxTextures=8;
  r.glWrapper=new Wrapper(r);r.glTextureUnits=new Units(r);
  // Install real wrappers before constructing the instance under test.
  f.repair.destroy();
  const sceneVao={vertexArrayObject:{}},sceneIndex={bufferType:34963,webGLBuffer:{indices:[0,1,2,2,3,0]}};
  r.glWrapper.updateVAO({vao:sceneVao});r.glWrapper.updateBindingsElementArrayBuffer({bindings:{elementArrayBuffer:sceneIndex}});
  r.glWrapper.updateVAO({vao:null});r.glWrapper.updateBindingsElementArrayBuffer({bindings:{elementArrayBuffer:null}});
  r.glWrapper.updateVAO({vao:sceneVao});
  // This is a normal Phaser VAO bind: global EBO cache is null, VAO owns indices.
  expect(r.glWrapper.state.bindings.elementArrayBuffer).toBeNull();
  const atlas={webGLTexture:{}};r.glTextureUnits.bind(atlas,0);
  const ext=gl.getExtension;gl.getExtension=(name:string)=>name==='OES_vertex_array_object'
    ?{createVertexArrayOES:()=>({}),bindVertexArrayOES:gl.bindVertexArray,deleteVertexArrayOES:()=>{}}:ext(name);
  const repair=RockFormationGpuRepair.create(r,1024,1024,[],{alpha:new Uint8Array(2176*1870),detail:new Float32Array(16)})!;
  const assertScene=()=>{expect(vao).toBe(sceneVao.vertexArrayObject);expect(indices.get(vao)).toBe(sceneIndex.webGLBuffer);expect(textures.get(0)).toBe(atlas.webGLTexture);};
  assertScene();
  for(const [cx,cy,slot] of [[0,0,0],[1,0,1],[0,1,8],[1,1,9]]) {
    repair.validate({cx,cy,slot},135,true,null,f.reference,f.reference);assertScene();

  }
  expect(f.gl.copyTexSubImage2D).not.toHaveBeenCalled();
  repair.change([{id:0,gridX:15,gridY:15,active:false,frame:0}]);assertScene();
  repair.repair([{cx:0,cy:0,slot:0},{cx:1,cy:1,slot:9}],135,true,null,{field:{} as WebGLTexture,occlusion:{} as WebGLTexture});
  assertScene();repair.destroy();
});


it('publishes initial worker channels unchanged across four chunks and their shared gutters',()=>{
  const f=fixture(1024,1024,15,15),states=[];
  for(let y=14;y<18;y++)for(let x=14;x<18;x++)states.push({id:states.length,gridX:x,gridY:y,active:true,frame:0});
  const reference=new RockFormationField(1024,1024,states,{alpha:new Uint8Array(2176*1870).fill(255),detail:new Float32Array(64)});
  f.lighting.updateView({x:300,y:300,width:424,height:424});
  const published=new Map<string,{data:Uint8Array;occlusion:Uint8Array}>();
  const captured:Uint8Array[]=[];f.upload.mockImplementation((...a:any[])=>{if(a[4]===FORMATION_SIDE&&a[5]===FORMATION_SIDE)captured.push(Uint8Array.from(a[8]));});
  let guard=20;
  while(f.lighting.getDiagnostics().pendingChunks&&guard--){
    const request=f.worker.messages.filter((m:any)=>m.kind==='build').at(-1);
    const result=reference.build(request.cx,request.cy,request.azimuth,request.horizons);
    f.upload.mockClear();captured.length=0;f.worker.onmessage?.({data:{...request,...result,buildMs:1}});f.lighting.tick();
    const uploads=f.upload.mock.calls.filter(c=>c[4]===FORMATION_SIDE&&c[5]===FORMATION_SIDE);
    expect(uploads).toHaveLength(2);
    expect(Buffer.from(captured[0]).equals(Buffer.from(result.data))).toBe(true);
    expect(Buffer.from(captured[1]).equals(Buffer.from(result.occlusion))).toBe(true);
    published.set(request.cx+','+request.cy,{data:captured[0],occlusion:captured[1]});
  }
  expect(published.size).toBe(4);expect(guard).toBeGreaterThan(0);
  for(const row of [0,1])for(let y=0;y<FORMATION_SIDE;y++)for(const channel of ['data','occlusion'] as const){
    const left=published.get('0,'+row)![channel],right=published.get('1,'+row)![channel];
    for(const x of [0,1])for(let c=0;c<4;c++)expect(left[(y*FORMATION_SIDE+256+x)*4+c]).toBe(right[(y*FORMATION_SIDE+x)*4+c]);
  }
  f.lighting.destroy();
},15000);

it('isolates rock receivers without changing data, worker jobs or readiness',()=>{
  const f=fixture();f.worker.reply();f.lighting.tick();const jobs=f.worker.messages.length,bytes=f.lighting.getDiagnostics().uploadBytes;
  const binding=f.lighting.getReceiverBinding();expect(binding).not.toBeNull();
  f.lighting.setDebugSuppressed(true,false,false);f.lighting.tick();
  expect(fake.quads.map(q=>q.visible)).toEqual([false,true]);expect(f.lighting.getReceiverBinding()).toBe(binding);
  f.lighting.setDebugSuppressed(false,true,true);f.lighting.tick();
  expect(fake.quads.map(q=>q.visible)).toEqual([true,false]);expect(f.lighting.getReceiverBinding()).toBeNull();
  f.lighting.setDebugSuppressed(false,false,false);f.lighting.tick();
  expect(fake.quads.every(q=>q.visible)).toBe(true);expect(f.lighting.getReceiverBinding()).toBe(binding);
  expect(f.worker.messages).toHaveLength(jobs);expect(f.lighting.getDiagnostics()).toMatchObject({uploadBytes:bytes,pendingChunks:0});f.lighting.destroy();
});


it('uploads zero-alpha ray/occupancy data unchanged after Phaser colour uploads leave PMA and flip enabled',()=>{
  const f=gpuFixture();let pma=true,flip=true;const uploads:{width:number;data:Float32Array|Uint8Array}[]=[];
  f.gl.pixelStorei=(name:number,value:number)=>{if(name===f.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)pma=!!value;if(name===f.gl.UNPACK_FLIP_Y_WEBGL)flip=!!value;};
  f.renderer.glWrapper.update.mockImplementation(()=>{pma=true;flip=true;});
  f.gl.texSubImage2D.mockImplementation((_t:number,_l:number,_x:number,_y:number,w:number,h:number,_fmt:number,_type:number,input:Float32Array|Uint8Array)=>{
    const out=input.slice(),stride=w*4;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<4;c++){
      const dst=(y*w+x)*4+c,src=((flip?h-1-y:y)*w+x)*4+c;
      out[dst]=input[src]*(pma&&c<3?input[src-c+3]/(input instanceof Uint8Array?255:1):1);
    }
    uploads.push({width:w,data:out});
  });
  f.repair.validate({cx:0,cy:0,slot:0},60,true,null,f.reference,f.reference);
  expect(uploads[0].data).toEqual(formationRepairLightTaps(60));
  expect(pma&&flip).toBe(true); // preserve caller state after the private scope
  f.repair.change([{id:0,gridX:15,gridY:15,active:true,frame:3}]);
  expect([...uploads.at(-1)!.data]).toEqual([4,0,0,0]);
  expect(pma&&flip).toBe(true);f.repair.destroy();
});
