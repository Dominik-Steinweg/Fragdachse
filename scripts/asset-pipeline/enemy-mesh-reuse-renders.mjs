/** Reuse completed images only across provably identical evaluated source geometry. */
import {readFile,readdir,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {enemyFileHash} from './enemy-mesh-sources.mjs';
const {values}=parseArgs({options:{from:{type:'string'},to:{type:'string'},asset:{type:'string'}}});
if(![values.from,values.to].every(v=>/^enemy-mesh-[a-z0-9-]+$/.test(v))||values.from===values.to||!['zombie-badger','rabid-badger'].includes(values.asset))throw Error('Explicit distinct D: revisions and pilot required');
const base='D:/Fragdachse-render',source=path.join(base,values.from,values.asset),target=path.join(base,values.to,values.asset);
const json=async(root,name)=>JSON.parse(await readFile(path.join(root,name),'utf8'));
const a=await json(source,'job.json'),b=await json(target,'job.json');
for(const member of ['source.blend','source-render.json','source-tools/enemy_mesh_anatomy.py'])if(a.sourceFiles[member]!==b.sourceFiles[member])throw Error('Source or repair differs');
for(const key of ['coordinates','poses','reviewSamples'])if(JSON.stringify(a[key])!==JSON.stringify(b[key]))throw Error('Frame/canvas contract differs');
const sa=await json(source,'review-source/source.json'),sb=await json(target,'review-source/source.json');
for(const member of ['positions.bin','indices.bin'])if(sa.files[member]!==sb.files[member])throw Error('Evaluated source differs');
const passes=await json(source,'render-passes.json');
if(passes.frames.length!==31||await enemyFileHash(path.join(source,'render-source.blend'))!==passes.sourceBlendSha256)throw Error('Incomplete/unbound render');
const files={};
async function copy(member){
  const s=path.join(source,member),t=path.join(target,member);
  const entries=await readdir(s,{withFileTypes:true}).catch(e=>{if(e.code==='ENOTDIR')return null;throw e;});
  if(entries){await mkdir(t);for(const e of entries){if(e.isSymbolicLink())throw Error('No junction/symlink reuse');await copy(path.join(member,e.name));}}
  else {await copyFile(s,t,constants.COPYFILE_EXCL);const h=await enemyFileHash(s);if(await enemyFileHash(t)!==h)throw Error('Reuse copy changed');files[member.replaceAll('\\','/')]=h;}
}
for(const member of ['beauty','albedo','normal','emission','render-source.blend','render-tools','render-passes.json'])await copy(member);
await writeFile(path.join(target,'render-reuse.json'),JSON.stringify({from:values.from,to:values.to,reason:'identical original source, repair implementation, frame/canvas contract and all 31 evaluated full-source meshes',sourceGeometry:sa.files,files},null,2)+'\n',{flag:'wx'});
console.log('FD_ENEMY_RENDER_REUSE_VERIFIED '+values.asset);
