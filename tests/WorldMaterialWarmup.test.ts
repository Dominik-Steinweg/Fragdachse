import { expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({finish:Object.assign(vi.fn(),{isReady:()=>true}),managers:[] as any[],shaderDestroyed:vi.fn()}));
vi.mock('../src/graphics/compileShaderPrograms',()=>({beginShaderPrograms:(_r:any,managers:any[])=>{state.managers=managers;return state.finish;}}));
vi.mock('phaser',()=>({Filters:{Controller:class{}},Renderer:{Events:{SET_PARALLEL_TEXTURE_UNITS:'units',RESIZE:'resize'},WebGL:{
 ProgramManager:class{ name='';setBaseShader(name:string){this.name=name;} },RenderNodes:{
 BaseFilterShader:class{programManager:any;constructor(name:string){this.programManager={name};}},
 BatchHandlerQuadSingle:class{
  programManager={programs:{},name:'',currentConfig:{additions:[{additions:{fragmentProcess:'fragColor = applyTint(fragColor);'}}] as any[]},addAddition(addition:any){this.name=addition.name;}};
  vertexBufferLayout={buffer:{}};indexBuffer={};updateTextureCount(){}resize(){}
  finalizeTextureCount(n:number){expect(n).toBe(1);}constructor(public manager:any){}
 }
}}},GameObjects:{Shader:class{
 renderNode:any;
 constructor(scene:any,config:any){this.renderNode={manager:scene.sys.renderer.renderNodes,
  vertexBufferLayout:{buffer:{}},programManager:{programs:{},name:config.shaderName}};}
 destroy(){state.shaderDestroyed();}
}}}));
import { warmupWorldMaterials } from '../src/graphics/WorldMaterialWarmup';
it('primes the real material and first-player keys, releases private probe resources and keeps completion behind the Boot barrier',()=>{
 state.finish.mockClear();state.shaderDestroyed.mockClear();
 const renderer:any={gl:{},game:{config:{smoothPixelArt:false}},maxTextures:16,off:vi.fn(),deleteBuffer:vi.fn(),glVAOWrappers:[]};
 renderer.renderNodes={renderer,off:vi.fn()};const scene={sys:{renderer}};
 const finish=warmupWorldMaterials(scene as never);
 expect(state.managers.map(m=>m.name)).toEqual(['CanopySunlightMaterialV9Batched','VegetationVolumeR18','RockFoliageSingleCoverage',
  'CharacterMaterial21eV2','FragdachseWaterSurfaceSunlight','FragdachseStatusRing','FragdachseStatusRingFill','WorldMoonSky','RockPenetration']);
 expect(renderer.deleteBuffer).toHaveBeenCalledTimes(13);expect(state.shaderDestroyed).toHaveBeenCalledTimes(5);
 expect(renderer.off).toHaveBeenCalledTimes(4);expect(renderer.renderNodes.off).toHaveBeenCalledTimes(4);
 expect(state.finish).not.toHaveBeenCalled();finish();expect(state.finish).toHaveBeenCalledOnce();
});
it('keeps the WebGL1 smooth-pixel fallback on its existing material preparation path',()=>{
 state.managers=[];warmupWorldMaterials({sys:{renderer:{gl:{},game:{config:{smoothPixelArt:true}}}}} as never)();
 expect(state.managers).toEqual([]);
});

it('prepares the fog projectile-wake program on low before any projectile appears',async()=>{
 const {warmupFogShaders}=await import('../src/effects/groundFog/FogShaderWarmup');
 const renderer:any={gl:{getParameter:()=>16},deleteBuffer:vi.fn(),glVAOWrappers:[]};
 renderer.renderNodes={renderer};state.finish.mockClear();
 const finish=warmupFogShaders({sys:{renderer}} as never,'low');
 expect(state.managers.map(m=>m.name)).toContain('GroundFog_trails');
 expect(state.finish).not.toHaveBeenCalled();finish();expect(state.finish).toHaveBeenCalledOnce();
});

it('links Kraken mission programs before the barrier, retaining shared filter nodes and releasing detached probes',async()=>{
 const {warmupKrakenShaders}=await import('../src/effects/kraken/KrakenShaderWarmup');
 const {getSubmersionNode}=await import('../src/effects/kraken/submersionShader');
 const {getKrakenDrainNode}=await import('../src/effects/kraken/KrakenReviewDrainFilter');
 state.finish.mockClear();state.shaderDestroyed.mockClear();
 const renderer:any={gl:{},deleteBuffer:vi.fn(),glVAOWrappers:[]};
 const nodes=new Map(),constructors=new Map();
 renderer.renderNodes={renderer,addNodeConstructor:(name:string,ctor:any)=>constructors.set(name,ctor),getNode:(name:string)=>{
  if(!nodes.has(name))nodes.set(name,new(constructors.get(name))(renderer.renderNodes));return nodes.get(name);
 }};
 const finish=warmupKrakenShaders({sys:{renderer}} as never);
 expect(finish.isReady()).toBe(true);
 expect(state.managers).toContain(getSubmersionNode(renderer).programManager);
 expect(state.managers).toContain(getKrakenDrainNode(renderer).programManager);
 expect(new Set(state.managers.map(m=>m.name)).size).toBe(state.managers.length);
 expect(state.shaderDestroyed).toHaveBeenCalled();
 expect(renderer.deleteBuffer).toHaveBeenCalledTimes(state.shaderDestroyed.mock.calls.length);
 expect(state.finish).not.toHaveBeenCalled();finish();expect(state.finish).toHaveBeenCalledOnce();
});
