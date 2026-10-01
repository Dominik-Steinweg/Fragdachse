import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { packEcologyAtlas, hash } from './lib/ecology-atlas.mjs';
const output='public/assets/environment/woodland/ecology';
// Explicit approved selection: never import review sheets, rejected revisions or future candidates.
const selections={
  'ground-litter-v8':['leaf-litter-01','leaf-litter-03','leaf-litter-04','twigs-02','twigs-05',
    'needle-litter-02','needle-litter-03','pebbles-01'],
  'pond-ecology-v8':['lily-group-01','lily-group-02','lily-pad-01','lily-pad-02','lily-pad-03'],
};
await mkdir(output,{recursive:true});
for(const [name,names] of Object.entries(selections)) {
  const source=`tools/source-art/${name}`,assets=[],images=new Map();
  const target=name==='pond-ecology-v8'?'lilies':'ground-litter';
  for(const assetName of names) {
    const input=await readFile(`${source}/${assetName}.png`), metadata=await sharp(input).metadata();
    if(!metadata.hasAlpha)throw new Error(`${assetName} needs authored alpha`);
    const width=256,height=256;
    const bytes=await sharp(input).resize(248,248,{fit:'contain',background:'#00000000',kernel:'lanczos3'})
      .extend({top:4,bottom:4,left:4,right:4,background:'#00000000'}).png().toBuffer();
    const file=`${name}-${assetName}.png`;images.set(file,bytes);
    assets.push({name:assetName,file,source:`${assetName}.png`,sourceSha256:hash(input),sha256:hash(bytes),
      width,height,rgbaBytes:width*height*4,sourceWidth:metadata.width,sourceHeight:metadata.height});
  }
  const atlas=await packEcologyAtlas(output,target,assets,256,a=>images.get(a.file));
  for(const a of assets) { a.pixelSha256=hash(await sharp(images.get(a.file)).ensureAlpha().raw().toBuffer()); delete a.file; delete a.sha256; }
  await writeFile(`${output}/${target}.json`,JSON.stringify({version:8,source,recipe:'scripts/export-woodland-ecology-v8.mjs',
    alpha:'authored alpha; unchanged colours; transparent 4px padding',atlas,assets},null,2)+'\n');
  console.log(`${name}: ${assets.length} frames, ${atlas.rgbaBytes} RGBA bytes`);
}
