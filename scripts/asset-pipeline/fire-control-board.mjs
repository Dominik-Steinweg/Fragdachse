// Offline review/export only. Does not publish textures or change the runtime manifest.
import sharp from 'sharp';
import path from 'node:path';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
const root=process.cwd();
const out=path.resolve(process.argv[2] ?? 'D:/Fragdachse-render/fire-control');
const labels=process.argv.slice(3);
if(labels.length!==3) throw Error('Usage: node scripts/asset-pipeline/fire-control-board.mjs <output> <relay-preview-label> <held-preview-label> <flight-preview-label>');
const ids=['fire-control-relay','held-fire-control-portal','fire-control-portal-flight'];
const folders=ids.map((id,i)=>path.join(root,'art/poc/pipeline-v2/previews',labels[i],id));
const specs=await Promise.all(folders.map(async f=>JSON.parse(await readFile(path.join(f,'preview.json'),'utf8'))));
const sprites=folders.map(f=>path.join(f,'frame-0000.png'));
await mkdir(out,{recursive:true});
const artifact=path.join(root,'art/drafts/fire-control-devices');await mkdir(artifact,{recursive:true});
for(let i=0;i<3;i++){
 const target=path.join(out,ids[i]);await mkdir(target,{recursive:true});await cp(folders[i],path.join(target,'preview'),{recursive:true});
 const deliver=path.join(artifact,ids[i]);await mkdir(deliver,{recursive:true});
 const m=specs[i],sheetSizes={};
 for(const size of m.spec.sourceSizes){
  const frames=await Promise.all(m.indices.map(index=>sharp(path.join(folders[i],`frame-${String(index).padStart(4,'0')}.png`)).resize(size,size).png().toBuffer()));
  await writeFile(path.join(deliver,`idle-${size}.png`),frames[0]);
  const columns=Math.min(8,frames.length),rows=Math.ceil(frames.length/columns),spacing=4,margin=2;
  await sharp({create:{width:columns*size+(columns-1)*spacing+2*margin,height:rows*size+(rows-1)*spacing+2*margin,channels:4,background:'#00000000'}}).composite(frames.map((input,n)=>({input,left:margin+(n%columns)*(size+spacing),top:margin+Math.floor(n/columns)*(size+spacing)}))).png().toFile(path.join(deliver,`sheet-${size}.png`));
  sheetSizes[size]={columns,rows,spacing,margin,frameWidth:size,frameHeight:size,frameCount:frames.length};
 }
 await writeFile(path.join(deliver,'draft.json'),JSON.stringify({status:'draft-not-approved',id:ids[i],previewLabel:labels[i],inputHash:m.inputHash,targetSize:m.spec.targetSize,sourceSizes:m.spec.sourceSizes,pivot:m.spec.pivot,forward:m.spec.forward,heldItem:m.spec.heldItem,idleFrame:0,clips:m.clips,sheets:sheetSizes},null,2)+'\n');
 for(const f of ['comparison.png','scale.png']){await cp(path.join(folders[i],f),path.join(target,f));await cp(path.join(folders[i],f),path.join(deliver,f));}
 await cp(deliver,path.join(target,'exports'),{recursive:true});
}
const W=1120,H=1030,layers=[];let texts='';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const text=(x,y,s,size=15,color='#dce6e4')=>{texts+=`<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${esc(s)}</text>`;};
async function put(file,cx,cy,size,nearest=false){const input=await sharp(file).resize(size,size,{kernel:nearest?'nearest':'lanczos3'}).png().toBuffer();layers.push({input,left:Math.round(cx-size/2),top:Math.round(cy-size/2)});}
async function terrain(x,y,w,h,light){
 const file=light?'public/assets/sprites/gras_bg_tile.png':'public/assets/sprites/dirt_material.png';
 const raw=await sharp(file).extract({left:0,top:0,width:w,height:h}).modulate({brightness:light?1.6:.48,saturation:light?.85:.6}).png().toBuffer();
 layers.push({input:raw,left:x,top:y});
}
text(24,32,'FEUERLEIT-UTILITIES / Blender Draft V1-D',25);
text(24,56,'90° orthografisch · matte Stahlteile · Türkis #3dffd0 / Kern #e8fff9 · keine Runtime-Übernahme',14);
text(24,88,'RELAY_v01 → Relais-Projektor',18);text(407,88,'PORTAL_v02 → Flugkörper',18);text(780,88,'Held-Item / 32-px-Raster',18);
await put(sprites[0],170,207,220);await put(sprites[2],552,207,220);await put(sprites[1],920,207,220);
text(24,338,'1:1 SPIELGRÖSSE / dunkler Waldboden',17);text(586,338,'1:1 SPIELGRÖSSE / helles Gras',17);
for(const [x,light] of [[24,false],[586,true]]){
 await terrain(x,355,510,140,light);
 await put('public/assets/sprites/pipeline-v2/rocket/idle.png',x+85,416,40);
 await put(sprites[0],x+180,416,24);
 await put(sprites[1],x+285,416,32);
 await put('public/assets/sprites/pipeline-v2/held-he-grenade/idle.png',x+385,416,32);
 text(x+38,477,'Rakete 40',12);text(x+148,477,'Relais 24',12);text(x+250,477,'Portal Held',12);text(x+350,477,'HE Held',12);
}
text(24,532,'DEPLOY / 8 Frames · 24 fps · einmalig · Schlussbild = idle',17);
for(let i=1;i<=8;i++){
 const cx=87+(i-1)*135;await put(path.join(folders[0],`frame-${String(i).padStart(4,'0')}.png`),cx,600,90);
 await put(path.join(folders[0],`frame-${String(i).padStart(4,'0')}.png`),cx,670,24);
 text(cx-32,712,`${i} / ${Math.round((i-1)/24*1000)} ms`,12);
}
text(24,751,'FLUG / 34×34 RGBA-Quelle · Body-Skalierung hier 0,48 wie HE bei size ≤ 12,8',17);
// Static reconstruction of the existing HE canvas body + detail; source cited in manifest.
const he=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34"><defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="17" cy="18" r="13" fx="12" fy="11" fr="1"><stop stop-color="#cadc76"/><stop offset=".36" stop-color="#627632" stop-opacity=".98"/><stop offset=".74" stop-color="#34421a"/><stop offset="1" stop-color="#1a240c"/></radialGradient></defs><ellipse cx="17" cy="19" rx="11" ry="12" fill="url(#g)"/><path d="M14 12V7A3 3 0 0 1 20 7V12Z" fill="#889c48"/>${[14,19,24].map(cy=>`<ellipse cx="17" cy="${cy}" rx="10.5" ry="1.5" fill="none" stroke="#16200a" stroke-opacity=".5" stroke-width="1.1"/>`).join('')}<path d="M27 15h5v3h-5z M28 13h3v7h-3z" fill="#c0d474" opacity=".86"/><path d="M15 7h3v3h-3z" fill="#e2f0ac" opacity=".58"/></svg>`);
for(const [x,light] of [[24,false],[586,true]]){
 await terrain(x,770,510,128,light);
 await put(sprites[2],x+80,818,16);await put(he,x+165,818,16);
 await put(sprites[2],x+285,820,68);await put(he,x+395,820,68);
 text(x+46,880,'Portal / 1:1',12);text(x+139,880,'HE / 1:1',12);text(x+257,880,'Portal / 2× Quelle',11);text(x+368,880,'HE / 2× Quelle',11);
}
text(24,933,'Oben Detailansichten; Terrain-Reihen unvergrößert. Deploy: 90-px-Ansicht plus 24-px-Originalgröße.',14);
text(24,956,'HE-Flug: statische SVG-Nachbildung von GrenadeRenderer Körper + Detail; Glow und Trails ausgelassen.',14);
text(24,979,'Draft-Review: Konzeptnähe und Lesbarkeit; kontinuierliche Bewegung / GPU-Shader noch nicht abgenommen.',14);
const base=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#242c31"/></svg>`);
const typography=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${texts}</svg>`);
const board=await sharp(base).composite([...layers,{input:typography,left:0,top:0}]).png().toBuffer();
await writeFile(path.join(out,'devices-draft-board.png'),board);await writeFile(path.join(artifact,'devices-draft-board.png'),board);
await writeFile(path.join(out,'board-sources.json'),JSON.stringify({previews:folders,backgrounds:['public/assets/sprites/dirt_material.png (brightness .48)','public/assets/sprites/gras_bg_tile.png (brightness 1.6)'],heFlight:'Static reconstruction of src/effects/GrenadeRenderer.ts generateHeTextures; no live browser capture'},null,2)+'\n');
console.log(path.join(out,'devices-draft-board.png'));
