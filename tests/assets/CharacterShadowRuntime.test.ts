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
 const scene:any={cache:{binary:{get:(key:string)=>cache.get(key),exists:(key:string)=>cache.has(key)}},
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
