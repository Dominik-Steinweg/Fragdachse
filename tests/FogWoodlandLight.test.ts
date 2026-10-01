import { SUN_TUNING_DEFAULTS } from '../src/effects/sunlight/SunTuning';
import { afterEach, describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({shaders:[] as any[],draws:vi.fn()}));
vi.mock('phaser',()=>({
  Textures:{FilterMode:{NEAREST:0,LINEAR:1}},Utils:{Array:{Remove(){}}},GameObjects:{Shader:class {
    texture={setFilter(){}};textures:any[];drawingContext={state:{blend:{}}};
    renderNode={programManager:{programs:{},getCurrentProgramSuite:()=>({program:{webGLProgram:{}}})},
      renderer:{deleteBuffer(){},glVAOWrappers:[]},vertexBufferLayout:{buffer:{}}};
    destroy=vi.fn();
    constructor(_scene:unknown,public config:any,_x:number,_y:number,public width:number,public height:number,textures:any[]){this.textures=textures;fake.shaders.push(this);}
    setRenderToTexture(){return this;}setOrigin(){return this;}setDepth(){return this;}setVisible(){return this;}
    setPosition(){return this;}setDisplaySize(){return this;}setTextures(value:any[]){this.textures=value;return this;}
    renderWebGLStep(){fake.draws();}
  }},
}));
import { FogGpuField } from '../src/effects/groundFog/FogGpuField';
import { FogTerrainModel } from '../src/effects/groundFog/FogTerrainModel';
import { fogTuning } from '../src/effects/groundFog/FogConfig';
import type { FogWoodlandLight } from '../src/effects/groundFog/FogWoodlandLight';

afterEach(()=>{fake.shaders.length=0;vi.clearAllMocks();});
describe('optional fog woodland presentation',()=>{
  it('borrows mutable light state without adding passes, then unbinds while paused',()=>{
    const gl={DITHER:1,MAX_TEXTURE_SIZE:2,MAX_TEXTURE_IMAGE_UNITS:3,FRAMEBUFFER_COMPLETE:4,
      isEnabled:()=>false,getParameter:(key:number)=>key===2?8192:16,getShaderPrecisionFormat:()=>({precision:23}),
      getProgramParameter:()=>true,checkFramebufferStatus:()=>4,texSubImage2D(){},disable(){},enable(){}};
    const fallback={source:[{glTexture:{}}]},remove=vi.fn(),scene={sys:{renderer:{gl,createTexture2D:()=>({}),glTextureUnits:{bind(){}},glWrapper:{updateTexturing(){},update(){}}}},
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
