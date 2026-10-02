import { readFile, readdir, realpath, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { selectedEnemySource, enemyFileHash } from './enemy-mesh-sources.mjs';
import { ENEMY_MESH_VIEWS } from './enemy-mesh-contract.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: { revision: { type: 'string', default: 'enemy-mesh-r1-001' },
  plan: { type: 'boolean', default: false }, geometry: { type: 'boolean', default: false },
  render: { type: 'boolean', default: false },
  'reuse-source': {type:'string'},
  blender: { type: 'string', default: 'D:/Blender Foundation/Blender 5.2/blender.exe' } } });
if (!/^enemy-mesh-[a-z0-9-]+$/.test(values.revision) || [values.plan,values.geometry,values.render].filter(Boolean).length!==1)
  throw Error('Choose --plan, --geometry (fresh revision), or --render (existing geometry revision)');
const pilot = JSON.parse(await readFile(path.join(repo, 'scripts/asset-pipeline/enemy-mesh-pilot.json'), 'utf8'));
const jobs = [];
for (const item of pilot.assets) {
  const job=await selectedEnemySource(repo,item);
  if(values['reuse-source']){
    if(!/^enemy-mesh-[a-z0-9-]+$/.test(values['reuse-source'])||values['reuse-source']===values.revision)throw Error('Invalid source review reuse');
    job.reuseSourceReview=values['reuse-source'];
  }
  jobs.push(job);
}
const sourceDirectory = path.join(repo, 'scripts/asset-pipeline');
const tools = (await readdir(sourceDirectory)).filter(file => file.endsWith('.py') || file.startsWith('enemy-mesh-'));
for (const job of jobs) for (const file of tools) {
  const member = 'source-tools/' + file, source = path.join(sourceDirectory, file), sha256 = await enemyFileHash(source);
  job.sourceFiles[member] = sha256; job.files.push({ member, file: source, sha256 });
}
const outputRoot = path.join('D:/Fragdachse-render', values.revision);
if (values.render) {
  for (const source of jobs) {
    const output=path.join(outputRoot,source.id), jobFile=path.join(output,'job.json');
    const job=JSON.parse(await readFile(jobFile,'utf8'));
    const receipt=JSON.parse(await readFile(path.join(output,'geometry-receipt.json'),'utf8'));
    if(receipt.status!=='source-and-proxy-corridors-passed')throw Error('Geometry did not pass');
    for(const [member,sha] of Object.entries(job.sourceFiles))if(await enemyFileHash(path.join(output,member))!==sha)throw Error('Changed staged input');
    const directory=path.join(output,'render-tools');await mkdir(directory,{recursive:true});
    const member='enemy_mesh_render.py', target=path.join(directory,member);
    const contents=await readFile(path.join(sourceDirectory,member));
    try { await writeFile(target,contents,{flag:'wx'}); }
    catch(error){if(error.code!=='EEXIST'||!contents.equals(await readFile(target)))throw error;}
    try {
      const completed=JSON.parse(await readFile(path.join(output,'render-passes.json'),'utf8'));
      if(completed.frames.length!==31||completed.rendererSha256!==await enemyFileHash(target))throw Error('Completed render provenance differs');
      for(const frame of completed.frames)if(await enemyFileHash(path.join(output,'beauty/masters',`frame-${String(frame.index).padStart(4,'0')}.png`))!==frame.beautySha256)throw Error('Changed Beauty master');
      console.log(`FD_ENEMY_RENDER_REUSED ${source.id}`);continue;
    } catch(error){if(error.code!=='ENOENT')throw error;}
    const log=createWriteStream(path.join(output,'render.log'),{flags:'a'});
    try {
      await new Promise((resolve,reject)=>{
        const child=spawn(values.blender,['--factory-startup','-b','--python-exit-code','1','--python',target,'--','--job',jobFile],
          {cwd:output,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TEMP:path.join(output,'intermediate'),TMP:path.join(output,'intermediate')}});
        child.stdout.on('data',data=>{log.write(data);for(const line of String(data).split('\n'))if(line.startsWith('FD_ENEMY_'))console.log(line);});
        child.stderr.on('data',data=>log.write(data));child.on('error',reject);
        child.on('close',code=>code===0?resolve():reject(Error(`Enemy render failed (${code}); see ${output}/render.log`)));
      });
    } finally {await new Promise(resolve=>log.end(resolve));}
  }
} else if (values.plan) {
  console.log(JSON.stringify({ status: 'preflight-only', outputRoot, geometryOnly: true,
    jobs: jobs.map(j => ({ id: j.id, coordinates: j.coordinates, poses: j.poses.length,
      reviewSamples: j.reviewSamples.length, views: ENEMY_MESH_VIEWS.length + 1,
      sourceFiles: j.sourceFiles })), pending: ['Blender export', 'Beauty/Albedo/Normal', 'review sheets', 'visual acceptance'] }, null, 2));
} else {
  const parent = await realpath('D:/Fragdachse-render');
  if (path.resolve(parent).toLowerCase() !== path.resolve('D:/Fragdachse-render').toLowerCase())
    throw Error('External output root must not be redirected');
  await mkdir(outputRoot); // Existing revisions, including junctions, fail. Never delete/resume.
  const staged=[];
  for (const job of jobs) {
    const output = path.join(outputRoot, job.id);
    await mkdir(output); await mkdir(path.join(output, 'intermediate'));
    for (const entry of job.files) {
      const target = path.join(output, entry.member);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(entry.file, target, constants.COPYFILE_EXCL);
      if (await enemyFileHash(target) !== entry.sha256) throw Error('Enemy input changed while staging');
    }
    const { files, ...bound } = job;
    const jobFile = path.join(output, 'job.json');
    await writeFile(jobFile, JSON.stringify({ ...bound, revision: values.revision, outputRoot }, null, 2) + '\n', { flag: 'wx' });
    staged.push({output,jobFile});
  }
  for(const {output,jobFile} of staged){
    const log = createWriteStream(path.join(output, 'geometry.log'), { flags: 'wx' });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(values.blender, ['--factory-startup', '-b', '--python-exit-code', '1', '--python',
          path.join(output, 'source-tools/enemy_mesh_export.py'), '--', '--job', jobFile],
        { cwd: output, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
          TEMP: path.join(output, 'intermediate'), TMP: path.join(output, 'intermediate') } });
        child.stdout.on('data', data => { log.write(data); for (const line of String(data).split('\n'))
          if (line.startsWith('FD_ENEMY_')) console.log(line); });
        child.stderr.on('data', data => log.write(data)); child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(Error(`Enemy geometry failed (${code}); see ${output}/geometry.log`)));
      });
    } finally { await new Promise(resolve => log.end(resolve)); }
  }
}
