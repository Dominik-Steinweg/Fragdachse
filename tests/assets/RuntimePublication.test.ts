import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {runtimeAssetUrl} from '../../src/assets/RuntimeAssetUrls';
import urls from 'virtual:runtime-asset-urls';
import publication from '../../src/assets/manifests/runtime-colours.json';
import atlases from '../../src/assets/manifests/runtime-atlases.json';
import runtimeFrames from '../../src/assets/manifests/runtime-atlas-frames.json';
import { atlasSources, packAtlas } from '../../scripts/lib/runtime-atlases.mjs';
import { publicDeploymentFiles, publicDeploymentExclusions, isNeverRequested } from '../../scripts/lib/public-deployment.mjs';
import { deployedRuntimeAssetUrls } from '../../scripts/asset-cache';
import { isColourPng, bossAtlasImages, UI_ART } from '../../scripts/prepare-runtime-assets.mjs';
import { psnr, premultipliedPixels, UI_ART_MIN_PSNR } from '../../scripts/lib/runtime-colours.mjs';
import { readPipelineRegistry } from '../../scripts/asset-pipeline/pipeline-registry.mjs';
import { preloadForestAssets } from '../../src/ui/LobbyForestAssets';
import { preloadHudFrameAssets } from '../../src/ui/HudFrameAssets';
import { DEFERRED_ASSETS } from '../../src/assets/DeferredAssets';
import { BADGER_CURSOR, BUTTON_CURSOR } from '../../src/ui/gameCursor';
import { CHARACTER_MATERIAL_PAGES } from '../../src/assets/CharacterMaterialAssetManifest';
import { CHARACTER_SHADOW_FILES } from '../../src/assets/CharacterShadowAssetManifest';
import { CHARACTER_SHADOW_MASKS_ENABLED } from '../../src/effects/ShadowConfig';
import { preloadedAudio } from '../AudioPreloadTestHelper';
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const visible=(pixels:Buffer)=>{for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===0)pixels.fill(0,i,i+3);return pixels;};
type Publication={file:string;source:string;category:string;sourceBytes:number;downloadBytes:number;sourceSha256:string;sha256:string;
 visiblePixelSha256?:string;pixelSha256?:string;psnr?:number};
const published=publication.assets as Record<string,Publication>;
const category=(name:string)=>Object.values(published).filter(a=>a.category===name);
const decode=(bytes:Buffer)=>sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});

it('retains packed elevation and linear emission as data PNGs', () => {
 for (const pass of ['elevation', 'emission', 'normal', 'height']) {
  expect(isColourPng(`assets/sprites/pipeline-v2/kraken/atlas/432/${pass}-idle-0.png`)).toBe(false);
  expect(isColourPng(`assets/sprites/pipeline-v2/kraken/${pass}/frame-0000.png`)).toBe(false);
 }
 expect(isColourPng('assets/sprites/pipeline-v2/kraken/atlas/432/color-idle-0.png')).toBe(true);
 expect(bossAtlasImages([{ runtimeContract: 'boss', atlases: { color: { idle: { pages: [{ image: './assets/boss/color.png' }] } },
  elevation: { idle: { pages: [{ image: './assets/boss/packed.png' }] } } } }, { runtimeContract: 'sheet' }]))
  .toEqual(new Set(['assets/boss/color.png', 'assets/boss/packed.png']));
});

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
 const atlasInputs=new Set(Object.values(atlases.groups).flatMap(group=>group.sources.map(source=>source.source)));
 for(const asset of Object.values(published)) {
  const preserved=/^assets\/sprites\/pipeline-v2\/(badger\/passes|powerups)\//.test(asset.source);
  expect(files.has(asset.source)).toBe(preserved);
  if(!atlasInputs.has(asset.source))expect(files.has(asset.file),asset.file).toBe(true);
  expect(publication.contracts[asset.category as keyof typeof publication.contracts],asset.source).toBeTruthy();
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
it('embeds exactly the shipped targets in deployable builds and keeps every shipped asset addressable',async()=>{
 const shipped=new Set(await publicDeploymentFiles()), deployed=await deployedRuntimeAssetUrls();
 for(const [key,url] of Object.entries(urls)) expect(deployed[key],key).toBe(shipped.has(url.split('?v=')[0])?url:undefined);
 for(const file of shipped) if(file.startsWith('assets/')) expect(deployed[file],file).toBeDefined();
},30000);
it('publishes colour with exact alpha and visible RGB, unchanged dimensions, valid content hashes and smaller downloads',async()=>{
 for(const a of category('colour')){
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
it('publishes data passes bit-identical in every channel, including RGB under alpha 0',async()=>{
 const data=category('data');expect(data.length).toBeGreaterThan(0);
 for(const a of data){
  const source=await readFile('public/'+a.source),runtime=await readFile('public/'+a.file);
  expect(hash(source)).toBe(a.sourceSha256);expect(hash(runtime)).toBe(a.sha256);expect(runtime.length).toBeLessThan(source.length);
  const before=await decode(source),after=await decode(runtime);
  expect([after.info.width,after.info.height]).toEqual([before.info.width,before.info.height]);
  expect(after.data.equals(before.data),a.file).toBe(true);expect(hash(after.data)).toBe(a.pixelSha256);
  expect(runtimeAssetUrl('./'+a.source)).toBe('./'+a.file+'?v='+a.sha256);
 }
 // Residency loaders that verify the bytes they fetch keep their exact files.
 const bound=bossAtlasImages((await readPipelineRegistry()).assets);
 for(const a of Object.values(published)){expect(bound.has(a.source),a.source).toBe(false);expect(a.source).not.toMatch(/\.bin$/);}
},60000);
it('publishes only the listed UI illustrations lossy, with exact alpha and premultiplied PSNR at or above the floor',async()=>{
 const art=category('ui-art');
 expect(art.map(a=>'public/'+a.source).sort()).toEqual([...UI_ART].sort());
 for(const a of art){
  const source=await readFile('public/'+a.source),runtime=await readFile('public/'+a.file);
  expect(hash(source)).toBe(a.sourceSha256);expect(hash(runtime)).toBe(a.sha256);expect(runtime.length).toBeLessThan(source.length);
  const before=await decode(source),after=await decode(runtime);
  expect([after.info.width,after.info.height]).toEqual([before.info.width,before.info.height]);
  for(let i=3;i<before.data.length;i+=4)if(before.data[i]!==after.data[i])expect.fail(`${a.file}: alpha changed at ${i}`);
  const quality=psnr(premultipliedPixels(before.data),premultipliedPixels(after.data));
  expect(quality,a.file).toBeGreaterThanOrEqual(UI_ART_MIN_PSNR);expect(quality).toBeCloseTo(a.psnr!,1);
  expect(runtimeAssetUrl('./'+a.source)).toBe('./'+a.file+'?v='+a.sha256);
 }
},60000);
it('serves byte-identical sounds from one canonical URL',async()=>{
 const aliases=category('alias');expect(aliases.length).toBeGreaterThan(0);
 for(const a of aliases){
  expect((await readFile('public/'+a.source)).equals(await readFile('public/'+a.file)),a.source).toBe(true);
  expect(published[a.file],a.file).toBeUndefined();
  expect(runtimeAssetUrl('./'+a.source)).toBe(runtimeAssetUrl('./'+a.file));
 }
});
it('deploys every file the UI, character and audio loaders request, and none of the never-requested sources',async()=>{
 const files=new Set(await publicDeploymentFiles()),requested=new Set<string>();
 const add=(url:string)=>requested.add(url.replace(/^\.?\//,'').split('?')[0]);
 const loader=(width:number)=>({scene:{scale:{width}},
  image:(key:string|{url:string},url?:string)=>add(typeof key==='string'?url!:key.url),atlas:(_key:string,url:string)=>add(url)});
 for(const width of [1920,3840]){preloadForestAssets(loader(width) as never);preloadHudFrameAssets(loader(width) as never);}
 for(const asset of DEFERRED_ASSETS)add(asset.url);
 for(const cursor of [BADGER_CURSOR,BUTTON_CURSOR])add(/url\("([^"]+)"\)/.exec(cursor)![1]);
 for(const page of CHARACTER_MATERIAL_PAGES)add(page.url);
 if(CHARACTER_SHADOW_MASKS_ENABLED)for(const file of CHARACTER_SHADOW_FILES)add(file.url);
 for(const path of preloadedAudio().values())add(path);
 expect(requested.size).toBeGreaterThan(100);
 for(const path of requested){
  expect(isNeverRequested(path),path).toBe(false);
  expect(files.has(published[path]?.file??path),path).toBe(true);
 }
},30000);
it('versions actual file contents, including unconverted data and audio, without stale cache URLs',async()=>{
 const seen=new Set<string>();
 for(const value of Object.values(urls)){
  if(seen.has(value))continue;seen.add(value);
  const [file,version]=value.split('?v=');expect(version).toBe(hash(await readFile('public/'+file)));
 }
},30000);
