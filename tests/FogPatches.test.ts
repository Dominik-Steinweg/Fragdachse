import {expect,it} from 'vitest';
import {fogPatchAlpha,fogPatchMaskAt,fogPatchMaterialAlpha,fogPatchStructureAt,fogPatchFinalAlphaAt} from '../src/effects/sunlight/FogPatchField';
import {FOG} from '../src/effects/groundFog/FogConfig';
import {createSunTuning,resolveSunAtmosphere,SUN_ATMOSPHERE_KEYFRAMES} from '../src/effects/sunlight/SunAtmosphere';
import {validateSunTuning} from '../src/effects/sunlight/SunTuning';
// Fog patch contracts. The costly statistical sweeps live in FogPatchesAreaTargets,
// FogPatchesAlphaProfile{Early,Late} and FogPatchesFinalAlpha{Halo,Spikes} so vitest runs them in parallel.

it('bounds visible coverage on land and water at every atmosphere anchor',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 const optics={water:0,flow:1,edge:100,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){
  resolveSunAtmosphere(minute,tuning);
  for(const time of [0,63,317])for(const water of [0,1]){
   state.timeSec=time;let occupied=0,total=0,invalid=0;
   // Count instead of asserting per sample: one expect per sweep keeps the same contract cheap.
   for(let y=-3072;y<3072;y+=48)for(let x=-3072;x<3072;x+=48){
    const mask=fogPatchMaskAt(x,y,state,water);
    if(!(Number.isFinite(mask)&&mask>=0&&mask<=1))invalid++;
    optics.water=water;
    if(fogPatchFinalAlphaAt(x,y,state,optics)>.2)occupied++;total++;
   }
   expect(invalid).toBe(0);
   const budget=water?Math.min(tuning.fogAreaBudget,tuning.fogWaterAreaBudget):tuning.fogAreaBudget;
   // Budgets refer to visible coverage, not the almost transparent support/halo.
   expect(occupied/total).toBeLessThanOrEqual(budget+.04);
  }
 }
},60000); // Multi-anchor statistical sweep: same samples under parallel CPU contention.
it('bounds average dense coverage across reference views at maximum transport',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 const optics={water:0,flow:1.8,edge:14.3,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};
 for(const minute of [480,720,1020,1140]){
  resolveSunAtmosphere(minute,tuning);
  for(const time of [0,63,317])for(const water of [0,1]){
   state.timeSec=time;
   let totalDense=0,totalSamples=0;
   for(let cy=-1600;cy<1600;cy+=800)for(let cx=-1600;cx<1600;cx+=800){
    let dense=0,total=0;
    for(let y=cy;y<cy+468;y+=20)for(let x=cx;x<cx+832;x+=20){
     optics.water=water;
     const alpha=fogPatchFinalAlphaAt(x,y,state,optics);
     if(alpha>.45)dense++;total++;
    }
    totalDense+=dense;totalSamples+=total;
   }
   // Merging may fill one close camera view; the budget is statistical over the world.
   const budget=water?tuning.fogWaterAreaBudget:tuning.fogAreaBudget;
   expect(totalDense/totalSamples).toBeLessThanOrEqual(budget+.035);
  }
 }
},15000);
it('permits dense cores without increasing occupied area',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){
  resolveSunAtmosphere(minute,tuning);
  expect(fogPatchAlpha(1,1,.58*tuning.fogOpacity,tuning.fogPatchDensity*tuning.fogDensity)).toBeGreaterThan(.60);
 }
 const before=fogPatchMaskAt(100,200,state);
 tuning.fogPatchDensity=6;tuning.fogOpacity=1.5;
 expect(fogPatchMaskAt(100,200,state)).toBe(before);expect(fogPatchAlpha(0,1,1.5,6)).toBe(0);
});
it('is continuous at shores, patch boundaries and frozen/invalid time',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};let edges=0,motion=0;
 for(let x=-3000;x<3000;x+=13){
  const y=x*.71,v=fogPatchMaskAt(x,y,state);
  expect(fogPatchMaskAt(x,y,state)).toBe(v);
  expect(Math.abs(fogPatchMaskAt(x+.001,y,state)-v)).toBeLessThan(.001);
  expect(fogPatchMaskAt(x,y,{...state,timeSec:NaN})).toBe(v);
  expect(Math.abs(fogPatchMaskAt(x,y,{...state,timeSec:.001})-v)).toBeLessThan(.001);
  const wet=fogPatchMaskAt(x,y,state,.5);
  expect(Math.abs(fogPatchMaskAt(x,y,state,.50001)-wet)).toBeLessThan(.001);
  expect(fogPatchMaskAt(x,y,state,1)).toBeLessThanOrEqual(v+1e-12);
  if(v>.05&&v<.95)edges++;
  motion+=Math.abs(fogPatchMaskAt(x,y,{...state,timeSec:120})-v);
 }
 expect(edges).toBeGreaterThan(0);expect(motion).toBeGreaterThan(1);
 expect(fogPatchMaskAt(NaN,0,state)).toBe(0);
 tuning.fogAreaBudget=0;expect(fogPatchMaskAt(100,200,state)).toBe(0);
 for(const patch of [{fogPatchScale:0},{fogPatchDensity:Infinity},{fogAreaBudget:NaN},{fogWaterAreaBudget:.8}])expect(()=>validateSunTuning(patch)).toThrow();
});
it('leaves the production night optical response untouched and fades continuously at dawn',()=>{
 const tuning=createSunTuning();
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){
  resolveSunAtmosphere(minute,tuning);
  for(const base of [0,.05,.3,1])for(const patch of [0,.2,6]){
   const expected=FOG.materialMaxAlpha*(1-Math.exp(-FOG.materialGain*.5*base));
   for(const strength of [0,-1,NaN])expect(fogPatchMaterialAlpha(base,patch,.5,.58,{tuning,timeSec:0,strength})).toBe(expected);
   expect(Math.abs(fogPatchMaterialAlpha(base,patch,.5,.58,{tuning,timeSec:0,strength:1e-7})-expected)).toBeLessThan(1e-8);
  }
 }
});

it('forms non-convex wisps with broad soft rims instead of elliptical cut-outs',()=>{
 const tuning=createSunTuning();resolveSunAtmosphere(480,tuning);
 const state={tuning,timeSec:0,strength:1},n=500,step=4,grid=new Uint8Array(n*n);
 const widths:number[]=[];
 // Measure the actual CPU mask; do not infer organic shape from tuning constants.
 for(let y=0;y<n;y++){
  let start=-1,reached=false;
  for(let x=0;x<n;x++){
   const v=fogPatchMaskAt(x*step-1000,y*step-1000,state);
   grid[y*n+x]=v>.2?1:0;
   if(v<.1){start=-1;reached=false;}
   else if(start<0)start=x;
   if(v>.9&&start>=0&&!reached){widths.push((x-start)*step);reached=true;}
  }
 }
 type Point=[number,number];
 const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 let area=0,hullArea=0,components=0;
 const neighbours=[[1,0],[-1,0],[0,1],[0,-1]];
 for(let i=0;i<grid.length;i++)if(grid[i]){
  const queue=[i],points:Point[]=[];grid[i]=0;let clipped=false;
  for(let head=0;head<queue.length;head++){
   const k=queue[head],x=k%n,y=Math.floor(k/n);points.push([x,y]);
   if(x===0||y===0||x===n-1||y===n-1)clipped=true;
   for(const [dx,dy] of neighbours){
    const xx=x+dx,yy=y+dy,j=yy*n+xx;
    if(xx>=0&&xx<n&&yy>=0&&yy<n&&grid[j]){grid[j]=0;queue.push(j);}
   }
  }
  if(clipped||points.length<80)continue;
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const lower:Point[]=[],upper:Point[]=[];
  for(const p of points){while(lower.length>1&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
  for(let j=points.length-1;j>=0;j--){const p=points[j];while(upper.length>1&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
  const hull=lower.slice(0,-1).concat(upper.slice(0,-1));let a=0;
  for(let j=0;j<hull.length;j++){const p=hull[j],q=hull[(j+1)%hull.length];a+=p[0]*q[1]-q[0]*p[1];}
  area+=points.length;hullArea+=Math.abs(a)/2;components++;
 }
 // An ellipse is convex regardless of aspect or orientation. Require substantial
 // indentations, not merely a changed axis ratio or subpixel edge noise.
 // Merged morning fields have fewer disconnected components; still measure
 // multiple complete contours (excluding masses clipped by the sample window).
 expect(components).toBeGreaterThan(5);
 expect(1-area/hullArea).toBeGreaterThan(.04);
 widths.sort((a,b)=>a-b);
 expect(widths.length).toBeGreaterThan(100);
 expect(widths[Math.floor(widths.length/2)]).toBeGreaterThanOrEqual(30);
 expect(widths[Math.floor(widths.length/2)]).toBeLessThanOrEqual(70);
});

it('retains bright crests and deep inner valleys rather than saturating selected patches',()=>{
 const tuning=createSunTuning();resolveSunAtmosphere(480,tuning);
 const state={tuning,timeSec:0,strength:1};let count=0,sum=0,square=0,peak=0;
 for(let y=-1000;y<1000;y+=8)for(let x=-1000;x<1000;x+=8){
  const mask=fogPatchMaskAt(x,y,state);
  const structure=fogPatchStructureAt(x,y,0);
  if(mask>.75){
   const alpha=fogPatchAlpha(mask,structure,.58*tuning.fogOpacity,tuning.fogPatchDensity*tuning.fogDensity);
   count++;sum+=alpha;square+=alpha*alpha;peak=Math.max(peak,alpha);
  }
 }
 expect(count).toBeGreaterThan(100);
 expect(Math.sqrt(square/count-(sum/count)**2)).toBeGreaterThan(.1);
 expect(peak).toBeGreaterThan(.6);
 for(const quality of [0,1,2])for(const time of [0,63,317])for(let x=-500;x<500;x+=17){
  const structure=fogPatchStructureAt(x,x*.71,time,quality);
  expect(structure).toBeGreaterThanOrEqual(0);expect(structure).toBeLessThanOrEqual(1);
  expect(fogPatchStructureAt(x,x*.71,time,quality)).toBe(structure);
 }
 expect(fogPatchStructureAt(NaN,0,0)).toBe(0);
 expect(fogPatchStructureAt(12,34,NaN)).toBe(fogPatchStructureAt(12,34,0));
});

