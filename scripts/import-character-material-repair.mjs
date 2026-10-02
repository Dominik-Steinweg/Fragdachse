// Import a verified rerender as a material-only revision. Original 21c stays immutable.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const render=process.argv[2];
if(!render)throw new Error('Usage: node scripts/import-character-material-repair.mjs <isolated-render-folder>');
const hash=b=>createHash('sha256').update(b).digest('hex');
const parentPath='src/assets/manifests/character-badger-player-shadow-21c-production.json';
const parentBytes=fs.readFileSync(parentPath), parent=JSON.parse(parentBytes);
const receiptBytes=fs.readFileSync(path.join(render,'receipt.json')), receipt=JSON.parse(receiptBytes);
if(receipt.control||receipt.sourceBlendSha256!==parent.source.blendSha256)throw new Error('Wrong render source/lifetime');
if(receipt.records.some(r=>r.nonfinite||r.opaqueBlack))throw new Error('Invalid material render');
const repaired=[9,12,17,22,27];
const revision='player-material-21e4', directory=`assets/sprites/pipeline-v2/badger/passes/${revision}`;
const dest='public/'+directory;
if(fs.existsSync(dest))throw new Error('Immutable revision already exists');
fs.mkdirSync(dest,{recursive:true});
const samples=parent.samples.filter(s=>s.pass==='albedo'||s.pass==='normal').map(s=>({...s,page:s.page-3}));
const pages=[], sources=[];
for(const [index,original] of parent.pages.slice(3).entries()) {
 const data=await sharp('public/'+original.file).ensureAlpha().raw().toBuffer();
 for(const sample of samples.filter(s=>s.page===index&&repaired.includes(s.pose))) {
  const file=`${sample.pass}/pose-${String(sample.pose).padStart(2,'0')}-${sample.sourceSize}.png`;
  const bytes=fs.readFileSync(path.join(render,file)), frame=await sharp(bytes).ensureAlpha().raw().toBuffer();
  const [left,top,w,h]=sample.rect;
  if(frame.length!==w*h*4)throw new Error('Frame shape changed');
  sources.push({file,sha256:hash(bytes),rgbaSha256:hash(frame),pose:sample.pose,pass:sample.pass,sourceSize:sample.sourceSize});
  // Replace the frame and its exact two-texel extrusion; never resample or trim.
  for(let y=-2;y<h+2;y++)for(let x=-2;x<w+2;x++) {
   const from=(Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x)))*4;
   const to=((top+y)*original.width+left+x)*4;
   frame.copy(data,to,from,from+4);
  }
 }
 const bytes=await sharp(data,{raw:{width:original.width,height:original.height,channels:4}}).png().toBuffer();
 const sha256=hash(bytes),file=`${directory}/${original.pass}-${index}-${sha256}.png`;
 fs.writeFileSync('public/'+file,bytes);
 pages.push({...original,file,url:file+'?v='+sha256,sha256,downloadBytes:bytes.length});
}
const manifest={schema:'fd-character-material-runtime',version:1,revision,assetId:parent.assetId,
 source:{blendSha256:receipt.sourceBlendSha256,parentManifestSha256:hash(parentBytes),
 parentArchiveSha256:parent.sourceArchiveSha256,renderReceiptSha256:hash(receiptBytes),
 renderScriptSha256:receipt.scriptSha256,helperSha256:receipt.helperSha256,repairedPoses:repaired,frames:sources},
 coordinates:parent.coordinates,poses:parent.poses,mipmaps:false,pages,samples,
 totalDownloadBytes:pages.reduce((n,p)=>n+p.downloadBytes,0),totalGpuBytes:pages.reduce((n,p)=>n+p.gpuBytes,0)};
fs.writeFileSync(`src/assets/manifests/character-material-badger-${revision}.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({revision,pages:pages.length,frames:samples.length,downloadBytes:manifest.totalDownloadBytes,repaired}));
