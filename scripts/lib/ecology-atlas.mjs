import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Offline packing; four transparent guard pixels survive linear filtering. */
export async function packEcologyAtlas(output, name, assets, cell = 256, readAsset = a => readFile(`${output}/${a.file}`)) {
  const columns = 4, width = columns*cell;
  const height = 2 ** Math.ceil(Math.log2(Math.ceil(assets.length/columns)*cell));
  const frames = {}, pixels = Buffer.alloc(width*height*4);
  for (let i=0; i<assets.length; i++) {
    const a=assets[i], x=(i%columns)*cell, y=Math.floor(i/columns)*cell;
    frames[a.name] = { frame:{x,y,w:a.width,h:a.height}, rotated:false, trimmed:false,
      spriteSourceSize:{x:0,y:0,w:a.width,h:a.height}, sourceSize:{w:a.width,h:a.height} };
    const tile=await sharp(await readAsset(a)).ensureAlpha().raw().toBuffer();
    // Copy straight RGBA exactly: alpha compositing would round dark leaf fringes twice.
    for(let row=0;row<a.height;row++)tile.copy(pixels,((y+row)*width+x)*4,row*a.width*4,(row+1)*a.width*4);
  }
  const bytes=await sharp(pixels,{raw:{width,height,channels:4}}).png(name === 'rock-contact' ? {compressionLevel:9,adaptiveFiltering:true,palette:false} : {}).toBuffer();
  const file=`${name}-atlas.png`; await writeFile(`${output}/${file}`,bytes);
  return {file,width,height,rgbaBytes:width*height*4,downloadBytes:bytes.length,sha256:hash(bytes),frames};
}
