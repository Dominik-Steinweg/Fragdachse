import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const revision=process.argv[2]??'kraken-ls-pilot-2';
assert.match(revision,/^kraken-ls-pilot-\d+$/);
const root=path.resolve('art/poc/pipeline-v2/runs',revision),manifest=JSON.parse(await fs.readFile(path.join(root,'ls-pilot.json')));
const sha=b=>createHash('sha256').update(b).digest('hex'),records=[];
const pixels=file=>sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(const asset of manifest.assets){
 const base=path.join(root,asset.id,'standard'),job=JSON.parse(await fs.readFile(path.join(base,'ls-job.json')));
 assert.equal(asset.encoding,'linear-unorm8-z-oct-normal-v1');assert.equal(asset.colorPass,'srgb-albedo-baked-cavity-v1');
 assert.equal(sha(await fs.readFile(path.join(job.source,'asset.blend'))),job.provenance.blend);
 assert.equal(sha(await fs.readFile(path.join(job.source,'render.json'))),job.provenance.render);
 for(const [file,hash] of Object.entries(job.helperHashes))assert.equal(sha(await fs.readFile(path.join('scripts/asset-pipeline',file))),hash);
 for(const [file,hash] of Object.entries(asset.publicationHashes))assert.equal(sha(await fs.readFile(path.join('scripts/asset-pipeline',file))),hash);
 for(const pose of asset.poses){
  assert.equal(sha(await fs.readFile(path.join(job.source,pose.beauty))),pose.beautySha256);
  assert.ok(pose.heightGeometryBU[0]>asset.heightRange[0]&&pose.heightGeometryBU[1]<asset.heightRange[1],'Geometry exceeds encoding');
  for(const [pass,p] of Object.entries(pose.passes)){
   const png=await fs.readFile(path.join(base,p.image)),json=await fs.readFile(path.join(base,p.json));
   assert.equal(sha(png),p.sha256);assert.equal(sha(json),p.jsonSha256);assert.equal(p.gpuBytes,p.width*p.height*4);
   const metadata=JSON.parse(json),frame=metadata.frames[pose.name],expected=await pixels(path.join(base,pose.name,{color:'albedo',elevation:'packed',emission:'emission',beauty:'beauty'}[pass]+'.png'));
   assert.equal(frame.sourceSize.w,pass==='elevation'?asset.size/2:asset.size);
   const crop=await sharp(png).extract({left:frame.frame.x,top:frame.frame.y,width:frame.frame.w,height:frame.frame.h}).ensureAlpha().raw().toBuffer();
   for(let y=0;y<frame.frame.h;y++){
    const start=((frame.spriteSourceSize.y+y)*expected.info.width+frame.spriteSourceSize.x)*4;
    assert.deepEqual(crop.subarray(y*frame.frame.w*4,(y+1)*frame.frame.w*4),expected.data.subarray(start,start+frame.frame.w*4),'Atlas altered data channels');
   }
  }
  const color=await pixels(path.join(base,pose.name,'albedo.png')),beauty=await pixels(path.join(base,pose.name,'beauty.png')),packed=await pixels(path.join(base,pose.name,'packed.png'));
  for(let i=3;i<color.data.length;i+=4)assert.equal(color.data[i],beauty.data[i],'Albedo coverage differs from accepted Beauty');
  let extremes=0;for(let i=0;i<packed.data.length;i+=4)if(packed.data[i+3]>250&&(packed.data[i]===0||packed.data[i]===255))extremes++;
  assert.equal(extremes,0,'Height reaches clamped extrema');
  const pos=await fs.readFile(path.join(base,pose.mesh.positions.file)),ix=await fs.readFile(path.join(base,pose.mesh.indices.file));
  assert.equal(sha(pos),pose.mesh.positions.sha256);assert.equal(sha(ix),pose.mesh.indices.sha256);
  assert.equal(pos.length,pose.mesh.vertexCount*6);assert.equal(ix.length,pose.mesh.triangleCount*6);
  for(let i=0;i<ix.length;i+=2)assert.ok(ix.readUInt16LE(i)<pose.mesh.vertexCount);
  records.push({asset:asset.id,pose:pose.name,hashes:true,coverage:true,trimmedPassPixels:true,heightExtrema:extremes,meshIndices:true});
 }
}
assert.equal(records.length,9);
const report={revision,passed:true,poses:records};
await fs.writeFile('art/poc/kraken-v12/light-shadow-pilot/verification.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS: nine poses; frozen sources, helper hashes, exact atlas RGBA, Beauty coverage, unclamped height and mesh buffers.');
