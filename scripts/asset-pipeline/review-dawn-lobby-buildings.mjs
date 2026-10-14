// Native-size review of all three buildings beside the imported stall and player.
import sharp from 'sharp';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
const {values:v}=parseArgs({options:{'draft-root':{type:'string'},run:{type:'string'},label:{type:'string'},output:{type:'string',default:'art/poc/dawn/v1-review'}}});
if ((!v['draft-root']&&!v.run)||!v.label) throw Error('Supply --draft-root or --run, and --label');
await mkdir(v.output,{recursive:true});
const ids=['workshop','yard','armory'].map(s=>'construction_dawn_lobby_'+s);
const names=['WERKSTATT / RUND','BAUHOF / DREIECK','AUSRUESTUNG / U-FORM','HAENDLERSTAND','SPIELER-DACHS'];
const files=ids.map(id=>v.run?path.join(v.run,id,'standard','sprite-256.png'):path.join(v['draft-root'],id,v.label,'standard/clips/__rest/frame-0000-beauty.png'));
files.push('public/assets/sprites/pipeline-v2/construction_dawn_dealer_stall/idle.png','public/assets/sprites/pipeline-v2/badger/idle.png');
const width=1260,height=1000,layers=[],metrics=[];
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#242725"/>`;
const text=(s,x,y,size=14,ink='#e0dccb')=>`<text x="${x}" y="${y}" fill="${ink}" font-family="Arial" font-size="${size}">${s}</text>`;
svg+=text(`DAWN / LOBBY U-4 / ${v.label}`,22,30,21)+text('128 px Canvas / 4 x 4 Zellen / Belegung ca. 4 x 3 / fester Mittelpunkt / orthografisch -Z',22,53);
for(let bg=0;bg<2;bg++){
 const top=72+bg*450,ink=bg?'#d5d6c9':'#1c281b';
 svg+=`<rect x="12" y="${top}" width="1236" height="440" fill="${bg?'#0b111b':'#82946a'}"/>`;
 svg+=text(bg?'NACHT':'WALDBODEN-GRUEN',25,top+24,13,ink);
 const xs=[20,300,580,872,1100],sizes=[128,128,128,96,38];
 for(let i=0;i<files.length;i++){
  svg+=text(names[i],xs[i]+8,top+48,13,ink);
  for(const scale of [1,2]){
   const size=sizes[i]*scale,left=xs[i]+Math.round((256-size)/2)*(i<3?1:0),y=top+(scale===1?56:180);
   layers.push({input:await sharp(await readFile(files[i])).resize(size,size).png().toBuffer(),left,top:y});
  }
 }
 svg+=text('1x',28,top+82,12,ink)+text('2x',28,top+203,12,ink);
}
svg+=text('Statische Offline-Sichtpruefung. Transparentes Sprite ohne Boden/Schatten. Groessenvergleich: Stand 96 px, Dachs 38 px.',22,990,12)+'</svg>';
// Height has room for the full 2x canvas in each row; adjacent panels never crop it.
await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(v.output,`review-lobby-buildings-${v.label}.png`));
for(let i=0;i<3;i++){
 const {data,info}=await sharp(files[i]).resize(128,128).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let xmin=128,ymin=128,xmax=-1,ymax=-1,occupied=0;
 for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(data[(y*128+x)*info.channels+3]>=128){occupied++;xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
 metrics.push({id:ids[i],canvas:128,bounds:[xmin,ymin,xmax,ymax],occupied,width:xmax-xmin+1,height:ymax-ymin+1});
}
await writeFile(path.join(v.output,`review-lobby-buildings-${v.label}.json`),JSON.stringify({label:v.label,files,metrics},null,2)+'\n');
console.log(JSON.stringify(metrics));
