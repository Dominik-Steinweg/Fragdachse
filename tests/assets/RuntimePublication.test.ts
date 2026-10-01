import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {runtimeAssetUrl} from '../../src/assets/RuntimeAssetUrls';
import urls from '../../src/assets/runtimeAssetUrls.json';
import publication from '../../src/assets/manifests/runtime-colours.json';
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const visible=(pixels:Buffer)=>{for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===0)pixels.fill(0,i,i+3);return pixels;};
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
