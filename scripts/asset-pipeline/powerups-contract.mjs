import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { digest, relativePath } from './character-pass-contract.mjs';
import { fileHash } from './character-pass-bundle.mjs';
import { validateManifestV2 } from './export-v2.mjs';
import { inspectMaster } from './export.mjs';
import { compositePowerup } from './review-powerups.mjs';
import { finishPowerupSymbol, SYMBOL_FINISH } from './powerup-symbol-finish.mjs';
export const POWERUP_IDS = ['hp', 'armor', 'rage', 'adrenaline', 'bfg', 'damage-amp', 'holy-grenade', 'nuke'];
const demand = (value, message) => { if (!value) throw Error(message); };
export const sameProjectionScale = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<1e-5;
export function validatePowerupSpec(s) {
  demand(s?.schema === 'fd-layered-powerups-spec' && s.version === 2 && s.masterSize === 1024
    && s.exportSize === 256 && s.displaySize === 22 && s.countdownDisplaySize === 16
    && s.reviewZoom === 1.4 && JSON.stringify(s.pulseScales) === '[0.92,1,1.08]', 'Invalid layered powerup contract');
  demand(s.assets?.length === 9 && s.assets[0].id === 'powerup-base' && s.assets[0].role === 'base', 'Exactly one common base required');
  demand(JSON.stringify(s.assets.slice(1).map(a => a.model.symbol)) === JSON.stringify(POWERUP_IDS), 'Incomplete/duplicate symbol roster');
  for (const a of s.assets) {
    demand(a.category === 'powerup' && a.targetSize === 22 && a.orthoScale === 2.2
      && JSON.stringify(a.pivot) === '[0.5,0.5]' && a.forward === 'north' && a.clips.length === 0
      && JSON.stringify(a.sourceSizes) === '[128,256]' && a.production === 'reference', 'Mismatched layer projection');
    demand(a.recipe === (a.role === 'base' ? 'powerup-base' : 'powerup-symbol'), 'Unknown recipe');
    relativePath(a.reference);
    if (a.role !== 'base') {
      demand(a.role === 'symbol' && a.id === 'powerup-'+a.model.symbol && a.gameIds.length === 1 && typeof a.spriteKey === 'string', 'Invalid symbol binding');
      relativePath(a.symbolReference);
      demand(/^[a-f0-9]{64}$/.test(a.referenceSha256) && /^[a-f0-9]{64}$/.test(a.symbolReferenceSha256), 'Missing approved reference hash');
    }
  }
  return s;
}
export async function verifyPowerupBundle(root) {
  const selectionBytes = await readFile(path.join(root, 'selection.json'));
  const selection = JSON.parse(selectionBytes);
  demand(selection.schema === 'fd-layered-powerups-selection' && selection.version === 2
    && /^[a-z0-9][a-z0-9-]*$/.test(selection.revision) && selection.id === 'powerups', 'Invalid powerup selection');
  for (const [name, hash] of Object.entries(selection.files ?? {})) {
    demand(await fileHash(path.join(root, relativePath(name))) === hash, 'Changed selected source: '+name);
  }
  const receipt = JSON.parse(await readFile(path.join(root, 'archive-receipt.json')));
  demand(receipt.selectionSha256 === digest(selectionBytes)
    && receipt.archiveSha256 === await fileHash(path.join(root, 'source-bundle.zip')), 'Archive receipt mismatch');
  const file = path.join(root, 'powerups-manifest.json'), bytes = await readFile(file), manifest = JSON.parse(bytes);
  demand(selection.files['powerups-manifest.json'] === digest(bytes), 'Unbound manifest');
  demand(manifest.schema === 'fd-layered-powerups' && manifest.version === 1 && manifest.revision === selection.revision
    && manifest.status === 'rendered-awaiting-review' && manifest.displaySize === 22 && manifest.countdownDisplaySize === 16
    && manifest.sourceSize === 256 && JSON.stringify(manifest.pivot) === '[0.5,0.5]'
    && manifest.orthoScale === 2.2 && JSON.stringify(manifest.pulseScales) === '[0.92,1,1.08]'
    && JSON.stringify(manifest.symbols.map(s=>s.id)) === JSON.stringify(POWERUP_IDS), 'Incomplete layered manifest');
  for (const img of [manifest.base, ...manifest.symbols.flatMap(s=>[s.image,s.composite])]) {
    demand(img.width === 256 && img.height === 256 && img.gpuBytes === 256*256*4
      && selection.files[relativePath(img.file)] === img.sha256, 'Unbound layer');
    const b = await readFile(path.join(root,img.file));
    demand(b.length === img.downloadBytes && digest(b) === img.sha256, 'Layer storage mismatch');
    await inspectMaster(b,256);
  }
  const specFile='source/scripts/asset-pipeline/powerups-v2.json';
  const specBytes=await readFile(path.join(root,specFile));
  demand(selection.files[specFile]===digest(specBytes),'Unbound source specification');
  const spec=validatePowerupSpec(JSON.parse(specBytes));
  demand(manifest.symbolFinish===spec.presentation?.symbolFinish,'Unbound symbol finishing method');
  demand(manifest.symbolFinish===undefined || manifest.symbolFinish===SYMBOL_FINISH,'Unknown symbol finishing method');
  const base=await readFile(path.join(root,manifest.base.file));
  for(const asset of spec.assets){
    const folder=asset.id+'/standard/', bytes=await readFile(path.join(root,folder+'render.json'));
    demand(selection.files[folder+'render.json']===digest(bytes),'Unbound V2 render manifest');
    const rendered=JSON.parse(bytes);validateManifestV2(rendered);
    demand(rendered.id===asset.id && rendered.revision===selection.revision && rendered.frames.length===1
      && rendered.category==='powerup' && rendered.orthoScale===spec.assets[0].orthoScale
      && sameProjectionScale(rendered.camera.orthoScale,rendered.orthoScale) && rendered.targetSize===22
      && JSON.stringify(rendered.pivot)==='[0.5,0.5]','V2 layer projection mismatch');
    const entry=asset.role==='base'?manifest.base:manifest.symbols.find(s=>s.id===asset.model.symbol)?.image;
    if(asset.role==='base' || !manifest.symbolFinish)
      demand(entry && selection.files[folder+'sprite-256.png']===entry.sha256,'Layer differs from V2 export');
    if(asset.role==='symbol'){
      const symbol=manifest.symbols.find(s=>s.id===asset.model.symbol);
      if(manifest.symbolFinish){
        demand(selection.files[folder+'sprite-256.png']===symbol.rawSymbolSha256,'Unbound raw symbol');
        const finished=await finishPowerupSymbol(await readFile(path.join(root,folder+'sprite-256.png')));
        demand(digest(finished)===symbol.image.sha256,'Symbol contour/contact shadow changed');
      }
      demand(symbol.gameId===asset.gameIds[0] && symbol.spriteKey===asset.spriteKey && symbol.previousComposite===asset.reference,'Runtime identity mismatch');
      const composed=await compositePowerup(base,await readFile(path.join(root,symbol.image.file)));
      demand(digest(composed)===symbol.composite.sha256,'UI composite differs from runtime layers');
    }
  }
  const images=[manifest.base,...manifest.symbols.flatMap(s=>[s.image,s.composite])];
  demand(manifest.totalDownloadBytes===images.reduce((n,i)=>n+i.downloadBytes,0)
    && manifest.layerGpuBytes===9*256*256*4 && manifest.withCompositesGpuBytes===17*256*256*4,'Incorrect memory accounting');
  return { manifest, selection, receipt };
}
