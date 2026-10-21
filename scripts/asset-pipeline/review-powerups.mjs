import sharp from 'sharp';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { inspectMaster } from './export.mjs';
import { digest } from './character-pass-contract.mjs';
const label = (text, width=180) => Buffer.from(`<svg width="${width}" height="22"><text x="4" y="16" font-family="Arial" font-size="12" fill="#eee">${text.replaceAll('&','&amp;').replaceAll('<','&lt;')}</text></svg>`);

/** Same center, same canvas; never fit a symbol by its nontransparent bounds. */
export async function compositePowerup(base, symbol, scale=1) {
  if (!Number.isFinite(scale) || scale < .92 || scale > 1.08) throw Error('Unsupported pulse scale');
  const size = 256, n = Math.round(size*scale);
  let layer = await sharp(symbol).resize(n,n).png().toBuffer();
  if(n>size) layer = await sharp(layer).extract({left:Math.floor((n-size)/2),top:Math.floor((n-size)/2),width:size,height:size}).png().toBuffer();
  return sharp(base).composite([{input:layer,left:Math.floor((size-Math.min(size,n))/2),top:Math.floor((size-Math.min(size,n))/2)}]).png().toBuffer();
}

export async function reviewPowerups(root, spec, manifest) {
  const dest=path.join(root,'review'); await mkdir(dest);
  const base=await readFile(path.join(root,manifest.base.file));
  const floor=await sharp(path.join(root,'source/public/assets/sprites/gras_bg_tile.png')).resize(128,128).png().toBuffer();
  const layers=[], animation=[], large=[], scale36=[];
  async function groundTile(icon, displaySize=22) {
    // 10x backing preserves 22*1.4=30.8px before the final 1:1 review reduction.
    const backing=await sharp(floor).resize(1280,1280).png().toBuffer();
    const sprite=await sharp(icon).resize(Math.round(displaySize*1.4*10)).png().toBuffer();
    const m=await sharp(sprite).metadata();
    const combined=await sharp(backing).composite([{input:sprite,left:Math.round((1280-m.width)/2),top:Math.round((1280-m.height)/2)}]).png().toBuffer();
    return sharp(combined).resize(128,128).png().toBuffer();
  }
  const measurements=[], world=[];
  // World presentation: the shared token with the symbol hovering at the runtime 1.12 scale.
  const token=await readFile(path.join(root,manifest.token.file));
  for(const [row,item] of manifest.symbols.entries()) {
    const asset=spec.assets.find(a=>a.model.symbol===item.id), y=32+row*156;
    const symbol=await readFile(path.join(root,item.image.file)), lifted=await sharp(symbol).resize(287,287).extract({left:15,top:15,width:256,height:256}).png().toBuffer();
    const onToken=await sharp(token).composite([{input:lifted}]).png().toBuffer();
    world.push({input:label(asset.label,200),left:8,top:y},
      {input:await groundTile(token,36/1.4),left:204,top:y+22},{input:await groundTile(onToken,36/1.4),left:344,top:y+22},
      {input:await groundTile(onToken),left:484,top:y+22});
  }
  for(const [row,item] of manifest.symbols.entries()) {
    const asset=spec.assets.find(a=>a.model.symbol===item.id), y=32+row*156;
    const old=await readFile(path.join(root,'source',asset.reference)), symbol=await readFile(path.join(root,item.image.file));
    const combined=await readFile(path.join(root,item.composite.file));
    layers.push({input:label(asset.label,200),left:8,top:y},
      {input:await groundTile(old),left:204,top:y+22},{input:await groundTile(combined),left:344,top:y+22},
      {input:await groundTile(combined,16),left:484,top:y+22});
    scale36.push({input:label(asset.label,200),left:8,top:y},
      {input:await groundTile(old,36/1.4),left:204,top:y+22},
      {input:await groundTile(combined,36/1.4),left:344,top:y+22},
      {input:await groundTile(symbol,36/1.4),left:484,top:y+22});
    large.push({input:label(asset.label,190),left:8,top:y},
      {input:await sharp(old).resize(128).png().toBuffer(),left:204,top:y+22},
      {input:await sharp(combined).resize(128).png().toBuffer(),left:344,top:y+22},
      {input:await sharp(symbol).resize(128).png().toBuffer(),left:484,top:y+22});
    for(const [col,scale] of spec.pulseScales.entries()) {
      const composed=await compositePowerup(base,symbol,scale);
      await inspectMaster(composed,256);
      animation.push({input:await groundTile(composed,36/1.4),left:204+col*140,top:y+22});
    }
    animation.push({input:label(asset.label,190),left:8,top:y});
    measurements.push({id:item.id,baseSha256:manifest.base.sha256,scales:spec.pulseScales,
      compositePixelHash:digest(await sharp(combined).raw().toBuffer())});
  }
  for(const [filename,items,headers] of [
    ['old-new-game-size.png',layers,['Alt 22 x 1.4','Neu 22 x 1.4','Neu 16 x 1.4']],
    ['old-new-36px.png',scale36,['Alt 36 px','Neu 36 px','Symbol 36 px']],
    ['symbol-pulse-fixed-base.png',animation,['Symbol 0.92','Symbol 1.00','Symbol 1.08']],
    ['old-new-detail.png',large,['Alt 128 px','Neu 128 px','Symbol 128 px']],
    ['world-token.png',world,['Token 36 px','Token+Symbol 36 px','Token+Symbol 22 x 1.4']],
  ]) {
    headers.forEach((text,i)=>items.push({input:label(text,138),left:204+i*140,top:4}));
    await sharp({create:{width:624,height:32+156*8,channels:4,background:'#303832'}}).composite(items).png().toFile(path.join(dest,filename));
  }
  const loops=manifest.symbols.filter(s=>s.loop);
  if(loops.length){
    const width=Math.max(...loops.map(s=>s.loop.layout.width))+210, items=[];let y=8;
    for(const item of loops){
      const asset=spec.assets.find(a=>a.model.symbol===item.id);
      items.push({input:label(`${asset.label} ${item.loop.frames}f @ ${item.loop.fps}fps`,200),left:4,top:y},
        {input:await readFile(path.join(root,item.loop.sheet.file)),left:204,top:y});
      y+=item.loop.layout.height+10;
    }
    await sharp({create:{width,height:y,channels:4,background:'#303832'}}).composite(items).png().toFile(path.join(dest,'symbol-loops.png'));
  }
  await writeFile(path.join(dest,'review.json'),JSON.stringify({status:'awaiting-human-review',
    note:'Static pulse key states at exactly 36px, not a temporal/GPU test. Extra game-size sheet keeps 30.8px and 22.4px canvas sizes. Ground uses current forest texture.',
    measurements},null,2)+'\n',{flag:'wx'});
  return ['old-new-game-size.png','old-new-36px.png','symbol-pulse-fixed-base.png','old-new-detail.png','world-token.png',
    ...(manifest.symbols.some(s=>s.loop)?['symbol-loops.png']:[]),'review.json'];
}

export async function copyPowerupReviews(root,destination,files) {
  if(await access(destination).then(()=>true,()=>false))throw Error('Review destination exists: '+destination);
  await mkdir(destination,{recursive:true});
  for(const file of files)await writeFile(path.join(destination,file),await readFile(path.join(root,'review',file)),{flag:'wx'});
}
