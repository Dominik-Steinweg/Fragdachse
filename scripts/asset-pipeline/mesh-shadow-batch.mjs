import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export function validateWeaponBatch(report,expectedIds,{requirePass=true}={}) {
  check(report.schema==='fd-weapon-batch'&&report.version===1,'Unknown weapon batch');
  check(new Set(expectedIds).size===expectedIds.length&&expectedIds.length>0,'Invalid expected weapons');
  check(JSON.stringify(report.expectedIds)===JSON.stringify(expectedIds)&&report.evaluated===expectedIds.length&&report.rows.length===expectedIds.length,'Incomplete weapon batch');
  const remaining=new Set(expectedIds);
  for(const row of report.rows){check(remaining.delete(row.asset)&&['passed','failed'].includes(row.status),'Duplicate/unknown weapon result');
    if(row.status==='failed')check(typeof row.error==='string'&&row.error.length>0,'Missing weapon failure reason');}
  check(report.passed===report.rows.filter(r=>r.status==='passed').length&&report.failed===report.rows.filter(r=>r.status==='failed').length,'Weapon batch count mismatch');
  if(requirePass)check(report.failed===0,'Weapon batch has failures');
  return report;
}
async function optional(file){try{return await readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
/** Failed runs stay unpublishable, but all available diagnostics are visible on C:. */
export async function mirrorWeaponDiagnostics(root,destination,expectedIds) {
  for(const id of expectedIds)check(/^held-[a-z0-9-]+$/.test(id),'Unsafe weapon ID');
  const bytes=await optional(path.join(root,'weapon-batch-report.json'));
  let report;
  if(bytes)report=validateWeaponBatch(JSON.parse(bytes),expectedIds,{requirePass:false});
  else {
    const rows=[];
    for(const id of expectedIds){const b=await optional(path.join(root,'weapon-batch',id+'.json'));rows.push(b?JSON.parse(b):{asset:id,status:'not-evaluated'});}
    report={schema:'fd-weapon-batch-interrupted',expectedIds,rows,evaluated:rows.filter(r=>r.status!=='not-evaluated').length,
      passed:rows.filter(r=>r.status==='passed').length,failed:rows.filter(r=>r.status==='failed').length};
  }
  await mkdir(path.dirname(destination),{recursive:true});await mkdir(destination);
  await writeFile(path.join(destination,'weapon-batch-report.json'),bytes??JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await mkdir(path.join(destination,'weapon-quality'));
  for(const id of expectedIds)for(const ext of ['json','png']){
    const source=path.join(root,'weapon-quality',id+'.'+ext),content=await optional(source);
    if(content)await writeFile(path.join(destination,'weapon-quality',id+'.'+ext),content,{flag:'wx'});
  }
  await copyFile(path.join(root,'blender.log'),path.join(destination,'blender.log'),constants.COPYFILE_EXCL);
  return report;
}
