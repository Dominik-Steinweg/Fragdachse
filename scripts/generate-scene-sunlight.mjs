import { prepareRuntimeAssets } from './prepare-runtime-assets.mjs';
// Offline scalar transmission for the opt-in woodland-light comparison.
// This artist-authored canopy projection is not geometry recovered from albedo.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { reconcileTileEdges } from './lib/material-tile.mjs';

await mkdir('public/assets/environment/woodland/sun',{recursive:true});
const source='tools/source-art/slate-v5/sun-transmission-source.png';
const size=512;
const data=await sharp(source).resize(size,size).removeAlpha().toColourspace('srgb').raw().toBuffer();
for(let i=0;i<data.length;i+=3) {
  const value=Math.round(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722);
  data[i]=data[i+1]=data[i+2]=value;
}
reconcileTileEdges(data,size,24);
await sharp(data,{raw:{width:size,height:size,channels:3}}).png({compressionLevel:9,adaptiveFiltering:true,palette:false}).toFile('public/assets/environment/woodland/sun/transmission.png');
await writeFile('src/assets/manifests/transmission.json',JSON.stringify({version:1,source,sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex'),sha256:createHash('sha256').update(await readFile('public/assets/environment/woodland/sun/transmission.png')).digest('hex'),downloadBytes:(await readFile('public/assets/environment/woodland/sun/transmission.png')).length,
  dimensions:[size,size],worldPeriod:1024,encoding:'linear scalar transmission; black blocked, white open',
  intent:'artist-authored forest ceiling, independent of world collision and visible tree geometry'},null,2)+'\n');
console.log('Sun transmission: 512x512, shared by ground, rock and foliage.');

// Refresh lossless runtime files and content versions after the authored export.
await prepareRuntimeAssets();
