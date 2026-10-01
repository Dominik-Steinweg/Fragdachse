/** Prepared publication only. No runtime registry activation or old-icon overwrite. */
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyPowerupBundle} from './powerups-contract.mjs';
import {runTool} from './character-pass-bundle.mjs';
import {digest} from './character-pass-contract.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {values,positionals}=parseArgs({allowPositionals:true,options:{apply:{type:'boolean',default:false},
  python:{type:'string',default:'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'}}});
if(positionals.length!==1)throw Error('Usage: node import-powerups.mjs <render-revision> [--apply]');
const root=path.resolve(positionals[0]);
const {manifest,selection,receipt}=await verifyPowerupBundle(root);
await runTool(values.python,['-B',path.join(repo,'scripts/asset-pipeline/archive-character-passes.py'),'--verify',path.join(root,'source-bundle.zip'),receipt.selectionSha256],repo);
const folder='assets/sprites/pipeline-v2/powerups/'+selection.revision;
const target=path.join(repo,'public',folder),manifestFile=path.join(repo,'src/assets/manifests','powerups-'+selection.revision+'.json');
for(const dest of [target,manifestFile]){
  if(await access(dest).then(()=>true,()=>false))throw Error('Immutable destination exists: '+dest);
  let parent=path.dirname(dest);while(!(await access(parent).then(()=>true,()=>false)))parent=path.dirname(parent);
  const rel=path.relative(await realpath(repo),await realpath(parent));
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Destination escapes repository');
}
const copies=[];
async function bind(img){
  const bytes=await readFile(path.join(root,img.file));if(digest(bytes)!==img.sha256)throw Error('Changed layer');
  const file=folder+'/'+path.basename(img.file,'.png')+'-'+img.sha256+'.png';
  copies.push({file:path.join(repo,'public',file),bytes});return {...img,file,url:file+'?v='+img.sha256};
}
const published={...manifest,sourceSelectionSha256:receipt.selectionSha256,sourceArchiveSha256:receipt.archiveSha256,
  base:await bind(manifest.base),symbols:[]};
for(const s of manifest.symbols)published.symbols.push({...s,image:await bind(s.image),composite:await bind(s.composite)});
if(values.apply){
  await mkdir(path.dirname(target),{recursive:true});await mkdir(target);
  for(const c of copies)await writeFile(c.file,c.bytes,{flag:'wx'});
  const json=JSON.stringify(published,null,2)+'\n';
  await writeFile(path.join(target,'manifest.json'),json,{flag:'wx'});await writeFile(manifestFile,json,{flag:'wx'});
  for(const c of copies)if(digest(await readFile(c.file))!==digest(c.bytes))throw Error('Import readback mismatch');
}
console.log(JSON.stringify({status:values.apply?'published-not-activated':'dry-run-no-writes',target,manifestFile,images:copies.length},null,2));
