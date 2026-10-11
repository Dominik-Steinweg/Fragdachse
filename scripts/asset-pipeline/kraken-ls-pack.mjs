import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {packAtlas} from './atlas-v2.mjs';
import {resizeMaster} from './export.mjs';

const revision=process.argv[2];
if(!/^kraken-ls-pilot-\d+$/.test(revision??''))throw Error('Pass pilot revision');
const root=path.resolve('art/poc/pipeline-v2/runs',revision);
const sha=b=>createHash('sha256').update(b).digest('hex');
const linear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const srgb=c=>c<=.0031308?c*12.92:1.055*Math.max(0,c)**(1/2.4)-.055;
const byte=x=>Math.round(Math.max(0,Math.min(1,x))*255);
async function npy(file){const b=await fs.readFile(file);const offset=10+b.readUInt16LE(8);const bytes=b.subarray(offset);return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));}
function reduce(pixels,source,size){
  const out=new Float32Array(size*size*4),scale=source/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const x0=x*scale,y0=y*scale,x1=x0+scale,y1=y0+scale,o=(y*size+x)*4;
    for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++)for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++){
      const weight=(Math.min(x1,sx+1)-Math.max(x0,sx))*(Math.min(y1,sy+1)-Math.max(y0,sy))/(scale*scale),i=(sy*source+sx)*4;
      for(let c=0;c<4;c++)out[o+c]+=pixels[i+c]*weight;
    }
  }return out;
}
function oct(x,y,z){const len=Math.hypot(x,y,z)||1;x/=len;y/=len;z/=len;const l=Math.abs(x)+Math.abs(y)+Math.abs(z);x/=l;y/=l;
  if(z<0){const a=x;x=(1-Math.abs(y))*(a<0?-1:1);y=(1-Math.abs(a))*(y<0?-1:1);}return [x*.5+.5,y*.5+.5];}
function decode(x,y){x=x*2-1;y=y*2-1;const z=1-Math.abs(x)-Math.abs(y),t=Math.max(0,-z);x+=x>=0?-t:t;y+=y>=0?-t:t;const l=Math.hypot(x,y,z)||1;return [x/l,y/l,z/l];}
function fillEdges(data,size,valid,channels){
  for(let pass=0;pass<2;pass++){
    const next=Uint8Array.from(valid),copy=Buffer.from(data);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x;if(!data[i*4+3]||valid[i])continue;
      const j=[x>0?i-1:-1,x<size-1?i+1:-1,y>0?i-size:-1,y<size-1?i+size:-1].find(k=>k>=0&&valid[k]);
      if(j!==undefined){for(const c of channels)copy[i*4+c]=data[j*4+c];next[i]=1;}
    }copy.copy(data);valid=next;
  }
}
const assets=[];
const ids=['abyssal-kraken','abyssal-kraken-land','abyssal-kraken-tentacle','abyssal-kraken-egg'];
const selected=process.argv[3];if(selected&&!ids.includes(selected))throw Error('Invalid asset selection');
for(const id of selected?[selected]:ids){
  const folder=path.join(root,id,'standard'),raw=JSON.parse(await fs.readFile(path.join(folder,'ls-raw.json'),'utf8'));
  const job=JSON.parse(await fs.readFile(path.join(folder,'ls-job.json'),'utf8'));
  const size=raw.size,half=size/2;
  let emissionPeak=0;
  for(const pose of raw.poses){const e=await npy(path.join(folder,pose.name,'emission.npy'));
    for(let i=0;i<e.length;i+=4)if(e[i+3]>.99)for(let c=0;c<3;c++)emissionPeak=Math.max(emissionPeak,e[i+c]/e[i+3]);
  }
  const emissionRange=2**Math.ceil(Math.log2(Math.max(1,emissionPeak)));
  const asset={id,role:raw.role,revision,size,canvasWorld:size,worldPxPerBU:raw.worldPxPerBU,
    pivot:job.render.pivot,sockets:job.render.sockets??{},heightRange:raw.heightRange,
    encoding:'linear-unorm8-z-oct-normal-v1',colorPass:'srgb-albedo-baked-cavity-v1',emissionEncoding:'linear-rgb-unorm8-scaled-v1',
    emissionRange,poses:[],gpuBytes:0,meshDownloadBytes:0};
  const exposureRatios=[];
  for(const pose of raw.poses){
    const dir=path.join(folder,pose.name),beauty=await resizeMaster(path.join(job.source,pose.beauty),size);
    const beautyPixels=await sharp(beauty).ensureAlpha().raw().toBuffer();
    const coverageHalf=await sharp(await resizeMaster(path.join(job.source,pose.beauty),half)).ensureAlpha().raw().toBuffer();
    const [albedoMaster,normalMaster,heightMaster,emissionMaster]=await Promise.all(['albedo','normal','height','emission'].map(p=>npy(path.join(dir,p+'.npy'))));
    const albedo=reduce(albedoMaster,1024,size),normal=reduce(normalMaster,1024,half),emission=reduce(emissionMaster,1024,size);
    const color=Buffer.alloc(size*size*4),data=Buffer.alloc(half*half*4),em=Buffer.alloc(size*size*4),heightValid=new Uint8Array(half*half);
    for(let i=0;i<color.length;i+=4){const a=Math.max(albedo[i+3],1e-8),ea=Math.max(emission[i+3],1e-8);
      for(let c=0;c<3;c++){color[i+c]=byte(srgb(albedo[i+c]/a));em[i+c]=byte(emission[i+c]/ea/emissionRange);}
      color[i+3]=beautyPixels[i+3];em[i+3]=em[i]+em[i+1]+em[i+2]>0?beautyPixels[i+3]:0;
    }
    for(let y=0;y<half;y++)for(let x=0;x<half;x++){
      const i=(y*half+x)*4,a=Math.max(normal[i+3],1e-8),n=oct(normal[i]/a*2-1,normal[i+1]/a*2-1,normal[i+2]/a*2-1);
      const sx=Math.min(1023,Math.floor((x+.5)*1024/half)),sy=Math.min(1023,Math.floor((y+.5)*1024/half)),j=(sy*1024+sx)*4;
      heightValid[y*half+x]=Number(heightMaster[j+3]>.01);
      data[i]=byte(heightMaster[j]/Math.max(1e-8,heightMaster[j+3]));data[i+1]=byte(n[0]);data[i+2]=byte(n[1]);data[i+3]=coverageHalf[i+3];
    }
    // Fill only missing edge data under Beauty's wider AA coverage. Never change coverage.
    fillEdges(color,size,Uint8Array.from({length:size*size},(_,i)=>Number(albedo[i*4+3]>.01)),[0,1,2]);
    fillEdges(data,half,Uint8Array.from({length:half*half},(_,i)=>Number(normal[i*4+3]>.01)),[1,2]);
    fillEdges(data,half,heightValid,[0]);
    const buffers={color:await sharp(color,{raw:{width:size,height:size,channels:4}}).png().toBuffer(),
      elevation:await sharp(data,{raw:{width:half,height:half,channels:4}}).png().toBuffer(),
      emission:await sharp(em,{raw:{width:size,height:size,channels:4}}).png().toBuffer(),beauty};
    let angleSum=0,angleMax=0,count=0,emissionMax=0,albedoClipped=0;
    for(let i=0;i<normal.length;i+=4)if(normal[i+3]>.99){
      const a=normal[i+3],n=[normal[i]/a*2-1,normal[i+1]/a*2-1,normal[i+2]/a*2-1],l=Math.hypot(...n),d=decode(data[i+1]/255,data[i+2]/255);
      const angle=Math.acos(Math.max(-1,Math.min(1,n.reduce((s,v,c)=>s+v*d[c],0)/l)))*180/Math.PI;
      angleSum+=angle;angleMax=Math.max(angleMax,angle);count++;
    }
    for(let i=0;i<emission.length;i+=4)if(emission[i+3]>.99)for(let c=0;c<3;c++)emissionMax=Math.max(emissionMax,emission[i+c]/emission[i+3]);
    for(let i=0;i<albedo.length;i+=4)if(albedo[i+3]>.99&&[0,1,2].some(c=>albedo[i+c]/albedo[i+3]>1))albedoClipped++;
    if(emissionMax>emissionRange+.01)throw Error('Emission exceeds declared range');
    const record={...pose,passes:{},gpuBytes:0,quantization:{normalMeanDeg:angleSum/count,normalMaxDeg:angleMax,emissionMax,albedoClippedPixels:albedoClipped}};
    for(const [pass,buffer] of Object.entries(buffers)){
      const pages=await packAtlas([buffer],{frameNames:[pose.name],sourceFrames:[pose.sourceFrame],size:pass==='elevation'?half:size,pivot:asset.pivot,prefix:`${pose.name}/${pass}`});
      const page=pages[0],json=JSON.stringify(page.metadata,null,2)+'\n';await fs.writeFile(path.join(folder,page.image),page.png);await fs.writeFile(path.join(folder,page.json),json);
      record.passes[pass]={image:page.image,json:page.json,sha256:sha(page.png),jsonSha256:sha(json),width:page.width,height:page.height,gpuBytes:page.gpuBytesRGBA8};
      if(pass!=='beauty')record.gpuBytes+=page.gpuBytesRGBA8;
    }
    await fs.writeFile(path.join(dir,'beauty.png'),beauty);
    await fs.writeFile(path.join(dir,'albedo.png'),buffers.color);
    await fs.writeFile(path.join(dir,'packed.png'),buffers.elevation);
    await fs.writeFile(path.join(dir,'emission.png'),buffers.emission);
    // Identical scalar form function as the material shader; CPU diagnostic, not a browser capture.
    const lights=[];
    for(const elevation of [28,45])for(const azimuth of [0,90,180,270])lights.push({azimuth,elevation,strength:1});
    lights.push({azimuth:0,elevation:45,strength:0});
    for(const light of lights){
      const e=light.elevation*Math.PI/180,a=light.azimuth*Math.PI/180,sun=[Math.cos(a)*Math.cos(e),-Math.sin(a)*Math.cos(e),Math.sin(e)],pixels=Buffer.from(color);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const i=(y*size+x)*4,fx=(x+.5)/2-.5,fy=(y+.5)/2-.5,x0=Math.floor(fx),y0=Math.floor(fy),n=[0,0,0];
        for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
          const j=(Math.max(0,Math.min(half-1,y0+oy))*half+Math.max(0,Math.min(half-1,x0+ox)))*4,
            w=(ox?fx-x0:1-fx+x0)*(oy?fy-y0:1-fy+y0)*data[j+3]/255,d=decode(data[j+1]/255,data[j+2]/255);
          d.forEach((v,c)=>n[c]+=v*w);
        }
        const length=Math.hypot(...n)||1;n.forEach((v,c)=>n[c]=v/length);
        const factor=(.2+light.strength*Math.max(0,n[0]*sun[0]+n[1]*sun[1]+n[2]*sun[2]))/(.2+light.strength*sun[2]);
        for(let c=0;c<3;c++)pixels[i+c]=byte(srgb(linear(color[i+c]/255)*factor+em[i+c]/255*emissionRange));
      }
      const name=light.strength?`sun-${light.azimuth}-${light.elevation}`:'night';
      if(light.elevation===45&&light.strength){
        let oldSum=0,newSum=0;
        for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>250&&em[i+3]===0){
          oldSum+=beautyPixels[i]*.2126+beautyPixels[i+1]*.7152+beautyPixels[i+2]*.0722;
          newSum+=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;
        }
        if(newSum)exposureRatios.push(oldSum/newSum);
      }
      await sharp(pixels,{raw:{width:size,height:size,channels:4}}).png().toFile(path.join(dir,name+'.png'));
    }
    asset.poses.push(record);asset.gpuBytes+=record.gpuBytes;asset.meshDownloadBytes+=pose.mesh.positions.bytes+pose.mesh.indices.bytes;
  }
  exposureRatios.sort((a,b)=>a-b);
  const ratio=exposureRatios[Math.floor(exposureRatios.length/2)],previous=asset.role==='water'?.55:1;
  asset.exposureCalibration={previous,ratioToBeauty:ratio,suggested:Math.round(previous*ratio*1000)/1000,
    method:'Median mean-luminance ratio over selected poses and four 45-degree sun azimuths; opaque non-emissive pixels, before World lighting. Provisional until browser visual acceptance.'};
  asset.publicationHashes=Object.fromEntries(await Promise.all(['kraken-ls-pack.mjs','atlas-v2.mjs','export.mjs'].map(async f=>[f,sha(await fs.readFile(path.join('scripts/asset-pipeline',f)))])));
  await fs.writeFile(path.join(folder,'ls-pilot.json'),JSON.stringify(asset,null,2)+'\n');assets.push(asset);
}
if(!selected)await fs.writeFile(path.join(root,'ls-pilot.json'),JSON.stringify({version:1,revision,assets},null,2)+'\n');
console.log(JSON.stringify(assets.map(a=>({id:a.id,poses:a.poses.length,gpuMiB:a.gpuBytes/1048576,meshKiB:a.meshDownloadBytes/1024})),null,2));
