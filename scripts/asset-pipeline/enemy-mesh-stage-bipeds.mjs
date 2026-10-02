/** Stage the already audited biped repair into the same 31-pose enemy contract. */
import fs from 'node:fs/promises';import path from 'node:path';import{selectedEnemySource,enemyFileHash}from'./enemy-mesh-sources.mjs';
const [revision,bipedRevision]=process.argv.slice(2);if(!/^enemy-mesh-r4-\d+$/.test(revision)||!/^player-r2-\d+$/.test(bipedRevision))throw Error('Explicit revisions required');
for(const id of ['alien-badger','pyro-badger']){
 const original=path.join('D:/Fragdachse-render',bipedRevision,id),output=path.join('D:/Fragdachse-render',revision,id),g=JSON.parse(await fs.readFile(path.join(original,'geometry.json'),'utf8'));
 const pilot={id,sourceRevision:'v2-claw-leap-a',sourceContract:'enemy-mesh-bipeds.json',family:'biped',rig:'Locomotion rig'};
 const job=await selectedEnemySource(process.cwd(),pilot);if(g.source.blendSha256!==job.sourceFiles['source.blend']||g.sourceQa.quick||g.sourceQa.samples!==118||g.sourceQa.afterFailures)throw Error('Unbound biped repair');
 if(await fs.access(path.join(output,'job.json')).then(()=>true,()=>false))throw Error('Biped staging already sealed');
 for(const dir of [output,path.join(output,'intermediate'),path.join(output,'biped-evidence'),path.join(output,'source-tools')])await fs.mkdir(dir,{recursive:true});
 for(const file of await fs.readdir('scripts/asset-pipeline'))if(file.endsWith('.py')){const member='source-tools/'+file,source=path.join('scripts/asset-pipeline',file),sha256=await enemyFileHash(source);job.sourceFiles[member]=sha256;job.files.push({member,file:source,sha256});}
 for(const e of job.files){const dest=path.join(output,e.member);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(e.file,dest);if(await enemyFileHash(dest)!==e.sha256)throw Error('Staging changed input');}
 for(const file of ['geometry.json','source-corridors.json','decoded-corridors.json'])await fs.copyFile(path.join(original,file),path.join(output,'biped-evidence',file));
 await fs.copyFile(path.join(original,'source.blend'),path.join(output,'candidate.blend'));if(await enemyFileHash(path.join(output,'candidate.blend'))!==g.repairedBlendSha256)throw Error('Changed repaired biped');
 for(const key of ['positions','indices']){const dest=path.join(output,g.mesh[key].file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(original,g.mesh[key].file),dest);}
 const {files,...bound}=job;await fs.writeFile(path.join(output,'job.json'),JSON.stringify({...bound,revision,outputRoot:path.dirname(output),bipedEvidence:original},null,2));
}
