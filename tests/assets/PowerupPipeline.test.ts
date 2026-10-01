import {finishPowerupSymbol} from '../../scripts/asset-pipeline/powerup-symbol-finish.mjs';
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {validatePowerupSpec,POWERUP_IDS,sameProjectionScale} from '../../scripts/asset-pipeline/powerups-contract.mjs';
import {validateManifestV2} from '../../scripts/asset-pipeline/export-v2.mjs';
import {compositePowerup} from '../../scripts/asset-pipeline/review-powerups.mjs';
const spec=JSON.parse(await readFile('scripts/asset-pipeline/powerups-v2.json','utf8'));
test('exactly one base, eight semantic symbols and a shared projection',()=>{
  validatePowerupSpec(spec);assert.equal(POWERUP_IDS.length,8);
  for(const mutate of [s=>s.assets.pop(),s=>s.assets.push(s.assets[0]),s=>s.assets[1].pivot=[.4,.5],s=>s.assets[2].orthoScale=3,s=>s.assets[2].model.symbol='hp',s=>s.pulseScales[2]=1.5]){
    const s=structuredClone(spec);mutate(s);assert.throws(()=>validatePowerupSpec(s));
  }
});
test('all nine static powerup specs satisfy the existing V2 manifest contract',()=>{
  for(const a of spec.assets){
    const hash='a'.repeat(64);
    const m={...a,pipelineVersion:2,revision:'powerups-unit',variant:'standard',masterSize:1024,
      textures:{technical:{path:a.textures.technical,sha256:hash}},sources:{'recipe.py':hash},idleFrame:0,
      frames:[{index:0,blenderFrame:0,file:'masters/frame-0000.png',sha256:hash,bounds:[-.97,-.97,.97,.97]}],
      camera:{type:'ORTHO',rotation:[0,0,0],location:[0,0,8],orthoScale:2.2,transparent:true}};
    validateManifestV2(m);assert.throws(()=>validateManifestV2({...m,camera:{...m.camera,rotation:[.1,0,0]}}));
  }
});
test('base pixels stay identical while only the center symbol pulses',async()=>{
  const base=await sharp({create:{width:256,height:256,channels:4,background:'#829080'}}).png().toBuffer();
  const raw=Buffer.alloc(256*256*4);
  for(let y=80;y<176;y++)for(let x=80;x<176;x++){const i=(y*256+x)*4;raw[i]=220;raw[i+3]=255;}
  const symbol=await sharp(raw,{raw:{width:256,height:256,channels:4}}).png().toBuffer();
  const b=await sharp(base).raw().toBuffer();let previousArea=0;
  for(const scale of spec.pulseScales){
    const image=await compositePowerup(base,symbol,scale),{data,info}=await sharp(image).raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,256);assert.equal(info.height,256);let area=0;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const i=(y*256+x)*4;if(x<65||x>190||y<65||y>190)assert.deepEqual(data.subarray(i,i+4),b.subarray(i,i+4));
      if(data[i]>180)area++;
    }
    assert.ok(area>previousArea);previousArea=area;
    if(scale===1){const expected=await sharp(base).composite([{input:symbol,left:0,top:0}]).raw().toBuffer();assert.deepEqual(data,expected);}
  }
  await assert.rejects(compositePowerup(base,symbol,2));
});
test('existing player beauty remains accepted unchanged',async()=>{
  const original=JSON.parse(await readFile('art/poc/pipeline-v2/runs/v2-ai/badger/standard/render.json','utf8'));
  validateManifestV2(original);
});
test('Blender float32 projection is accepted but real drift and nonfinite scales fail',()=>{
  assert.ok(sameProjectionScale(2.200000047683716,2.2));
  assert.ok(!sameProjectionScale(2.2001,2.2));assert.ok(!sameProjectionScale(NaN,2.2));assert.ok(!sameProjectionScale(Infinity,2.2));
});
test('symbol finish preserves opaque colour and attaches a bounded southeast contact shadow',async()=>{
  const raw=Buffer.alloc(256*256*4);
  for(let y=90;y<166;y++)for(let x=90;x<166;x++){const i=(y*256+x)*4;raw[i]=240;raw[i+1]=20;raw[i+2]=40;raw[i+3]=255;}
  const input=await sharp(raw,{raw:{width:256,height:256,channels:4}}).png().toBuffer();
  const result=await sharp(await finishPowerupSymbol(input)).raw().toBuffer();
  assert.deepEqual([...result.subarray((128*256+128)*4,(128*256+128)*4+4)],[240,20,40,255]);
  const a=(x,y)=>result[(y*256+x)*4+3];assert.ok(a(128,171)>a(128,84));
  for(let i=0;i<256;i++){assert.equal(a(i,0),0);assert.equal(a(i,255),0);assert.equal(a(0,i),0);assert.equal(a(255,i),0);}
  const clear=await sharp({create:{width:256,height:256,channels:4,background:'#00000000'}}).png().toBuffer();
  const empty=await sharp(await finishPowerupSymbol(clear)).raw().toBuffer();
  for(let i=3;i<empty.length;i+=4)assert.equal(empty[i],0);
});
