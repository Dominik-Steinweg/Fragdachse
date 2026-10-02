/** Pipeline-only real-data regression. No Blender, runtime import, or D: writes. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMeshBundle, decodePositions, decodeIndices, hash } from './mesh-shadow-contract.mjs';
import { repairLegConnections, quantizeRepairedMesh, writeRepairedProduction } from './mesh-shadow-repair.mjs';
import { gapMetric, assertGapAcceptance, repairFootprintMetric } from './mesh-shadow-gap-metric.mjs';
import { selectedHeldSources } from './mesh-shadow-sources.mjs';
import { runtimeMeshManifest } from './import-character-mesh.mjs';
import { reviewMeshShadow } from './review-mesh-shadow.mjs';
const {values}=parseArgs({options:{pilot:{type:'string',default:'D:/Fragdachse-render/player-mesh-22b-pilot2'},review:{type:'boolean',default:false}}});
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.resolve(values.pilot);
const {manifest,meshes}=await loadMeshBundle(root),body=meshes.get('badger'),fixed=repairLegConnections(body);
const q=quantizeRepairedMesh(fixed),spec={...fixed.spec,bounds:{min:q.lo,max:q.hi},positions:{file:'fixed-positions.bin',bytes:q.positions.length,sha256:hash(q.positions)},
  indices:{file:'fixed-indices.bin',bytes:q.indices.length,sha256:hash(q.indices),encoding:'uint16-le-triangles'},topologySha256:hash(q.indices),downloadBytes:q.positions.length+q.indices.length,
  gpuFloat32Bytes:q.positions.length*2+q.indices.length};
const decoded={spec,indices:decodeIndices(spec,q.indices),poses:spec.poseIndices.map((_,i)=>decodePositions(spec,q.positions,i))};
assert.equal(spec.vertexCount-body.spec.vertexCount,fixed.repair.addedVertices);
assert.equal(spec.triangleCount-body.spec.triangleCount,fixed.repair.addedTriangles);
assert.ok(spec.vertexCount<=2000&&spec.triangleCount<=4000,'Repaired body exceeds contract budget');
assert.deepEqual(decoded.indices.slice(0,body.indices.length),body.indices);
for(let pose=0;pose<37;pose++)for(let i=0;i<body.poses[pose].length;i++)assert.ok(Math.abs(decoded.poses[pose][i]-body.poses[pose][i])<.001,'Original body moved');
assert.ok(fixed.repair.evidence.every(e=>e.radiiWorld[0]<e.endpointClearanceWorld[0]&&e.radiiWorld[3]<e.endpointClearanceWorld[1]));
const gaps=gapMetric(body,decoded);assert.ok(gaps.before>0,'Regression source must actually exhibit leg gaps');assertGapAcceptance(gaps);
gaps.footprint=repairFootprintMetric(body,decoded);assert.ok(gaps.footprint.maxAddedWorld2<=.125,'Repair widens silhouette');
assert.throws(()=>assertGapAcceptance({...gaps,after:1}),/Leg gap gate/);
assert.equal(gaps.samples,37*16*3);
const boundary=gapMetric(body,decoded,{elevations:[20,60]});
const sources=await selectedHeldSources(repo),registry=JSON.parse(await readFile(path.join(repo,'src/config/pipelineAssets.json')));
assert.equal(sources.length,registry.assets.filter(a=>a.id.startsWith('held-')).length);
const production={...manifest,status:'production-unreviewed',revision:'player-mesh-selfcheck',meshes:[spec,...manifest.meshes.slice(1)],shadowRepair:{...fixed.repair,baseline:body.spec}};
const runtime=runtimeMeshManifest(production,{schema:'fd-character-mesh-selection',status:'production-unreviewed',id:'badger',revision:production.revision},{selectionSha256:'a'.repeat(64),archiveSha256:'b'.repeat(64)});
assert.equal(runtime.meshes[0].positions.url.split('?v=')[1],hash(q.positions));assert.ok(!('audit' in runtime.meshes[0]));assert.ok(!('baseline' in runtime.shadowRepair));
assert.throws(()=>runtimeMeshManifest({...production,status:'pilot-unreviewed'},{},{}));
const parent=path.join(repo,'build/player-shadow/mesh-prod');await mkdir(parent,{recursive:true});const destination=path.join(parent,'preflight-'+Date.now());await mkdir(destination);
await writeFile(path.join(destination,'gap-metric.json'),JSON.stringify(gaps,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(destination,'boundary-metric.json'),JSON.stringify(boundary,null,2)+'\n',{flag:'wx'});
// Exercise the real production writer and source-closure validator with a marked,
// single-weapon fixture. The runtime importer rejects this subset against the live registry.
const fixture=path.join(destination,'fixture');await mkdir(fixture);const sourceFiles={};
for(const file of ['source-body-render.json','source-body-selection.json','source-weapon.blend','source-weapon-render.json','source-weapon-selection.json','source-weapon-bundle.zip']){
  const bytes=await readFile(path.join(root,file));await writeFile(path.join(fixture,file),bytes);sourceFiles[file]=hash(bytes);
}
for(const [name,source] of [['source-held-registry.json','src/config/pipelineAssets.json'],['source-catalog.json','scripts/asset-pipeline/catalog-v2.json']]){
  const data=JSON.parse(await readFile(path.join(repo,source)));data.assets=data.assets.filter(a=>a.id==='held-glock');
  const bytes=Buffer.from(JSON.stringify(data));await writeFile(path.join(fixture,name),bytes);sourceFiles[name]=hash(bytes);
}
const baseManifest={...manifest,sourceFiles,meshes:manifest.meshes.map(m=>m.id==='badger'?m:{...m,gameIds:['GLOCK'],sourceRole:'weapon'})};
for(const mesh of baseManifest.meshes)for(const f of [mesh.positions,mesh.indices]){await mkdir(path.dirname(path.join(fixture,f.file)),{recursive:true});await copyFile(path.join(root,f.file),path.join(fixture,f.file));}
await writeFile(path.join(fixture,'mesh-base-manifest.json'),JSON.stringify(baseManifest));
const written=await writeRepairedProduction(fixture);
assert.equal(written.manifest.meshes[0].positions.sha256,spec.positions.sha256);
assert.equal(written.manifest.meshes[0].indices.sha256,spec.indices.sha256);
assert.equal(written.manifest.downloadBytes,written.manifest.meshes.reduce((sum,m)=>sum+m.downloadBytes,0));
if(values.review){
  // Small local fixture uses only the existing accepted body/Glock. The 28 real weapon exports remain Claude's job.
  const job=JSON.parse(await readFile(path.join(root,'job.json'))),render=JSON.parse(await readFile(path.join(root,'source-body-render.json')));
  job.beauties={};for(const pose of [4,5,10,11]){const file=`beauty-${pose}.png`;job.beauties[pose]=file;
    const source=path.join(repo,'art/poc/pipeline-v2/runs/v2-ai/badger',render.variant,render.frames[pose].file);
    assert.equal(hash(await readFile(source)),render.frames[pose].sha256);await copyFile(source,path.join(fixture,file));}
  await copyFile(path.join(root,job.weapon.beauty),path.join(fixture,'weapon.png'));job.weapon.beauty='weapon.png';job.weapons=[job.weapon];
  await copyFile(path.join(root,'source-ground.png'),path.join(fixture,'source-ground.png'));await writeFile(path.join(fixture,'job.json'),JSON.stringify(job));
  await reviewMeshShadow(fixture,path.join(destination,'review'),{production:true});
}
const summary={status:'offline-pilot-regression-passed-not-production-export',destination,vertices:spec.vertexCount,triangles:spec.triangleCount,
  bodyDownloadBytes:spec.downloadBytes,bodyGpuFloat32Bytes:spec.gpuFloat32Bytes,addedDownloadBytes:spec.downloadBytes-body.spec.downloadBytes,
  gap:{samples:gaps.samples,before:gaps.before,after:gaps.after,byElevation:gaps.byElevation,byPose:gaps.byPose},boundary:{samples:boundary.samples,before:boundary.before,after:boundary.after},heldSources:sources.map(s=>s.id)};
await writeFile(path.join(destination,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary,null,2));
