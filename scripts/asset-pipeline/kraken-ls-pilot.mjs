import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const revision = arg('--revision') ?? 'kraken-ls-pilot-1';
if (!/^kraken-ls-pilot-\d+$/.test(revision)) throw Error('Expected new kraken-ls-pilot-<n> revision');
const root = path.resolve('art/poc/pipeline-v2/runs', revision);
const sourceRoot = path.resolve('art/poc/pipeline-v2/runs/kraken-v11b');
const hash = async p => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const roles = [
  ['water', 'abyssal-kraken', 384, [['idle', 0], ['egg-throw', 'middle'], ['ink-spit', 'spit']]],
  ['land', 'abyssal-kraken-land', 432, [['idle', 0], ['slam', 'impact']]],
  ['tentacle', 'abyssal-kraken-tentacle', 448, [['hover', 0], ['slam', 'strike']]],
  ['egg', 'abyssal-kraken-egg', 64, [['idle', 0], ['hatch', 'spawn']]],
];
if (!process.argv.includes('--resume')) await fs.mkdir(root);
const sourceAudit = [];
for (const [role,id,size,selections] of roles) {
  const source = path.join(sourceRoot,id,'standard'), out = path.join(root,id,'standard');
  await fs.mkdir(out,{recursive:true});
  const render = JSON.parse(await fs.readFile(path.join(source,'render.json'),'utf8'));
  const poses = selections.map(([clip,selector])=>{
    const c=render.clips.find(c=>c.name===clip);
    const local=selector==='middle'?Math.floor(c.frames.length/2):typeof selector==='number'?selector:c.markers[selector];
    const frame=render.frames[c.frames[local]];
    if(!frame)throw Error('Missing requested pose');
    return {name:`${clip}-${local}`,clip,clipFrame:local,...frame};
  });
  const provenance={blend:await hash(path.join(source,'asset.blend')),render:await hash(path.join(source,'render.json')),
    beauty:await Promise.all(poses.map(async p=>({file:p.file,sha256:await hash(path.join(source,p.file))})))};
  const job={revision,role,id,size,source,out,render,poses,provenance,
    helperHashes:Object.fromEntries(await Promise.all(['kraken_ls_export.py','kraken_ls_material.py'].map(async f=>[f,await hash(`scripts/asset-pipeline/${f}`)])))};
  const jobFile=path.join(out,'ls-job.json');
  if(process.argv.includes('--resume')) {
    const old=JSON.parse(await fs.readFile(jobFile,'utf8'));
    if(JSON.stringify(old)!==JSON.stringify(job))throw Error('Resume source/tool mismatch; use a new revision');
  } else await fs.writeFile(jobFile,JSON.stringify(job,null,2)+'\n');
  sourceAudit.push({id,...provenance});
  if(process.argv.includes('--plan'))continue;
  if(process.argv.includes('--resume')){try{await fs.access(path.join(out,'ls-raw.json'));continue;}catch{}}
  const log=await fs.open(path.join(out,'ls-export.log'),'a');
  const blender=arg('--blender')??'D:/Blender Foundation/Blender 5.2/blender.exe';
  const args=['-b',path.join(source,'asset.blend'),'--threads','4','--python-exit-code','1','--python',path.resolve('scripts/asset-pipeline/kraken_ls_export.py'),'--','--job',jobFile];
  const exitCode=await new Promise((resolve,reject)=>{
    const p=spawn(blender,args,{windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TEMP:out,TMP:out}});
    p.on('error',reject);p.on('exit',resolve);
  });
  await log.close();
  if(exitCode!==0)throw Error(`${id} Blender failed (${exitCode}); see ${out}/ls-export.log`);
  console.log(`Completed ${id}`);
}
await fs.writeFile(path.join(root,'sources.json'),JSON.stringify(sourceAudit,null,2)+'\n');
console.log(root);
