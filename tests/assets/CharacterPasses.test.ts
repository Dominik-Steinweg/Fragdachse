import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { validatePassSpec, validatePassManifest, validateCanvas, sampleWeights, localAzimuth, lightVector, relativePath } from '../../scripts/asset-pipeline/character-pass-contract.mjs';
import { interleaveMasks, layoutTiles } from '../../scripts/asset-pipeline/export-character-passes.mjs';
import { validateManifestV2 } from '../../scripts/asset-pipeline/export-v2.mjs';
import { runtimePassManifest } from '../../scripts/asset-pipeline/import-character-passes.mjs';
const spec = JSON.parse(await readFile('scripts/asset-pipeline/player-shadow-v1.json', 'utf8'));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, String(a) + ' != ' + b);
function fixture(inputSpec = spec) {
  const spec = inputSpec;
  const hash = 'a'.repeat(64);
  const canvases = Array.from({length:48}, (_, i) => ({azimuthIndex:i%16,elevationIndex:Math.floor(i/16),width:8,height:8,texelsPerWorldPx:2,boundsWorld:[-2,-2,2,2],pivotPx:[4,4],pixelToWorld:[.5,0,0,.5,-2,-2]}));
  const images = [];
  for (const pose of spec.poseIndices) {
    for (let c=0;c<48;c++) images.push({pass:'shadow',pose,canvasIndex:c,width:8,height:8,channels:1,encoding:spec.shadow.encoding});
    for (const size of spec.material.sourceSizes) for (const pass of ['albedo','normal']) images.push({pass,pose,width:size,height:size,channels:4,encoding:spec.material[pass].encoding});
  }
  images.forEach((img,i)=>Object.assign(img,{file:'pass/'+i+'.png',sha256:hash,downloadBytes:123,premultiplied:false,gpuBytesRGBA8:img.width*img.height*4}));
  return {schema:'fd-character-passes',version:1,status:'pilot-unreviewed',spec:structuredClone(spec),source:{blendSha256:hash,renderSha256:hash,selectionSha256:hash,specSha256:hash,tools:{exporter:hash}},poses:spec.poseIndices.map(index=>({index,blenderFrame:index,beautySha256:hash})),canvases,images};
}
test('relative light follows displayed clockwise rotation; never flips the cast direction', () => {
  near(localAzimuth(1,0,0),0); near(localAzimuth(1,0,Math.PI/2),270);
  near(localAzimuth(0,-1,0),270);
  const n = lightVector(270,45); near(n[0],0); near(n[1],-Math.SQRT1_2); near(n[2],Math.SQRT1_2);
});
test('cyclic and cotangent weights remain normalized and continuous at north wrap', () => {
  const cot=x=>1/Math.tan(x*Math.PI/180);
  const mid=Math.atan(1/((cot(28)+cot(35))/2))*180/Math.PI;
  const w=sampleWeights(spec,348.75,mid);
  assert.deepEqual(w.map(v=>v.azimuthIndex),[15,0,15,0]); w.forEach(v=>near(v.weight,.25));
  for(const a of [-721,0,359.999,360,721]) for(const e of [0,28,35,45,89]) {
    const p=sampleWeights(spec,a,e); near(p.reduce((s,x)=>s+x.weight,0),1); assert.ok(p.every(x=>x.weight>=0&&x.weight<=1));
  }
  assert.throws(()=>sampleWeights(spec,NaN,35));
});
test('data encodings and finite coordinate scales cannot silently become colour/PMA', () => {
  validatePassSpec(spec);
  for(const mutate of [s=>s.shadow.premultiplied=true,s=>s.material.normal.encoding='srgb8',s=>s.coordinates.bodyCanvasWorldPx=Infinity,s=>s.poseIndices.push(s.poseIndices[0]),s=>s.grid.azimuthDegrees.reverse()]) {
    const s=structuredClone(spec);mutate(s);assert.throws(()=>validatePassSpec(s));
  }
  for(const p of ['../bad.png','/bad.png','C:/bad.png','x//a'])assert.throws(()=>relativePath(p));
});
test('pivot and pixel/world mapping survive off-centre rectangular packing', () => {
  const c={width:20,height:8,texelsPerWorldPx:2,boundsWorld:[-12,1,-2,5],pivotPx:[24,-2],pixelToWorld:[.5,0,0,.5,-12,1]};
  validateCanvas(c);assert.throws(()=>validateCanvas({...c,pivotPx:[10,4]}));assert.throws(()=>validateCanvas({...c,width:21}));
});
test('all poses/light samples/material sizes must be present once and source-bound', () => {
  validatePassManifest(fixture());
  for(const mutate of [m=>m.images.pop(),m=>m.images.push(m.images[0]),m=>m.source.blendSha256='broken',m=>m.images[0].gpuBytesRGBA8=64,m=>m.canvases[0].pivotPx=[0,0],m=>m.poses[0].index=99]) {
    const m=fixture();mutate(m);assert.throws(()=>validatePassManifest(m));
  }
});
test('four independent masks round-trip through PNG including RGB where A is zero', async () => {
  const masks=[Buffer.from([255,41,19,0]),Buffer.from([1,127,0,255]),Buffer.from([99,55,221,0]),Buffer.from([0,200,0,255])];
  const packed=interleaveMasks(masks,2,2);
  assert.deepEqual([...packed.slice(0,4)],[255,1,99,0]);
  const png=await sharp(packed,{raw:{width:2,height:2,channels:4}}).png().toBuffer();
  assert.deepEqual(await sharp(png).raw().toBuffer(),packed);
  for(let c=0;c<4;c++)for(let p=0;p<4;p++)assert.equal(packed[p*4+c],masks[c][p]);
  assert.throws(()=>interleaveMasks([Buffer.alloc(3)],2,2));
});
test('bounded pages preserve gutter and never overlap sample rectangles', () => {
  const pages=layoutTiles(Array.from({length:13},()=>({width:12,height:8})),32,2);
  assert.ok(pages.length>1);
  for(const p of pages) {
    assert.ok(p.width<=32&&p.height<=32);
    for(let i=0;i<p.tiles.length;i++)for(let j=0;j<i;j++) {
      const a=p.tiles[i],b=p.tiles[j];assert.ok(a.x+a.width+4<=b.x||b.x+b.width+4<=a.x||a.y+a.height+4<=b.y||b.y+b.height+4<=a.y);
    }
  }
  assert.throws(()=>layoutTiles([{width:33,height:8}],32,2));
});
test('immutable beauty manifest still passes its unchanged V2 validator', async () => {
  const original=JSON.parse(await readFile('art/poc/pipeline-v2/runs/v2-ai/badger/standard/render.json','utf8'));
  const before=JSON.stringify(original);validateManifestV2(original);assert.equal(JSON.stringify(original),before);
});

test('production requires every source pose once in source order and matching status', () => {
  const full=structuredClone(spec);full.status='production';full.poseIndices=Array.from({length:37},(_,i)=>i);
  const m=fixture(full);m.status='production-unreviewed';m.sourceFrameCount=37;validatePassManifest(m);
  for(const mutate of [x=>x.sourceFrameCount=38,x=>x.status='pilot-unreviewed',x=>x.spec.poseIndices.reverse(),x=>x.images.pop()]) {
    const broken=structuredClone(m);mutate(broken);assert.throws(()=>validatePassManifest(broken));
  }
  const fake=fixture();fake.spec.status='production';fake.status='production-unreviewed';fake.sourceFrameCount=37;
  assert.throws(()=>validatePassManifest(fake));
});
test('runtime publication retains data bytes/layout and excludes mask/normal from A2 colour conversion', () => {
  const hash='b'.repeat(64), pages=['shadow','normal','albedo'].map(pass=>({pass,file:pass+'.png',sha256:hash,premultiplied:false}));
  const atlas={status:'production-unreviewed',poses:Array.from({length:37},(_,index)=>({index})),pages,samples:[{pass:'shadow',pose:4,channel:3,page:0,rect:[2,2,10,10]}]};
  const selection={id:'badger',revision:'test-21c'},receipt={selectionSha256:hash,archiveSha256:hash};
  const result=runtimePassManifest(atlas,selection,receipt);
  assert.deepEqual(result.samples,atlas.samples);assert.equal(result.pages[0].textureRole,'data');
  assert.equal(result.pages[1].textureRole,'data');assert.equal(result.pages[2].textureRole,'colour');
  for(const page of result.pages) {assert.equal(page.sha256,hash);assert.equal(page.unpackPremultiplyAlpha,false);assert.ok(page.file.includes(hash));}
  assert.match(result.pages[0].file,/shadow-mask/);assert.match(result.pages[1].file,/normal/);
  assert.throws(()=>runtimePassManifest({...atlas,poses:atlas.poses.slice(0,5)},selection,receipt));
  assert.throws(()=>runtimePassManifest(atlas,{...selection,revision:'../escape'},receipt));
});
