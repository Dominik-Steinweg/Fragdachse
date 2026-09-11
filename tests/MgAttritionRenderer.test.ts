import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser',()=>({BlendModes:{NORMAL:0,ADD:1},Scenes:{Events:{PRE_RENDER:'prerender',SHUTDOWN:'shutdown'}},Math:{Linear:(a:number,b:number,t:number)=>a+(b-a)*t}}));
vi.mock('../src/graphics/GraphicsQuality',()=>({getGraphicsQualityController:()=>({getProfile:()=>({particleFactors:{critical:1,standard:1,decorative:1}}),subscribe:()=>()=>{}})}));
import { MgAttritionRenderer } from '../src/effects/MgAttritionRenderer';
import { mgTargetVisual } from '../src/effects/MgAttritionVisualTarget';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';
import { mgTarget } from './MgTurretTestHelper';
import { emptyMgAttritionSnapshot } from '../src/systems/MgAttritionRuntime';

beforeEach(()=>resetGpuVfxAtlasForTests());
function setup(){
  const scene=Object.assign(makeFakeGpuVfxScene(),{cameras:{main:{worldView:{x:-100,y:-100,right:1000,bottom:1000}}}});
  const gpu=new GpuVfxSystem(scene as never), registrations=vi.spyOn(gpu,'registerEmission'), create=vi.spyOn(gpu,'createSource'),release=vi.spyOn(gpu,'releaseSource');
  const renderer=new MgAttritionRenderer(scene as never,gpu);
  const target=mgTarget().ref,snapshot={targets:[{target,expiresAt:4000,bleedUntil:4000}],transfers:[],transferSequence:0};
  return {gpu,renderer,registrations,create,release,target,snapshot};
}
describe('MG shared GPU presentation',()=>{
  it('uses one callback and releases target sources on invisibility, explicit empty state and teardown',()=>{
    const f=setup();let visible=true;
    const lookup=()=>visible?{x:100,y:100,width:40,height:40}:null;
    f.renderer.sync(f.snapshot,0,lookup);f.gpu.update(400);
    expect(f.create).toHaveBeenCalledWith(GpuVfxEffectId.MgAttrition);expect(f.registrations).toHaveBeenCalledTimes(1);
    visible=false;f.gpu.update(1);expect(f.release).toHaveBeenCalledTimes(1);
    visible=true;f.gpu.update(1);f.renderer.sync(emptyMgAttritionSnapshot(),402,lookup);
    expect(f.release).toHaveBeenCalledTimes(2);
    f.renderer.sync(f.snapshot,403,lookup);f.gpu.update(1);f.renderer.clear();
    expect(f.release).toHaveBeenCalledTimes(3);expect(f.registrations).toHaveBeenCalledTimes(1);
  });
  it('does not replay bootstrap impulses, deduplicates updates and releases transfer sources',()=>{
    const f=setup(),lookup=()=>null;
    const event=(sequence:number)=>({sequence,fromX:0,fromY:0,toX:100,toY:0,createdAt:100});
    f.renderer.sync({targets:[],transfers:[event(1)],transferSequence:1},100,lookup);f.gpu.update(1);
    expect(f.create).not.toHaveBeenCalled();
    const next={targets:[],transfers:[event(1),event(2)],transferSequence:2};
    f.renderer.sync(next,101,lookup);f.renderer.sync(next,101,lookup);f.gpu.update(1);
    expect(f.create).toHaveBeenCalledExactlyOnceWith(GpuVfxEffectId.MgTransfer);
    f.gpu.update(200);expect(f.release).toHaveBeenCalledTimes(1);
    f.renderer.clear();f.gpu.update(500);expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('rejects reused enemy IDs and automatically expires visual handles without another snapshot',()=>{
    const f=setup(),enemy={visible:true,sprite:{active:true,visible:true,x:100,y:100},bodySize:40,entityGeneration:2};
    expect(mgTargetVisual(f.target,()=>enemy as never,()=>null)).toBeNull();
    enemy.entityGeneration=1;
    const lookup=()=>mgTargetVisual(f.target,()=>enemy as never,()=>null);
    f.renderer.sync(f.snapshot,0,lookup);f.gpu.update(400);f.gpu.update(4000);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
});
