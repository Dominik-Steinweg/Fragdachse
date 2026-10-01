/** Rebuild only the accepted canopy material maps from canonical native sources.
 * node tools/source-art/forest-v9-neutral/derive.mjs [--verify]
 */
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { deriveCanopyMaterial } from '../../../scripts/lib/canopy-material.mjs';
import { normalizeCanopyCoverage } from '../../../scripts/lib/canopy-coverage.mjs';
const root=new URL('./',import.meta.url),file=name=>new URL(name,root);
const selection=JSON.parse(await fs.readFile(file('selection.json'),'utf8'));
const coverage=JSON.parse(await fs.readFile(file('../forest-canopy/coverage.json'),'utf8'));
const {version:materialVersion,parameters}=JSON.parse(await fs.readFile(file('../forest-canopy/material.json'),'utf8'));
if(coverage.version!==1||materialVersion!==1)throw Error('Unsupported canopy configuration version');
const verify=process.argv.includes('--verify');
for(const {index} of selection){
 const prefix='canopy-v9-'+index;
 const albedo=await sharp(await fs.readFile(file(prefix+'.png'))).resize(512,512,{fit:'fill',kernel:'lanczos3'}).ensureAlpha().raw().toBuffer();
 const fit=normalizeCanopyCoverage(albedo,coverage.minimumArea);
 if(!fit.runtimeEligible||fit.displayScale>1.6)throw Error('Canopy coverage failed: '+index);
 const m=deriveCanopyMaterial(albedo,parameters);
 for(const [suffix,pixels] of [['albedo',m.albedo],['data',m.data],['horizon-0',m.horizons[0]],['horizon-1',m.horizons[1]]]){
  const target=file(prefix+'-'+suffix+'.png');
  if(verify){const original=await sharp(await fs.readFile(target)).raw().toBuffer();if(!pixels.equals(original))throw Error('Material channels differ: '+target);}
  else await fs.writeFile(target,await sharp(pixels,{raw:{width:512,height:512,channels:4}}).png().toBuffer());
 }
 console.log((verify?'Verified ':'Derived ')+prefix);
}
