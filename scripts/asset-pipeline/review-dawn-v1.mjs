// Contact sheets only. Inputs are disposable draft beauty, never selected assets.
import sharp from 'sharp';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { 'draft-root': { type: 'string' }, label: { type: 'string' }, output: { type: 'string' } } });
if (!values['draft-root'] || !/^[a-z0-9-]+$/.test(values.label ?? '') || !values.output) throw Error('Required: --draft-root <folder> --label <revision> --output <folder>');
const out = path.resolve(values.output); await mkdir(out, { recursive: true });
const text = (s,x,y,size=14,color='#eef0e6') => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
const input = ({id,clip='__rest',frame=0}) => path.join(values['draft-root'],id,values.label,'standard','clips',clip,`frame-${String(frame).padStart(4,'0')}-beauty.png`);
const manifest = { label: values.label, input: path.resolve(values['draft-root']), sheets: {} };
for (const family of ['wreck','extractor','scrap']) {
  const scrap = family === 'scrap';
  const items = family==='extractor' ? [{id:'construction_dawn_extractor',label:'IDLE'}, ...[0,3,6,9].map(frame=>({id:'construction_dawn_extractor',label:`ACTIVE ${frame}/12`,clip:'active',frame}))]
    : [1,2,3].map(t=>({id:(family==='wreck'?'construction_dawn_wreck_t':'dawn_scrap_t')+t,label:`T${t}`}));
  const cell=family==='extractor'?210:260, width=cell*items.length+40, height=scrap?630:880;
  const layers=[], sources=[];
  let svg=`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#20282b"/>`;
  svg+=text(`DAWN / ${family.toUpperCase()} / ${values.label} / ENTWURF`,20,30,20);
  svg+=text(scrap?'24 px nominal | Vergleich 22 / 32 / 40 px | lose Bauteile':'96 x 96 px Canvas | 1x + 2x | Pivot Mitte | orthografisch -Z',20,54);
  for(let bg=0;bg<2;bg++){
    const top=74+bg*(scrap?260:390), ink=bg?'#eef0e6':'#203222';
    svg+=`<rect x="10" y="${top}" width="${width-20}" height="${scrap?250:380}" rx="8" fill="${bg?'#0b111b':'#82946a'}"/>`;
    svg+=text(bg?'NACHT':'WALDBODEN-GRUEN',23,top+23,12,ink);
    for(let col=0;col<items.length;col++){
      const item=items[col], file=input(item), left=20+col*cell, raw=await readFile(file);
      sources.push(file);
      svg+=text(item.label+(scrap?'':' / 1x'),left+14,top+47,13,ink);
      if(scrap){
        for(const [i,size] of [24,48,22,32,40].entries()){
          const x=left+[24,102,20,94,169][i], y=top+(i<2?65:156);
          layers.push({input:await sharp(raw).resize(size,size).toBuffer(),left:x,top:y});
          svg+=text(['24 / 1x','24 / 2x','22 px','32 px','40 px'][i],x-3,y+size+19,12,ink);
        }
      }else{
        svg+=text('2x',left+14,top+164,12,ink);
        layers.push({input:raw,left:left+Math.floor((cell-96)/2),top:top+53});
        layers.push({input:await sharp(raw).resize(192,192).toBuffer(),left:left+Math.floor((cell-192)/2),top:top+173});
      }
    }
  }
  svg+=text('2x = vergroesserte Entwurfsaufloesung | kein Boden, keine Schlagschatten im Sprite',20,height-14,12)+'</svg>';
  const file=`review-${family}.png`;
  await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(out,file));
  manifest.sheets[file]=[...new Set(sources)];
}
await writeFile(path.join(out,'review-inputs.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(out);
