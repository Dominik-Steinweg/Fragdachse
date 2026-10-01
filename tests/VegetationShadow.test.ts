import {expect,it} from 'vitest';
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import {stampVegetationAlpha,packVegetationVolume,vegetationShadowLength,VEGETATION_PAD} from '../src/effects/sunlight/VegetationVolume';
import {vegetationShadowAlpha,vegetationShadowCoverage,vegetationDataAt} from '../src/effects/sunlight/VegetationShadow';
import {createSunPath,resolveSunPath} from '../src/effects/sunlight/SunPath';
import {SUN_RENDER_QUALITY} from '../src/effects/sunlight/SunRenderQuality';

it('projects visible shadows outside actual fern alpha and reverses with the solar bearing',async()=>{
 const names=['forest_fern-01-uneven-star','forest_fern-02-side-spread','forest_fern-03-young-four','forest_fern-04-twin-growth'];
 const size=64,side=80,radius=4,rows:any[]=[],image=Buffer.alloc(384*512*4,255);
 for(const [index,name] of names.entries()){
  const {data,info}=await sharp('public/assets/sprites/groundcover/'+name+'.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const alpha=Uint8Array.from({length:info.width*info.height},(_,i)=>data[i*4+3]);
  const raw=new Float32Array(side*side),a=new Float32Array(raw.length),b=new Float32Array(raw.length),packed=new Uint8Array(size*size*4);
  stampVegetationAlpha(raw,side,-80,-80,{width:info.width,height:info.height,alpha},0,0,64,64*info.height/info.width,.37,1);
  packVegetationVolume(raw,a,b,side,radius,packed);
  for(const minute of [480,720,1050]){
   const path=resolveSunPath(minute,null,createSunPath()),length=vegetationShadowLength(path.elevation,5);
   const oldLength=Math.max(4,Math.min(14,6/Math.tan(path.elevation)));
   let changed=0,oldChanged=0,external=0,mass=0,projection=0,peak=0;
   for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const tx=x/2-.25,ty=y/2-.25,plant=vegetationDataAt(packed,size,tx,ty,1);
    const coverage=vegetationShadowCoverage(packed,size,tx,ty,path.direction[0]*length,path.direction[1]*length);
    const shadow=vegetationShadowAlpha(coverage,plant,path.sun[2],path.strength,.44);
    const oldCoverage=vegetationDataAt(packed,size,tx+path.direction[0]*oldLength/2,ty+path.direction[1]*oldLength/2,0);
    const g=Math.max(0,Math.min(1,(plant-.02)/.16)),mask=1-g*g*(3-2*g);
    const oldShadow=Math.min(.3,oldCoverage*.2*path.strength)*mask;
    // Same premultiplied source-over as the chunk shader, composited over ground.
    const base=[.3,.36,.2],cool=[0,.006,.012],oldCool=[.06,.085,.12],luma=[.2126,.7152,.0722];
    let diff=0,oldDiff=0;
    for(let c=0;c<3;c++){
     const source=plant*[.12,.3,.08][c];
     const before=source+base[c]*(1-plant);
     const after=source*(1-shadow)+cool[c]*shadow+base[c]*(1-plant)*(1-shadow);
     const old=source*(1-oldShadow)+oldCool[c]*oldShadow+base[c]*(1-plant)*(1-oldShadow);
     diff+=(before-after)*luma[c];oldDiff+=(before-old)*luma[c];
     if(minute===1050){
      const row=index*128+y;
      image[(row*384+x)*4+c]=Math.round(old*255);
      image[(row*384+128+x)*4+c]=Math.round(after*255);
      image[(row*384+256+x)*4+c]=Math.round(Math.min(1,Math.abs(old-after)*6)*255);
     }
    }
    if(plant<.02){external++;if(diff>3/255)changed++;if(oldDiff>3/255)oldChanged++;
     mass+=shadow;projection+=shadow*((x-63.5)*path.direction[0]+(y-63.5)*path.direction[1]);peak=Math.max(peak,shadow);}
   }
   rows.push({name,minute,length,externalPercent:100*changed/16384,oldExternalPercent:100*oldChanged/16384,
    clearGroundAffected:100*changed/external,centroidAlongSun:projection/mass,peak});
   expect(changed).toBeGreaterThan(120);expect(projection/mass).toBeLessThan(-1);
   if(minute!==720)expect(changed).toBeGreaterThan(oldChanged*1.5);
   // Mirror the field and solar offset together: no direction-dependent bias.
   const mirrored=new Uint8Array(packed.length);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<4;c++)mirrored[(y*size+x)*4+c]=packed[((size-1-y)*size+size-1-x)*4+c];
   for(let y=10;y<54;y+=7)for(let x=10;x<54;x+=7)
    expect(vegetationShadowCoverage(mirrored,size,size-1-x,size-1-y,-path.direction[0]*length,-path.direction[1]*length))
     .toBeCloseTo(vegetationShadowCoverage(packed,size,x,y,path.direction[0]*length,path.direction[1]*length),8);
  }
 }
 mkdirSync('build/r18b-proof',{recursive:true});writeFileSync('build/r18b-proof/metrics.json',JSON.stringify(rows,null,2));
 await sharp(image,{raw:{width:384,height:512,channels:4}}).resize(768,1024).png().toFile('build/r18b-proof/shadows.png');
 console.table(rows.map(r=>({asset:r.name,time:r.minute,length:r.length.toFixed(1),before:r.oldExternalPercent.toFixed(2),after:r.externalPercent.toFixed(2)})));
});
it('is neutral at night, under complete cover and in medium/low; grows smoothly with lower sun',()=>{
 for(const strength of [0,-1,NaN])expect(vegetationShadowAlpha(1,0,.5,strength,.44)).toBe(0);
 expect(vegetationShadowAlpha(1,0,0,1,.44)).toBe(0);
 for(const [canopy,cloud] of [[0,1],[1,0]])expect(vegetationShadowAlpha(1,0,.5,1,.44,canopy,cloud)).toBe(0);
 for(const quality of [SUN_RENDER_QUALITY.medium,SUN_RENDER_QUALITY.low])
  expect(vegetationShadowAlpha(1,0,.5,1,.44,1,1,quality.vegetationShadows)).toBe(0);
 expect(vegetationShadowAlpha(1,0,.48,1,.44)).toBeCloseTo(.44);
 expect(vegetationShadowAlpha(1,0,Math.SQRT1_2,1,.44)).toBeCloseTo(.198);
 expect(vegetationShadowLength(Math.PI/4,5)).toBeCloseTo(5);
 expect(vegetationShadowLength(.2,5)).toBe(22);
 expect(VEGETATION_PAD).toBeGreaterThanOrEqual(22+4.14+1);
});
