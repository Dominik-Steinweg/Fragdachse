
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
it.each(['rock-colonies','ground-litter','lilies'])('verifies %s atlas frames, source hashes and exclusions',async name=>{
  const root='public/assets/environment/woodland/ecology/';
  const m=JSON.parse(await readFile(root+name+'.json','utf8'));
  const png=await readFile(root+m.atlas.file);expect(hash(png)).toBe(m.atlas.sha256);
  const {data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true});
  expect(info).toMatchObject({width:m.atlas.width,height:m.atlas.height,channels:4});expect(data.length).toBe(m.atlas.rgbaBytes);
  expect(Object.keys(m.atlas.frames)).toHaveLength(m.assets.length);
  if(name==='lilies') {
    const approved=['lily-group-01','lily-group-02','lily-pad-01','lily-pad-02','lily-pad-03'];
    expect(m.assets.map((a:{name:string})=>a.name).sort()).toEqual(approved.sort());
  }
  for(const a of m.assets){
    expect(a.name).not.toMatch(/^(moss-roots|pebbles-04|lily-group-03)/);
    const source=await readFile(m.source+'/'+a.source);
    expect(hash(source)).toBe(a.sourceSha256);
    const f=m.atlas.frames[a.name].frame;expect(f.w).toBe(a.width);expect(f.h).toBe(a.height);
    expect(f.x).toBeGreaterThanOrEqual(0);expect(f.y).toBeGreaterThanOrEqual(0);
    expect(f.x+f.w).toBeLessThanOrEqual(info.width);expect(f.y+f.h).toBeLessThanOrEqual(info.height);
    const packed=await sharp(png).extract({left:f.x,top:f.y,width:f.w,height:f.h}).raw().toBuffer();
    expect(hash(packed)).toBe(a.pixelSha256);
    let solid=0;
    for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++){
      const alpha=packed[(y*f.w+x)*4+3];if(alpha>=192)solid++;
      if(x<4||y<4||x>=f.w-4||y>=f.h-4)expect(alpha).toBe(0);
    }
    expect(solid).toBeGreaterThan(0);
  }
},30000); // Full PNG/data-channel validation shares CPUs with all other asset decoders.
