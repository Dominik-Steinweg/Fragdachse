import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {runtimeAssetUrl} from '../../src/assets/RuntimeAssetUrls';
import urls from '../../src/assets/runtimeAssetUrls.json';
import publication from '../../src/assets/manifests/runtime-colours.json';
import atlases from '../../src/assets/manifests/runtime-atlases.json';
import runtimeFrames from '../../src/assets/manifests/runtime-atlas-frames.json';
import { atlasSources, packAtlas } from '../../scripts/lib/runtime-atlases.mjs';
import { publicDeploymentFiles, publicDeploymentExclusions } from '../../scripts/lib/public-deployment.mjs';
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const visible=(pixels:Buffer)=>{for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===0)pixels.fill(0,i,i+3);return pixels;};

it('packs exactly the active registries with untrimmed frames, lossless PMA pixels and two clamped edge texels', async () => {
 const sources = await atlasSources(), ids = new Set<string>();
 for (const [name, group] of Object.entries(atlases.groups)) {
  expect(group.sources.map(s => ({id:s.id,source:s.source}))).toEqual(sources[name]);
  const layouts = packAtlas(group.sources);
  expect(group.pages.length).toBe(layouts.length);
  for (const [index,page] of group.pages.entries()) {
   expect(page.width).toBeLessThanOrEqual(4096);expect(page.height).toBeLessThanOrEqual(4096);
   const encoded=await readFile('public/'+page.image), json=await readFile('public/'+page.data);
   expect(hash(encoded)).toBe(page.sha256);expect(hash(json)).toBe(page.dataSha256);
   expect(runtimeAssetUrl(page.image)).toContain('?v='+page.sha256);
   expect(runtimeAssetUrl(page.data)).toContain('?v='+page.dataSha256);
   const metadata=JSON.parse(json.toString()), raw=await sharp(encoded).ensureAlpha().raw().toBuffer();
   expect(Object.keys(metadata.frames)).toEqual(page.frames);
   expect(runtimeFrames.groups[name][index]).toEqual({key:page.key,image:page.image,data:page.data,frames:page.frames});
   for (const item of layouts[index].items) {
    expect(ids.has(item.id)).toBe(false);ids.add(item.id);
    const frame=metadata.frames[item.id];
    expect(frame).toMatchObject({rotated:false,trimmed:false,frame:{x:item.x,y:item.y,w:item.width,h:item.height},sourceSize:{w:item.width,h:item.height}});
    const source=await sharp('public/'+item.source).ensureAlpha().raw().toBuffer();
    const region=Buffer.alloc((item.width+4)*(item.height+4)*4);
    const expected=Buffer.alloc(region.length);
    for(let y=-2;y<item.height+2;y++)for(let x=-2;x<item.width+2;x++){
     const to=((y+2)*(item.width+4)+x+2)*4;
     const from=((item.y+y)*page.width+item.x+x)*4;
     raw.copy(region,to,from,from+4);
     const edge=(Math.max(0,Math.min(item.height-1,y))*item.width+Math.max(0,Math.min(item.width-1,x)))*4;
     source.copy(expected,to,edge,edge+4);
    }
    // These are colour atlases. Alpha is exact; hidden RGB is zero after the normal PMA upload.
    expect(visible(region).equals(visible(expected)),item.id).toBe(true);
   }
  }
 }
},60000);

it('deploys replacement atlases and colour outputs while retaining their source files for authoring', async () => {
 const files=new Set(await publicDeploymentFiles()), excluded=await publicDeploymentExclusions();
 for(const asset of Object.values(publication.assets)) {
  const preserved=/^assets\/sprites\/pipeline-v2\/(badger\/passes|powerups)\//.test(asset.source);
  expect(files.has(asset.source)).toBe(preserved);
 }
 for(const group of Object.values(atlases.groups)) {
  for(const source of group.sources) {
   expect(files.has(source.source)).toBe(false);expect(files.has(source.file)).toBe(false);
   expect((await readFile('public/'+source.source)).length).toBeGreaterThan(0);
  }
  for(const page of group.pages) {expect(files.has(page.image)).toBe(true);expect(files.has(page.data)).toBe(true);}
 }
 for(const file of excluded) expect(file).not.toMatch(/badger\/passes|pipeline-v2\/powerups/);
},30000);
it('publishes exact alpha and visible RGB, unchanged dimensions, valid content hashes and smaller downloads',async()=>{
 for(const a of Object.values(publication.assets)){
  const source=await readFile('public/'+a.source),runtime=await readFile('public/'+a.file);
  expect(hash(source)).toBe(a.sourceSha256);expect(hash(runtime)).toBe(a.sha256);expect(runtime.length).toBe(a.downloadBytes);
  expect(runtime.length).toBeLessThan(source.length);
  const before=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const after=await sharp(runtime).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  expect([after.info.width,after.info.height]).toEqual([before.info.width,before.info.height]);
  expect(visible(after.data).equals(visible(before.data))).toBe(true);
  expect(hash(after.data)).toBe(a.visiblePixelSha256);
  expect((await sharp(source).metadata()).icc).toBeUndefined();
  expect(runtimeAssetUrl('./'+a.source)).toBe('./'+a.file+'?v='+a.sha256);
 }
},30000);
it('versions actual file contents, including unconverted data and audio, without stale cache URLs',async()=>{
 const seen=new Set<string>();
 for(const value of Object.values(urls)){
  if(seen.has(value))continue;seen.add(value);
  const [file,version]=value.split('?v=');expect(version).toBe(hash(await readFile('public/'+file)));
 }
},30000);
