import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { rasterUnion, bilinear } from './mesh-shadow-raster.mjs';

const revision=process.argv[2]??'kraken-ls-pilot-2';
if(!/^kraken-ls-pilot-\d+$/.test(revision))throw Error('Invalid revision');
const root=path.resolve('art/poc/pipeline-v2/runs',revision),out=path.resolve('art/poc/kraken-v12/light-shadow-pilot');
await fs.mkdir(out,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'ls-pilot.json'))),metrics=[],gallery=[];
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const label=(w,h,title,subtitle='')=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#14201e"/><text x="16" y="25" fill="#e2eddf" font-family="sans-serif" font-size="17">${esc(title)}</text><text x="16" y="47" fill="#a7bcae" font-family="sans-serif" font-size="12">${esc(subtitle)}</text></svg>`);
const png=(data,width,height,channels=4)=>sharp(data,{raw:{width,height,channels}}).png().toBuffer();
const raw=file=>sharp(file).ensureAlpha().raw().toBuffer();
function exposure(pixels,ratio){for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)pixels[i+c]=Math.min(255,Math.round(pixels[i+c]*ratio));return pixels;}
async function meshAt(base,p){
 const [qb,ib]=await Promise.all([fs.readFile(path.join(base,p.mesh.positions.file)),fs.readFile(path.join(base,p.mesh.indices.file))]);
 const positions=new Float64Array(p.mesh.vertexCount*3),indices=new Uint16Array(p.mesh.triangleCount*3),b=p.mesh.bounds;
 for(let i=0;i<positions.length;i++)positions[i]=b.min[i%3]+qb.readUInt16LE(i*2)/65535*(b.max[i%3]-b.min[i%3]);
 for(let i=0;i<indices.length;i++)indices[i]=ib.readUInt16LE(i*2);return {positions,indices};
}
const playerManifest=JSON.parse(await fs.readFile('src/assets/manifests/character-mesh-badger-player-mesh-r2-005.json'));
const playerSpec=playerManifest.meshes.find(m=>m.id==='badger');
const player=await meshAt('public',{mesh:{...playerSpec,positions:{file:playerSpec.positions.url.split('?')[0]},indices:{file:playerSpec.indices.url.split('?')[0]}}});
const playerImage=await sharp('public/assets/sprites/pipeline-v2/badger/idle.png').resize(38,38).png().toBuffer();
function projectedMask(mesh,width,height,cx,cy,azimuth,elevation,shore,plane,waterLevel,wetPass=plane>0){
 const a=azimuth*Math.PI/180,e=elevation*Math.PI/180,dx=Math.cos(a)/Math.tan(e),dy=-Math.sin(a)/Math.tan(e),xy=new Float64Array(mesh.positions.length/3*2);
 const p=mesh.positions;
 for(let i=0;i<p.length;i+=3){xy[i/3*2]=p[i]+cx-dx*Math.max(0,p[i+2]-plane);xy[i/3*2+1]=p[i+1]+cy-dy*Math.max(0,p[i+2]-plane);}
 // Reference raster with interpolated source position: exactly the wet/dry clipping contract.
 const data=new Uint8Array(width*height),edge=(ax,ay,bx,by,x,y)=>(x-ax)*(by-ay)-(y-ay)*(bx-ax);
 const wet=(x,y)=>shore&&y<325;
 for(let j=0;j<mesh.indices.length;j+=3){
   const ids=[mesh.indices[j],mesh.indices[j+1],mesh.indices[j+2]],t=ids.map(i=>[xy[i*2],xy[i*2+1]]),area=edge(...t[0],...t[1],...t[2]);if(Math.abs(area)<1e-10)continue;
   const x0=Math.max(0,Math.floor(Math.min(...t.map(v=>v[0])))),x1=Math.min(width-1,Math.ceil(Math.max(...t.map(v=>v[0])))),y0=Math.max(0,Math.floor(Math.min(...t.map(v=>v[1])))),y1=Math.min(height-1,Math.ceil(Math.max(...t.map(v=>v[1]))));
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
     const u=edge(...t[1],...t[2],x+.5,y+.5)/area,v=edge(...t[2],...t[0],x+.5,y+.5)/area,w=1-u-v;
     if(Math.min(u,v,w)<-1e-6||wet(x,y)!==wetPass)continue;
     const sx=p[ids[0]*3]*u+p[ids[1]*3]*v+p[ids[2]*3]*w+cx,sy=p[ids[0]*3+1]*u+p[ids[1]*3+1]*v+p[ids[2]*3+1]*w+cy,
       z=p[ids[0]*3+2]*u+p[ids[1]*3+2]*v+p[ids[2]*3+2]*w;
     if(z<plane||z<(wet(sx,sy)?waterLevel:0))continue;data[y*width+x]=255;
   }
 }return data;
}
function blur(mask,w,h,step){
 const weights=[.227027027,.3162162162,.3162162162,.0702702703,.0702702703],steps=[0,1.3846153846,-1.3846153846,3.2307692308,-3.2307692308],a=new Float32Array(w*h),b=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let i=0;i<5;i++)a[y*w+x]+=bilinear(mask,w,h,x+steps[i]*step,y)*weights[i]/255;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let i=0;i<5;i++)b[y*w+x]+=bilinear(a,w,h,x,y+steps[i]*step)*weights[i];return b;
}
function background(w,h,shore){const d=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const i=(y*w+x)*4,noise=(Math.sin(x*17.13+y*91.17)*43758.5)%1*3,base=shore&&y<325?[34,81,88]:[69,91,46];
 for(let c=0;c<3;c++)d[i+c]=base[c]+noise;d[i+3]=255;
 }return d;}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
async function shadowPanel(asset,pose,mesh,base,shore){
 const w=1200,h=600,cx=750,cy=320,az=0,el=28,e=el*Math.PI/180,level=(asset.role==='water'?.38:0)*40;
 const d=background(w,h,shore),m0=projectedMask(mesh,w,h,cx,cy,az,el,shore,0,level),m1=shore?projectedMask(mesh,w,h,cx,cy,az,el,shore,level,level,true):null;
 if(m1)for(let i=0;i<m0.length;i++)m0[i]=Math.max(m0[i],m1[i]);
 const pm=projectedMask(player,w,h,1040,430,az,el,shore,0,level),soft=.65+.65*(1-Math.sin(e));
 const bm=blur(m0,w,h,soft),bp=blur(pm,w,h,soft),shadowColor=[.02,.028,.043];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,response=shore&&y<325?Math.round(.45*255)/255:1;
  const radius=asset.size*(asset.role==='egg'?.12:.16),contact=asset.role==='water'||asset.role==='tentacle'?0:(1-smooth(.25,1,Math.hypot((x-cx)/radius,(y-cy)/(radius*.7))))*.18;
  const badgerContact=(1-smooth(.25,1,Math.hypot((x-1040)/6,(y-430)/4)))*.18;
  const alpha=(1-(1-(asset.role==='egg'?0:bm[i]*.38))*(1-contact))*response,pa=(1-(1-bp[i]*.38)*(1-badgerContact))*response;
  for(let c=0;c<3;c++)d[i*4+c]*=(1-alpha+shadowColor[c]*alpha)*(1-pa+shadowColor[c]*pa);
 }
 const color=exposure(await raw(path.join(base,pose.name,'sun-0-28.png')),asset.exposureCalibration.ratioToBeauty),packed=await raw(path.join(base,pose.name,'packed.png')),n=asset.size;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(y*n+x)*4,j=(Math.floor(y/2)*(n/2)+Math.floor(x/2))*4,z=asset.heightRange[0]+packed[j]/255*(asset.heightRange[1]-asset.heightRange[0]),worldY=cy-n/2+y;
  const wet=shore&&worldY<325,depth=(wet?level/40:0)-z;
  // The board tests cast geometry; simplified static underwater tint is explicitly labelled.
  if(wet&&depth>0){const f=1-Math.exp(-depth/.35);for(let c=0;c<3;c++)color[i+c]=color[i+c]*(1-f)+[6,41,43][c]*f;color[i+3]*=1-smooth(.15,1.2,depth);}
  if(!wet)color[i+3]*=1-smooth(.5,1,depth);
 }
 return sharp(await png(d,w,h)).composite([{input:await png(color,n,n),left:cx-n/2,top:cy-n/2},
  {input:playerImage,left:1021,top:411},{input:label(w,58,`${asset.role} / ${pose.name} · ${shore?'Ufer: Wasserantwort .45':'Gras'} · Dachs 38.4 px`,
  'CPU-Referenz, 1:1 · Sonne 0° / 28° · gemeinsames Figuren-Finish · keine Wolken / vereinfachtes Wasser · kein Browserbild'),left:0,top:0}]).png().toBuffer();
}
for(const asset of manifest.assets){
 const base=path.join(root,asset.id,'standard'),n=asset.size;
 for(const pose of asset.poses){
  const key=`${asset.role}-${pose.name}`,mesh=await meshAt(base,pose),dir=path.join(base,pose.name),cellW=n*2+32,cellH=n+60,width=cellW*3,height=cellH*3+66,layers=[];
  const lights=[];for(const el of [28,45])for(const az of [0,90,180,270])lights.push([`sun-${az}-${el}`,`${az}° / ${el}°`]);lights.push(['night','Nacht: direkte Sonne 0']);
  layers.push({input:label(width,66,`${asset.id} / ${pose.name} · F${pose.clipFrame} · ${n} px, 1:1`,
   'Je Paar links: abgenommene Beauty v11b · rechts: Albedo × Kavität/AO + gepackte Shading-Normalen + Emission. Material-Referenz vor World-Licht/Wasser, kein Browserbild.'),left:0,top:0});
  for(let i=0;i<lights.length;i++){
   const x=i%3*cellW,y=66+Math.floor(i/3)*cellH;
   layers.push({input:label(cellW,52,lights[i][1],i===8?'Ohne Nacht-Ambient/World-Grade; Emission bleibt aktiv':`Rechts Exposure-Faktor ${asset.exposureCalibration.ratioToBeauty.toFixed(3)} relativ zur Beauty.`),left:x,top:y},
    {input:path.join(dir,'beauty.png'),left:x+8,top:y+54},{input:await png(exposure(await raw(path.join(dir,lights[i][0]+'.png')),asset.exposureCalibration.ratioToBeauty),n,n),left:x+n+24,top:y+54});
  }
  const file=key+'-light.png';await sharp({create:{width,height,channels:4,background:'#344435'}}).composite(layers).png().toFile(path.join(out,file));gallery.push({file,title:key+' – Licht'});
  const xy=new Float64Array(mesh.positions.length/3*2);for(let i=0;i<xy.length/2;i++){xy[i*2]=mesh.positions[i*3];xy[i*2+1]=mesh.positions[i*3+1];}
  // Pad beyond the logical canvas so rasterUnion's clipping guard remains meaningful.
  const pad=16,mask=rasterUnion([{xy,indices:mesh.indices}],[-n/2-pad,-n/2-pad,n/2+pad,n/2+pad],2);
  const proxy=await sharp(mask.data,{raw:{width:mask.width,height:mask.height,channels:1}}).resize(n+pad*2,n+pad*2).extract({left:pad,top:pad,width:n,height:n}).greyscale().raw().toBuffer();
  if(proxy.length!==n*n)throw Error('Expected one-channel silhouette');
  const beauty=await raw(path.join(dir,'beauty.png')),diff=Buffer.alloc(n*n*4),proxyRgba=Buffer.alloc(n*n*4);let intersection=0,union=0,missing=0,extra=0;
  for(let i=0;i<n*n;i++){
   const b=beauty[i*4+3]>=128,p=proxy[i]>=128;if(b||p)union++;if(b&&p)intersection++;if(b&&!p)missing++;if(!b&&p)extra++;
   diff.set(b&&p?[190,196,189,255]:b?[235,66,82,255]:p?[38,210,210,255]:[36,47,41,255],i*4);
   proxyRgba.set([210,224,218,proxy[i]],i*4);
  }
  const metric={asset:asset.id,pose:pose.name,iou:intersection/union,missingPixels:missing,extraPixels:extra,vertices:pose.mesh.vertexCount,triangles:pose.mesh.triangleCount,
   heightGeometryBU:pose.heightGeometryBU,heightEncodingBU:asset.heightRange,quantization:pose.quantization,timings:pose.timings};metrics.push(metric);
  const silhouette=key+'-silhouette.png',sw=n*3+48;
  await sharp({create:{width:sw,height:n+85,channels:4,background:'#24332b'}}).composite([
   {input:label(sw,74,`${key}: Beauty-Alpha / Mesh-Projektion (Zenit) / Differenz · IoU ${(metric.iou*100).toFixed(2)}%`,
    `${pose.mesh.triangleCount} Dreiecke · rot: im Proxy fehlend (${missing} px) · türkis: Proxy zusätzlich (${extra} px) · AA-Schwelle 50%`),left:0,top:0},
   {input:path.join(dir,'beauty.png'),left:8,top:77},{input:await png(proxyRgba,n,n),left:n+24,top:77},{input:await png(diff,n,n),left:n*2+40,top:77}]).png().toFile(path.join(out,silhouette));gallery.push({file:silhouette,title:key+' – Silhouette'});
  const shadows=key+'-shadows.png',grass=await shadowPanel(asset,pose,mesh,base,false),shore=await shadowPanel(asset,pose,mesh,base,true);
  await sharp({create:{width:1200,height:1200,channels:4,background:'#18211c'}}).composite([{input:grass,left:0,top:0},{input:shore,left:0,top:600}]).png().toFile(path.join(out,shadows));gallery.push({file:shadows,title:key+' – Schatten mit Spieler-Dachs'});
  console.log(key,metric.iou.toFixed(4));
 }
}
await fs.writeFile(path.join(out,'metrics.json'),JSON.stringify({revision,reference:'CPU diagnostics; not GPU/browser validation',poses:metrics},null,2)+'\n');
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Kraken Licht/Schatten Pilot</title><style>body{margin:24px;background:#14201e;color:#dce9df;font:16px system-ui}a{color:#9fdbc9}img{display:block;max-width:100%;height:auto}details{margin:22px 0}summary{cursor:pointer;font-size:20px}p{max-width:90ch}</style><h1>${revision}</h1><p>CPU-Vergleichsbögen aus den archivierten v11b-Blends. Keine Browseraufnahmen: der Browser-Connector war in dieser Sitzung nicht verfügbar. Bilder zum Prüfen bei 1:1 separat öffnen; die Galerie passt sie an die Fensterbreite an. Nacht zeigt die Materialantwort ohne World-Ambient. Schattenbögen verwenden das Figuren-Finish mit vereinfachtem Wasser und klarem Himmel.</p><p><a href="report.md">Bericht / Budget / Review-Aufruf</a> · <a href="metrics.json">Messdaten</a> · <a href="budget.json">Budgetdaten</a></p>${gallery.map(g=>`<details><summary>${esc(g.title)}</summary><p><a href="${g.file}">Bild in Originalgröße</a></p><img loading="lazy" src="${g.file}"></details>`).join('')}`);
