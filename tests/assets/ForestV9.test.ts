import { expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CANOPY_ATLASES, CANOPY_ASSETS, canopyVariant } from '../../src/arena/trees/CanopyAssets';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
it('packs the source channels unchanged, including non-opacity data alpha, with matching hashes',async()=>{
  const root='public/assets/environment/woodland/canopy';
  const manifest=JSON.parse(await readFile('src/assets/manifests/canopy.json','utf8'));
  for(const atlas of CANOPY_ATLASES){
    const bytes=await readFile(root+'/'+atlas.file);expect(hash(bytes)).toBe(atlas.sha256);
    const meta=await sharp(bytes).metadata();expect(meta).toMatchObject({width:atlas.width,height:atlas.height,channels:4});
    for(const asset of CANOPY_ASSETS){
      const source=asset.sources[CANOPY_ATLASES.indexOf(atlas)];
      const original=await readFile(manifest.source+'/'+source.file);expect(hash(original)).toBe(source.sha256);
      const {x:left,y:top,w:width,h:height}=asset.frame;
      const actual=await sharp(bytes).extract({left,top,width,height}).raw().toBuffer();
      expect(actual.equals(await sharp(original).raw().toBuffer())).toBe(true);
    }
  }
},30000);
it('retains the original hiding coverage contract and deterministic weighted species',async()=>{
  const {canopyCoverage}=await import('../../scripts/lib/canopy-coverage.mjs');
  const manifest=JSON.parse(await readFile('src/assets/manifests/canopy.json','utf8'));
  for(const a of CANOPY_ASSETS){
    const pixels=await sharp(manifest.source+'/'+a.sources[0].file).raw().toBuffer();
    const coverage=canopyCoverage(pixels,a.displayScale);
    expect(coverage).toEqual(a.coverage);expect(a.runtimeEligible).toBe(true);
    expect(coverage.displayedOpaqueFraction).toBeGreaterThanOrEqual(manifest.coverageContract.minimumArea);
    expect(coverage.coreCoverage).toBeGreaterThanOrEqual(manifest.coverageContract.coreMinimum);
  }
  let conifers=0;
  for(let i=0;i<10000;i++){const index=canopyVariant(i*37,i*71);expect(canopyVariant(i*37,i*71)).toBe(index);if(CANOPY_ASSETS[index].conifer)conifers++;}
  expect(conifers/10000).toBeGreaterThan(.17);expect(conifers/10000).toBeLessThan(.23);
});
