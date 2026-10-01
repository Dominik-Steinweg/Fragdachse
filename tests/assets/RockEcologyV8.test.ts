
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ROCK_ECOLOGY_RECIPE,exportRockEcology} from '../../scripts/lib/rock-ecology-v8-export.mjs';
import {ROCK_ECOLOGY_ASSETS} from '../../src/arena/rocks/RockEcologyAssets';
it('reproduces source-traced RGBA ecology assets with clear borders and real leaf coverage',async()=>{
  const manifest=JSON.parse(await readFile('public/assets/environment/woodland/ecology/rock-colonies.json','utf8'));
  expect(manifest.assets.length).toBe(23);expect(manifest.assets.length).toBe(ROCK_ECOLOGY_ASSETS.length);
  const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  for(const asset of manifest.assets){
    const source=await readFile(manifest.source+'/'+asset.source);
    const output=await exportRockEcology(source,ROCK_ECOLOGY_RECIPE.find((r:any)=>r.name===asset.name));
    expect(hash(source)).toBe(asset.sourceSha256);expect(hash(await sharp(output).ensureAlpha().raw().toBuffer())).toBe(asset.pixelSha256);
    
    const {data,info}=await sharp(output).raw().toBuffer({resolveWithObject:true});
    expect(info).toMatchObject({width:asset.width,height:asset.height,channels:4});expect(data.length).toBe(asset.rgbaBytes);
    let solid=0,clear=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      const a=data[(y*info.width+x)*4+3];if(a>=192)solid++;if(a===0)clear++;
      if(x===0||y===0||x===info.width-1||y===info.height-1)expect(a).toBe(0);
    }
    expect(solid).toBeGreaterThan(0);expect(clear).toBeGreaterThan(0);
  }
});
it('packs exact frame pixels and hashes in one atlas, preserving approved padded source proportions',async()=>{
  const m=JSON.parse(await readFile('public/assets/environment/woodland/ecology/rock-colonies.json','utf8'));
  const bytes=await readFile('public/assets/environment/woodland/ecology/'+m.atlas.file);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(m.atlas.sha256);
  expect(m.atlas.rgbaBytes).toBe(m.atlas.width*m.atlas.height*4);
  expect(Object.keys(m.atlas.frames).sort()).toEqual(m.assets.map((a:any)=>a.name).sort());
  expect(m.assets.some((a:any)=>a.name==='crevice-herb-04')).toBe(false);
  for(const a of m.assets){
    const f=m.atlas.frames[a.name].frame;
    const packed=await sharp(bytes).extract({left:f.x,top:f.y,width:f.w,height:f.h}).raw().toBuffer();
    const source=await readFile(m.source+'/'+a.source);
    const single=await sharp(await exportRockEcology(source,ROCK_ECOLOGY_RECIPE.find((r:any)=>r.name===a.name))).raw().toBuffer();
    expect(packed.equals(single)).toBe(true);
    if(a.preserveCanvas){
      expect(a.height/a.width).toBeCloseTo(a.sourceHeight/a.sourceWidth,2);
      expect(a.minWorld).toBeGreaterThan(0);expect(a.maxWorld).toBeGreaterThanOrEqual(a.minWorld);
    }
  }
});
