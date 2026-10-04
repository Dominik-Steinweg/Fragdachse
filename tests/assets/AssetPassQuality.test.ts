import { expect, test } from 'vitest';
import { inspectPasses, validatePoseMapping, mapLimit } from '../../scripts/asset-pipeline/pass-quality.mjs';
import { validateAlbedoRepair, replaceTile } from '../../scripts/asset-pipeline/material-repair.mjs';

const image = (pixels: number[]) => ({ width: pixels.length / 4, height: 1, data: Buffer.from(pixels) });
test('detects opaque black albedo islands against intact Beauty (21e4 regression)', () => {
  const beauty = image([80,70,60,255, 80,70,60,255, 0,0,0,0]);
  const albedo = image([0,0,0,255, 0,0,0,255, 0,0,0,0]);
  const result = inspectPasses({beauty,albedo});
  expect(result.blackOverLitBeauty).toBe(2);
  expect(result.blackIslands).toEqual({count:1,largest:2});
  expect(result.alphaInteriorMismatch).toBe(0);
});
test('normal alpha is AO; valid fully occluded vectors must survive', () => {
  const albedo=image([100,80,60,255]);
  const valid=inspectPasses({albedo,normal:image([128,128,255,0])});
  expect(valid.invalidNormals).toBe(0);expect(valid.alphaInteriorMismatch).toBe(0);expect(valid.aoMin).toBe(0);
  expect(inspectPasses({albedo,normal:image([128,128,128,255])}).invalidNormals).toBe(1);
});
test('rejects nonfinite pixels, inconsistent frames and shifted pivots before packing', () => {
  expect(()=>inspectPasses({beauty:{width:1,height:1,data:Float32Array.from([NaN,0,0,255])}})).toThrow(/Nonfinite/);
  expect(()=>inspectPasses({beauty:image([1,2,3,255]),albedo:image([1,2,3,255,0,0,0,0])})).toThrow(/canvas/);
  const poses=[{index:0,blenderFrame:1}];
  expect(()=>validatePoseMapping(poses,[{index:0,blenderFrame:2}],[.5,.5],[.5,.5])).toThrow(/Frame/);
  expect(()=>validatePoseMapping(poses,poses,[.5,.5],[.4,.5])).toThrow(/Pivot/);
  expect(inspectPasses({beauty:image([1,2,3,255]),albedo:image([1,2,3,0])}).alphaInteriorMismatch).toBe(1);
});
test('bounded parallel work records independent failures and preserves result order', async () => {
  let active=0,maximum=0;
  const result=await mapLimit([0,1,2,3],2,async (id:number)=>{
    active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;
    if(id===1)throw Error('bad source');return id;
  });
  expect(maximum).toBe(2);expect(result).toEqual([{value:0},{error:'bad source'},{value:2},{value:3}]);
});
test('repairs preserve coverage and every pixel outside the selected atlas tile', () => {
  const before=image([0,0,0,255]),after=image([60,70,80,255]);
  expect(validateAlbedoRepair(before,after)).toMatchObject({beforeBlack:1,afterBlack:0,alphaChanged:0});
  expect(()=>validateAlbedoRepair(before,image([60,70,80,254]))).toThrow(/coverage/);
  const sheet=image([12,13,14,255,0,0,0,255,32,33,34,255]),copy=Buffer.from(sheet.data);
  replaceTile(sheet,after,[1,0,1,1]);
  expect(sheet.data.subarray(0,4)).toEqual(copy.subarray(0,4));expect(sheet.data.subarray(8)).toEqual(copy.subarray(8));
  expect(sheet.data.subarray(4,8)).toEqual(after.data);
  const row=image([0,0,0,255,...Array(6).fill([50,50,50,255]).flat()]);
  const changed={...row,data:Buffer.from(row.data)};changed.data.set([60,70,80],0);changed.data[24]=52;
  expect(()=>validateAlbedoRepair(row,changed)).toThrow(/outside/);
});
