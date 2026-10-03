import { SUN_TUNING_DEFAULTS } from '../src/effects/sunlight/SunTuning';
import { afterEach, describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({shaders:[] as any[],draws:vi.fn()}));
vi.mock('phaser',()=>({
  Textures:{FilterMode:{NEAREST:0,LINEAR:1}},Utils:{Array:{Remove(){}}},GameObjects:{RenderTexture:class {
    texture={};destroy=vi.fn();
    constructor(_scene:unknown,_x:number,_y:number,public width:number,public height:number){}
    clear(){}render(){}stamp(){}
  },Shader:class {
    visible=false;depth=0;texture={setFilter(){}};textures:any[];drawingContext={state:{blend:{}}};
    renderNode={programManager:{programs:{},getCurrentProgramSuite:()=>({program:{webGLProgram:{}}})},
      renderer:{deleteBuffer(){},glVAOWrappers:[]},vertexBufferLayout:{buffer:{}}};
    destroy=vi.fn();
    constructor(_scene:unknown,public config:any,_x:number,_y:number,public width:number,public height:number,textures:any[]){this.textures=textures;fake.shaders.push(this);}
    setRenderToTexture(){return this;}setOrigin(){return this;}setDepth(value:number){this.depth=value;return this;}setVisible(value:boolean){this.visible=value;return this;}
    setPosition(){return this;}setDisplaySize(){return this;}setTextures(value:any[]){this.textures=value;return this;}
    renderWebGLStep(){fake.draws();}
  }},
}));
import { FogGpuField } from '../src/effects/groundFog/FogGpuField';
vi.mock('../src/effects/groundFog/FogTrailRenderer',()=>({FogTrailRenderer:class {draw(){}get drawCalls(){return 0;}get visibleTraces(){return 0;}}}));
import { FogTerrainModel } from '../src/effects/groundFog/FogTerrainModel';
import { fogTuning } from '../src/effects/groundFog/FogConfig';
import type { FogWoodlandLight } from '../src/effects/groundFog/FogWoodlandLight';
import { DEPTH } from '../src/config';
import { CHARACTER_SHADOW_CONFIG } from '../src/effects/ShadowConfig';
import { ENEMY_SHADOW_DEPTH } from '../src/effects/EnemyMeshShadowModel';

afterEach(()=>{fake.shaders.length=0;vi.clearAllMocks();});
describe('optional fog woodland presentation',()=>{
  it.each([8,16])('packs borrowed rock lighting without extra passes on a %i-sampler renderer',units=>{
    const gl={ZERO:0,ONE:1,ONE_MINUS_SRC_ALPHA:771,FUNC_ADD:32774,DITHER:1,MAX_TEXTURE_SIZE:2,MAX_TEXTURE_IMAGE_UNITS:3,FRAMEBUFFER_COMPLETE:4,
      isEnabled:()=>false,getParameter:(key:number)=>key===2?8192:units,getShaderPrecisionFormat:()=>({precision:23}),
      getProgramParameter:()=>true,checkFramebufferStatus:()=>4,texSubImage2D(){},disable(){},enable(){}};
    const fallback={},remove=vi.fn(),scene={sys:{renderer:{gl,blendModes:[],addBlendMode:vi.fn(),updateBlendMode:vi.fn(),createTexture2D:()=>({}),glTextureUnits:{bind(){}},glWrapper:{updateTexturing(){},update(){}}}},
      textures:{addGLTexture:()=>({}),get:()=>fallback,remove},add:{existing:(value:unknown)=>value}};
    const terrain=new FogTerrainModel({offsetX:100,offsetY:200,width:512,height:512},[]),tuning=fogTuning(1);
    const field=new FogGpuField(scene as never,terrain,1,tuning,DEPTH.GROUND_FOG_COMPOSITE),view={x:100,y:200,width:512,height:512};
    const shadows={occlusion:{},horizonPrevious:{},horizonBlend:new Float32Array(64).fill(1),sun:[0,0,1],strength:1,solarEnabled:true};
    const binding={field:{},lookup:{},frame:[100,200,512,512],fogShadows:shadows};
    const uniforms=(shader:any)=>{const values=new Map();shader.config.setupUniforms((name:string,value:unknown)=>values.set(name,value));return values;};
    field.setRockCoverage(binding as never);field.prepare(view,0);field.step([], [.3,.5],tuning,0);
    const render=()=>field.render(view,256,256,'normal',1,[],'low');render();
    const surface=fake.shaders.find(s=>s.config.name==='GroundFog_surface');
    const display=fake.shaders.find(s=>s.config.name==='GroundFog_display');
    expect(surface.textures).toEqual([expect.anything(),binding.field,binding.lookup,shadows.occlusion,shadows.horizonPrevious]);
    expect(surface.textures.length).toBeLessThanOrEqual(units);
    expect(surface.drawingContext.state.blend.enabled).toBe(false);
    expect(uniforms(surface).get('uHasRockShadows')).toBe(1);
    expect(uniforms(surface).get('uRockSolarStrength')).toBe(0);
    expect(uniforms(surface).get('uRockFogStrength')[0]).toBeGreaterThan(0);
    const allocationCount=fake.shaders.length,bytes=field.bytes,terrainBefore=terrain.blocked.slice();
    for(const strength of [[0,.1],[.2,0],[0,0]] as [number,number][]) {
      field.setRockLighting(strength);fake.draws.mockClear();render();
      expect(uniforms(surface).get('uRockFogStrength')).toEqual(strength);
      expect(fake.draws).toHaveBeenCalledTimes(2);
      expect(fake.shaders).toHaveLength(allocationCount);expect(field.bytes).toBe(bytes);
      expect(terrain.blocked).toEqual(terrainBefore);
    }
    field.render(view,256,256,'normal',1,[],'high');
    expect(uniforms(surface).get('uRockSolarStrength')).toBe(1);
    shadows.solarEnabled=false;expect(uniforms(surface).get('uRockSolarStrength')).toBe(0);
    shadows.solarEnabled=true;shadows.strength=0;expect(uniforms(surface).get('uRockSolarStrength')).toBe(0);
    field.setRockCoverage(null);render();expect(uniforms(display).get('uHasRockCoverage')).toBe(0);
    expect(uniforms(surface).get('uHasRockShadows')).toBe(0);
    // The same fog must cover bodies, held items and both shadow paths at night,
    // dawn and full sun, including reduced-quality and unlit sampler fallbacks.
    const light:FogWoodlandLight={sun:[0,0,1],sunCompositeTuning:{...SUN_TUNING_DEFAULTS}};
    for(const strength of [0,.01,1,0])for(const quality of ['low','medium','high'] as const) {
      light.sunStrength=strength;field.setWoodlandLight(light);
      field.render(view,256,256,'normal',1,[],quality);
      const visible=fake.shaders.filter(s=>s.visible&&s.config.name==='GroundFog_display'&&!s.destroy.mock.calls.length);
      expect(visible).toHaveLength(1);
      const fog=visible[0];
      expect(fog.depth).toBeGreaterThan(DEPTH.PLAYERS+.05);
      expect(fog.depth).toBeGreaterThan(CHARACTER_SHADOW_CONFIG.depth);
      expect(fog.depth).toBeGreaterThan(ENEMY_SHADOW_DEPTH);
      expect(fog.depth).toBeLessThan(DEPTH.PLAYERS+1);
      expect(fog.depth).toBeLessThan(DEPTH.PROJECTILES);
    }
    field.hide();expect(fake.shaders.filter(s=>s.visible&&!s.destroy.mock.calls.length)).toHaveLength(0);
    field.destroy();expect(remove.mock.calls.every(call=>String(call[0]).startsWith('__ground_fog_'))).toBe(true);
  });
  it('borrows mutable light state without adding passes, then unbinds while paused',()=>{
    const gl={ZERO:0,ONE:1,ONE_MINUS_SRC_ALPHA:771,FUNC_ADD:32774,DITHER:1,MAX_TEXTURE_SIZE:2,MAX_TEXTURE_IMAGE_UNITS:3,FRAMEBUFFER_COMPLETE:4,
      isEnabled:()=>false,getParameter:(key:number)=>key===2?8192:16,getShaderPrecisionFormat:()=>({precision:23}),
      getProgramParameter:()=>true,checkFramebufferStatus:()=>4,texSubImage2D(){},disable(){},enable(){}};
    const fallback={source:[{glTexture:{}}]},remove=vi.fn(),scene={sys:{renderer:{gl,blendModes:[],addBlendMode:vi.fn(),updateBlendMode:vi.fn(),createTexture2D:()=>({}),glTextureUnits:{bind(){}},glWrapper:{updateTexturing(){},update(){}}}},
      textures:{addGLTexture:()=>({}),get:()=>fallback,remove},add:{existing:(value:unknown)=>value}};
    const terrain=new FogTerrainModel({offsetX:100,offsetY:200,width:512,height:512},[]),tuning=fogTuning(1);
    const field=new FogGpuField(scene as never,terrain,1,tuning,10),view={x:100,y:200,width:512,height:512};
    field.prepare(view,0);field.step([], [.3,.5],tuning,0);field.render(view,256,256,'normal',1,[],'low');
    const display=fake.shaders.find(s=>s.config.name==='GroundFog_display');
    const material=fake.shaders.find(s=>s.config.name==='GroundFog_material');
    const uniforms=(shader:any)=>{const values=new Map();shader.config.setupUniforms((name:string,value:unknown)=>values.set(name,value));return values;};
    expect(uniforms(material).get('uWoodlandBanks')).toBe(0);
    expect(uniforms(display).get('uSceneSun')).toBe(0);
    const binding:FogWoodlandLight={sunStrength:1,sun:[-.5,-.5,.7]};
    const allocations=fake.shaders.length;fake.draws.mockClear();
    field.setWoodlandLight(binding);field.render(view,256,256,'normal',1,[],'low');
    expect(fake.shaders).toHaveLength(allocations);expect(fake.draws).toHaveBeenCalledTimes(1);
    expect(display.textures).toHaveLength(2);expect(uniforms(material).get('uWoodlandBanks')).toBe(1);expect(uniforms(display).get('uFogBankMetadata')).toBe(0);
    expect(uniforms(display).get('uFogView')).toEqual([100,200,512,512]);
    binding.sunStrength=0;
    expect(uniforms(display).get('uSceneSun')).toBe(0);
    field.setWoodlandLight(null);
    expect(uniforms(display).get('uSceneSun')).toBe(0);expect(uniforms(material).get('uWoodlandBanks')).toBe(0);
    
    const productionBytes=field.bytes;
    binding.sunCompositeTuning={...SUN_TUNING_DEFAULTS};binding.baseFogOpacity=.4;binding.baseFogDetail=.6;
    field.setWoodlandLight(binding);field.prepare(view,0);field.render(view,256,256,'normal',1,[],'low');
    expect(field.bytes).toBeGreaterThan(productionBytes);
    expect(uniforms(material).get('uWoodlandBanks')).toBe(0);
    expect(uniforms(material).get('uFogDay')).toBe(0);
    expect(uniforms(display).get('uFogBankMetadata')).toBe(1);
    expect(uniforms(display).get('uFogWaterMaxCover')).toBe(binding.sunCompositeTuning.fogWaterMaxCover);
    expect(uniforms(material).get('uOpacity')).toBe(binding.baseFogOpacity);
    expect(uniforms(material).get('uDetail')).toBe(binding.baseFogDetail);
    binding.sunStrength=1;fake.draws.mockClear();
    field.render(view,256,256,'normal',1,[],'low');
    expect(uniforms(material).get('uOpacity')).toBe(tuning.opacity);
    const lit=fake.shaders.find(s=>s.config.name==='GroundFog_materialLit');
    const litDisplay=fake.shaders.filter(s=>s.config.name==='GroundFog_display').at(-1);
    expect(material.destroy).toHaveBeenCalledOnce();expect(display.destroy).toHaveBeenCalledOnce();
    expect(fake.shaders).toHaveLength(allocations+2);expect(fake.draws).toHaveBeenCalledTimes(1);
    expect(uniforms(lit).get('uFogPrelit')).toBe(1);expect(uniforms(lit).has('uSunTransmission')).toBe(false);
    expect(uniforms(litDisplay).get('uFogPrelit')).toBe(1);
    expect(field.lightingAtMaterialResolution).toBe(true);expect(field.materialWidth).toBe(256);
    field.setWoodlandLight(null);expect(field.bytes).toBe(productionBytes);
    expect(uniforms(material).get('uFogBanksK')).toBe(0);expect(uniforms(display).get('uFogBankMetadata')).toBe(0);
    field.destroy();expect(display.destroy).toHaveBeenCalledOnce();expect(lit.destroy).toHaveBeenCalledOnce();expect(litDisplay.destroy).toHaveBeenCalledOnce();
    expect(remove.mock.calls.every(call=>String(call[0]).startsWith('__ground_fog_'))).toBe(true);
  });
});
