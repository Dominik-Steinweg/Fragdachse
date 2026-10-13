import {expect,it} from 'vitest';
import {fogPatchFinalAlphaAt} from '../src/effects/sunlight/FogPatchField';
import {createSunTuning,resolveSunAtmosphere} from '../src/effects/sunlight/SunAtmosphere';
import {createSunPath,resolveSunPath} from '../src/effects/sunlight/SunPath';
// FogPatches suite, split by cost so vitest runs the parts in parallel; see FogPatches.test.ts.

// Visible-area acceptance contract: settled transport, no obstruction/wake,
// 8192² world px sampled at three drift phases, actual authored clock/strength.
// Material saturation, final rim, dither and RGBA8 quantization are all included.
it.each([
 {minute:420,land:[.37,.44],water:[.27,.34]},
 {minute:450,land:[.45,.55],water:[.30,.40]},
 {minute:480,land:[.45,.55],water:[.30,.40]},
 {minute:510,land:[.45,.55],water:[.30,.40]},
 {minute:540,land:[.32,.38],water:[.20,.27]},
 {minute:600,land:[.22,.28],water:[.08,.14]},
 {minute:720,land:[.025,.05],water:[.02,.045]},
])('reaches visible area targets at minute $minute',({minute,land,water})=>{
 const tuning=createSunTuning(),sun=createSunPath();resolveSunAtmosphere(minute,tuning);
 const state={tuning,timeSec:0,strength:resolveSunPath(minute,null,sun).strength};
 const o={water:0,flow:1,edge:100,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};
 for(const wet of [0,1])for(const time of [0,63,317]){
  o.water=wet;state.timeSec=time;let count=0,visible=0,dense=0,peak=0;
  for(let y=-4096;y<4096;y+=32)for(let x=-4096;x<4096;x+=32){
   const a=fogPatchFinalAlphaAt(x,y,state,o);visible+=a>.2?1:0;dense+=a>.4?1:0;peak=Math.max(peak,a);count++;
  }
  const range=wet?water:land;
  expect(visible/count).toBeGreaterThanOrEqual(range[0]);expect(visible/count).toBeLessThanOrEqual(range[1]);
  expect(dense/count).toBeLessThan(visible/count);expect(peak).toBeLessThanOrEqual(.62+1/255);
  if(minute<720)expect(peak).toBeGreaterThan(.6);
 }
},15000);

it('increases morning footprint with live budgets rather than only saturating cores',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:63,strength:1};
 const o={water:0,flow:1,edge:100,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};
 const fractions:number[]=[];
 for(const extra of [false,true]){
  resolveSunAtmosphere(480,tuning,extra?{fogAreaBudget:.55,fogCover:.85,fogPatchDensity:4.5}:{});
  let count=0,visible=0;
  for(let y=-4096;y<4096;y+=32)for(let x=-4096;x<4096;x+=32){visible+=fogPatchFinalAlphaAt(x,y,state,o)>.2?1:0;count++;}
  fractions.push(visible/count);
 }
 expect(fractions[1]-fractions[0]).toBeGreaterThan(.04);
 expect(fractions[1]).toBeLessThanOrEqual(.59);
});

