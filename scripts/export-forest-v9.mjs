import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeCanopyCoverage } from './lib/canopy-coverage.mjs';

const source='tools/source-art/forest-v9-neutral', output='public/assets/environment/woodland/canopy';
const sha256=b=>createHash('sha256').update(b).digest('hex');
const selected=JSON.parse(await readFile(`${source}/selection.json`,'utf8'));
const coverageConfig='tools/source-art/forest-canopy/coverage.json';
const coverageText=(await readFile(coverageConfig,'utf8')).replace(/\r\n/g,'\n');
const {version:coverageVersion,...coverageContract}=JSON.parse(coverageText);
const materialConfig='tools/source-art/forest-canopy/material.json';
const materialText=(await readFile(materialConfig,'utf8')).replace(/\r\n/g,'\n');
const {version:materialVersion}=JSON.parse(materialText);
if(coverageVersion!==1||materialVersion!==1)throw Error('Unsupported canopy configuration version');
const kinds=['albedo','data','horizon-0','horizon-1'], side=2048, size=512;
const buffers=kinds.map(()=>Buffer.alloc(side*side*4)), assets=[];
for(const entry of selected) {
  const index=entry.index, x=index%4*size,y=Math.floor(index/4)*size;
  if(index<0||index>=16)throw Error('V9 atlas capacity exceeded');
  const sources=[];let coverage;
  for(let k=0;k<kinds.length;k++) {
    const file=`canopy-v9-${index}-${kinds[k]}.png`,bytes=await readFile(`${source}/${file}`);
    const {data,info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
    if(info.width!==size||info.height!==size||info.channels!==4)throw Error(`Invalid V9 data: ${file}`);
    // Raw copies preserve horizon alpha and normal channels. No compositing/PMA/resampling.
    for(let row=0;row<size;row++)data.copy(buffers[k],((y+row)*side+x)*4,row*size*4,(row+1)*size*4);
    sources.push({file,sha256:sha256(bytes)});
    if(k===0)coverage=normalizeCanopyCoverage(data,coverageContract.minimumArea);
  }
  if(!coverage.runtimeEligible||coverage.displayScale>1.6)throw Error(`V9 coverage failed: ${index}`);
  assets.push({...entry,...coverage,conifer:/^(tanne|schirmkiefer|eibe)-/.test(entry.id),
    weight:/eiche/.test(entry.id)?1.4:1,frame:{x,y,w:size,h:size},sources});
}
const broad=assets.filter(a=>!a.conifer).reduce((n,a)=>n+a.weight,0),conifers=assets.filter(a=>a.conifer).length;
for(const a of assets)if(a.conifer)a.weight=broad*.25/conifers;
await mkdir(output,{recursive:true});
const atlases=[];
for(let i=0;i<kinds.length;i++) {
  const file=`${kinds[i]==='data'?'normal-ao-thickness':kinds[i]}.png`,bytes=await sharp(buffers[i],{raw:{width:side,height:side,channels:4}}).png().toBuffer();
  await writeFile(`${output}/${file}`,bytes);
  atlases.push({kind:kinds[i],file,width:side,height:side,rgbaBytes:buffers[i].length,downloadBytes:bytes.length,sha256:sha256(bytes),premultiplied:i===0});
}
await writeFile(`${output}/canopy.json`,JSON.stringify({version:9,source,recipe:'scripts/export-forest-v9.mjs',
  orientation:'top-down neutral; no rotation or mirroring',coverageConfig,coverageVersion,coverageSha256:sha256(coverageText),coverageContract,materialConfig,materialVersion,materialSha256:sha256(materialText),atlases,assets},null,2)+'\n');
console.log(`V9: ${assets.length} crowns, ${atlases.length} atlases, ${buffers.reduce((n,b)=>n+b.length,0)/1048576} MiB RGBA.`);
