import {expect,it} from 'vitest';
import {fogPatchMaskAt,fogPatchFinalAlphaAt} from '../src/effects/sunlight/FogPatchField';
import {FOG} from '../src/effects/groundFog/FogConfig';
import {createSunTuning,resolveSunAtmosphere,SUN_ATMOSPHERE_KEYFRAMES} from '../src/effects/sunlight/SunAtmosphere';
// FogPatches suite, split by cost so vitest runs the parts in parallel; see FogPatches.test.ts.

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
},60000); // Statistical sweep; slow when suites share the CPU.

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

