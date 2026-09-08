// Compare diagnostic master frames at nominal size and in a labeled enlargement.
import sharp from 'sharp';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
const folder = path.resolve(process.argv[2] || '');
const m = JSON.parse(await readFile(path.join(folder, 'preview.json'), 'utf8'));
const file = path.join(folder, 'review.png');
if (await access(file).then(() => true, () => false)) throw new Error('Preview review already exists');
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const n=m.indices.length, columns=Math.min(n,6), rows=Math.ceil(n/columns), width=columns*176+24, height=70+rows*230;
let svg=`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#27343b"/><text x="18" y="26" fill="#e5e9dc" font-family="Arial" font-size="17">${escape(m.spec.label)} · ${m.variant} · Authoring-Vorschau</text><text x="18" y="48" fill="#c0caba" font-family="Arial" font-size="12">Oben: Vergrößerung. Unten: ${m.spec.targetSize} px Spielgröße. Fels bleibt 32×32 px.</text>`;
const layers=[];
let rock;
if(m.spec.category==='turret')rock=await sharp('public/assets/sprites/rocks47blob.png').extract({left:3*32,top:3*32,width:32,height:32}).toBuffer();
for(let i=0;i<n;i++){
 const x=12+(i%columns)*176,y=62+Math.floor(i/columns)*230,index=m.indices[i];
 const source=path.join(folder,`frame-${String(index).padStart(4,'0')}.png`);
 svg+=`<text x="${x+6}" y="${y+12}" fill="#bbc7c3" font-family="Arial" font-size="11">Frame ${index}</text>`;
 layers.push({input:await sharp(source).resize(152,152).toBuffer(),left:x+12,top:y+20});
 if(rock)layers.push({input:rock,left:x+72,top:y+184});
 layers.push({input:await sharp(source).resize(m.spec.targetSize,m.spec.targetSize).toBuffer(),left:Math.round(x+88-m.spec.targetSize/2),top:Math.round(y+200-m.spec.targetSize/2)});
}
await sharp(Buffer.from(svg+'</svg>')).composite(layers).png().toFile(file);
console.log(file);
