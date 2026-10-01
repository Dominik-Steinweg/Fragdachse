
import {expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({configs:[] as any[],objects:[] as any[]}));
vi.mock('phaser',()=>({Textures:{FilterMode:{LINEAR:1}},BlendModes:{NORMAL:0},GameObjects:{Shader:class{
  destroy=vi.fn();constructor(_s:any,c:any,...args:any[]){state.configs.push({...c,samplers:args.at(-1)});state.objects.push(this);}
  setDepth(){return this;}setBlendMode(){return this;}
}}}));
import {WaterSurfaceRenderer} from '../src/arena/WaterSurfaceRenderer';
import {WATER_FRAGMENT} from '../src/arena/waterSurfaceShader';
import {setWaterSunUniforms} from '../src/arena/WaterSunlight';
import {createSunTuning} from '../src/effects/sunlight/SunAtmosphere';
it('changes only the program on sunlight binding changes, shares paused water time and restores the unbound material exactly',()=>{
  state.configs.length=0;state.objects.length=0;
  const upload=vi.fn(),remove=vi.fn();
  const scene={time:{now:7777},add:{existing:vi.fn()},textures:{remove,createCanvas:()=>({context:{createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:upload},refresh:vi.fn(),setFilter:vi.fn()})}};
  const water=new WaterSurfaceRenderer(scene as never,{offsetX:-70,offsetY:30,width:512,height:512},[{gridX:5,gridY:5}],123);
  while(!water.isPrepared())water.prepareMasks();water.updateResidency({x:-70,y:30,width:512,height:512});
  expect(state.configs.at(-1).fragmentSource).toBe(WATER_FRAGMENT);const baseline=state.configs.at(-1).samplers;
  const clouds={timeSec:10,strength:1,tuning:createSunTuning()};water.setSunlight(clouds);
  expect(state.configs.at(-1).fragmentSource).not.toBe(WATER_FRAGMENT);expect(state.configs.at(-1).samplers).toEqual(baseline);
  const uniforms:Record<string,any>={};state.configs.at(-1).setupUniforms((k:string,v:any)=>uniforms[k]=v);
  expect([...uniforms.uWorldOffset]).toEqual([-70,30]);expect(uniforms.uTime).toBe(10);
  const n=state.configs.length;for(let i=0;i<20;i++)water.setSunlight(clouds);expect(state.configs).toHaveLength(n);
  scene.time.now+=1000;expect(water.getPresentationTime()).toBe(10);clouds.timeSec+=.016;expect(water.getPresentationTime()).toBe(10.016);
  water.setSunlight(undefined);expect(state.configs.at(-1).fragmentSource).toBe(WATER_FRAGMENT);expect(state.configs.at(-1).samplers).toEqual(baseline);
  expect(water.getPresentationTime()).toBe(scene.time.now/1000);expect(upload).toHaveBeenCalledTimes(1);expect(remove).not.toHaveBeenCalled();
  water.destroy();expect(remove).toHaveBeenCalledTimes(1);expect(state.objects.every(o=>o.destroy.mock.calls.length===1)).toBe(true);
});
it('keeps water sun/glint uniforms neutral without sunlight and at night',()=>{
  const u:Record<string,unknown>={},set=(k:string,v:unknown)=>u[k]=v;
  setWaterSunUniforms(set);expect(u.uWaterGlint).toBe(0);expect(u.uCloudStrength).toBe(0);expect(u.uWaterGlintDensity).toBe(0);expect(u.uWaterGlintSpeed).toBe(0);
  setWaterSunUniforms(set,{timeSec:10,strength:0,tuning:createSunTuning()});expect(u.uCloudStrength).toBe(0);
});
