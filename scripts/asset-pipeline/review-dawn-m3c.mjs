// Mechanical size comparisons from real Blender previews or checked production sheets.
import sharp from 'sharp';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from 'node:util';
const {values:a}=parseArgs({options:{input:{type:'string'},label:{type:'string'},production:{type:'boolean'}}});
if(!a.input||!a.label)throw Error('--input and --label required');
const out='art/poc/dawn/v1-review',local=out+'/m3c';
const catalog=JSON.parse(await readFile('scripts/asset-pipeline/catalog-v2.json'));
const refs=['dawn_scrap_heap_t1','dawn_scrap_heap_t2','dawn_scrap_heap_t3','enemy_dawn_scavenger','dawn_supply_crate'];
const sources={},hash=b=>createHash('sha256').update(b).digest('hex');
async function bytes(file){const b=await readFile(file);sources[file.replaceAll('\\','/')]=hash(b);return b;}
for(const id of refs){
 const folder=local+'/baseline/'+id;await mkdir(folder,{recursive:true});
 if(!await access(folder+'/idle.png').then(()=>true,()=>false))await copyFile('public/assets/sprites/pipeline-v2/'+id+'/idle.png',folder+'/idle.png');
}
async function newImage(id){
 const folder=path.join(a.input,id),meta=JSON.parse(await bytes(path.join(folder,a.production?'standard/export.json':'preview.json')));
 const spec=a.production?meta.manifest:meta.spec;
 const file=a.production?path.join(folder,'standard',`sprite-${spec.sourceSizes[0]}.png`):path.join(folder,meta.frames[0].path);
 const data=await bytes(file);
 if(hash(data)!==(a.production?meta.outputs[path.basename(file)]:meta.frames[0].sha256))throw Error('Source hash mismatch');
 return {data,size:Math.round(spec.targetSize*(spec.displayScale??1))};
}
async function oldImage(id){const spec=catalog.assets.find(x=>x.id===id);return {data:await bytes(local+'/baseline/'+id+'/idle.png'),size:Math.round(spec.targetSize*(spec.displayScale??1))};}
const txt=(x,y,s,size=13,color='#e5dfcd')=>`<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
async function board(name,rows){
 const width=1600,height=85+rows.length*252,layers=[];let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#222520"/>`;
 svg+=txt(20,28,`DAWN / M3C / ${a.production?'PRODUKTION':'ENTWURF '+a.label} / ${name.toUpperCase()}`,20);
 svg+=txt(20,52,name==='camps'?'Echte Anzeige: Lager 68 px / Haufen 64 px / Sammler 26 px. 1x und 2x; feste Canvas, kein Autocrop.':'Echte Anzeige: beide Kisten 28 px / Quelle jeweils 56 x 56 px. 1x und 2x; feste Canvas, kein Autocrop.');
 for(let row=0;row<rows.length;row++){
  const entry=rows[row],top=72+row*252;
  for(const [side,color,title] of [[0,'#849469','GRUEN'],[1,'#0b111a','NACHT']]){
   const left=10+side*795;svg+=`<rect x="${left}" y="${top}" width="785" height="242" rx="4" fill="${color}"/>`;
   svg+=txt(left+15,top+23,entry.label+' / '+title,13,side?'#ded9c6':'#20251c');
   for(const [scale,positions] of [[1,[68,168,248]],[2,[400,570,700]]]){
    for(let i=0;i<entry.images.length;i++){
     const {data,size,label}=entry.images[i],n=size*scale,cx=left+positions[i],cy=top+144;
     const png=await sharp(data).resize(n,n,{kernel:'lanczos3'}).png().toBuffer();
     layers.push({input:png,left:Math.round(cx-n/2),top:Math.round(cy-n/2)});
     svg+=txt(cx-40,top+49,label+' / '+scale+'x',11,side?'#ded9c6':'#20251c');
    }
   }
  }
 }
 svg+='</svg>';
 const file=`${out}/${a.production?'production':'review'}-m3c-${name}${a.production?'':'-'+a.label}.png`;
 await sharp(Buffer.from(svg)).composite(layers).png().toFile(file);return file;
}
const camps=[];
for(let tier=1;tier<=3;tier++)camps.push({label:'Lager T'+tier+' / 2 x 2 Zellen',images:[{...await newImage('dawn_scavenger_camp_t'+tier),label:'Lager'},{...await oldImage('dawn_scrap_heap_t'+tier),label:'Haufen'},{...await oldImage('enemy_dawn_scavenger'),label:'Sammler'}]});
const boards=[await board('camps',camps),await board('carried',[{label:'Getragene Versorgungskiste / gleiche Konstruktion mit Tragegurt',images:[{...await newImage('dawn_supply_crate_carried'),label:'Getragen'},{...await oldImage('dawn_supply_crate'),label:'Abgestellt'}]}])];
await writeFile(local+'/'+a.label+'-board-inputs.json',JSON.stringify({production:!!a.production,input:a.input,boards,sources},null,2)+'\n');
console.log(boards.join('\n'));
