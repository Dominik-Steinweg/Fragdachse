import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {decodePositions,decodeIndices} from './mesh-shadow-contract.mjs';
import {anatomicalParts} from './mesh-shadow-repair.mjs';
import {gapMetric} from './mesh-shadow-gap-metric.mjs';
import {projectMesh,rasterUnion} from './mesh-shadow-raster.mjs';
import {resizeMaster} from './export.mjs';
import {sheetLayout} from './export-v2.mjs';
const root=path.resolve(process.argv[2]),geometryOnly=process.argv.includes('--geometry');
if(!root.toLowerCase().startsWith('d:\\fragdachse-render\\player-r2-'))throw Error('Expected isolated R2 source');
const json=async p=>JSON.parse(await fs.readFile(p,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const g=await json(path.join(root,'geometry.json')),oldRoot='D:/Fragdachse-render/player-mesh-22-production-r3';
const base=await json(path.join(oldRoot,'mesh-base-manifest.json'));
async function decode(spec,directory){
 const pb=await fs.readFile(path.join(directory,spec.positions.file)),ib=await fs.readFile(path.join(directory,spec.indices.file));
 if(hash(pb)!==spec.positions.sha256||hash(ib)!==spec.indices.sha256)throw Error('Mesh bytes changed');
 return {spec,indices:decodeIndices(spec,ib),poses:spec.poseIndices.map((_,i)=>decodePositions(spec,pb,i))};
}
const before=await decode(base.meshes[0],oldRoot),after=await decode(g.mesh,root);
const out='build/enemy-mesh',selected=[0,4,5,10,11];
const label=(w,h,text)=>Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#172128"/><text x="10" y="24" fill="white" font-size="16">${text}</text></svg>`);
if(geometryOnly){
 const report=gapMetric(before,after,{elevations:[20,28,35,45,60],progress:p=>console.log('R2_GAP',p)});
 await fs.writeFile(path.join(root,'legacy-gap-grid.json'),JSON.stringify(report,null,2));

 const panels=[];
 for(const [col,pose]of selected.entries())for(const [row,mesh]of [before,after].entries()){
  const xy=projectMesh(mesh.poses[pose],0,Math.PI,35*Math.PI/180),mask=rasterUnion([{xy,indices:mesh.indices}],[-25,-25,80,35],4);
  const pixels=Buffer.alloc(mask.data.length*4);for(let i=0;i<mask.data.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=mask.data[i]?35:195;pixels[i*4+3]=255;}
  const image=await sharp(pixels,{raw:{width:mask.width,height:mask.height,channels:4}}).resize(280,210,{fit:'contain',background:'#c3c3c3'}).extend({top:34,bottom:0,left:0,right:0,background:'#172128'}).composite([{input:label(280,34,`P${pose} | ${row?'Quellmesh repariert':'Original ohne Proxy-Füller'}`),left:0,top:0}]).png().toBuffer();
  panels.push({input:image,left:col*280,top:row*244});
 }
 await sharp({create:{width:1400,height:488,channels:4,background:'#172128'}}).composite(panels).png().toFile(out+'/r2-shadow.png');
 console.log('R2_GAP_COMPLETE',report.before,report.after,report.samples);if(report.after)throw Error('Legacy gap gate failed');
}else{
 const receipt=await json(path.join(root,'renders/receipt.json'));if(receipt.persistentData||!receipt.passMajor||receipt.poses.length!==37)throw Error('Incomplete material rendering');
 const folder=path.join(root,'exports');await fs.mkdir(folder);
 const rows=[],panels=[],diffPanels=[],materialPanels=[];
 const partsBefore=anatomicalParts(before),partsAfter=anatomicalParts(after);
 const oldMaterial=await json('src/assets/manifests/character-material-badger-player-material-21e4.json');
 const oldPages=await Promise.all(oldMaterial.pages.map(p=>sharp('public/'+p.file).ensureAlpha().raw().toBuffer()));
 for(const size of [64,128]){
  const layout=sheetLayout(size,37),tiles=[];
  for(let pose=0;pose<37;pose++){
   const source=path.join(root,'renders/beauty',`pose-${String(pose).padStart(2,'0')}-1024.png`),beauty=await resizeMaster(source,size);
   await fs.writeFile(path.join(folder,`beauty-${pose}-${size}.png`),beauty);
   tiles.push({input:beauty,left:2+pose%8*(size+4),top:2+Math.floor(pose/8)*(size+4)});
  }
  await sharp({create:{width:layout.width,height:layout.height,channels:4,background:'#00000000'}}).composite(tiles).png().toFile(path.join(folder,`sheet-${size}.png`));
  await fs.copyFile(path.join(folder,`beauty-0-${size}.png`),path.join(folder,`idle-${size}.png`));
 }
 for(let pose=0;pose<37;pose++){
  const frame=g.render.frames[pose],old=await resizeMaster(path.join('art/poc/pipeline-v2/runs/v2-ai/badger/standard',frame.file),128);
  const fresh=await fs.readFile(path.join(folder,`beauty-${pose}-128.png`));
  const a=await sharp(old).ensureAlpha().raw().toBuffer(),b=await sharp(fresh).ensureAlpha().raw().toBuffer();
  const region=new Uint8Array(128*128);
  for(const [mesh,parts]of [[before,partsBefore],[after,partsAfter]])for(const part of parts.filter(p=>p.name.startsWith('Upright hind leg')||p.name.endsWith('closed hip transition'))){
   const p=mesh.poses[pose],xs=part.vertices.map(i=>(p[i*3]/38.4+.5)*128),ys=part.vertices.map(i=>(p[i*3+1]/38.4+.5)*128);
   for(let y=Math.max(0,Math.floor(Math.min(...ys))-5);y<=Math.min(127,Math.ceil(Math.max(...ys))+5);y++)for(let x=Math.max(0,Math.floor(Math.min(...xs))-5);x<=Math.min(127,Math.ceil(Math.max(...xs))+5);x++)region[y*128+x]=1;
  }
  let changed=0,outside=0,alphaOutside=0,holes=0,black=0,maxCoverage=0,maxNormalError=0;const diff=Buffer.alloc(b.length);
  const albedo=await sharp(path.join(root,'renders/albedo',`pose-${String(pose).padStart(2,'0')}-128.png`)).ensureAlpha().raw().toBuffer();
  const normal=await sharp(path.join(root,'renders/normal',`pose-${String(pose).padStart(2,'0')}-128.png`)).ensureAlpha().raw().toBuffer();
  for(let i=0;i<128*128;i++){
   const j=i*4;let delta=Math.abs(a[j+3]-b[j+3]);for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(a[j+c]*a[j+3]/255-b[j+c]*b[j+3]/255));
   if(delta>=8){changed++;if(!region[i])outside++;}if(!region[i]&&Math.abs(a[j+3]-b[j+3])>=8)alphaOutside++;
   diff[j]=delta>=8?255:region[i]?35:0;diff[j+1]=region[i]?70:0;diff[j+2]=delta>=8&&!region[i]?255:0;diff[j+3]=255;
   if(b[j+3]>240&&albedo[j+3]<=15)holes++;
   if(b[j+3]>240&&albedo[j+3]>240&&Math.min(...b.subarray(j,j+3))>16&&Math.max(...albedo.subarray(j,j+3))<3)black++;
   maxCoverage=Math.max(maxCoverage,Math.abs(b[j+3]-albedo[j+3]));
   maxNormalError=Math.max(maxNormalError,Math.abs(Math.hypot(normal[j]/127.5-1,normal[j+1]/127.5-1,normal[j+2]/127.5-1)-1));
  }
  rows.push({pose,changed,outside,alphaOutside,holes,black,maxCoverage,maxNormalError});
  if(selected.includes(pose)){
   const col=selected.indexOf(pose);
   for(const [row,bytes]of [old,fresh].entries())panels.push({input:await sharp(bytes).resize(280,280).flatten({background:'#aaa18c'}).extend({top:34,bottom:0,left:0,right:0,background:'#172128'}).composite([{input:label(280,34,`P${pose} | ${row?'neu':'alt'}`),left:0,top:0}]).png().toBuffer(),left:col*280,top:row*314});
   diffPanels.push({input:await sharp(diff,{raw:{width:128,height:128,channels:4}}).resize(280,280,{kernel:'nearest'}).png().toBuffer(),left:col*280,top:0});
   for(const [r,pass]of ['albedo','normal'].entries()){
    const sample=oldMaterial.samples.find(s=>s.pose===pose&&s.sourceSize===128&&s.pass===pass),page=oldMaterial.pages[sample.page],[x,y,w,h]=sample.rect;
    const oldPass=await sharp(oldPages[sample.page],{raw:{width:page.width,height:page.height,channels:4}}).extract({left:x,top:y,width:w,height:h}).png().toBuffer();
    const newPass=await fs.readFile(path.join(root,'renders',pass,`pose-${String(pose).padStart(2,'0')}-128.png`));
    for(const [v,bytes]of [oldPass,newPass].entries())materialPanels.push({input:await sharp(bytes).removeAlpha().resize(280,280).extend({top:34,bottom:0,left:0,right:0,background:'#172128'}).composite([{input:label(280,34,`P${pose} | ${pass} ${v?'neu':'21e4'}`),left:0,top:0}]).png().toBuffer(),left:col*280,top:(r*2+v)*314});
   }
  }
 }
 const totals=rows.reduce((a,r)=>({changed:a.changed+r.changed,outside:a.outside+r.outside,alphaOutside:a.alphaOutside+r.alphaOutside,holes:a.holes+r.holes,black:a.black+r.black}),{changed:0,outside:0,alphaOutside:0,holes:0,black:0});
 await fs.writeFile(path.join(root,'image-review.json'),JSON.stringify({definition:'PMA max channel difference >=8/255; leg/transition bounds +5 pixels; no recentering',totals,rows},null,2));
 for(const [name,height,layers]of [['beauty',628,panels],['difference',280,diffPanels],['material',1256,materialPanels]])await sharp({create:{width:1400,height,channels:4,background:'#172128'}}).composite(layers).png().toFile(out+`/r2-${name}.png`);
 console.log('R2_IMAGE_REVIEW',JSON.stringify(totals));
 if(totals.holes||totals.black||totals.alphaOutside||totals.outside>Math.max(12,totals.changed*.01)||rows.some(r=>r.maxNormalError>.007))throw Error('Image review gate failed');
}

