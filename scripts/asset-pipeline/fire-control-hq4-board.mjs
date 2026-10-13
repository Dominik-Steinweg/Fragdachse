// Offline three-way material review. No runtime writes or browser required.
import sharp from 'sharp';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2), preview = args.includes('--preview');
const paths = args.filter(a => a !== '--preview');
if (paths.length !== 4) throw Error('Usage: <HQ4 run or preview-prefix> <HQ3 run> <draft root> <out> [--preview]');
const [run, previous, drafts, out] = paths.map(p => path.resolve(p));
const ids = ['fire-control-relay', 'held-fire-control-relay', 'held-fire-control-portal', 'fire-control-portal-flight'];
const sourceSizes = [48, 128, 128, 34], displaySizes = [24, 32, 32, 16.32];
const W = 1440, H = preview ? 2290 : 2750, layers = [], sources = new Map();
let labels = '';
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const text = (x, y, s, size = 14, fill = '#dce6e4') => { labels += `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" fill="${fill}">${esc(s)}</text>`; };
const col = [24, 496, 968];
async function bytes(file) {
  const data = await readFile(file);
  sources.set(file, createHash('sha256').update(data).digest('hex'));
  return data;
}
function master(i, version, k = 0) {
  const frame = `frame-${String(k).padStart(4, '0')}.png`;
  if (version === 2) return preview ? path.join(`${run}-${ids[i]}`, ids[i], frame) : path.join(run, ids[i], 'standard/masters', frame);
  if (version === 1) return path.join(previous, ids[i], 'standard/masters', frame);
  return i === 1 ? path.join(drafts, 'v1-h-authoring/art/poc/pipeline-v2/runs/fc-v1-h-draft', ids[i], 'standard/masters', frame) : path.join(drafts, ids[i], 'preview', frame);
}
async function sprite(file, x, y, size, sourceSize) {
  let data = await bytes(file);
  if (sourceSize) data = await sharp(data).resize(sourceSize, sourceSize).png().toBuffer();
  size = Math.round(size);
  const input = await sharp(data).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  layers.push({ input, left: Math.round(x-size/2), top: Math.round(y-size/2) });
}
async function terrain(x, y, light) {
  const file = path.join(process.cwd(), 'public/assets/sprites', light ? 'gras_bg_tile.png' : 'dirt_material.png');
  const input = await sharp(await bytes(file)).extract({left:0,top:0,width:448,height:128})
    .modulate({brightness:light?1.6:.48,saturation:light?.85:.6}).png().toBuffer();
  layers.push({input,left:x,top:y});
}
text(24, 35, 'FEUERLEIT-GERÄTE / Material- und Wertetrennung', 27);
text(24, 61, `Draft / HQ3 / HQ4 · ${preview ? 'Authoring-Vorschau' : 'fc-hq-4 Produktionsbuild'} · Kamera, Silhouette und Emissives unverändert`);
for (let v=0;v<3;v++) { text(col[v]+145, 95, ['Draft','HQ3','HQ4'][v], 22); text(col[v]+82,116,'1:1'); text(col[v]+284,116,'4×'); }
for (let i=0;i<4;i++) {
  const y=143+i*300;
  text(24,y,`${ids[i]} · ${i===3?'16,32-px-Flugcanvas (34 × 0,48), gerastert':displaySizes[i]+'-px-Canvas'}`,16);
  for (let v=0;v<3;v++) for (const light of [false,true]) {
    const top=y+12+Number(light)*132;
    await terrain(col[v],top,light);
    await sprite(master(i,v),col[v]+102,top+60,displaySizes[i],sourceSizes[i]);
    await sprite(master(i,v),col[v]+302,top+60,displaySizes[i]*4,sourceSizes[i]);
    text(col[v]+8,top+118,light?'Gras':'Waldboden',11);
  }
}
let details=1380;
if (!preview) {
  text(24,1380,'DEPLOY / Draft – HQ3 – HQ4 · je 1:1 und 4× · 8 Frames, 24 fps · Ende = idle',16);
  for(let v=0;v<3;v++) for(let k=1;k<=8;k++) {
    const x=106+(k-1)*176,y=1441+v*136;
    await sprite(master(0,v,k),x,y,96,48); await sprite(master(0,v,k),x,y+63,24,48);
    if(v===2)text(x-26,y+96,`${k} / ${Math.round((k-1)/24*1000)} ms`,11);
  }
  details=1840;
}
text(24,details,'MATERIALDETAIL / 256-px-Masteransicht, keine Spielgröße',17);
for (let i=0;i<2;i++) {
  const asset=i===0?0:3, y=details+151+i*282;
  for(let v=0;v<3;v++)await sprite(master(asset,v),col[v]+224,y,256);
}
const he=path.join(process.cwd(),'public/assets/sprites/pipeline-v2/held-he-grenade/idle.png');
text(24,H-268,'dunkler Waldboden 1:1, 2\u00d7 nearest / je Asset Draft \u2013 HQ4',17);
const stripParts=[];
for(let i=0;i<4;i++) {
  const terrainFile=path.join(process.cwd(),'public/assets/sprites/dirt_material.png');
  const input=await sharp(await bytes(terrainFile)).extract({left:0,top:0,width:168,height:54}).modulate({brightness:.48,saturation:.6}).png().toBuffer();
  const parts=[];
  for(const [j,v] of [0,2].entries()) {
    const src=await sharp(await bytes(master(i,v))).resize(sourceSizes[i],sourceSizes[i]).png().toBuffer();
    const n=Math.round(displaySizes[i]);
    parts.push({input:await sharp(src).resize(n,n).png().toBuffer(),left:Math.round(43+j*83-n/2),top:Math.round(27-n/2)});
  }
  const native=await sharp(input).composite(parts).png().toBuffer();
  layers.push({input:await sharp(native).resize(336,108,{kernel:'nearest'}).png().toBuffer(),left:24+i*354,top:H-250});
  text(24+i*354,H-127,['Relais','Relais gehalten','Portal gehalten','Portal Flug'][i],13);
}
text(24,H-104,'HE-Größenreferenz / Held-Relais, Held-Portal, HE jeweils 1:1',14);
for(let v=0;v<3;v++) {
  await sprite(master(1,v),col[v]+142,H-74,32,128);
  await sprite(master(2,v),col[v]+224,H-74,32,128);
  await sprite(he,col[v]+306,H-74,32);
}
text(24,H-35,'HQ4: angehobenes Petrol / Gunmetal / helle Stahlfasen · zurückgenommener Kontaktschmutz',13);
text(24,H-13,'Offline-Sichtprüfung; kontinuierliche Bewegung und Runtime-GPU-Darstellung bleiben ungeprüft.',13);
await mkdir(out,{recursive:true});
await sharp({create:{width:W,height:H,channels:4,background:'#242e32'}})
  .composite([...layers,{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels}</svg>`),left:0,top:0}])
  .png().toFile(path.join(out,'hq4-vs-hq3-vs-draft.png'));
await writeFile(path.join(out,'hq4-board-sources.json'),JSON.stringify({run,previous,drafts,preview,ids,sourceSizes,displaySizes,resampling:'Master to selected source size, then display size; lanczos3',sources:Object.fromEntries(sources)},null,2)+'\n');
console.log(path.join(out,'hq4-vs-hq3-vs-draft.png'));
