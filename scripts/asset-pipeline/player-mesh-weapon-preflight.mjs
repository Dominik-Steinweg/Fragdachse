/** Read all selected sources and existing QA evidence; never starts Blender or writes D:. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {selectedHeldSources} from './mesh-shadow-sources.mjs';
import {hash,safeFile,validateWeaponQuality,weaponMeshLimits} from './mesh-shadow-contract.mjs';
import {fileHash,runTool} from './character-pass-bundle.mjs';
export async function preflightHeldWeapons(previous,python='D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'){
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sources=await selectedHeldSources(repo);
  const job=JSON.parse(await readFile(path.join(previous,'job.json'))),rows=[];
  for(const asset of sources){const row={asset:asset.id,source:asset.folder};
    try{
      const selectionBytes=await readFile(path.join(asset.folder,'selection.json')),s=JSON.parse(selectionBytes),variant=safeFile(s.variant);
      const blend=path.join(asset.folder,variant,'asset.blend'),renderFile=path.join(asset.folder,variant,'render.json');
      const blendSha=await fileHash(blend),renderBytes=await readFile(renderFile),render=JSON.parse(renderBytes);
      if(blendSha!==s.files[`${variant}/asset.blend`]||hash(renderBytes)!==s.files[`${variant}/render.json`]
        ||render.id!==asset.id||render.frames.length!==1||!['held-weapon','held-utility'].includes(render.recipe))throw Error('Selected source mismatch');
      if(JSON.stringify(render.heldItem.grip)!==JSON.stringify(asset.heldItem.grip)||JSON.stringify(render.heldItem.muzzle)!==JSON.stringify(asset.heldItem.muzzle))throw Error('Registry anchor mismatch');
      await runTool(python,['-B',path.join(repo,'scripts/asset-pipeline/archive-character-passes.py'),'--verify',path.join(asset.folder,'source-bundle.zip'),hash(selectionBytes)],repo);
      row.sourceVerified=true;
      const prior=job.weapons.find(w=>w.render.id===asset.id);
      if(!prior||job.sourceFiles[`source-${prior.role}.blend`]!==blendSha||job.sourceFiles[`source-${prior.role}-render.json`]!==hash(renderBytes)){
        row.gate='not-evaluated-source-changed';rows.push(row);continue;
      }
      let bytes;
      try{bytes=await readFile(path.join(previous,'weapon-quality',asset.id+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;row.gate='not-evaluated';rows.push(row);continue;}
      const q=JSON.parse(bytes),mesh={id:asset.id,budget:q.budget};weaponMeshLimits(mesh);
      const sourceBounds=q.sourceBoundsWorld;
      if(!sourceBounds||q.asset!==asset.id||q.rows?.length!==49||q.density!==3||q.minIou!==.95||q.edgeTolerancePixels!==2)throw Error('Unrecognized prior QA');
      const image=await readFile(path.join(previous,safeFile(q.image.file)));
      if(image.length!==q.image.bytes||hash(image)!==q.image.sha256)throw Error('Prior QA image hash mismatch');
      row.priorReportSha256=hash(bytes);row.evidence='previous unsealed run; same selected Blend/render hashes; not an r3 geometry result';
      row.minimumIou=Math.min(...q.rows.map(r=>r.iou));
      row.failedViews=q.rows.filter(r=>r.iou<.95||r.missingBeyondTolerancePixels!==0||r.extraBeyondTolerancePixels!==0);
      if(q.passed){validateWeaponQuality(mesh,q);row.gate='previous-pass';}
      else {if(!row.failedViews.length)throw Error('Inconsistent failed prior QA');row.gate='previous-fail';}
      row.lastAttempt=q.attempts.at(-1);
    }catch(error){row.gate='preflight-error';row.error=error.message;}
    rows.push(row);
  }
  const report={schema:'fd-weapon-preflight',previous,expected:sources.length,sourceVerified:rows.filter(r=>r.sourceVerified).length,
    previousPassed:rows.filter(r=>r.gate==='previous-pass').length,previousFailed:rows.filter(r=>r.gate==='previous-fail').length,
    notEvaluated:rows.filter(r=>r.gate.startsWith('not-evaluated')).length,errors:rows.filter(r=>r.gate==='preflight-error').length,
    note:'All selected inputs checked, including archive readback. Missing evaluated source/proxy geometry cannot be gate-tested without Blender. r3 evaluates every weapon before rejecting the batch.',rows};
  const parent=path.join(repo,'build/player-shadow/mesh-prod');await mkdir(parent,{recursive:true});const destination=path.join(parent,'r3-preflight-'+Date.now());await mkdir(destination);
  await writeFile(path.join(destination,'weapons.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(destination,'weapons.csv'),'asset,sourceVerified,gate,minimumIou\n'+rows.map(r=>[r.asset,!!r.sourceVerified,r.gate,r.minimumIou??''].join(',')).join('\n')+'\n',{flag:'wx'});
  return {...report,destination};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{previous:{type:'string',default:'D:/Fragdachse-render/player-mesh-22-production-r2'},python:{type:'string'}}});
  const {rows,...summary}=await preflightHeldWeapons(values.previous,values.python);console.log(JSON.stringify(summary,null,2));if(summary.errors)process.exitCode=1;
}
