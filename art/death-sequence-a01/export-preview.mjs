// Offline packing and comparison of rendered frames. No game files are changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import gifwrap from 'gifwrap';

const revision=process.argv[2];
if(!/^r\d+$/.test(revision??''))throw Error('Usage: node art/death-sequence-a01/export-preview.mjs r02');
const root=process.cwd(),source=path.join(root,'art/poc/death-sequence-a01',revision);
const out=path.join(root,'art/death-sequence-a01',revision);
await fs.mkdir(out,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(source,'preview.json'),'utf8'));
const fw=256,fh=512,columns=8,rows=9,margin=2,spacing=4;
const width=columns*(fw+spacing),height=rows*(fh+spacing);
const composites=[],frames=[],checks=[];
for(let i=0;i<72;i++){
 const input=await fs.readFile(path.join(source,'masters',`frame-${String(i).padStart(4,'0')}.png`));
 const rgba=await sharp(input).resize(fw,fh,{kernel:'lanczos3'}).ensureAlpha().raw().toBuffer();
 let bounds=[fw,fh,-1,-1],occupied=0,maxAlpha=0;
 for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){
  const a=rgba[(y*fw+x)*4+3];maxAlpha=Math.max(maxAlpha,a);
  if(a>2){occupied++;bounds=[Math.min(bounds[0],x),Math.min(bounds[1],y),Math.max(bounds[2],x),Math.max(bounds[3],y)]}
 }
 if(occupied&&(bounds[0]<5||bounds[1]<10||bounds[2]>=fw-5||bounds[3]>=fh-10))throw Error(`Clipping at frame ${i}: ${bounds}`);
 if(i===71&&maxAlpha!==0)throw Error('Last frame must be completely transparent');
 const png=await sharp(rgba,{raw:{width:fw,height:fh,channels:4}}).png().toBuffer();
 frames.push(png);
 const x=margin+i%columns*(fw+spacing),y=margin+Math.floor(i/columns)*(fh+spacing);
 composites.push({input:png,left:x,top:y});
 checks.push({frame:i,occupied,maxAlpha,bounds:occupied?bounds:null,sha256:crypto.createHash('sha256').update(png).digest('hex')});
}
const sheet=await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(composites).png().toBuffer();
await fs.writeFile(path.join(out,'death-sheet.png'),sheet);
const atlas={frames:{},meta:{image:'death-sheet.png',size:{w:width,h:height},scale:'1'}};
for(let i=0;i<72;i++)atlas.frames[`badger-death-${String(i).padStart(3,'0')}`]={frame:{x:margin+i%8*(fw+spacing),y:margin+Math.floor(i/8)*(fh+spacing),w:fw,h:fh},rotated:false,trimmed:false,spriteSourceSize:{x:0,y:0,w:fw,h:fh},sourceSize:{w:fw,h:fh},duration:1000/60};
await fs.writeFile(path.join(out,'death-atlas.json'),JSON.stringify(atlas,null,2)+'\n');
const old=await fs.readFile('public/assets/player/dachs_death_ani3.png');
const previous=await fs.readFile('art/death-sequence-a01/r02/death-sheet.png');
const grass=await sharp('public/assets/sprites/gras_bg_tile.png').resize(512,512).png().toBuffer();
const data=b=>'data:image/png;base64,'+b.toString('base64');
let html=await fs.readFile('art/death-sequence-a01/review-template.html','utf8');
html=html.replaceAll('__REVISION__',revision).replace('__OLD_IMAGE__',data(old)).replace('__PREVIOUS_IMAGE__',data(previous)).replace('__NEW_IMAGE__',data(sheet)).replace('__GRASS_IMAGE__',data(grass));
await fs.writeFile(path.join(out,'vergleich.html'),html);

// Identical logical scale, common death position, intended clip durations.
// GIF samples every second 60-fps frame, with 30/40-ms delays for exact 30 fps.
const {GifFrame,GifUtil}=gifwrap;
const gifFrames=[];
const label=Buffer.from(`<svg width="760" height="420"><style>text{font-family:Arial;fill:#d9e9df} .small{font-size:13px;fill:#a2b7aa}</style><text x="36" y="32" font-size="21">VORHER</text><text x="414" y="32" font-size="21">NACHHER · A01</text><text x="36" y="54" class="small">32 × 64 / Frame · 0,63 s</text><text x="414" y="54" class="small">256 × 512 / Frame · 1,20 s</text><path d="M380 20V398" stroke="#405649"/><text x="36" y="402" class="small">Gleicher Maßstab · 3× Spielgröße · Vorschau, nicht integriert</text></svg>`);
for(let index=0;index<54;index++){
 const time=index/30,parts=[{input:label,left:0,top:0}];
 if(time<38/60){const frame=Math.min(37,Math.floor(time*60));parts.push({input:await sharp(old).extract({left:frame*32,top:0,width:32,height:64}).resize(96,192).png().toBuffer(),left:190-48,top:302-144})}
 if(time<1.2){const frame=Math.min(71,Math.floor(time*60));parts.push({input:await sharp(frames[frame]).resize(144,288).png().toBuffer(),left:570-72,top:302-216})}
 const rgba=await sharp({create:{width:760,height:420,channels:4,background:'#203128'}}).composite(parts).raw().toBuffer();
 gifFrames.push(new GifFrame({width:760,height:420,data:rgba},{delayCentisecs:index%3===2?4:3}));
}
GifUtil.quantizeWu(gifFrames,256);
await GifUtil.write(path.join(out,'vorher-nachher.gif'),gifFrames,{loops:0});
const revisionFrames=[];
const revisionLabel=Buffer.from(`<svg width="760" height="420"><style>text{font-family:Arial;fill:#d9e9df}.small{font-size:13px;fill:#a2b7aa}</style><text x="36" y="32" font-size="21">BISHER · r02</text><text x="414" y="32" font-size="21">ÜBERARBEITET · ${revision}</text><text x="36" y="54" class="small">Gesicht, Ohren, Übergang und Schweif im direkten Vergleich</text><path d="M380 20V398" stroke="#405649"/><text x="36" y="402" class="small">Gleicher Maßstab · 3× Spielgröße · Vorschau, nicht integriert</text></svg>`);
for(let index=0;index<54;index++){
 const parts=[{input:revisionLabel,left:0,top:0}];
 if(index<36){const f=index*2;
  parts.push({input:await sharp(previous).extract({left:2+f%8*260,top:2+Math.floor(f/8)*516,width:fw,height:fh}).resize(144,288).png().toBuffer(),left:118,top:86});
  parts.push({input:await sharp(frames[f]).resize(144,288).png().toBuffer(),left:498,top:86});
 }
 const rgba=await sharp({create:{width:760,height:420,channels:4,background:'#203128'}}).composite(parts).raw().toBuffer();
 revisionFrames.push(new GifFrame({width:760,height:420,data:rgba},{delayCentisecs:index%3===2?4:3}));
}
GifUtil.quantizeWu(revisionFrames,256);
const revisionGif=`r02-${revision}.gif`;
await GifUtil.write(path.join(out,revisionGif),revisionFrames,{loops:0});
const proof=[0,8,16,24,34,46,58,68,71],contact=[];
for(let j=0;j<proof.length;j++){
 const f=proof[j];contact.push({input:await sharp(frames[f]).resize(120,240).png().toBuffer(),left:j*130+5,top:0});
 contact.push({input:Buffer.from(`<svg width="130" height="25"><text x="12" y="18" fill="#d9e9df" font-family="Arial" font-size="12">${(f/60).toFixed(2)} s · F${f}</text></svg>`),left:j*130,top:240});
}
await sharp({create:{width:1170,height:272,channels:3,background:'#203128'}}).composite(contact).png().toFile(path.join(out,'phasen.png'));
const files={};for(const name of ['death-sheet.png','death-atlas.json','vergleich.html','vorher-nachher.gif',revisionGif,'phasen.png'])files[name]=crypto.createHash('sha256').update(await fs.readFile(path.join(out,name))).digest('hex');
await fs.writeFile(path.join(out,'review.json'),JSON.stringify({...manifest,verification:{fixedCanvas:true,safetyBorder:'2% at alpha > 2',lastFrameTransparent:true,frames:checks},files},null,2)+'\n');
console.log(JSON.stringify({output:out,frames:frames.length,sheet:[width,height],lastFrameTransparent:true}));
