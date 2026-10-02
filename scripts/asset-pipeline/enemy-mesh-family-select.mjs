/** Assemble immutable accepted geometry/images into one R4 source selection on D:. */
import fs from 'node:fs/promises';import path from 'node:path';import {enemyFileHash}from'./enemy-mesh-sources.mjs';
const [selectionFile]=process.argv.slice(2),selection=JSON.parse(await fs.readFile(selectionFile,'utf8'));
if(!/^enemy-mesh-r4-\d+$/.test(selection.revision)||selection.assets.length!==12)throw Error('Complete R4 selection required');
const root=path.join('D:/Fragdachse-render',selection.revision);await fs.mkdir(root);
async function copyTree(from,to){const stat=await fs.lstat(from);if(stat.isSymbolicLink())throw Error('Redirected source');if(stat.isDirectory()){await fs.mkdir(to,{recursive:true});for(const f of await fs.readdir(from))if(!['intermediate','review-tools','render-tools'].includes(f)&&!f.endsWith('.log'))await copyTree(path.join(from,f),path.join(to,f));}else{await fs.copyFile(from,to);if(await enemyFileHash(from)!==await enemyFileHash(to))throw Error('Copy mismatch');}}
for(const a of selection.assets){
 if(!/^[-a-z]+$/.test(a.id)||![a.geometry,a.images].every(r=>/^enemy-mesh-r4-\d+$/.test(r)))throw Error('Unsafe selection');
 const geometry=path.join('D:/Fragdachse-render',a.geometry,a.id),images=path.join('D:/Fragdachse-render',a.images,a.id),out=path.join(root,a.id),read=async(p,n)=>JSON.parse(await fs.readFile(path.join(p,n),'utf8'));
 const shadow=await read(geometry,'silhouette-review.json'),diff=await read(images,'beauty-difference.json');
 if(shadow.below095||diff.outsideRepairAlphaPixels||diff.outsideRepairPixels>Math.max(12,diff.changedPixels*.01))throw Error('Unaccepted candidate '+a.id);
 await copyTree(geometry,out);
 if(geometry!==images){
  const x=await read(geometry,'source-geometry-proof.json'),y=await read(images,'source-geometry-proof.json');
  for(const file of ['positions.bin','indices.bin','before-source-positions.bin','before-source-indices.bin'])if(x.files[file]!==y.files[file])throw Error('Image source geometry differs '+a.id);
  const j=await read(geometry,'job.json'),k=await read(images,'job.json');for(const key of ['coordinates','poses','reviewSamples','pilot'])if(JSON.stringify(j[key])!==JSON.stringify(k[key]))throw Error('Source contract differs');
  for(const member of ['source.blend','source-render.json','source-tools/enemy_mesh_anatomy.py'])if(j.sourceFiles[member]!==k.sourceFiles[member])throw Error('Source repair differs');
  for(const name of ['beauty','albedo','normal','emission','render-passes.json','beauty-difference.json'])await copyTree(path.join(images,name),path.join(out,name));
  await fs.writeFile(path.join(out,'render-reuse.json'),JSON.stringify({reason:'All 31 evaluated source poses, topology, original/repair inputs and canvas exactly match; only shadow approximation differs',geometry:a.geometry,images:a.images,sourceGeometry:x.files},null,2));
 }
 await fs.copyFile(path.join(images,'candidate.blend'),path.join(out,'render-source.blend'));
 await copyTree(path.join(images,'review-tools'),path.join(out,'image-tools'));
 const job=await read(out,'job.json'),m=await read(out,'mesh-manifest.json');
 await fs.writeFile(path.join(out,'generation-selection.json'),JSON.stringify({geometry:a.geometry,images:a.images,originalJob:job,originalManifest:m},null,2));
 job.revision=selection.revision;job.outputRoot=root;m.revision=selection.revision;
 await fs.writeFile(path.join(out,'job.json'),JSON.stringify(job,null,2));await fs.writeFile(path.join(out,'mesh-manifest.json'),JSON.stringify(m,null,2));
}
await fs.copyFile(selectionFile,path.join(root,'selection.json'));console.log('R4_ASSEMBLED',root);
