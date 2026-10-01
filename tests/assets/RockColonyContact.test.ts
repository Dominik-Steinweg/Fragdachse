import {expect,it} from 'vitest';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {exportRockContact,exportRockEcology} from '../../scripts/lib/rock-ecology-v8-export.mjs';
it('softens alpha edges without introducing a light colour rim',async()=>{
 const data=Buffer.alloc(64*64*4);
 for(let y=16;y<48;y++)for(let x=16;x<48;x++)data.set([40,70,30,255],(y*64+x)*4);
 const input=await sharp(data,{raw:{width:64,height:64,channels:4}}).png().toBuffer();
 const output=await exportRockEcology(input,{width:64,height:64,preserveCanvas:true,
  surfaceFinish:{blur:1.2,brightness:1,saturation:1,rgb:[1,1,1]}});
 const pixels=await sharp(output).raw().toBuffer();let fringe=0;
 for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>40&&pixels[i+3]<240){
  fringe++;for(const [c,v] of [40,70,30].entries())expect(Math.abs(pixels[i+c]-v)).toBeLessThanOrEqual(4);
 }
 expect(fringe).toBeGreaterThan(0);
});
it('reproduces deterministic alpha contact masks and their exact atlas frames',async()=>{
 const root='public/assets/environment/woodland/ecology/',m=JSON.parse(await readFile(root+'rock-colonies.json','utf8'));
 const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
 const atlas=await readFile(root+m.contactAtlas.file);expect(hash(atlas)).toBe(m.contactAtlas.sha256);
 expect(m.contacts.map((a:any)=>a.name).sort()).toEqual(m.assets.filter((a:any)=>a.surfaceFinish).map((a:any)=>a.name).sort());
 for(const a of m.contacts){
  const fColour=m.atlas.frames[a.name].frame;
  const source=await sharp(root+m.atlas.file).extract({left:fColour.x,top:fColour.y,width:fColour.w,height:fColour.h}).png().toBuffer();
  const generated=await exportRockContact(source),saved=generated.bytes;

  const {data,info}=await sharp(saved).raw().toBuffer({resolveWithObject:true});
  expect(hash(data)).toBe(a.pixelSha256);
  const f=m.contactAtlas.frames[a.name].frame;
  expect((await sharp(atlas).extract({left:f.x,top:f.y,width:f.w,height:f.h}).raw().toBuffer()).equals(data)).toBe(true);
  let soft=0,occupied=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
   const alpha=data[(y*info.width+x)*4+3];if(alpha>0)occupied++;if(alpha>0&&alpha<255)soft++;
   if(x===0||y===0||x===info.width-1||y===info.height-1)expect(alpha).toBe(0);
  }
  expect(soft).toBeGreaterThan(0);expect(occupied).toBeGreaterThan(0);
 }
});
