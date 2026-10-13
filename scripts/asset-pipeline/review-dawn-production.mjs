// Selection proposal from checked production exports. Never selects or imports assets.
import sharp from 'sharp';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{run:{type:'string'},output:{type:'string'},'asset-run':{type:'string',multiple:true},label:{type:'string'}}});
if(!values.run||!values.output)throw Error('Required: --run <completed revision directory> --output <review directory>');
const run=path.resolve(values.run),revision=values.label??path.basename(run),out=path.resolve(values.output);
if(!/^[a-z0-9-]+$/.test(revision))throw Error('Invalid review label');
const overrides=new Map((values['asset-run']??[]).map(p=>[path.basename(p),path.resolve(p)]));
await mkdir(out,{recursive:true});
const cache=new Map(),sources=new Map(),hash=b=>createHash('sha256').update(b).digest('hex');
async function load(id){
 if(!cache.has(id)){const folder=path.join(overrides.get(id)??path.join(run,id),'standard'),bytes=await readFile(path.join(folder,'export.json'));sources.set(path.join(folder,'export.json'),hash(bytes));cache.set(id,{folder,...JSON.parse(bytes)});}
 return cache.get(id);
}
async function frame(id,size,clip,index=0){
 const e=await load(id),n=clip?e.manifest.clips.find(c=>c.name===clip).frames[index]:e.manifest.idleFrame;
 const l=e.sheets[size],file=path.join(e.folder,`sheet-${size}.png`),bytes=await readFile(file);
 if(hash(bytes)!==e.outputs[`sheet-${size}.png`])throw Error('Production sheet hash mismatch: '+file);
 sources.set(file,hash(bytes));
 return sharp(bytes).extract({left:l.margin+(n%l.columns)*(size+l.spacing),top:l.margin+Math.floor(n/l.columns)*(size+l.spacing),width:size,height:size}).png().toBuffer();
}
const text=(s,x,y,size=13,color='#eef0e6')=>`<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
const begin=(w,h,title)=>`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#20282b"/>${text(`DAWN / ${title} / ${revision} / AUSWAHL-VORLAGE`,20,30,20)}`;
async function add(layers,raw,x,y,size){layers.push({input:await sharp(raw).resize(size,size).png().toBuffer(),left:Math.round(x),top:Math.round(y)});}
const groups={wreck:[1,2,3].map(t=>({id:`construction_dawn_wreck_t${t}`,label:`T${t}`})),scrap:[1,2,3].map(t=>({id:`dawn_scrap_t${t}`,label:`T${t}`})),extractor:[{id:'construction_dawn_extractor',label:'IDLE'},...[0,3,6,9].map(index=>({id:'construction_dawn_extractor',label:`ACTIVE ${index}/12`,clip:'active',index}))]};
const files=[];
for(const [family,items] of Object.entries(groups)){
 const small=family==='scrap',cell=small?158:208,native=small?24:96,row=small?205:380,width=40+items.length*cell*2,height=100+row*2;
 let svg=begin(width,height,family.toUpperCase());const layers=[];
 svg+=text(`1024er Master / standard / ${native} px Anzeige / Quellen je Paar links 2x, rechts 4x`,20,54);
 for(let bg=0;bg<2;bg++){
  const top=70+bg*row,ink=bg?'#eef0e6':'#203222';
  svg+=`<rect x="10" y="${top}" width="${width-20}" height="${row-10}" rx="8" fill="${bg?'#0b111b':'#82946a'}"/>${text(bg?'NACHT':'WALDBODEN-GRUEN',24,top+23,12,ink)}`;
  let col=0;
  for(const item of items){const e=await load(item.id);for(const size of e.manifest.sourceSizes){
   const left=20+cell*col++,raw=await frame(item.id,size,item.clip,item.index);
   svg+=text(`${item.label} / Quelle ${size}`,left+8,top+47,12,ink);
   await add(layers,raw,left+(cell-native)/2,top+58,native);
   svg+=text('1x',left+8,top+80,11,ink);
   const zoomY=top+(small?117:169);
   await add(layers,raw,left+(cell-native*2)/2,zoomY,native*2);
   svg+=text('2x',left+8,zoomY-9,11,ink);
  }}
 }
 svg+=text('Beide Ansichten aus der jeweiligen Quellgroesse; kein Nachschaerfen, kein Beschnitt.',20,height-12,12)+'</svg>';
 const file=`production-${family}.png`;await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(out,file));files.push(file);
}
// Dealer: equal player/dealer display canvases; both source sizes include four idle phases.
{
 const width=1510,height=890,layers=[];let svg=begin(width,height,'HAENDLER');
 svg+=text('Stand 96 px / Haendler + Spieler 38 px / 1x und 2x / ruhiger Idle 24 Frames, 8 fps',20,54);
 const playerFile='public/assets/sprites/pipeline-v2/badger/idle.png',player=await readFile(playerFile);sources.set(playerFile,hash(player));
 for(let bg=0;bg<2;bg++){
  const top=70+bg*400,ink=bg?'#eef0e6':'#203222';
  svg+=`<rect x="10" y="${top}" width="1490" height="390" rx="8" fill="${bg?'#0b111b':'#82946a'}"/>`;
  for(let v=0;v<2;v++){
   const x=20+v*745,ss=[192,384][v],ds=[76,152][v],stall=await frame('construction_dawn_dealer_stall',ss),dealer=await frame('dawn_dealer',ds);
   svg+=text(`${bg?'NACHT':'GRUEN'} / Quellen Stand ${ss}, Dachs ${ds}`,x+10,top+24,14,ink);
   svg+=text('STAND 1x / 2x',x+10,top+48,12,ink);await add(layers,stall,x+58,top+52,96);await add(layers,stall,x+10,top+170,192);
   for(const [i,index] of [null,0,6,12,18].entries()){
    const px=x+234+i*92,raw=index===null?dealer:await frame('dawn_dealer',ds,'idle',index);
    svg+=text(index===null?'RUHE':`IDLE ${index}`,px,top+48,11,ink);
    await add(layers,raw,px+19,top+63,38);await add(layers,raw,px,top+125,76);
   }
   svg+=text('Haendler / Spieler 2x',x+236,top+248,12,ink);
   await add(layers,dealer,x+240,top+263,76);await add(layers,player,x+344,top+263,76);
   svg+=text('Am Stand / Spieler 1x',x+465,top+248,12,ink);
   await add(layers,stall,x+470,top+252,96);await add(layers,dealer,x+500,top+327,38);await add(layers,player,x+623,top+327,38);
  }
 }
 svg+=text('Original-Spieler-Idle als Groessenvergleich / kein Runtime-Import / keine Auswahl gespeichert',20,878,12)+'</svg>';
 const file='production-dealer.png';await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(out,file));files.push(file);
}
const proposals=[];
for(const [id,e] of cache){
 const reportPath=path.resolve(e.folder,'../../../../verification',e.manifest.revision,id+'.json');
 const verification=JSON.parse(await readFile(reportPath,'utf8'));
 if(verification.status!=='passed'||verification.blendSha256!==e.blendSha256)throw Error('Missing or mismatched production verification: '+id);
 const minimumBorderPx=Math.min(...e.report.frames.flatMap(f=>[f.bounds[0],f.bounds[1],1023-f.bounds[2],1023-f.bounds[3]]));
 if(minimumBorderPx<Math.ceil(1024*.02))throw Error('Master alpha enters 2% safety border: '+id);
 proposals.push({id,revision:e.manifest.revision,folder:e.folder,variant:'standard',recommendedSourceSize:e.manifest.sourceSizes[0],alternatives:e.manifest.sourceSizes,
  reason:id==='dawn_dealer'?'76 px retains the exposed badger mask and small accessories at 38 px; 152 px is an optional zoom source.':
   id.startsWith('dawn_scrap')?'48 px preserves the 24 px silhouette and tier contrast; 96 px mainly helps stronger zoom.':
   '192 px resolves the 96 px display and 2x review cleanly; 384 px offers little benefit at 1x and costs four times the pixel memory.',
  frames:e.manifest.frames.length,displaySize:Math.round(e.manifest.targetSize*(e.manifest.displayScale??1)),native:e.report.native,
  minimumMasterAlphaBorderPx:minimumBorderPx,verification:reportPath,manifestSha256:verification.manifestSha256,blendSha256:e.blendSha256});
}
await writeFile(path.join(out,'production-review-inputs.json'),JSON.stringify({revision,run,status:'proposal-only',files,proposals,sources:Object.fromEntries(sources)},null,2)+'\n');
console.log(files.map(f=>path.join(out,f)).join('\n'));
