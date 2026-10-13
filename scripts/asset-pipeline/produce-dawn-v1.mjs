// Sequential production preparation only: no selection, ZIP archive or runtime import.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, access, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { exportVariantV2 } from './export-v2.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {values,positionals}=parseArgs({allowPositionals:true,options:{output:{type:'string'},revision:{type:'string'},blender:{type:'string'}}});
if(!values.output || !/^[a-z0-9][a-z0-9-]*$/.test(values.revision??''))throw Error('Required: --output <dedicated directory> --revision <new revision> [asset IDs]');
const base=path.resolve(values.output), revision=values.revision, blender=values.blender??process.env.BLENDER_PATH;
if(!blender)throw Error('BLENDER_PATH or --blender required');
const ids=positionals.length?positionals:['construction_dawn_wreck_t1','construction_dawn_wreck_t2','construction_dawn_wreck_t3','construction_dawn_extractor','dawn_scrap_t1','dawn_scrap_t2','dawn_scrap_t3','construction_dawn_dealer_stall','dawn_dealer'];
if(ids.some(id=>!/^[a-z][a-z0-9_-]*$/.test(id)))throw Error('Invalid asset ID');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
await mkdir(path.join(base,'verification',revision),{recursive:true});
await mkdir(path.join(base,'logs'),{recursive:true});
async function run(args,log){
 const stream=createWriteStream(log);
 try{await new Promise((resolve,reject)=>{
  const child=spawn(blender,args,{cwd:repo,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',CUDA_CACHE_PATH:path.join(base,'cache/cuda')}});
  child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`Blender failed (${code}); see ${log}`)));
 });}finally{await new Promise(resolve=>stream.end(resolve));}
}
const results=[];
for(const id of ids){
 const disk=await statfs(base);if(disk.bavail*disk.bsize<2*1024**3)throw Error('Less than 2 GiB free; stopped before next asset');
 const asset=path.join(base,'runs',revision,id), folder=path.join(asset,'standard');
 if(!await exists(path.join(asset,'build.json'))){
  console.log(`${id}: build 1024 masters`);
  await run(['-b','--python-exit-code','1','--python','scripts/asset-pipeline/blender_pipeline_v2.py','--','--repo',repo,'--asset',id,'--revision',revision,'--device','OPTIX','--output-root',base],path.join(base,'logs',`${revision}-${id}-build.log`));
 }
 const manifest=JSON.parse(await readFile(path.join(folder,'render.json'),'utf8'));
 // Resume only the same current source snapshot, never silently mix revisions.
 for(const [relative,digest] of Object.entries(manifest.sources))if(hash(await readFile(path.join(repo,relative)))!==digest)throw Error(`Current source differs from ${revision}: ${relative}`);
 console.log(`${id}: export + master/hash/alpha checks`);
 const exported=await exportVariantV2(folder,repo);
 const reportFile=path.join(base,'verification',revision,`${id}.json`);
 if(!await exists(reportFile)){
  console.log(`${id}: independent saved-Blend verification`);
  await run(['-b',path.join(folder,'asset.blend'),'--python-exit-code','1','--python','tests/assets/verify_asset_pipeline_v2.py','--','--manifest',path.join(folder,'render.json'),'--report',reportFile],path.join(base,'logs',`${revision}-${id}-verify.log`));
 }
 const report=JSON.parse(await readFile(reportFile,'utf8'));
 if(report.status!=='passed'||report.blendSha256!==exported.blendSha256||report.manifestSha256!==hash(await readFile(path.join(folder,'render.json'))))throw Error(`Invalid verification receipt: ${id}`);
 results.push({id,revision,folder,frames:manifest.frames.length,sourceSizes:manifest.sourceSizes,verification:reportFile,manifestSha256:report.manifestSha256});
 await writeFile(path.join(base,`build-summary-${revision}.json`),JSON.stringify({revision,results},null,2)+'\n');
 console.log(`${id}: PASS`);
}
