import { prepareRuntimeAssets } from './prepare-runtime-assets.mjs';
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {slateV7Geometry,slateV7WeatheredGeometry} from './lib/slate-v7-geometry.mjs';
import {reconcileTileEdges} from './lib/material-tile.mjs';
import {ROCK_BASE_FRAME_SIZE as CELL,ROCK_BASE_PHASE_CELLS as N,
  ROCK_BASE_PHASES as PHASES,ROCK_BASE_AUTOTILE_SLOTS as SLOTS,
  ROCK_BASE_FRAME_MARGIN as MARGIN} from '../src/arena/RockBaseConfig.ts';

const source=process.argv[2]??'tools/source-art/slate-v7/mineral-source-d.png';
const directory='public/assets/environment/woodland/rock', period=CELL*N, pitch=CELL+MARGIN*2;
const seed=74931,variant=process.argv[3]??'weathered',width=PHASES*pitch,height=SLOTS*pitch;
const heightPeriod=variant==='weathered'?512:period,geometryScale=.8,geometryChips=1.2;
const sourceBytes=await readFile(source),baselineBytes=await readFile('tools/source-art/rock-mineral/coverage.png');
const baseline=await sharp(baselineBytes).ensureAlpha().raw().toBuffer();
if(baseline.length!==width*height*4)throw new Error('V7 requires the existing formation atlas layout');
const tile=await sharp(sourceBytes).resize(period,period,{kernel:'lanczos3'}).removeAlpha().raw().toBuffer();
reconcileTileEdges(tile,period,8);
const colour=Buffer.from(baseline);
for(let slot=0;slot<SLOTS;slot++)for(let phase=0;phase<PHASES;phase++){
  for(let y=-MARGIN;y<CELL+MARGIN;y++)for(let x=-MARGIN;x<CELL+MARGIN;x++){
    const sx=Math.max(0,Math.min(CELL-1,x)),sy=Math.max(0,Math.min(CELL-1,y));
    const p=((Math.floor(phase/N)*CELL+sy)*period+(phase%N)*CELL+sx)*3;
    const i=((slot*pitch+MARGIN+y)*width+phase*pitch+MARGIN+x)*4;
    colour[i]=tile[p];colour[i+1]=tile[p+1];colour[i+2]=tile[p+2];
  }
}
// The optional high-density skin preserves normalized frame rectangles and
// duplicates baseline coverage exactly. It adds detail, never gameplay area.
const scale=2,hiPeriod=period*scale,hiWidth=width*scale,hiHeight=height*scale;
const hiTile=await sharp(sourceBytes).resize(hiPeriod,hiPeriod,{kernel:'lanczos3'}).removeAlpha().raw().toBuffer();
reconcileTileEdges(hiTile,hiPeriod,8*scale);
const hiColour=Buffer.alloc(hiWidth*hiHeight*4);
for(let slot=0;slot<SLOTS;slot++)for(let phase=0;phase<PHASES;phase++){
  for(let y=-MARGIN*scale;y<(CELL+MARGIN)*scale;y++)for(let x=-MARGIN*scale;x<(CELL+MARGIN)*scale;x++){
    const sx=Math.max(0,Math.min(CELL*scale-1,x)),sy=Math.max(0,Math.min(CELL*scale-1,y));
    const p=((Math.floor(phase/N)*CELL*scale+sy)*hiPeriod+(phase%N)*CELL*scale+sx)*3;
    const i=((slot*pitch*scale+MARGIN*scale+y)*hiWidth+phase*pitch*scale+MARGIN*scale+x)*4;
    const a=((slot*pitch+MARGIN+Math.floor(sy/scale))*width+phase*pitch+MARGIN+Math.floor(sx/scale))*4+3;
    hiColour[i]=hiTile[p];hiColour[i+1]=hiTile[p+1];hiColour[i+2]=hiTile[p+2];hiColour[i+3]=baseline[a];
  }
}
const geometry=variant==='weathered'?slateV7WeatheredGeometry(heightPeriod,seed,geometryScale,geometryChips):slateV7Geometry(heightPeriod,seed,variant),heightPixels=Buffer.alloc(512*512*4);
for(let y=0;y<512;y++)for(let x=0;x<512;x++){
  const p=(y%heightPeriod)*heightPeriod+x%heightPeriod,i=(y*512+x)*4,z=geometry.field[p];
  if(!Number.isFinite(z)||z< -32||z>32)throw new Error('V7 geometric height exceeds RG16 range');
  const encoded=Math.round((z+32)/64*65535);
  heightPixels[i]=encoded>>8;heightPixels[i+1]=encoded&255;
  heightPixels[i+2]=Math.round(geometry.variation[p]*255);heightPixels[i+3]=255;
}
await mkdir(directory,{recursive:true});
await writeFile(`${directory}/coverage.png`,baselineBytes);
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=[
  {file:'mineral-colour.png',data:colour,width,height},
  {file:'mineral-colour-2x.png',data:hiColour,width:hiWidth,height:hiHeight},
  {file:'mineral-height.png',data:heightPixels,width:512,height:512},
];
const assets=[];
for(const entry of files){
  const png=await sharp(entry.data,{raw:{width:entry.width,height:entry.height,channels:4}}).png(entry.file === 'mineral-height.png' ? {compressionLevel:9,adaptiveFiltering:true,palette:false} : {}).toBuffer();
  await writeFile(`${directory}/${entry.file}`,png);
  assets.push({file:entry.file,width:entry.width,height:entry.height,rgbaBytes:entry.data.length,downloadBytes:png.length,sha256:hash(png)});
}
await writeFile('src/assets/manifests/mineral.json',JSON.stringify({version:7,period,heightPeriod,seed,variant,geometryScale,geometryChips,
  source,sourceSha256:hash(sourceBytes),coverage:{file:'coverage.png',width,height,downloadBytes:baselineBytes.length,sha256:hash(baselineBytes),cpuOnly:true},coverageSource:'tools/source-art/rock-mineral/coverage.png',coverageSha256:hash(baselineBytes),
  geometrySource:'scripts/lib/slate-v7-geometry.mjs',geometrySha256:hash((await readFile('scripts/lib/slate-v7-geometry.mjs','utf8')).replace(/\r\n/g,'\n')),
  heightEncoding:'RG uint16: -32 + n/65535 * 64 world pixels',heightFromAlbedo:false,assets},null,2)+'\n');
console.log(JSON.stringify({source,period,assets}));

// Refresh lossless runtime files and content versions after the authored export.
await prepareRuntimeAssets();
