// Frozen v2, revised model and original concept at comparable scale, never recentered.
import sharp from 'sharp';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
const {values:v}=parseArgs({options:{'draft-root':{type:'string'},run:{type:'string'},'old-run':{type:'string'},label:{type:'string'},output:{type:'string',default:'art/poc/dawn/v1-review'}}});
if(!v['old-run']||!v.label||(!v.run&&!v['draft-root']))throw Error('Required: --old-run, --label, --run or --draft-root');
const width=1410,height=1490,layers=[],inputs=[];
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#222721"/>`;
const text=(s,x,y,size=14,fill='#e5e0d0')=>`<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" fill="${fill}">${s}</text>`;
svg+=text(`U-4 QUALITAET / ${v.label} / ALT v2 - NEU - KONZEPT`,20,30,22);
svg+=text('Je Feld 2x oben / 1x unten. Fixes 128-px-Canvas. Konzepte nur Formreferenz; neue Produktion ist Blender-Geometrie.',20,55);
for(const [i,role] of ['workshop','yard','armory'].entries()){
 const id='construction_dawn_lobby_'+role,y=76+i*460;
 const old=path.join(v['old-run'],id,'standard/sprite-256.png');
 const fresh=v.run?path.join(v.run,id,'standard/sprite-256.png'):path.join(v['draft-root'],id,v.label,'standard/clips/__rest/frame-0000-beauty.png');
 const reference=`scripts/asset-pipeline/references/dawn-lobby-${role}.png`;
 inputs.push({id,old,fresh,reference});
 svg+=text(role.toUpperCase(),20,y+20,18);
 for(let j=0;j<4;j++){
  const x=16+j*274,night=j>=2;
  svg+=`<rect x="${x}" y="${y+31}" width="268" height="417" fill="${night?'#0b111b':'#82946a'}"/>`;
  svg+=text(j%2?'NEU':'ALT v2',x+8,y+49,13,night?'#dddacb':'#203021');
  const file=j%2?fresh:old;
  for(const [size,top] of [[256,y+53],[128,y+310]])layers.push({input:await sharp(await readFile(file)).resize(size,size).png().toBuffer(),left:x+Math.round((268-size)/2),top});
 }
 svg+=text('GEWAEHLTES KONZEPT',1125,y+48,14);
 layers.push({input:await sharp(await readFile(reference)).resize(280,280,{fit:'contain',background:'#222721'}).png().toBuffer(),left:1120,top:y+60});
 svg+=text('Massstab: Stand 96 / Dachs 38',1120,y+367,12);
 for(const [file,x,size] of [['construction_dawn_dealer_stall',1130,96],['badger',1290,38]])layers.push({input:await sharp(`public/assets/sprites/pipeline-v2/${file}/idle.png`).resize(size,size).png().toBuffer(),left:x,top:y+354});
}
svg+='</svg>';
await mkdir(v.output,{recursive:true});
const file=path.join(v.output,`review-lobby-buildings-compare-${v.label}`);
await sharp(Buffer.from(svg)).composite(layers).png().toFile(file+'.png');
await writeFile(file+'.json',JSON.stringify({label:v.label,inputs},null,2)+'\n');
console.log(file+'.png');
