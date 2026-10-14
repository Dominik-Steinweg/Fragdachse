// Frozen ALT sources and disposable previews or checked production exports.
// Writes contact sheets only; never selects or imports.
import sharp from 'sharp';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
const { values: args } = parseArgs({ options: {
  input: { type: 'string' }, baseline: { type: 'string', default: 'art/poc/dawn/v1-review/retex-t4/baseline' },
  output: { type: 'string', default: 'art/poc/dawn/v1-review' }, production: { type: 'boolean' },
} });
if (!args.input) throw Error('--input <preview-label or production-revision directory>');
const groups = {
  drohnenwrack: [1, 2, 3].map(t => `construction_dawn_wreck_t${t}`),
  extraktor: ['construction_dawn_extractor'],
  traktor: [1, 2, 3].map(t => `construction_dawn_wreck_tractor_t${t}`),
  lore: [1, 2, 3].map(t => `construction_dawn_wreck_minecart_t${t}`),
  brutnest: ['construction_dawn_broodnest'],
  versorgung: ['construction_dawn_supply_capsule', 'dawn_supply_crate'],
  schrotthaufen: [1, 2, 3].map(t => `dawn_scrap_heap_t${t}`),
  haendlerstand: ['construction_dawn_dealer_stall'],
};
const hash = b => createHash('sha256').update(b).digest('hex'), sources = {};
async function bytes(file, expected) {
  const data = await readFile(file), sha = hash(data);
  if (expected && sha !== expected) throw Error('Hash mismatch: ' + file);
  sources[file.replaceAll('\\', '/')] = sha; return data;
}
const baseline = JSON.parse(await bytes(path.join(args.baseline, 'pipelineAssets.json')));
const entries = new Map();
for (const id of Object.values(groups).flat()) {
  const old = baseline.assets.find(a => a.id === id), folder = path.join(args.input, id);
  const fresh = JSON.parse(await bytes(path.join(folder, args.production ? 'standard/export.json' : 'preview.json')));
  const spec = args.production ? fresh.manifest : fresh.spec;
  entries.set(id, { old, fresh, spec, folder });
}
async function frame(id, index, previous) {
  const { old, fresh, spec, folder } = entries.get(id);
  if (previous) {
    const raw = await bytes(path.join(args.baseline, id, 'sheet.png'), old.hashes.sheet), l = old.layout;
    return sharp(raw).extract({ left: l.margin + index % l.columns * (l.frameWidth + l.spacing),
      top: l.margin + Math.floor(index / l.columns) * (l.frameHeight + l.spacing), width: l.frameWidth, height: l.frameHeight }).png().toBuffer();
  }
  if (args.production) {
    const size = spec.sourceSizes[0], l = fresh.sheets[size], file = `sheet-${size}.png`;
    return sharp(await bytes(path.join(folder, 'standard', file), fresh.outputs[file])).extract({
      left: l.margin + index % l.columns * (size + l.spacing), top: l.margin + Math.floor(index / l.columns) * (size + l.spacing), width: size, height: size }).png().toBuffer();
  }
  const f = fresh.frames.find(f => f.index === index);
  return bytes(path.join(folder, f.path), f.sha256);
}
const text = (s,x,y,size=12,color='#e5dfcd') => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
const svgStart = (w,h,title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#222520"/>${text(title,20,29,20)}`;
const short = id => id.replace(/^construction_dawn_/, '').replace(/^dawn_/, '');
await mkdir(args.output, { recursive: true });
for (const [family, ids] of Object.entries(groups)) {
  const items = ids.map(id => ({ id, index: 0, label: short(id) }));
  for (const id of ids) {
    const { fresh } = entries.get(id), clips = args.production ? fresh.manifest.clips : fresh.clips;
    const clip = clips.find(c => c.name === 'active') ?? clips[0];
    if (clip) for (const phase of [.25,.75]) {
      const local = Math.min(clip.frames.length-1,Math.round(clip.frames.length*phase));
      items.push({ id, index: clip.frames[local], label: `${short(id)} / ${clip.name} ${local}/${clip.frames.length}` });
    }
  }
  const w = 1420, h = 100 + items.length*260, layers = [];
  let svg = svgStart(w,h,`DAWN / ${family.toUpperCase()} / ${args.production ? 'PRODUKTION' : 'ENTWURF'} / ALT - NEU`);
  svg += text('1x = Zielgroesse | 2x = doppelte Anzeige | Gruen/Nacht sind Vergleichshintergruende, keine Lichtvarianten',20,52);
  for (const [r,item] of items.entries()) {
    const size = entries.get(item.id).spec.targetSize, old = await frame(item.id,item.index,true), fresh = await frame(item.id,item.index,false);
    for (let bg=0;bg<2;bg++) {
      const x=10+bg*705,y=72+r*260,ink=bg?'#e5dfcd':'#172319';
      svg += `<rect x="${x}" y="${y}" width="695" height="250" rx="6" fill="${bg?'#0b111b':'#82946a'}"/>`;
      svg += text(`${item.label} / ${size} px / ${bg?'NACHT':'GRUEN'}`,x+12,y+22,13,ink);
      for(const [slot,raw] of [old,fresh,old,fresh].entries()) {
        const n=size*(slot<2?1:2),cell=slot<2?96:192,xx=x+[12,125,282,490][slot]+Math.round((cell-n)/2),yy=y+52+Math.round((192-n)/2);
        svg += text(`${slot%2?'NEU':'ALT'} / ${slot<2?'1x':'2x'}`,x+[18,131,288,496][slot],y+44,11,ink);
        layers.push({input:await sharp(raw).resize(n,n).png().toBuffer(),left:xx,top:yy});
      }
    }
  }
  svg += text('Orthografisch -Z / feste Pivots / Originalpixel der Materialbibliothek / keine automatische Auswahl durch diesen Bogen',20,h-10,11)+'</svg>';
  await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(args.output,`retex-${family}.png`));
}
// Every prop at true nominal size, green and night adjacent.
const ids=Object.values(groups).flat(),w=1360,h=100+Math.ceil(ids.length/4)*190,layers=[];
let svg=svgStart(w,h,`DAWN / RETEXTURIERUNG / ${args.production?'PRODUKTION':'ENTWURF'} / ALLE PROPS 1x`);
svg+=text('Je Paar links GRUEN, rechts NACHT | Zielgroessen 28 / 64 / 96 px | keine Skalierung nach belegter Flaeche',20,54);
for(const [i,id] of ids.entries()) {
  const x=10+i%4*335,y=75+Math.floor(i/4)*190,n=entries.get(id).spec.targetSize,raw=await frame(id,0,false);
  svg+=text(short(id),x+8,y+15,12);
  for(let bg=0;bg<2;bg++) {
    svg+=`<rect x="${x+bg*160}" y="${y+25}" width="155" height="145" rx="5" fill="${bg?'#0b111b':'#82946a'}"/>`;
    layers.push({input:await sharp(raw).resize(n,n).png().toBuffer(),left:x+bg*160+Math.round((155-n)/2),top:y+25+Math.round((145-n)/2)});
  }
}
await sharp(Buffer.from(svg+'</svg>')).composite(layers).png().toFile(path.join(args.output,'retex-final.png'));
await writeFile(path.join(args.output,'retex-inputs.json'),JSON.stringify({input:args.input,production:!!args.production,groups,sources},null,2)+'\n');
console.log(Object.keys(groups).join(', '));
