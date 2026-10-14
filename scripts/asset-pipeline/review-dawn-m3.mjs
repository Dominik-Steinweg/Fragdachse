// Offline M3 contact sheets and checked selection proposals; never select/archive/import.
import sharp from 'sharp';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{'draft-root':{type:'string'},run:{type:'string'},label:{type:'string'},output:{type:'string'},family:{type:'string'}}});
if(!values.output||!values.label||!!values.run===!!values['draft-root'])throw Error('Use --output <folder> --label <revision> and exactly one of --run or --draft-root');
const out=path.resolve(values.output),production=!!values.run,label=values.label;
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid label');
await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),sources={},cache=new Map(),proposals=[];
async function bytes(file){const b=await readFile(file);sources[file]=hash(b);return b;}
async function load(id){
 if(cache.has(id))return cache.get(id);
 const folder=production?path.join(values.run,id,'standard'):path.join(values['draft-root'],id,label,'standard');
 const e=JSON.parse(await bytes(path.join(folder,'export.json')));cache.set(id,{folder,e});
 if(production){
  const reportPath=path.resolve(folder,'../../../../verification',e.manifest.revision,id+'.json');
  const verification=JSON.parse(await bytes(reportPath));
  if(verification.status!=='passed'||verification.blendSha256!==e.blendSha256||verification.manifestSha256!==hash(await bytes(path.join(folder,'render.json'))))throw Error('Verification mismatch: '+id);
  const border=Math.min(...e.report.frames.flatMap(f=>[f.bounds[0],f.bounds[1],1023-f.bounds[2],1023-f.bounds[3]]));
  if(border<21)throw Error('Less than 2% safety border: '+id);
  proposals.push({id,revision:e.manifest.revision,folder,variant:'standard',recommendedSourceSize:192,displaySize:96,frames:e.manifest.frames.length,native:e.report.native,minimumMasterAlphaBorderPx:border,verification:reportPath,manifestSha256:verification.manifestSha256,blendSha256:e.blendSha256,reason:'192 px source resolves the 96 px silhouette and matte form shading; only requested 2x source produced.',status:'proposal-only'});
 }
 return cache.get(id);
}
async function frame(id,index){
 const {folder,e}=await load(id);
 if(!production)return bytes(path.join(folder,'clips',index===undefined?'__rest':'idle',`frame-${String(index??0).padStart(4,'0')}-beauty.png`));
 const n=index===undefined?e.manifest.idleFrame:e.manifest.clips.find(c=>c.name==='idle').frames[index],l=e.sheets[192];
 const raw=await bytes(path.join(folder,'sheet-192.png'));
 if(hash(raw)!==e.outputs['sheet-192.png'])throw Error('Sheet hash mismatch: '+id);
 return sharp(raw).extract({left:l.margin+n%l.columns*(192+l.spacing),top:l.margin+Math.floor(n/l.columns)*(192+l.spacing),width:192,height:192}).png().toBuffer();
}
const text=(s,x,y,size=13,color='#eef0e6')=>`<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
const files=[];
if(values.family&&!['tractor','minecart','broodnest'].includes(values.family))throw Error('Unknown family');
for(const family of values.family?[values.family]:['tractor','minecart','broodnest']){
 const items=family==='broodnest'?[undefined,0,3,6,9].map(index=>({id:'construction_dawn_broodnest',index,label:index===undefined?'RUHE':`IDLE ${index}/12`})):[1,2,3].map(t=>({id:`construction_dawn_wreck_${family}_t${t}`,label:`T${t}`}));
 const cell=220,width=40+cell*items.length,height=890,layers=[];
 let svg=`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#20282b"/>`;
 svg+=text(`DAWN M3 / ${family.toUpperCase()} / ${label}`,20,28,19);
 svg+=text(`${production?'AUSWAHL-VORLAGE / standard / Quelle 192 px':'ENTWURF / direkt 96 px'} / Anzeige 96 px / feste 90-Grad-Kamera`,20,51,12);
 for(let bg=0;bg<2;bg++){
  const top=70+bg*395,ink=bg?'#eef0e6':'#203222';
  svg+=`<rect x="10" y="${top}" width="${width-20}" height="385" rx="8" fill="${bg?'#0b111b':'#82946a'}"/>${text(bg?'NACHT':'WALDBODEN-GRUEN',24,top+23,12,ink)}`;
  for(const [col,item] of items.entries()){
   const raw=await frame(item.id,item.index),left=20+cell*col;
   svg+=text(item.label,left+12,top+46,13,ink)+text('1x',left+12,top+87,11,ink)+text('2x',left+12,top+165,11,ink);
   for(const [size,y] of [[96,top+53],[192,top+174]])layers.push({input:await sharp(raw).resize(size,size).png().toBuffer(),left:left+(cell-size)/2,top:y});
  }
 }
 svg+=text(production?'Empfehlung: standard / 192 px. Leit-Abnahme ausstehend; keine Auswahl gespeichert.':'2x zeigt denselben Entwurf vergroessert; Revision nach Sichtpruefung.',20,879,12)+'</svg>';
 const file=`${production?'production':'review'}-m3-${family}${production?'':'-'+label}.png`;
 await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(out,file));files.push(file);
}
await writeFile(path.join(out,`${production?'production':'review'}-m3-${label}-inputs.json`),JSON.stringify({label,status:production?'proposal-only':'draft-review',files,proposals,sources},null,2)+'\n');
console.log(files.map(f=>path.join(out,f)).join('\n'));
