import { describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({shaders:[] as any[]}));
vi.mock('phaser',()=>({BlendModes:{SCREEN:3},Textures:{FilterMode:{LINEAR:0}},Utils:{Array:{Remove:(a:any[],v:any)=>{const i=a.indexOf(v);if(i>=0)a.splice(i,1);}}},
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
    setOrigin(){return this;}setScrollFactor(){return this;}setDepth(){return this;}setBlendMode(){return this;}
    setPosition(){return this;}setSize(w:number,h:number){this.width=w;this.height=h;return this;}
    destroy(){if(this.destroyed)return;this.destroyed=true;for(const f of this.callbacks)f();this.texture?.destroy();this.drawingContext?.destroy();}
  }}
}));
vi.mock('../src/scenes/arena/ClarityCameraRegistry',()=>({getClarityCameraRegistry:()=>null}));
import { GraphicsQualityController, GRAPHICS_QUALITY_PROFILES } from '../src/graphics/GraphicsQuality';
import { WorldSunComposite } from '../src/effects/sunlight/WorldSunComposite';
import { createSunTuning } from '../src/effects/sunlight/SunAtmosphere';
import { createSunPath } from '../src/effects/sunlight/SunPath';
import { sunRenderWorld, SUN_RENDER_QUALITY } from '../src/effects/sunlight/SunRenderQuality';
import type { SunCloudState } from '../src/effects/sunlight/cloudShadow';

function fixture(){
  fake.shaders.length=0;
  const renderer={gl:{DST_COLOR:1,SRC_COLOR:2,FUNC_ADD:3,MAX_TEXTURE_IMAGE_UNITS:4,getParameter:()=>16},
    blendModes:[],addBlendMode:vi.fn(),glVAOWrappers:[],deleteBuffer:vi.fn(),deleteProgram:vi.fn(),shaderProgramFactory:{programs:{}},
    glTextureUnits:{bind:vi.fn()},glWrapper:{update:vi.fn()},renderNodes:{finishBatch:vi.fn()}};
  const source={glTexture:{}},texture={source:[source],get:()=>({source})};
  const scene={sys:{renderer},textures:{get:()=>texture},add:{particles:vi.fn(),existing:(x:any)=>x}};
  const quality=new GraphicsQualityController();quality.attach(scene as never);
  const tuning=createSunTuning(),clouds:SunCloudState={tuning,timeSec:0,strength:1,sunPath:createSunPath()};
  const owner=new WorldSunComposite(scene as never,tuning,{enabled:true,normals:false,strength:1,sun:[0,0,1]},[0,0],clouds);
  return {renderer,scene,quality,owner,clouds};
}
describe('reduced sunlight resources',()=>{
  it('uses existing quality profiles with descending costs',()=>{
    for(const q of ['high','medium','low'] as const)expect(GRAPHICS_QUALITY_PROFILES[q].sunlight).toBe(SUN_RENDER_QUALITY[q]);
    const {high,medium,low}=SUN_RENDER_QUALITY;
    expect(high.raysScale).toBe(.5);expect(medium.raysScale).toBe(.25);expect(low.raysScale).toBe(0);
    expect(high.raysSamples).toBeGreaterThanOrEqual(medium.raysSamples);
    expect(high.horizonStep).toBeLessThan(medium.horizonStep);
    expect(low.horizons).toBe(false);expect(low.dapple).toBe(false);
    expect(low.ecologyDensity).toBeLessThan(high.ecologyDensity);
  });
  it('retains world coordinates across zoom, backing scale and offset viewports',()=>{
    const f=fixture();f.owner.setEnabled(true,true);
    const quad=fake.shaders.find(s=>!s.renderToTexture&&s.config.name.includes('CompositeDisplay'));
    for(const zoom of [.5,1,1.25,2,4]){
      const camera={x:137,y:81,zoomX:zoom,zoomY:zoom,worldView:{x:-123.5,y:377.25,width:1664/zoom,height:936/zoom}};
      quad.renderNode.run({camera},quad);
      const material=fake.shaders.find(s=>s.config.name.includes('CompositeMaterial')),w=material.uniforms.uSunWorld;
      expect(w[0]+64/(1664+128)*w[2]).toBeCloseTo(camera.worldView.x,8);
      expect(w[1]+64/(936+128)*w[3]).toBeCloseTo(camera.worldView.y,8);
      expect(material.width).toBe(896);expect(material.height).toBe(532);
      const out=[0,0,0,0];sunRenderWorld(out,-123.5,377.25,1664/zoom,936/zoom,zoom,zoom);expect(w).toEqual(out);
    }
    f.owner.destroy();f.quality.destroy();
  });
  it('hot switches and releases rays, textures, VAOs, buffers and programs',()=>{
    const f=fixture();f.owner.setEnabled(true,true);f.owner.prepareClouds(-100,-200,4000,3000);
    const first=f.owner.diagnostics.clouds!.builds,cache=f.clouds.cache;
    f.owner.prepareClouds(-100,-200,4000,3000);expect(f.owner.diagnostics.clouds!.builds).toBe(first);
    f.clouds.timeSec=.016;f.owner.prepareClouds(-100,-200,4000,3000);expect(f.owner.diagnostics.clouds!.builds).toBe(first+1);
    expect(f.clouds.cache).toBe(cache);
    f.quality.setLevel('low');f.owner.setEnabled(true,true);f.owner.prepareClouds(-100,-200,4000,3000);
    expect(f.owner.diagnostics.raysSamples).toBe(0);
    expect(fake.shaders.filter(s=>!s.destroyed&&s.config.name.includes('Rays'))).toHaveLength(0);
    f.quality.setLevel('high');f.owner.setEnabled(true,true);expect(f.owner.diagnostics.raysSamples).toBeGreaterThan(0);
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

it('invalidates the shared canopy channel for sun/tuning changes even with still, clear clouds',()=>{
 const f=fixture();f.clouds.tuning.cloudCover=0;f.owner.prepareClouds(0,0,1000,1000);
 let builds=f.owner.diagnostics.clouds!.builds;
 const check=()=>{f.owner.prepareClouds(0,0,1000,1000);expect(f.owner.diagnostics.clouds!.builds).toBe(++builds);
  f.owner.prepareClouds(0,0,1000,1000);expect(f.owner.diagnostics.clouds!.builds).toBe(builds);};
 f.clouds.sunPath!.azimuth=160;f.clouds.sunPath!.direction=[-.94,-.342];check();
 f.clouds.sunPath!.elevation=.5;check();
 f.clouds.tuning.bandAlong+=10;check();f.clouds.tuning.openFraction+=.1;check();
 const shader=fake.shaders.find(s=>s.config.name.includes('CloudField'));
 expect(shader.uniforms.uSunOpen).toBe(f.clouds.tuning.openFraction);
 expect(shader.config.fragmentSource).toContain('sunBandVisibility(p)');
 expect(shader.uniforms.uFieldCanopy).toBe(1);
 f.quality.setLevel('medium');check();expect(shader.uniforms.uFieldCanopy).toBe(0);
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


it('keeps long-world cloud UVs finite and reports anisotropic texel footprint without resizing the field',()=>{
 const f=fixture();f.owner.setEnabled(true,true);
 for(const level of ['high','medium','low'] as const){f.quality.setLevel(level);f.owner.prepareClouds(-100,40,12800,1056);
  const d=f.owner.diagnostics.clouds!;expect(d.worldTexelX).toBeCloseTo(12800/d.size);expect(d.worldTexelY).toBeCloseTo(1056/d.size);
  const shader=fake.shaders.find(s=>s.config.name.includes('CloudField'));expect(Array.from(shader.uniforms.uFieldWorld)).toEqual([-100,40,12800,1056]);}
 f.owner.destroy();f.quality.destroy();
});
