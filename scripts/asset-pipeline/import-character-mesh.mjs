/** Prepared for Spur A / 22c. Dry-run by default; never activates a renderer. */
import { readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMeshBundle, hash, safeFile } from './mesh-shadow-contract.mjs';
import { assertGapAcceptance } from './mesh-shadow-gap-metric.mjs';
import { runTool } from './character-pass-bundle.mjs';
export function runtimeMeshManifest(m,selection,receipt) {
  if(m.status!=='production-unreviewed'||selection.status!==m.status||selection.schema!=='fd-character-mesh-selection'
    ||selection.id!=='badger'||m.revision!==selection.revision||!/^player-mesh-[a-z0-9-]+$/.test(m.revision)||!m.shadowRepair)throw Error('Expected complete repaired production');
  const folder=`assets/sprites/pipeline-v2/badger/mesh/${m.revision}`;
  const meshes=m.meshes.map(mesh=>{
    const {audit,sourceGripBlender,sourceMuzzleBlender,...out}=mesh;
    for(const key of ['positions','indices']){const f=mesh[key],name=`${mesh.id}-${key}-${f.sha256}.bin`;
      out[key]={...f,file:`${folder}/${name}`,url:`${folder}/${name}?v=${f.sha256}`};}
    return out;
  });
  return {provenance:m.provenance,schema:'fd-character-mesh-runtime',version:1,revision:m.revision,assetId:'badger',coordinates:m.coordinates,poses:m.poses,sockets:m.sockets,meshes,
    downloadBytes:meshes.reduce((s,m)=>s+m.downloadBytes,0),gpuQuantizedBytes:meshes.reduce((s,m)=>s+m.downloadBytes,0),gpuFloat32Bytes:meshes.reduce((s,m)=>s+m.gpuFloat32Bytes,0),
    shadowRepair:{method:m.shadowRepair.method,addedVertices:m.shadowRepair.addedVertices,addedTriangles:m.shadowRepair.addedTriangles},
    sourceSelectionSha256:receipt.selectionSha256,sourceArchiveSha256:receipt.archiveSha256,
    publication:{folder,activation:'22c explicitly registers these assets; no change to Beauty/held registry or renderer',encoding:'Little-endian binary, byte-preserving, full-hash immutable URLs'}};
}
export async function importCharacterMesh(root,{apply=false,python='D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'}={}){
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const receipt=JSON.parse(await readFile(path.join(root,'archive-receipt.json'))),selectionBytes=await readFile(path.join(root,'selection.json')),selection=JSON.parse(selectionBytes);
  if(hash(selectionBytes)!==receipt.selectionSha256||hash(await readFile(path.join(root,'source-bundle.zip')))!==receipt.archiveSha256)throw Error('Changed mesh archive/selection');
  for(const [file,sha] of Object.entries(selection.files))if(hash(await readFile(path.join(root,safeFile(file))))!==sha)throw Error('Changed selected mesh member '+file);
  for(const file of ['mesh-manifest.json','completion.json','review/gap-metric.json','review/review.json','job.json'])if(!selection.files[file])throw Error('Unselected required production member '+file);
  const {manifest:m}=await loadMeshBundle(root);
  const current=JSON.parse(await readFile(path.join(repo,'src/config/pipelineAssets.json')));
  const frozen=JSON.parse(await readFile(path.join(root,'source-held-registry.json')));
  for(const asset of frozen.assets.filter(a=>a.id.startsWith('held-'))){const live=current.assets.find(a=>a.id===asset.id);
    if(!live||JSON.stringify(live.hashes)!==JSON.stringify(asset.hashes)||JSON.stringify(live.heldItem)!==JSON.stringify(asset.heldItem)||JSON.stringify(live.gameIds)!==JSON.stringify(asset.gameIds))throw Error('Runtime held assets changed since export: '+asset.id);}
  if(current.assets.filter(a=>a.id.startsWith('held-')).length!==m.meshes.length-1)throw Error('Runtime held catalog changed since export');
  const sourceBody=JSON.parse(await readFile(path.join(root,'source-body-selection.json'))),liveBody=current.assets.find(a=>a.id==='badger');
  if(!liveBody||liveBody.hashes.idle!==sourceBody.files[sourceBody.idle]||liveBody.hashes.sheet!==sourceBody.files[sourceBody.sheet])throw Error('Runtime badger Beauty differs from mesh source');
  const gaps=JSON.parse(await readFile(path.join(root,'review/gap-metric.json')));assertGapAcceptance(gaps);
  if(gaps.samples!==1776||gaps.byPose.length!==37||gaps.rows.length!==1776||gaps.rows.some(r=>r.flaggedAfter))throw Error('Incomplete gap gate');
  if(!Number.isFinite(gaps.footprint?.maxAddedWorld2)||gaps.footprint.maxAddedWorld2>.125)throw Error('Missing/failed silhouette gate');
  await runTool(python,['-B',path.join(repo,'scripts/asset-pipeline/archive-character-passes.py'),'--verify',path.join(root,'source-bundle.zip'),receipt.selectionSha256],repo);
  const manifest=runtimeMeshManifest(m,selection,receipt),destination=path.join(repo,'public',manifest.publication.folder),manifestFile=path.join(repo,'src/assets/manifests',`character-mesh-badger-${m.revision}.json`);
  const copies=[];
  for(const [i,mesh] of m.meshes.entries())for(const key of ['positions','indices']){const bytes=await readFile(path.join(root,safeFile(mesh[key].file)));
    if(hash(bytes)!==mesh[key].sha256)throw Error('Binary changed before import');copies.push({bytes,file:path.join(repo,'public',manifest.meshes[i][key].file)});}
  for(const target of [destination,manifestFile]){if(await access(target).then(()=>true,()=>false))throw Error('Immutable destination exists '+target);
    let parent=path.dirname(target);while(!(await access(parent).then(()=>true,()=>false)))parent=path.dirname(parent);
    const rel=path.relative(await realpath(repo),await realpath(parent));if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Destination escapes repo');}
  if(apply){await mkdir(path.dirname(destination),{recursive:true});await mkdir(destination);
    for(const c of copies)await writeFile(c.file,c.bytes,{flag:'wx'});
    const text=JSON.stringify(manifest,null,2)+'\n';await writeFile(path.join(destination,'manifest.json'),text,{flag:'wx'});await writeFile(manifestFile,text,{flag:'wx'});
    for(const c of copies)if(hash(await readFile(c.file))!==hash(c.bytes))throw Error('Import readback failed');}
  return {status:apply?'imported-for-22c':'dry-run-no-writes',destination,manifestFile,meshCount:m.meshes.length,downloadBytes:manifest.downloadBytes,gpuFloat32Bytes:manifest.gpuFloat32Bytes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{apply:{type:'boolean',default:false},python:{type:'string'}}});
  if(positionals.length!==1)throw Error('Usage: node import-character-mesh.mjs <revision-folder> [--apply]');
  console.log(JSON.stringify(await importCharacterMesh(path.resolve(positionals[0]),values),null,2));
}
