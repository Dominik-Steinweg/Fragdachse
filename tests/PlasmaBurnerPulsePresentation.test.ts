import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser',()=>({Math:{Clamp:(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v)),Linear:(a:number,b:number,t:number)=>a+(b-a)*t}}));
import { PlasmaBurnerRenderer } from '../src/effects/PlasmaBurnerRenderer';
import { isPlasmaBurnerPulseEvent, type PlasmaBurnerPulseEvent } from '../src/combat/plasmaBurner/PlasmaBurnerContracts';
function harness(){
  const r=Object.create(PlasmaBurnerRenderer.prototype) as any;
  r.beams=new Map();r.pulseSegments=new Map();r.localAimAngleProvider=()=>.2;
  r.playTracer=vi.fn((_sx,_sy,_ex,_ey,_color,_thickness,_fx,key)=>r.beams.set(key,{}));
  r.recycleBeam=(key:string)=>{r.beams.delete(key);r.pulseSegments.delete(key);};
  return r;
}
const event:PlasmaBurnerPulseEvent={id:'p',sid:4,m:1.5,lk:false,p:2,s:[[0,0,50,0,0],[200,0,250,0,1],[250,0,300,0,2]]};
describe('atomic plasma pulse presentation',()=>{
  it('replaces the authoritative segment set and never deduplicates by predicted shot id',()=>{
    const r=harness();r.playPulse(event);r.playPulse({...event,p:1,s:event.s.slice(0,1)});
    expect([...r.beams.keys()]).toEqual(['p#0']);expect(r.playTracer).toHaveBeenCalledTimes(4);
    r.playPulse({...event,id:'other'});r.playPulse({...event,p:1,s:event.s.slice(0,1)});
    expect(r.beams.has('other#2')).toBe(true);
  });
  it('prediction only changes segment zero and respects confirmed portals and locks',()=>{
    const r=harness();r.playPulse(event);
    r.playPulse({...event,p:1,s:[event.s[0]]},true);expect(r.playTracer).toHaveBeenCalledTimes(3);
    expect(r.getLocalAimAngle('p#0')).toBeNull();expect(r.getLocalAimAngle('p#2')).toBeNull();
    r.playPulse({...event,p:1,lk:true});expect(r.pulseSegments.get('p#0').lockEnd).toBe(true);
    expect(r.getLocalAimAngle('p#0')).toBeNull();
    r.playPulse({...event,p:1});r.playPulse({...event,p:1,s:[event.s[0]]},true);
    expect([...r.beams.keys()]).toEqual(['p#0','p#1','p#2']);expect(r.getLocalAimAngle('p#0')).toBe(.2);
  });
  it('rejects malformed wire segments and primary section counts',()=>{
    expect(isPlasmaBurnerPulseEvent(event)).toBe(true);
    for(const bad of [{...event,p:0},{...event,p:4},{...event,m:NaN},{...event,s:[[0,0,1,2,3]]}])
      expect(isPlasmaBurnerPulseEvent(bad)).toBe(false);
  });
});
