// Disposable draft beauty comparisons; no production selection or runtime import.
import sharp from 'sharp';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { 'draft-root': { type: 'string' }, label: { type: 'string' }, output: { type: 'string' } } });
if (!values['draft-root'] || !/^[a-z0-9-]+$/.test(values.label ?? '') || !values.output) throw Error('Required: --draft-root <folder> --label <revision> --output <folder>');
await mkdir(values.output,{recursive:true});
const sources=new Set(), layers=[], width=1110, height=850;
const text=(s,x,y,size=14,color='#eef0e6')=>`<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
const frame=(id,clip='__rest',index=0)=>path.join(values['draft-root'],id,values.label,'standard','clips',clip,`frame-${String(index).padStart(4,'0')}-beauty.png`);
async function put(file,x,y,size){sources.add(file);layers.push({input:await sharp(await readFile(file)).resize(size,size).png().toBuffer(),left:x,top:y});}
const stall=frame('construction_dawn_dealer_stall'), dealer=frame('dawn_dealer');
const player='public/assets/sprites/pipeline-v2/badger/idle.png';
let svg=`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#20282b"/>`;
svg+=text(`DAWN / SCHROTTHAENDLER / ${values.label} / ENTWURF`,20,30,20);
svg+=text('Stand: Canvas 96 px / ca. 3 x 2 Zellen | Dachs: Basis 32, Anzeige 38 px | orthografisch -Z',20,55);
for(let bg=0;bg<2;bg++){
 const y=75+bg*370, ink=bg?'#eef0e6':'#203222';
 svg+=`<rect x="10" y="${y}" width="1090" height="358" rx="8" fill="${bg?'#0b111b':'#82946a'}"/>`;
 svg+=text(bg?'NACHT':'WALDBODEN-GRUEN',25,y+24,12,ink);
 svg+=text('STAND / 1x',30,y+50,13,ink);await put(stall,77,y+54,96);
 svg+=text('2x',30,y+163,13,ink);await put(stall,30,y+162,192);
 const frames=[null,0,6,12,18];
 for(let i=0;i<frames.length;i++){
  const x=265+i*88, file=frames[i]===null?dealer:frame('dawn_dealer','idle',frames[i]);
  svg+=text(frames[i]===null?'RUHE':`IDLE ${frames[i]}/24`,x,y+56,11,ink);
  await put(file,x+19,y+79,38);await put(file,x,y+157,76);
 }
 svg+=text('Dachs / 1x oben, 2x unten',265,y+267,13,ink);
 svg+=text('24 Frames / 8 fps / 3 s Loop',265,y+288,12,ink);
 svg+=text('KOMPOSIT / ANZEIGEGROESSE',742,y+56,13,ink);
 await put(stall,783,y+74,96);await put(dealer,812,y+149,38);
 await put(player,966,y+149,38);
 svg+=text('Haendler am Stand',768,y+222,12,ink);
 svg+=text('Spieler-Idle',945,y+222,12,ink);
 svg+=text('Direktvergleich 2x / beide Canvas 38 px',760,y+252,12,ink);
 await put(dealer,792,y+266,76);await put(player,947,y+266,76);
}
svg+=text('2x = vergroesserte Entwurfsaufloesung | kein Boden / Schlagschatten im Sprite | keine Runtime-Bindung',20,836,12)+'</svg>';
await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(values.output,'review-dealer.png'));
await writeFile(path.join(values.output,'review-dealer-inputs.json'),JSON.stringify({label:values.label,sources:[...sources]},null,2)+'\n');
console.log(path.resolve(values.output,'review-dealer.png'));
