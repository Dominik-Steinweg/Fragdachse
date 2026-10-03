import { beforeEach, describe, expect, it, vi } from 'vitest';
const batch=vi.hoisted(()=>({begin:vi.fn(),add:vi.fn(),flush:vi.fn(),clear:vi.fn(),destroy:vi.fn()}));
vi.mock('../src/effects/gpu/MeteorGpuLayer',()=>({MeteorGpuLayer:class {constructor(){return batch;}}}));
import { MeteorRenderer } from '../src/effects/MeteorRenderer';
import type { SyncedMeteorStrike } from '../src/types';
const strike:SyncedMeteorStrike={id:1,x:100,y:100,radius:60,spawnedAt:1000,impactAt:2000,ownerId:'p',variant:'normal'};
function fixture(){
  const scene={time:{now:0},cameras:{main:{worldView:{contains:()=>true}}}};
  const renderer=new MeteorRenderer(scene as never);
  return {scene,renderer};
}
describe('meteor snapshot presentation',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.spyOn(Date,'now').mockReturnValue(1500);});
  it('preserves authoritative radius and position at partial progress, clamps the clock',()=>{
    const {renderer}=fixture();renderer.sync([strike]);
    expect(batch.add).toHaveBeenLastCalledWith(expect.objectContaining({x:100,y:100,radius:60,progress:.5,age:-1}));
    vi.mocked(Date.now).mockReturnValue(5000);renderer.sync([strike]);
    expect(batch.add).toHaveBeenLastCalledWith(expect.objectContaining({progress:1,age:-1}));
  });
  it('leaves no impact or residue on early cancellation',()=>{
    const {renderer}=fixture();const feedback={request:vi.fn()};renderer.setCameraFeedback(feedback as never);
    renderer.sync([strike]);batch.add.mockClear();renderer.sync([]);
    expect(batch.add).not.toHaveBeenCalled();expect(feedback.request).not.toHaveBeenCalled();
  });
  it('creates residue only from the impact event, expires it and clears round resources',()=>{
    const {renderer,scene}=fixture();renderer.sync([strike]);vi.mocked(Date.now).mockReturnValue(2000);
    renderer.sync([]);expect(batch.add).not.toHaveBeenCalledWith(expect.objectContaining({age:0}));
    renderer.playImpact(100,100,60,'normal');batch.add.mockClear();renderer.sync([]);
    expect(batch.add).toHaveBeenLastCalledWith(expect.objectContaining({x:100,y:100,radius:60,age:0}));
    batch.add.mockClear();scene.time.now=8000;renderer.sync([]);expect(batch.add).not.toHaveBeenCalled();
    renderer.sync([strike]);renderer.clear();batch.add.mockClear();renderer.sync([]);
    expect(batch.add).not.toHaveBeenCalled();expect(batch.clear).toHaveBeenCalled();
    renderer.destroy();expect(batch.destroy).toHaveBeenCalledOnce();
  });
  it('retains warning state through suppression without drawing',()=>{
    const {renderer}=fixture();const system={isSuppressed:()=>true};renderer.registerGpuVfx(system as never);
    renderer.sync([strike]);expect(batch.add).not.toHaveBeenCalled();
    system.isSuppressed=()=>false;renderer.sync([strike]);expect(batch.add).toHaveBeenCalledOnce();
  });
});
