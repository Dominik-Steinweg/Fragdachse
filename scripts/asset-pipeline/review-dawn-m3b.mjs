// Offline M3-P3 review sheets; no selection, archive or runtime publication.
import sharp from 'sharp';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
const {values:v}=parseArgs({options:{'draft-root':{type:'string'},run:{type:'string'},label:{type:'string'},output:{type:'string'},family:{type:'string'}}});
if(!v.output||!v.label||!!v.run===!!v['draft-root'])throw Error('Use output, label and either run or draft-root');
const out=path.resolve(v.output),prod=!!v.run,sources={},cache=new Map(),proposals=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
async function bytes(file){const b=await readFile(file);sources[file]=hash(b);return b;}
async function load(id){
 if(cache.has(id))return cache.get(id);
 const folder=prod?path.join(v.run,id,'standard'):path.join(v['draft-root'],id,v.label,'standard');
 const e=JSON.parse(await bytes(path.join(folder,'export.json'))),size=Math.round(e.manifest.targetSize*(e.manifest.displayScale??1));
 if(prod){
  const reportPath=path.resolve(folder,'../../../../verification',e.manifest.revision,id+'.json');
  const verification=JSON.parse(await bytes(reportPath));
  if(verification.status!=='passed'||verification.blendSha256!==e.blendSha256||verification.manifestSha256!==hash(await bytes(path.join(folder,'render.json'))))throw Error('Verification mismatch: '+id);
  const border=Math.min(...e.report.frames.flatMap(f=>[f.bounds[0],f.bounds[1],1023-f.bounds[2],1023-f.bounds[3]]));
  if(border<21)throw Error('Less than 2% safety border: '+id);
  proposals.push({id,revision:e.manifest.revision,folder,variant:'standard',recommendedSourceSize:size*2,displaySize:size,frames:e.manifest.frames.length,native:e.report.native,minimumMasterAlphaBorderPx:border,verification:reportPath,manifestSha256:verification.manifestSha256,blendSha256:e.blendSha256,status:'proposal-only'});
 }
 const data={folder,e,size};cache.set(id,data);return data;
}
async function frame(item){
 if(item.reference)return bytes(item.reference);
 const {folder,e,size}=await load(item.id);
 if(!prod)return bytes(path.join(folder,'clips',item.clip??'__rest',`frame-${String(item.index??0).padStart(4,'0')}-beauty.png`));
 const n=item.clip?e.manifest.clips.find(c=>c.name===item.clip).frames[item.index]:e.manifest.idleFrame,s=size*2,l=e.sheets[s];
 const raw=await bytes(path.join(folder,`sheet-${s}.png`));
 if(hash(raw)!==e.outputs[`sheet-${s}.png`])throw Error('Sheet hash mismatch');
 return sharp(raw).extract({left:l.margin+n%l.columns*(s+l.spacing),top:l.margin+Math.floor(n/l.columns)*(s+l.spacing),width:s,height:s}).png().toBuffer();
}
const text=(s,x,y,size=13,color='#eef0e6')=>`<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
const catalog=JSON.parse(await bytes('scripts/asset-pipeline/catalog-v2.json'));
const runtime=JSON.parse(await bytes('src/config/pipelineAssets.json'));
const display=id=>{const a=catalog.assets.find(a=>a.id===id);return Math.round(a.targetSize*(a.displayScale??1));};
const scavSize=display('enemy_dawn_scavenger');
const families={capsule:[{id:'construction_dawn_supply_capsule',label:'VERSORGUNG / 96 px',size:96}],crate:[{id:'dawn_supply_crate',label:'TRAGEKISTE / 28 px',size:28}],heap:[1,2,3].map(t=>({id:`dawn_scrap_heap_t${t}`,label:`T${t} / 64 px`,size:64})),scavenger:[{id:'enemy_dawn_scavenger',label:`RUHE / ${scavSize} px`,size:scavSize},...[0,3,6,9].map(index=>({id:'enemy_dawn_scavenger',clip:'move',index,label:`MOVE ${index}/12 / ${scavSize} px`,size:scavSize})),...['rabid-badger','demon-badger','zombie-badger'].map(id=>({reference:'public/'+runtime.assets.find(a=>a.id===id).idlePath.replace(/^\.\//,''),label:`${id} / ${display(id)} px`,size:display(id)}))]};
if(v.family&&!families[v.family])throw Error('Unknown family');
await mkdir(out,{recursive:true});const files=[];
for(const [family,items] of Object.entries(families)){
 if(v.family&&v.family!==family)continue;
 const cell=240,width=Math.max(760,40+cell*items.length),height=940,layers=[];
 let svg=`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#20282b"/>`;
 svg+=text(`DAWN M3B / ${family.toUpperCase()} / ${v.label}`,20,28,19)+text(`${prod?'AUSWAHL-VORLAGE / standard / 2x Quelle':'ENTWURF / native Anzeige'} / orthografische 90-Grad-Kamera`,20,51,12);
 for(let bg=0;bg<2;bg++){
  const top=70+bg*400,ink=bg?'#eef0e6':'#203222';
  svg+=`<rect x="10" y="${top}" width="${width-20}" height="390" rx="8" fill="${bg?'#0b111b':'#82946a'}"/>${text(bg?'NACHT':'WALDBODEN-GRUEN',24,top+23,12,ink)}`;
  for(const [i,item] of items.entries()){
   const raw=await frame(item),left=20+cell*i;
   svg+=text(item.label,left+12,top+46,12,ink)+text('1x',left+12,top+90,11,ink)+text('2x',left+12,top+184,11,ink);
   const largest=Math.max(...items.map(i=>i.size));
   for(const [s,y,factor] of [[item.size,top+65,1],[item.size*2,top+190,2]])layers.push({input:await sharp(raw).resize(s,s).png().toBuffer(),left:left+Math.floor((cell-s)/2),top:y+Math.floor((largest*factor-s)/2)});
   if(items.length===1){const s=family==='capsule'?288:224;layers.push({input:await sharp(raw).resize(s,s).png().toBuffer(),left:380,top:top+68});svg+=text('DETAIL (aus gleicher Quelle)',380,top+49,12,ink);}
  }
 }
 svg+=text(prod?(v.label.endsWith('-final')?'FINAL: standard / 2x Quelle. Massstab zur Auswahl und zum Import geprueft.':'Empfehlung: standard / 2x Quelle. Auswahl und Import ausstehend.'):'Entwurfspruefung: Form, Werte, Fuellgrad und native Lesbarkeit.',20,899,12);
 if(family==='scavenger')svg+=text('Bestand: importierte Idle-Sprites, Katalog targetSize x displayScale, gerundet. Kein Beschnitt/Zoom. Bewegung als Einzelbilder; kein Browserreview.',20,924,11);
 svg+='</svg>';const file=`${prod?'production':'review'}-m3b-${family}-${v.label}.png`;
 await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(out,file));files.push(file);
}
await writeFile(path.join(out,`${prod?'production':'review'}-m3b-${v.label}-inputs.json`),JSON.stringify({label:v.label,status:prod?'proposal-only':'draft-review',files,proposals,sources},null,2)+'\n');
console.log(files.join('\n'));
