import { describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({shaders:[] as any[]}));
vi.mock('phaser',()=>({BlendModes:{NORMAL:0,SCREEN:3},Textures:{FilterMode:{LINEAR:0}},Utils:{Array:{Remove:(a:any[],v:any)=>{const i=a.indexOf(v);if(i>=0)a.splice(i,1);}}},
  GameObjects:{Shader:class {
    scene:any;config:any;width:number;height:number;renderNode:any;texture:any;glTexture:any;drawingContext:any;
    textures:any[];renderToTexture=false;callbacks:(()=>void)[]=[];uniforms:Record<string,any>={};destroyed=false;
    constructor(scene:any,config:any,_x:number,_y:number,w:number,h:number,textures:any[]){
      this.scene=scene;this.config=config;this.width=w;this.height=h;this.textures=textures.map(t=>typeof t==='string'?scene.textures.get(t):t);
      const renderer=scene.sys.renderer,vao={destroy:vi.fn()};
      renderer.glVAOWrappers.push(vao);renderer.shaderProgramFactory.programs[config.shaderName]={};
      this.renderNode={renderer,manager:renderer.renderNodes,programManager:{programs:{main:{vao}}},vertexBufferLayout:{buffer:{}},
        run:()=>{this.config.setupUniforms((k:string,v:any)=>this.uniforms[k]=Array.isArray(v)?v.slice():v);}};
      fake.shaders.push(this);
    }
    once(_e:string,f:()=>void){this.callbacks.push(f);return this;}
    setRenderToTexture(){this.renderToTexture=true;this.glTexture={};this.texture={get:()=>({source:{glTexture:this.glTexture}}),setFilter:vi.fn(),destroy:vi.fn()};this.drawingContext={state:{blend:{}},camera:{destroy:vi.fn()},destroy:vi.fn()};return this;}
    renderWebGLStep(){this.renderNode.run();}
    setTextures(textures:any[]){this.textures=textures;return this;}
    visible=true;blendMode=0;
    setVisible(value:boolean){this.visible=value;return this;}
    setOrigin(){return this;}setScrollFactor(){return this;}setDepth(){return this;}setBlendMode(value:number){this.blendMode=value;return this;}
    setPosition(){return this;}setSize(w:number,h:number){this.width=w;this.height=h;return this;}
    destroy(){if(this.destroyed)return;this.destroyed=true;for(const f of this.callbacks)f();this.texture?.destroy();this.drawingContext?.destroy();}
  }}
}));
vi.mock('../src/scenes/arena/ClarityCameraRegistry',()=>({getClarityCameraRegistry:()=>null}));
import { GraphicsQualityController, GRAPHICS_QUALITY_PROFILES } from '../src/graphics/GraphicsQuality';
import { WorldSunComposite, SUN_COMPOSITE_FRAGMENT } from '../src/effects/sunlight/WorldSunComposite';
import { createSunTuning } from '../src/effects/sunlight/SunAtmosphere';
import { createSunPath } from '../src/effects/sunlight/SunPath';
import { sunRenderWorld, cloudFieldSize, SUN_RENDER_QUALITY } from '../src/effects/sunlight/SunRenderQuality';
import { VEGETATION_LIGHT_HEADER, VEGETATION_LIGHT_PROCESS } from '../src/effects/sunlight/VegetationLighting';
import { CLOUD_FIELD_FRAGMENT } from '../src/effects/sunlight/CloudFieldTexture';
import type { SunCloudState } from '../src/effects/sunlight/cloudShadow';

function fixture(canopies:any[]=[]){
  fake.shaders.length=0;
  const renderer={gl:{ZERO:0,ONE:1,DST_COLOR:774,SRC_COLOR:768,FUNC_ADD:32774,MAX_TEXTURE_IMAGE_UNITS:4,CLAMP_TO_EDGE:33071,LINEAR:9729,TEXTURE_2D:3553,TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,texParameteri:vi.fn(),getParameter:()=>16},
    createTexture2D:vi.fn(()=>({})),blendModes:Array.from({length:18},()=>({enabled:true,func:[1,771,1,771],equation:[3,3]})),addBlendMode:vi.fn(function(this:any,func:number[],equation:number){return this.blendModes.push({enabled:true,func:[...func,...func],equation:[equation,equation]})-2;}),updateBlendMode:vi.fn(function(this:any,index:number,func:number[],equation:number){this.blendModes[index]={enabled:true,func:func.slice(),equation:[equation,equation]};}),glVAOWrappers:[],deleteBuffer:vi.fn(),deleteProgram:vi.fn(),shaderProgramFactory:{programs:{}},
    glTextureUnits:{bind:vi.fn()},glWrapper:{update:vi.fn(),updateBlend:vi.fn()},renderNodes:{finishBatch:vi.fn()}};
  const source={glTexture:{}},texture={source:[source],get:()=>({source})};
  const scene={sys:{renderer},textures:{get:()=>texture,addGLTexture:vi.fn((key:string)=>({...texture,key})),remove:vi.fn()},add:{particles:vi.fn(),existing:(x:any)=>x}};
  const quality=new GraphicsQualityController();quality.attach(scene as never);
  const tuning=createSunTuning(),clouds:SunCloudState={tuning,timeSec:0,strength:1,sunPath:createSunPath()};
  const owner=new WorldSunComposite(scene as never,tuning,{enabled:true,normals:false,strength:1,sun:[0,0,1]},clouds,canopies);
  return {renderer,scene,quality,owner,clouds};
}
describe('reduced sunlight resources',()=>{
  it('uses existing quality profiles with descending costs',()=>{
    for(const q of ['high','medium','low'] as const)expect(GRAPHICS_QUALITY_PROFILES[q].sunlight).toBe(SUN_RENDER_QUALITY[q]);
    const {high,medium,low}=SUN_RENDER_QUALITY;
    expect(high.cloudMaxPixels).toBeGreaterThan(medium.cloudMaxPixels);
    expect(medium.cloudMaxPixels).toBeGreaterThan(low.cloudMaxPixels);
    expect(high.horizonStep).toBeLessThan(medium.horizonStep);
    expect(low.horizons).toBe(false);
    expect(low.ecologyDensity).toBeLessThan(high.ecologyDensity);
  });
  it('retains world coordinates across zoom, backing scale and offset viewports',()=>{
    const f=fixture();f.owner.setEnabled(true);
    const quad=fake.shaders.find(s=>!s.renderToTexture&&s.config.name.includes('CompositeDisplay'));
    for(const zoom of [.5,1,1.25,2,4]){
      const camera={x:137,y:81,width:1664,height:936,originX:0,originY:0,scrollX:-123.5,scrollY:377.25,zoom,zoomX:zoom,zoomY:zoom,worldView:{x:-123.5,y:377.25,width:1664/zoom,height:936/zoom}};
      quad.renderNode.run({camera,renderer:f.renderer,blendMode:0,state:{blend:f.renderer.blendModes[0]}},quad);
      const material=fake.shaders.find(s=>s.config.name.includes('CompositeMaterial')),w=material.uniforms.uSunWorld;
      expect(w[0]+64/(1664+128)*w[2]).toBeCloseTo(camera.worldView.x,8);
      expect(w[1]+64/(936+128)*w[3]).toBeCloseTo(camera.worldView.y,8);
      expect(material.width).toBe(896);expect(material.height).toBe(532);
      const out=[0,0,0,0];sunRenderWorld(out,-123.5,377.25,1664/zoom,936/zoom,zoom,zoom);expect(w).toEqual(out);
    }
    f.owner.destroy();f.quality.destroy();
  });
  it('hot switches and releases textures, VAOs, buffers and programs',()=>{
    const f=fixture();f.owner.setEnabled(true);f.owner.prepareClouds(-100,-200,4000,3000);
    const first=f.owner.diagnostics.clouds!.builds,cache=f.clouds.cache;
    f.owner.prepareClouds(-100,-200,4000,3000);expect(f.owner.diagnostics.clouds!.builds).toBe(first);
    f.clouds.timeSec=.016;f.owner.prepareClouds(-100,-200,4000,3000);expect(f.owner.diagnostics.clouds!.builds).toBe(first+1);
    expect(f.clouds.cache).toBe(cache);
    f.quality.setLevel('low');f.owner.setEnabled(true);f.owner.prepareClouds(-100,-200,4000,3000);
    expect(f.owner.diagnostics.clouds!.rgbaBytes).toBeLessThanOrEqual(SUN_RENDER_QUALITY.low.cloudMaxPixels*4);
    f.quality.setLevel('high');f.owner.setEnabled(true);f.owner.prepareClouds(-100,-200,4000,3000);
    expect(f.owner.diagnostics.clouds!.rgbaBytes).toBeLessThanOrEqual(SUN_RENDER_QUALITY.high.cloudMaxPixels*4);
    f.owner.destroy();f.owner.destroy();f.quality.destroy();
    expect(f.clouds.cache).toBeUndefined();expect(fake.shaders.every(s=>s.destroyed)).toBe(true);
    expect(f.renderer.glVAOWrappers).toHaveLength(0);expect(f.renderer.shaderProgramFactory.programs).toEqual({});
    expect(f.renderer.deleteBuffer).toHaveBeenCalledTimes(fake.shaders.length);
    for(const s of fake.shaders.filter(s=>s.renderToTexture)){
      expect(s.texture.destroy).toHaveBeenCalledTimes(1);expect(s.drawingContext.destroy).toHaveBeenCalledTimes(1);expect(s.drawingContext.camera.destroy).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps neutral modulate-2x exactly representable through RGBA8',()=>{
    const encoded=Math.round((.5+.5/255)*255)/255;
    expect(2*(encoded-.5/255)).toBe(1);
  });
});

it('keeps the cloud texture independent of solar direction, invalidates optics and freezes on pause',()=>{
 const f=fixture();f.owner.prepareClouds(0,0,1000,1000);
 let builds=f.owner.diagnostics.clouds!.builds;
 const unchanged=()=>{f.owner.prepareClouds(0,0,1000,1000);expect(f.owner.diagnostics.clouds!.builds).toBe(builds);};
 for(const angle of [0,90,180,270]){f.clouds.sunPath!.azimuth=angle;f.clouds.sunPath!.direction=[Math.cos(angle),Math.sin(angle)];f.clouds.sunPath!.elevation=.5;unchanged();}
 for(const key of ['cloudWarp','cloudSoftness','cloudDensity','cloudCover'] as const){f.clouds.tuning[key]+=.01;
  f.owner.prepareClouds(0,0,1000,1000);expect(f.owner.diagnostics.clouds!.builds).toBe(++builds);unchanged();}
 f.owner.destroy();f.quality.destroy();
});

it('program disposal cannot disable the regular sprite VAO (Phaser 4.2.1 regression)',async()=>{
 const {createRequire}=await import('node:module');
 const require=createRequire(process.cwd()+'/package.json');
 const Program=require(process.cwd()+'/node_modules/phaser/src/renderer/webgl/wrappers/WebGLProgramWrapper.js');
 const {ownSunShader}=await import('../src/effects/sunlight/SunRenderTarget');
 const regular={enabled:true},neutral={enabled:true};let active=regular;
 const gl={isContextLost:()=>false,deleteProgram:vi.fn(),disableVertexAttribArray:()=>{active.enabled=false;}};
 const program={webGLProgram:{},renderer:{gl},glAttributes:[{location:0}],glUniforms:new Map(),glAttributeNames:new Map(),uniformRequests:new Map()};
 let dispose!:()=>void;
 const renderer={renderNodes:{finishBatch:vi.fn()},glWrapper:{update:(state:any)=>{if(state.vao===null)active=neutral;}},
  glVAOWrappers:[],deleteBuffer:vi.fn(),shaderProgramFactory:{programs:{Regression:program}},
  deleteProgram:(value:any)=>Program.prototype.destroy.call(value)};
 const shader={renderNode:{renderer,programManager:{programs:{}},vertexBufferLayout:{buffer:{}}},once:(_e:string,fn:()=>void)=>{dispose=fn;}};
 ownSunShader(shader as never,'Regression');dispose();
 expect(regular.enabled).toBe(true);expect(neutral.enabled).toBe(false);
 expect(renderer.shaderProgramFactory.programs).toEqual({});expect(gl.deleteProgram).toHaveBeenCalledOnce();
});


it('bounds rectangular world fields and retains the original world origin across quality changes',()=>{
 const f=fixture();f.owner.setEnabled(true);const size=[0,0];
 for(const level of ['high','medium','low'] as const){f.quality.setLevel(level);
  for(const [width,height] of [[9984,1792],[1792,9984],[12800,1056],[4096,4096],[1,1],[1e8,1e8]]){
   const q=SUN_RENDER_QUALITY[level];cloudFieldSize(size,width,height,q);
   expect(size[0]*size[1]).toBeLessThanOrEqual(q.cloudMaxPixels);expect(Math.max(...size)).toBeLessThanOrEqual(q.cloudMaxAxis);
   f.owner.prepareClouds(-100,40,width,height);const d=f.owner.diagnostics.clouds!;
   expect([d.width,d.height]).toEqual(size);expect(d.rgbaBytes).toBe(size[0]*size[1]*4);
   expect(d.worldTexelX).toBeCloseTo(width/d.width);expect(d.worldTexelY).toBeCloseTo(height/d.height);
   if(width===9984){expect(d.worldTexelX).toBeLessThanOrEqual(q.cloudTexel);expect(d.worldTexelY).toBeLessThanOrEqual(q.cloudTexel);}
   const shader=fake.shaders.find(s=>s.config.name.includes('CloudField'));expect(Array.from(shader.uniforms.uFieldWorld)).toEqual([-100,40,width,height]);
  }
 }
 f.owner.destroy();f.quality.destroy();
});

it('declares uniforms and samplers in the actual composite and cloud fragments',()=>{
 for(const source of [SUN_COMPOSITE_FRAGMENT,CLOUD_FIELD_FRAGMENT,VEGETATION_LIGHT_HEADER+VEGETATION_LIGHT_PROCESS]){
  const declared=new Set([...source.matchAll(/uniform\s+\w+\s+([^;]+);/g)].flatMap(m=>m[1].split(',').map(s=>s.trim())));
  const used=new Set([...source.replace(/\/\/[^\n]*/g,'').matchAll(/\bu[A-Z]\w*/g)].map(m=>m[0]));
  for(const name of used)expect(declared,name).toContain(name);
 }
});


it('restores finite-field edge sampling after the real Phaser POT resize',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(process.cwd()+'/package.json');
 const Wrapper=require(process.cwd()+'/node_modules/phaser/src/renderer/webgl/wrappers/WebGLTextureWrapper.js');
 const {clampSunRenderTexture}=await import('../src/effects/sunlight/SunRenderTarget');
 const f=fixture(),gl={...f.renderer.gl,REPEAT:10497,NEAREST:9728};
 const renderer={...f.renderer,gl,config:{antialias:false,mipmapRegeneration:true},mipmapFilter:9987};
 const texture={width:3,height:3,renderer,isRenderTexture:true,wrapS:gl.CLAMP_TO_EDGE,wrapT:gl.CLAMP_TO_EDGE,
  minFilter:gl.LINEAR,magFilter:gl.LINEAR,_processTexture:vi.fn()};
 for(const [w,h] of [[1024,256],[512,128],[256,64],[896,532],[1024,256]]){
  Wrapper.prototype.resize.call(texture,w,h);
  if(w===1024)expect(texture.wrapT).toBe(gl.REPEAT); // Demonstrates the installed dependency's reset.
  clampSunRenderTexture(renderer as never,texture as never);
  expect(texture.wrapS).toBe(gl.CLAMP_TO_EDGE);expect(texture.wrapT).toBe(gl.CLAMP_TO_EDGE);
  expect(texture.minFilter).toBe(gl.LINEAR);expect(texture.magFilter).toBe(gl.LINEAR);
  const calls=gl.texParameteri.mock.calls.length;clampSunRenderTexture(renderer as never,texture as never);
  expect(gl.texParameteri.mock.calls).toHaveLength(calls); // No steady-frame GL mutations.
  // Opposite edges have different light. A finite field must not mix them at v=0/1.
  const first=.2,last=.9;
  const lower=texture.wrapT===gl.REPEAT?(first+last)/2:first;
  const upper=texture.wrapT===gl.REPEAT?(first+last)/2:last;
  expect(lower).toBe(first);expect(upper).toBe(last);
 }
 f.owner.destroy();f.quality.destroy();
});

it('enforces sampling after renderWebGLStep performs its deferred resize',async()=>{
 const {SunRenderTarget}=await import('../src/effects/sunlight/SunRenderTarget');const f=fixture();
 const target=new SunRenderTarget(f.scene as never,'ResizeProbe','',()=>{}),shader=target.shader as any;
 shader.renderWebGLStep=()=>{shader.glTexture.wrapS=shader.glTexture.wrapT=10497;shader.glTexture.minFilter=9728;};
 target.draw(1024,256);
 expect(shader.glTexture.wrapS).toBe(f.renderer.gl.CLAMP_TO_EDGE);
 expect(shader.glTexture.wrapT).toBe(f.renderer.gl.CLAMP_TO_EDGE);
 expect(shader.glTexture.minFilter).toBe(f.renderer.gl.LINEAR);
 target.destroy();f.owner.destroy();f.quality.destroy();
});

it('owns one static canopy exclusion, keeps it across quality changes and releases it on teardown',()=>{
 const f=fixture([{worldX:150,worldY:150,gfx:{displayWidth:200,displayHeight:200}}]);
 f.owner.prepareClouds(0,0,1000,1000);expect(f.renderer.createTexture2D).toHaveBeenCalledOnce();
 expect(f.owner.diagnostics.clouds!.canopyBytes).toBeGreaterThan(0);
 for(const q of ['low','high'] as const){f.quality.setLevel(q);f.clouds.timeSec+=1;f.owner.prepareClouds(0,0,1000,1000);}
 expect(f.renderer.createTexture2D).toHaveBeenCalledOnce();
 f.owner.destroy();f.owner.destroy();expect(f.scene.textures.remove).toHaveBeenCalledOnce();f.quality.destroy();
});

it('isolates composite output, material sampling and offscreen drawing independently',()=>{
 const f=fixture();f.owner.setEnabled(true);
 const quad=fake.shaders.find(s=>s.config.name.includes('CompositeDisplay'));
 const material=fake.shaders.find(s=>s.config.name.includes('CompositeMaterial'));
 const draw=vi.spyOn(material,'renderWebGLStep');
 const camera={x:0,y:0,width:1664,height:936,originX:0,originY:0,scrollX:0,scrollY:0,zoom:1,zoomX:1,zoomY:1};
 f.owner.setDebugSuppressed(true);expect(quad.visible).toBe(false);
 f.owner.setEnabled(true);expect(quad.visible).toBe(false);
 f.owner.setDebugSuppressed(false);expect(quad.visible).toBe(true);
 for(const view of ['normal','material','neutral','neutralInline'] as const){
   draw.mockClear();f.owner.setDebugView(view);quad.renderNode.run({camera,renderer:f.renderer,blendMode:0,state:{blend:f.renderer.blendModes[0]}},quad);
   expect(draw).toHaveBeenCalledTimes(view==='neutralInline'?0:1);
   expect(quad.uniforms.uDebugView).toBe(view==='normal'?0:view==='material'?1:2);
 }
 f.owner.setDebugView('normal');quad.renderNode.run({camera,renderer:f.renderer,blendMode:0,state:{blend:f.renderer.blendModes[0]}},quad);expect(quad.uniforms.uDebugView).toBe(0);
 f.owner.destroy();f.quality.destroy();
});

it('reads only the factor target on request and restores the framebuffer even on failure',()=>{
 const f=fixture();f.owner.setEnabled(true);
 const material=fake.shaders.find(s=>s.config.name.includes('CompositeMaterial'));
 material.setSize(2,1);material.drawingContext.framebuffer={name:'factor'};
 const sceneBuffer={name:'scene'};let bound:any=sceneBuffer;
 const wrapper=f.renderer.glWrapper as any;wrapper.state={bindings:{framebuffer:sceneBuffer}};
 wrapper.update.mockImplementation((state:any)=>{if(state.bindings)bound=state.bindings.framebuffer;});
 const read=vi.fn((_x:number,_y:number,_w:number,_h:number,_format:number,_type:number,out:Uint8Array)=>{
   expect(bound).toBe(material.drawingContext.framebuffer);out.set([128,128,128,128,100,120,140,128]);
 });
 (f.renderer.gl as any).readPixels=read;
 expect(f.owner.inspectMaterial()).toEqual({width:2,height:1,minRGB:[100,120,128],maxRGB:[128,128,140],zeroRGB:0,minAlpha:128,maxAlpha:128});
 expect(bound).toBe(sceneBuffer);expect(read).toHaveBeenCalledOnce();
 read.mockImplementationOnce(()=>{throw Error('read failure');});expect(()=>f.owner.inspectMaterial()).toThrow('read failure');
 expect(bound).toBe(sceneBuffer);
 f.owner.destroy();expect(f.owner.inspectMaterial()).toBeNull();f.quality.destroy();
});


it('registers Modulate RGB with independent destination-alpha preservation, once per renderer',()=>{
 const f=fixture(),mode=f.renderer.blendModes.length;f.owner.setEnabled(true);
 const gl=f.renderer.gl,entry=f.renderer.blendModes[mode];
 expect(entry.func).toEqual([gl.DST_COLOR,gl.SRC_COLOR,gl.ZERO,gl.ONE]);
 expect(entry.equation).toEqual([gl.FUNC_ADD,gl.FUNC_ADD]);
 // The public addBlendMode returns mode-1 in pinned Phaser; updating that slot
 // would corrupt ERASE and leave the Composite with combined alpha factors.
 expect(f.renderer.updateBlendMode).toHaveBeenCalledWith(mode,entry.func,gl.FUNC_ADD);
 expect(f.renderer.blendModes[mode-1].func).not.toEqual(entry.func);
 for(const view of ['normal','material','neutral','neutralInline'] as const)f.owner.setDebugView(view);
 f.owner.setEnabled(false);f.owner.setEnabled(true);
 expect(f.renderer.addBlendMode).toHaveBeenCalledOnce();expect(f.renderer.updateBlendMode).toHaveBeenCalledOnce();
 f.owner.destroy();f.quality.destroy();
});
