import {expect,it} from 'vitest';
import {fogPatchFinalAlphaAt} from '../src/effects/sunlight/FogPatchField';
import {createSunTuning,resolveSunAtmosphere,SUN_ATMOSPHERE_KEYFRAMES} from '../src/effects/sunlight/SunAtmosphere';
// FogPatches suite, split by cost so vitest runs the parts in parallel; see FogPatches.test.ts.

it('keeps final-alpha spikes bounded at every keyframe and at maximum supported coverage',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 const o={water:0,flow:1.8,edge:14.3,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};
 for(const minute of [...SUN_ATMOSPHERE_KEYFRAMES.map(k=>k.minute),1440]){
  resolveSunAtmosphere(minute,tuning);
  if(minute===1440){tuning.fogAreaBudget=.55;tuning.fogWaterAreaBudget=.45;tuning.fogOpacity=1.5;tuning.fogCover=.7;}
  let peak=0;
  for(const time of [0,317])for(const water of [0,1]){
   state.timeSec=time;o.water=water;
   for(let y=-900;y<900;y+=24)for(let x=-900;x<900;x+=4){
    const a=fogPatchFinalAlphaAt(x,y,state,o);
    peak=Math.max(peak,Math.abs(fogPatchFinalAlphaAt(x+1,y,state,o)-a),Math.abs(fogPatchFinalAlphaAt(x,y+1,state,o)-a));
   }
  }
  expect(peak).toBeLessThanOrEqual(.065);
 }
},60000); // Dense finite-difference sweep over every keyframe; slow when suites share the CPU.
