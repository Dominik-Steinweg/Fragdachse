import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {CHARACTER_SHADOW_FILES,CHARACTER_SHADOW_MANIFEST as manifest} from '../../src/assets/CharacterShadowAssetManifest';

it('published shadow pages retain source bytes, linear RGBA channels and complete displayed poses',async()=>{
 const samples=manifest.samples.filter(s=>s.pass==='shadow');
 expect(samples.length).toBe(manifest.poses.length*manifest.canvases.length);
 let independentRgb=false;
 for(const file of CHARACTER_SHADOW_FILES){
  const page=manifest.pages.find(p=>p.sha256===file.sha256)!;
  const bytes=await readFile('public/'+page.file),meta=await sharp(bytes).metadata();
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(page.sha256);
  expect(bytes.length).toBe(page.downloadBytes);expect(meta.width).toBe(page.width);expect(meta.height).toBe(page.height);
  expect(meta.channels).toBe(4);expect(meta.hasProfile).toBe(false);expect(page.premultiplied).toBe(false);
  const data=await sharp(bytes).raw().toBuffer();
  for(let i=0;i<data.length;i+=4)if(data[i+3]===0&&(data[i]||data[i+1]||data[i+2])){independentRgb=true;break;}
 }
 expect(independentRgb).toBe(true);
 for(const sample of samples){
  const canvas=manifest.canvases[sample.canvasIndex!],page=manifest.pages[sample.page];
  expect(page.pass).toBe('shadow');expect(sample.channel).toBeGreaterThanOrEqual(0);expect(sample.channel).toBeLessThan(4);
  expect(sample.rect.slice(2)).toEqual([canvas.width,canvas.height]);
  expect(sample.rect[0]+canvas.width).toBeLessThan(page.width);expect(sample.rect[1]+canvas.height).toBeLessThan(page.height);
 }
});

import { CHARACTER_MESH_MANIFEST as meshes, decodeCharacterMesh, getCharacterMeshes, preloadCharacterMeshAssets } from '../../src/assets/CharacterMeshAssets';
it('mesh publication loads exact hashes and quantized fixed-topology poses through the binary cache',async()=>{
 const cache=new Map<string,ArrayBuffer>(), requests:{key:string;url:string}[]=[];
 const scene:any={textures:{exists:()=>true},cache:{binary:{get:(key:string)=>cache.get(key),exists:(key:string)=>cache.has(key)}},
  load:{binary:(key:string,url:string)=>requests.push({key,url})}};
 preloadCharacterMeshAssets(scene);expect(requests).toHaveLength(meshes.meshes.length*2);
 expect(getCharacterMeshes(scene)).toBeNull();
 for(const request of requests){
  const file=meshes.meshes.flatMap(m=>[m.positions,m.indices]).find(f=>request.url.includes(f.file))!;
  expect(request.url).toContain(file.sha256);
  const bytes=await readFile('public/'+file.file);
  expect(bytes.length).toBe(file.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
  cache.set(request.key,Uint8Array.from(bytes).buffer);
 }
 const decoded=getCharacterMeshes(scene)!;expect(decoded.size).toBe(meshes.meshes.length);
 expect(getCharacterMeshes(scene)).toBe(decoded);
 requests.length=0;preloadCharacterMeshAssets(scene);expect(requests).toHaveLength(0);
 for(const data of decoded.values()){
  expect(data.positions.length).toBe(data.spec.poseIndices.length*data.spec.vertexCount*3);
  expect(data.indices.length).toBe(data.spec.triangleCount*3);
  expect(data.indices.every(i=>i<data.spec.vertexCount)).toBe(true);
  expect(data.positions.every(Number.isFinite)).toBe(true);
  for(let a=0;a<3;a++)for(let i=a;i<data.positions.length;i+=3){
   if(data.positions[i]<data.spec.bounds.min[a]-.00001||data.positions[i]>data.spec.bounds.max[a]+.00001)
    throw Error('decoded position outside quantization bounds');
  }
 }
 expect(decoded.get('badger')!.spec.poseIndices).toEqual(meshes.poses.map(p=>p.index));
 // This production uses planar hand sockets; the runtime composes yaw with displayed recoil.
 for(const pose of meshes.sockets){const s=pose.weapon,r=s.rotationMatrix;
  expect(r[2]).toBeCloseTo(0,5);expect(r[5]).toBeCloseTo(0,5);expect(r[6]).toBeCloseTo(0,5);expect(r[7]).toBeCloseTo(0,5);expect(r[8]).toBeCloseTo(1,5);
  expect(Math.atan2(r[3],r[0])).toBeCloseTo(s.yaw,5);
 }
 expect(()=>decodeCharacterMesh(meshes.meshes[0],new ArrayBuffer(1),new ArrayBuffer(1))).toThrow('byte count');
});

import repairedMaterials from '../../src/assets/manifests/character-material-badger-player-material-21e4.json';
import parentMaterials from '../../src/assets/manifests/character-badger-player-shadow-21c-production.json';
it('material repair preserves all unaffected frame pixels, source hashes, coverage and normalized data',async()=>{
 const raw=await Promise.all(repairedMaterials.pages.map(async p=>{
  const bytes=await readFile('public/'+p.file);expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.sha256);
  expect(p.premultiplied).toBe(false);expect(p.unpackPremultiplyAlpha).toBe(false);
  return sharp(bytes).ensureAlpha().raw().toBuffer();
 }));
 const original=await Promise.all(parentMaterials.pages.slice(3).map(p=>sharp('public/'+p.file).ensureAlpha().raw().toBuffer()));
 const beauty=await sharp('public/assets/sprites/pipeline-v2/badger/sheet.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 expect(repairedMaterials.samples).toHaveLength(37*2*2);
 for(const sample of repairedMaterials.samples){
  const [x,y,w,h]=sample.rect,p=repairedMaterials.pages[sample.page];
  const pixels=Buffer.alloc(w*h*4),old=Buffer.alloc(w*h*4);
  for(let row=0;row<h;row++){
   const from=((y+row)*p.width+x)*4;raw[sample.page].copy(pixels,row*w*4,from,from+w*4);
   original[sample.page].copy(old,row*w*4,from,from+w*4);
  }
  const source=repairedMaterials.source.frames.find(s=>s.pose===sample.pose&&s.pass===sample.pass&&s.sourceSize===w);
  if(source)expect(createHash('sha256').update(pixels).digest('hex')).toBe(source.rgbaSha256);
  else expect(pixels.equals(old),`unaffected ${sample.pass}/${w}/${sample.pose}`).toBe(true);
  let holes=0,black=0,maxNormalError=0;
  if(sample.pass==='albedo'&&w===128)for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
   const i=(yy*w+xx)*4,b=((2+Math.floor(sample.pose/8)*132+yy)*beauty.info.width+2+sample.pose%8*132+xx)*4;
   if(beauty.data[b+3]>240){if(pixels[i+3]<=15)holes++;
    if(pixels[i+3]>240&&Math.min(...beauty.data.subarray(b,b+3))>16)if(Math.max(...pixels.subarray(i,i+3))<3)black++;
   }
  }
  if(sample.pass==='normal')for(let i=0;i<pixels.length;i+=4){
   // Component quantization in RGB8 permits sqrt(3)/255 length error.
   const len=Math.hypot(pixels[i]/127.5-1,pixels[i+1]/127.5-1,pixels[i+2]/127.5-1);
   maxNormalError=Math.max(maxNormalError,Math.abs(len-1));
  }
  expect(holes).toBe(0);expect(black).toBe(0);expect(maxNormalError).toBeLessThan(.007);
 }
});
