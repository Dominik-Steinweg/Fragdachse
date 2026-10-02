import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateWeaponBatch,mirrorWeaponDiagnostics} from './mesh-shadow-batch.mjs';
const ids=Array.from({length:28},(_,i)=>'held-'+i);
const report={schema:'fd-weapon-batch',version:1,expectedIds:ids,evaluated:28,passed:27,failed:1,
  rows:ids.map((asset,i)=>i===0?{asset,status:'failed',error:'silhouette gate'}:{asset,status:'passed'})};
assert.equal(validateWeaponBatch(report,ids,{requirePass:false}),report);
assert.throws(()=>validateWeaponBatch(report,ids),/failures/);
for(const mutate of [r=>r.rows.pop(),r=>r.rows[1]=r.rows[0],r=>r.passed=28,r=>r.rows[0].error='']){
  const bad=structuredClone(report);mutate(bad);assert.throws(()=>validateWeaponBatch(bad,ids,{requirePass:false}));
}
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),parent=path.join(repo,'build/player-shadow/mesh-prod');
await mkdir(parent,{recursive:true});const root=path.join(parent,'batch-selfcheck-'+Date.now());await mkdir(root);
const source=path.join(root,'source');await mkdir(source);await mkdir(path.join(source,'weapon-quality'));
await writeFile(path.join(source,'blender.log'),'SYNTHETIC batch test; no Blender');
await writeFile(path.join(source,'weapon-batch-report.json'),JSON.stringify(report));
await writeFile(path.join(source,'weapon-quality/held-0.json'),'synthetic failure evidence');
const before=await readFile(path.join(source,'weapon-batch-report.json'));
await mirrorWeaponDiagnostics(source,path.join(root,'review'),ids);
assert.deepEqual(await readFile(path.join(root,'review/weapon-batch-report.json')),before);
assert.deepEqual(await readFile(path.join(source,'weapon-batch-report.json')),before);
assert.equal(await readFile(path.join(root,'review/weapon-quality/held-0.json'),'utf8'),'synthetic failure evidence');
const interrupted=path.join(root,'interrupted');await mkdir(interrupted);await mkdir(path.join(interrupted,'weapon-batch'));
await writeFile(path.join(interrupted,'blender.log'),'SYNTHETIC native interruption');
await writeFile(path.join(interrupted,'weapon-batch/held-0.json'),JSON.stringify(report.rows[0]));
const partial=await mirrorWeaponDiagnostics(interrupted,path.join(root,'partial-review'),ids);
assert.equal(partial.evaluated,1);assert.equal(partial.rows.filter(r=>r.status==='not-evaluated').length,27);
console.log(JSON.stringify({status:'passed',scope:'batch completeness, strict rejection, failure/partial diagnostic mirroring',root}));
