import {expect,it} from 'vitest';
import {fogPatchAlpha,fogPatchMaskAt,fogPatchMaterialAlpha,fogPatchStructureAt,fogPatchFinalAlphaAt} from '../src/effects/sunlight/FogPatchField';
import {FOG} from '../src/effects/groundFog/FogConfig';
import {createSunTuning,resolveSunAtmosphere,SUN_ATMOSPHERE_KEYFRAMES} from '../src/effects/sunlight/SunAtmosphere';
import {validateSunTuning} from '../src/effects/sunlight/SunTuning';
import {createSunPath,resolveSunPath} from '../src/effects/sunlight/SunPath';

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

it('bounds visible coverage on land and water at every atmosphere anchor',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 const optics={water:0,flow:1,edge:100,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){
  resolveSunAtmosphere(minute,tuning);
  for(const time of [0,63,317])for(const water of [0,1]){
   state.timeSec=time;let occupied=0,total=0;
   for(let y=-3072;y<3072;y+=48)for(let x=-3072;x<3072;x+=48){
    const mask=fogPatchMaskAt(x,y,state,water);
    expect(Number.isFinite(mask)&&mask>=0&&mask<=1).toBe(true);
    optics.water=water;
    if(fogPatchFinalAlphaAt(x,y,state,optics)>.2)occupied++;total++;
   }
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

it.each(SUN_ATMOSPHERE_KEYFRAMES)('measures the final alpha profile at minute $minute',({minute})=>{
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

it('preserves area budgets and a faint exterior halo through transport and water amplification',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 const optics={water:0,flow:1.8,edge:14.3,surface:0,wake:0,quality:2,opacity:.58,baseThickness:0,baseOpacity:.5,quantize:true};
 let peak=0,halo=0;
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){
  resolveSunAtmosphere(minute,tuning);
  for(const time of [0,317])for(const water of [0,1]){
   state.timeSec=time;optics.water=water;let dense=0,total=0,exteriorMax=0;
   for(let y=-1536;y<1536;y+=32)for(let x=-1536;x<1536;x+=32){
    const a=fogPatchFinalAlphaAt(x,y,state,optics);
    expect(a>=0&&a<=.62+1/255).toBe(true);
    if(fogPatchMaskAt(x,y,state,water)===0){exteriorMax=Math.max(exteriorMax,a);halo+=a>0;}
    peak=Math.max(peak,a);dense+=a>.45?1:0;total++;
   }
   expect(exteriorMax).toBeLessThanOrEqual(.08);
   expect(dense/total).toBeLessThanOrEqual((water?tuning.fogWaterAreaBudget:tuning.fogAreaBudget)+.005);
  }
 }
 expect(peak).toBeGreaterThan(.6);expect(halo).toBeGreaterThan(100);
},15000);

it('keeps the final alpha night-neutral, clears blocked transport and preserves wakes',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};resolveSunAtmosphere(480,tuning);
 const optics={water:.5,flow:1,edge:100,surface:0,wake:0,quality:2,opacity:.58,baseThickness:.3,baseOpacity:.5,quantize:false};
 for(const strength of [0,-1,NaN]){
  state.strength=strength;
  expect(fogPatchFinalAlphaAt(250,100,state,optics)).toBe(FOG.materialMaxAlpha*(1-Math.exp(-FOG.materialGain*.5*.3)));
 }
 state.strength=1;
 for(const quality of [0,1,2]){
  optics.quality=quality;
  for(let x=-800;x<800;x+=11){
   const a=fogPatchFinalAlphaAt(x,x*.71,state,optics);
   expect(fogPatchFinalAlphaAt(x,x*.71,state,optics)).toBe(a);
   optics.wake=1;expect(fogPatchFinalAlphaAt(x,x*.71,state,optics)).toBe(0);optics.wake=0;
   optics.flow=0;expect(fogPatchFinalAlphaAt(x,x*.71,state,optics)).toBe(0);optics.flow=1;
   optics.surface=1;expect(fogPatchFinalAlphaAt(x,x*.71,state,optics)).toBe(0);optics.surface=0;
  }
 }
});

it('has varied spacing and sizes without strong lattice-period peaks, including dense mornings',()=>{
 const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
 const n=512,step=16,wind=1/Math.hypot(1,.23);
 const cv=(v:number[])=>{const m=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/v.length)/m;};
 for(const minute of [480,720])for(const time of [0,317]){
  resolveSunAtmosphere(minute,tuning);state.timeSec=time;
  const grid=new Uint8Array(n*n),cover=new Float64Array(n*n);let sum=0,square=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const u=(x-n/2)*step,v=(y-n/2)*step;
   const a=fogPatchMaskAt((u-.23*v)*wind,(u*.23+v)*wind,state);
   cover[y*n+x]=a;grid[y*n+x]=a>.15?1:0;sum+=a;square+=a*a;
  }
  // Connected visible masses, rather than the hidden cell seeds: this also tests merging.
  const centers:[number,number][]=[],areas:number[]=[],neighbours=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let i=0;i<grid.length;i++)if(grid[i]){
   const queue=[i];grid[i]=0;let sx=0,sy=0,clipped=false;
   for(let h=0;h<queue.length;h++){
    const k=queue[h],x=k%n,y=Math.floor(k/n);sx+=x;sy+=y;
    if(x===0||y===0||x===n-1||y===n-1)clipped=true;
    for(const [dx,dy] of neighbours){const xx=x+dx,yy=y+dy,j=yy*n+xx;
     if(xx>=0&&xx<n&&yy>=0&&yy<n&&grid[j]){grid[j]=0;queue.push(j);}}
   }
   if(!clipped&&queue.length>=5){centers.push([sx/queue.length,sy/queue.length]);areas.push(queue.length);}
  }
  const nearest=centers.map((p,i)=>{let d=Infinity;for(let j=0;j<centers.length;j++)if(i!==j)d=Math.min(d,Math.hypot(p[0]-centers[j][0],p[1]-centers[j][1]));return d;});
  expect(centers.length).toBeGreaterThan(100);
  expect(cv(nearest)).toBeGreaterThan(.22);expect(cv(areas)).toBeGreaterThan(.65);
  const mean=sum/cover.length,variance=square/cover.length-mean*mean;
  for(const axis of [0,1])for(let lag=16;lag<=100;lag++){
   let s=0,count=0;
   for(let y=0;y<n-(axis?lag:0);y+=2)for(let x=0;x<n-(axis?0:lag);x+=2){
    s+=(cover[y*n+x]-mean)*(cover[(y+(axis?lag:0))*n+x+(axis?0:lag)]-mean);count++;
   }
   // 256–1600 world px covers both cell scales and their first harmonics.
   expect(s/count/variance).toBeLessThan(.30);
  }
 }
},15000);

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
},15000);
