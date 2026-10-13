import {expect,it} from 'vitest';
import {fogPatchFinalAlphaAt} from '../src/effects/sunlight/FogPatchField';
import {createSunTuning,resolveSunAtmosphere,SUN_ATMOSPHERE_KEYFRAMES} from '../src/effects/sunlight/SunAtmosphere';
// FogPatches suite, split by cost so vitest runs the parts in parallel; see FogPatches.test.ts.
// Second half of the atmosphere keyframes; FogPatchesAlphaProfileEarly covers the rest.

it.each(SUN_ATMOSPHERE_KEYFRAMES.slice(Math.ceil(SUN_ATMOSPHERE_KEYFRAMES.length/2)))('measures the final alpha profile at minute $minute',({minute})=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 const optics={water:0,flow:1,edge:100,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};

  resolveSunAtmosphere(minute,tuning);
  for(const softEdges of [false,true]){
   const widths:number[]=[];let maxSlope=0,slopeSum=0,profiles=0;
   for(let line=-900;line<900;line+=12)for(const axis of [0,1]){
    const values:number[]=[];
    for(let k=-900;k<900;k++){
     const v=fogPatchFinalAlphaAt(axis?line:k,axis?k:line,state,optics,softEdges);
     if(values.length)maxSlope=Math.max(maxSlope,Math.abs(v-values[values.length-1]));
     values.push(v);
    }
    for(let start=0;start<values.length;){
     while(start<values.length&&values[start]<.02)start++;
     let end=start,peak=0,p=start;
     while(end<values.length&&values[end]>=.02){if(values[end]>peak){peak=values[end];p=end;}end++;}
     if(peak>.35&&start>0&&end<values.length){
      let lo=start,hi=start;while(lo<p&&values[lo]<peak*.1)lo++;while(hi<p&&values[hi]<peak*.9)hi++;
      widths.push(hi-lo);slopeSum+=peak*.8/Math.max(1,hi-lo);profiles++;
      lo=end-1;hi=end-1;while(lo>p&&values[lo]<peak*.1)lo--;while(hi>p&&values[hi]<peak*.9)hi--;
      widths.push(lo-hi);slopeSum+=peak*.8/Math.max(1,lo-hi);profiles++;
     }
     start=end+1;
    }
   }
   widths.sort((a,b)=>a-b);expect(profiles).toBeGreaterThan(100);
   if(softEdges){
    expect(widths[Math.floor(widths.length/2)]).toBeGreaterThanOrEqual(40);
    expect(widths[Math.floor(widths.length/2)]).toBeLessThanOrEqual(80);
    expect(slopeSum/profiles).toBeLessThanOrEqual(.62/40);
    // One-pixel quantization steps and fine fingers are allowed, paper-like jumps are not.
    expect(maxSlope).toBeLessThanOrEqual(.065);
   }else{
    // Removing the final optical ramp must still fail: a wide mask is insufficient.
    expect(maxSlope).toBeGreaterThan(.065);
   }
  }
},15000);

