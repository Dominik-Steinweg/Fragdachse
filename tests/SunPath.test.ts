import {createSunPath,resolveSunPath,SUN_PATH,quantizeSunAzimuth} from '../src/effects/sunlight/SunPath';
import {expect,it} from 'vitest';
import {writeShadowCellHull} from '../src/effects/sunlight/ShadowProjection';
import {resolveSkyState,resolveSkyShadowLength} from '../src/effects/TimeOfDay';
import {updateRockLightingSun} from '../src/arena/rocks/RockLightingState';
import {createSunTuning,resolveSunAtmosphere} from '../src/effects/sunlight/SunAtmosphere';
import {validateSunTuning} from '../src/effects/sunlight/SunTuning';
import {packPreviousHorizons} from '../src/arena/rocks/FormationHorizonTransition';
it('anchors east, north, west; remains normalized, continuous in daylight and cyclic',()=>{
  const out=createSunPath(),other=createSunPath(),direction=out.direction,sun=out.sun;
  for(const [m,x,y] of [[SUN_PATH.sunrise,1,0],[SUN_PATH.noon,0,-1],[SUN_PATH.sunset,-1,0]]) {
    resolveSunPath(m,null,out);expect(out.direction[0]).toBeCloseTo(x);expect(out.direction[1]).toBeCloseTo(y);
  }
  let last=0;
  for(let m=-1440;m<2880;m+=.71){
    resolveSunPath(m,null,out);resolveSunPath(m+1440,null,other);
    expect(out.azimuth).toBeCloseTo(other.azimuth,9);expect(out.strength).toBeCloseTo(other.strength,9);
    expect(Math.hypot(...out.direction)).toBeCloseTo(1,12);expect(Math.hypot(...out.sun)).toBeCloseTo(1,12);
    expect(out.elevation).toBeCloseTo(Math.atan(1/Math.max(.1,resolveSkyState(m).shadowLengthMult)),12);
    expect(resolveSkyShadowLength(m)).toBe(resolveSkyState(m).shadowLengthMult);
    if(m>=360&&m<=1215){expect(out.azimuth).toBeGreaterThanOrEqual(last);expect(out.azimuth-last).toBeLessThan(1);last=out.azimuth;}
    expect(out.strength).toBeGreaterThanOrEqual(0);expect(out.strength).toBeLessThanOrEqual(1);
  }
  for(const bad of [NaN,Infinity,-Infinity]){resolveSunPath(bad,bad,out);expect(Number.isFinite(out.azimuth+out.elevation+out.strength)).toBe(true);}
  expect(out.direction).toBe(direction);expect(out.sun).toBe(sun);
  for(const m of [0,300,1215,1300,1439])expect(resolveSunPath(m,null,out).strength).toBe(0);
});
it('validates, persists and resets fixed bearings without affecting the legacy northwest sun',()=>{
  const out=createSunPath(),t=createSunTuning();
  for(const degree of [-360,0,90,180,270,360]){
    const override=validateSunTuning({sunAzimuthOverride:degree});resolveSunAtmosphere(480,t,override);
    expect(t.sunAzimuthOverride).toBe(degree);resolveSunPath(480,t.sunAzimuthOverride,out);
    expect(out.azimuth).toBe((degree%360+360)%360);
  }
  for(const bad of [NaN,Infinity,361,'90',[],false])expect(()=>validateSunTuning({sunAzimuthOverride:bad})).toThrow();
  resolveSunAtmosphere(480,t,validateSunTuning({sunAzimuthOverride:null}));expect(t.sunAzimuthOverride).toBeNull();
  expect(quantizeSunAzimuth(90.1)).toBe(quantizeSunAzimuth(91));expect(quantizeSunAzimuth(94)).not.toBe(quantizeSunAzimuth(90));
  const legacy={strength:0,sun:[0,0,1] as [number,number,number]};
  for(const m of [360,480,720,1020,1185]){updateRockLightingSun(legacy,m);expect(legacy.sun[0]).toBe(legacy.sun[1]);expect(legacy.sun[0]).toBeLessThan(0);}
});
it('covers both rectangles with a convex hull and the swept area in every quadrant',()=>{
  const p=Array.from({length:6},()=>({x:0,y:0}));
  for(const dx of [-90,-20,0,20,90])for(const dy of [-90,-20,0,20,90]) {
    writeShadowCellHull(p,0,0,32,48,dx,dy);
    let area=0;
    for(let i=0;i<6;i++){
      const a=p[i],b=p[(i+1)%6],c=p[(i+2)%6];area+=a.x*b.y-a.y*b.x;
      expect((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)).toBeGreaterThanOrEqual(-1e-9);
      for(const shift of [0,1])for(const x of [-16,16])for(const y of [-24,24])
        expect((b.x-a.x)*(y+dy*shift-a.y)-(b.y-a.y)*(x+dx*shift-a.x)).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(area/2).toBeCloseTo(32*48+Math.abs(dx)*48+Math.abs(dy)*32);
  }
});
it('retains the visible horizon when a direction transition is interrupted',()=>{
  const old=new Uint8Array([10,20,30,255]);packPreviousHorizons(new Uint8Array([128,128,110,255]),new Uint8Array([255,120,130,255]),old,.5);
  expect([...old]).toEqual([60,70,80,255]);
});
