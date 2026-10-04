import { expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({finish:vi.fn(),managers:[] as any[],shaderDestroyed:vi.fn()}));
vi.mock('../src/graphics/compileShaderPrograms',()=>({beginShaderPrograms:(_r:any,managers:any[])=>{state.managers=managers;return state.finish;}}));
vi.mock('phaser',()=>({Renderer:{Events:{SET_PARALLEL_TEXTURE_UNITS:'units',RESIZE:'resize'},WebGL:{RenderNodes:{
 BatchHandlerQuadSingle:class{
  programManager={programs:{},name:'',addAddition(addition:any){this.name=addition.name;}};
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
it('primes the real material keys, releases private probe resources and keeps completion behind the Boot barrier',()=>{
 state.finish.mockClear();state.shaderDestroyed.mockClear();
 const renderer:any={gl:{},game:{config:{smoothPixelArt:false}},maxTextures:16,off:vi.fn(),deleteBuffer:vi.fn(),glVAOWrappers:[]};
 renderer.renderNodes={renderer,off:vi.fn()};const scene={sys:{renderer}};
 const finish=warmupWorldMaterials(scene as never);
 expect(state.managers.map(m=>m.name)).toEqual(['CanopySunlightMaterialV9Batched','VegetationVolumeR18','RockFoliageSingleCoverage','FragdachseWaterSurfaceSunlight']);
 expect(renderer.deleteBuffer).toHaveBeenCalledTimes(7);expect(state.shaderDestroyed).toHaveBeenCalledOnce();
 expect(renderer.off).toHaveBeenCalledTimes(3);expect(renderer.renderNodes.off).toHaveBeenCalledTimes(3);
 expect(state.finish).not.toHaveBeenCalled();finish();expect(state.finish).toHaveBeenCalledOnce();
});
it('keeps the WebGL1 smooth-pixel fallback on its existing material preparation path',()=>{
 state.managers=[];warmupWorldMaterials({sys:{renderer:{gl:{},game:{config:{smoothPixelArt:true}}}}} as never)();
 expect(state.managers).toEqual([]);
});
