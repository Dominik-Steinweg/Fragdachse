import { readFile, writeFile, mkdir, copyFile, readdir, realpath } from 'node:fs/promises';
import { createWriteStream, constants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MESH_COORDINATES, PILOT_POSES, hash, safeFile, loadMeshBundle } from './mesh-shadow-contract.mjs';
import { fileHash, runTool } from './character-pass-bundle.mjs';
import { reviewMeshShadow } from './review-mesh-shadow.mjs';
import { selectedHeldSources } from './mesh-shadow-sources.mjs';
import { writeRepairedProduction } from './mesh-shadow-repair.mjs';
import { mirrorWeaponDiagnostics } from './mesh-shadow-batch.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {values}=parseArgs({options:{
  revision:{type:'string',default:'player-mesh-22b-pilot'},plan:{type:'boolean',default:false},
  'review-only':{type:'boolean',default:false},
  production:{type:'boolean',default:false},
  blender:{type:'string',default:'D:/Blender Foundation/Blender 5.2/blender.exe'},
  python:{type:'string',default:'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'},
  'body-source':{type:'string',default:'art/poc/pipeline-v2/runs/v2-ai/badger'},
  'weapon-source':{type:'string',default:'art/poc/pipeline-v2/runs/v2-aj/held-glock'},
  'd-source':{type:'string',default:'D:/Fragdachse-render/player-shadow-21c-production'},
}});
if(!/^player-mesh-[a-z0-9-]+$/.test(values.revision))throw Error('Use a new player-mesh-* revision');
const outputRoot=await realpath('D:/Fragdachse-render'),output=path.join(outputRoot,values.revision);
const reviewParent=path.join(repo,'build/player-shadow',values.production?'mesh-prod':'mesh-pilot'),localReview=path.join(reviewParent,values.revision);
if(values['review-only']) {
  if(values.plan)throw Error('Use either --plan or --review-only');
  await mkdir(reviewParent,{recursive:true});
  await reviewMeshShadow(output,localReview,{production:values.production});console.log(JSON.stringify({review:localReview}));
} else {
  const staged=new Map(),sourceFiles={};
  async function stage(name,source,expected) {
    safeFile(name);const sha=await fileHash(source);
    if(expected&&sha!==expected)throw Error('Source hash mismatch: '+source);
    if(staged.has(name))throw Error('Duplicate source member');
    staged.set(name,path.resolve(source));sourceFiles[name]=sha;
  }
  async function selected(role,folder) {
    folder=path.resolve(repo,folder);
    const selectionPath=path.join(folder,'selection.json'),s=JSON.parse(await readFile(selectionPath));
    safeFile(s.variant);
    const base=path.join(folder,s.variant),renderFile=path.join(base,'render.json'),r=JSON.parse(await readFile(renderFile));
    if(s.id!==r.id||s.revision!==r.revision||s.variant!==r.variant)throw Error('Foreign selection');
    for(const name of ['asset.blend','render.json']) {
      const expected=s.files[`${s.variant}/${name}`];if(!expected)throw Error('Unselected source '+name);
      await stage(`source-${role}${name==='asset.blend'?'.blend':'-render.json'}`,path.join(base,name),expected);
    }
    await stage(`source-${role}-selection.json`,selectionPath);
    await stage(`source-${role}-bundle.zip`,path.join(folder,'source-bundle.zip'));
    return {render:r,base,selection:s};
  }
  const body=await selected('body',values['body-source']);
  const requests=values.production?await selectedHeldSources(repo):[{folder:values['weapon-source'],role:'weapon',gameIds:[]}],weapons=[];
  for(const request of requests){const role=request.role??request.id;
    const w=await selected(role,request.folder);
    if(!w.render.id.startsWith('held-')||!['held-weapon','held-utility'].includes(w.render.recipe)||w.render.frames.length!==1)throw Error('Expected static held recipe');
    if(values.production&&(JSON.stringify(w.render.heldItem.grip)!==JSON.stringify(request.heldItem.grip)||JSON.stringify(w.render.heldItem.muzzle)!==JSON.stringify(request.heldItem.muzzle)))throw Error('Held anchors differ from imported registry');
    const f=w.render.frames[0],beauty=`source-beauty/${role}.png`;safeFile(f.file);
    if(w.selection.files[`${w.render.variant}/${f.file}`]!==f.sha256)throw Error('Unselected weapon beauty');
    await stage(beauty,path.join(w.base,f.file),f.sha256);
    weapons.push({role,render:w.render,beauty,gameIds:request.gameIds});
  }
  const weapon=weapons[0],reviewPoses=values.production?[4,5,10,11]:PILOT_POSES;
  if(body.render.id!=='badger'||body.render.frames.length!==37||body.render.frames.some((f,i)=>f.index!==i))throw Error('Expected 37 badger poses');
  const poses=body.render.frames.map(f=> {const clip=body.render.clips.find(c=>c.frames.includes(f.index));return {index:f.index,blenderFrame:f.blenderFrame,
    clip:clip?.name??'rest',clipFrame:clip?.frames.indexOf(f.index)??0,beautySha256:f.sha256};});
  const beauties={};
  for(const i of (values.production?body.render.frames.map(f=>f.index):PILOT_POSES)) {
    const f=body.render.frames[i],name=`source-beauty/body-${i}.png`;safeFile(f.file);
    if(body.selection.files[`${body.render.variant}/${f.file}`]!==f.sha256)throw Error('Unselected beauty');
    await stage(name,path.join(body.base,f.file),f.sha256);beauties[i]=name;
  }
  await stage('source-ground.png',path.join(repo,'public/assets/sprites/gras_bg_tile.png'));
  const dFile=path.join(values['d-source'],'render-passes.json'),d=JSON.parse(await readFile(dFile));
  if(d.source.blendSha256!==sourceFiles['source-body.blend']||d.source.renderSha256!==sourceFiles['source-body-render.json'])throw Error('D reference belongs to another body source');
  await stage('source-d-render.json',dFile);
  const references=[];
  for(const pose of reviewPoses)for(let a=0;a<16;a+=2) {
    const canvasIndex=d.canvases.findIndex(c=>c.elevationIndex===1&&c.azimuthIndex===a);
    const img=d.images.find(i=>i.pass==='shadow'&&i.pose===pose&&i.canvasIndex===canvasIndex);
    if(!img||d.spec.grid.elevationDegrees[1]!==35)throw Error('Missing baked reference');
    const file=`references/p${pose}-a${a}.png`;await stage(file,path.join(values['d-source'],safeFile(img.file)),img.sha256);
    references.push({pose,azimuth:d.spec.grid.azimuthDegrees[a],canvas:d.canvases[canvasIndex],file});
  }
  const tools=['render_integrity.py','player-mesh-run.mjs','mesh_shadow_blender.py','mesh_shadow_geometry.py','mesh_shadow_geometry_selfcheck.py','mesh-shadow-contract.mjs','mesh-shadow-raster.mjs','review-mesh-shadow.mjs',
    'mesh-shadow-selfcheck.mjs','MESH-SHADOWS.md','mesh-shadows.d.ts','archive-character-passes.py','character-pass-bundle.mjs',
    'character-pass-contract.mjs','export-character-passes.mjs','mesh-shadow-sources.mjs','mesh-shadow-repair.mjs','mesh-shadow-gap-metric.mjs',
    'import-character-mesh.mjs','mesh-shadow-production-selfcheck.mjs','mesh_shadow_weapon.py','mesh_shadow_weapon_blender.py',
    'mesh_shadow_weapon_selfcheck.py','review-weapon-union.mjs','mesh-shadow-batch.mjs','mesh-shadow-batch-selfcheck.mjs','player-mesh-weapon-preflight.mjs'];
  for(const name of tools)await stage('source-tools/'+name,path.join(repo,'scripts/asset-pipeline',name));
  await stage('source-package.json',path.join(repo,'package.json'));
  await stage('source-package-lock.json',path.join(repo,'package-lock.json'));
  if(values.production){await stage('source-held-registry.json',path.join(repo,'src/config/pipelineAssets.json'));await stage('source-catalog.json',path.join(repo,'scripts/asset-pipeline/catalog-v2.json'));}
  const job={revision:values.revision,production:values.production,outputRoot,coordinates:MESH_COORDINATES,poses,sourceFiles,beauties,references,
    body:{render:body.render},weapon,weapons};
  if(values.plan) {
    console.log(JSON.stringify({status:'prepared-not-exported',output,review:localReview,body:body.render.id,weapons:weapons.map(w=>({id:w.render.id,gameIds:w.gameIds})),
      bakePoses:37,reviewPoses,bodyVertexBudget:[1000,2000],bodyTriangleBudget:[2000,4000],sourceFiles},null,2));
  } else {
    for(const role of ['body',...weapons.map(w=>w.role)])await runTool(values.python,['-B',path.join(repo,'scripts/asset-pipeline/archive-character-passes.py'),
      '--verify',staged.get(`source-${role}-bundle.zip`),sourceFiles[`source-${role}-selection.json`]],repo);
    await mkdir(output);const started=performance.now();await mkdir(path.join(output,'intermediate'));
    for(const [name,source] of staged) {
      const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target,constants.COPYFILE_EXCL);
      if(await fileHash(target)!==sourceFiles[name])throw Error('Source changed during staging: '+name);
    }
    await writeFile(path.join(output,'job.json'),JSON.stringify(job,null,2)+'\n',{flag:'wx'});
    const log=createWriteStream(path.join(output,'blender.log'),{flags:'wx'});
    let blenderFailure;
    try {await new Promise((resolve,reject)=> {
      const child=spawn(values.blender,['--factory-startup','-b','--python-exit-code','1','--python',path.join(output,'source-tools/mesh_shadow_blender.py'),
        '--','--job',path.join(output,'job.json')],{cwd:output,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TEMP:path.join(output,'intermediate'),TMP:path.join(output,'intermediate')}});
      child.stdout.on('data',bytes=>{log.write(bytes);for(const line of String(bytes).split('\n'))if(line.startsWith('FD_'))console.log(line);});
      child.stderr.on('data',bytes=>log.write(bytes));child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Blender export failed: '+code+'; '+output+'/blender.log')));
    });} catch(error){blenderFailure=error;} finally {await new Promise(resolve=>log.end(resolve));}
    if(blenderFailure){
      const batch=await mirrorWeaponDiagnostics(output,localReview,weapons.map(w=>w.render.id));
      throw Error(`${blenderFailure.message}; ${batch.evaluated}/${weapons.length} evaluated, ${batch.passed} passed, ${batch.failed} failed. Diagnostics: ${localReview}`);
    }
    const {manifest}=values.production?await writeRepairedProduction(output):await loadMeshBundle(output);
    await reviewMeshShadow(output,path.join(output,'review'),{production:values.production});
    // Guard against concurrent edits and record the exact tools actually used by Node.
    for(const [name,source] of staged)if(await fileHash(source)!==sourceFiles[name])throw Error('Input changed during export: '+name);
    await writeFile(path.join(output,'completion.json'),JSON.stringify({status:manifest.status,wallSeconds:(performance.now()-started)/1000,
      geometryWallSeconds:manifest.geometryWallSeconds,downloadBytes:manifest.meshes.reduce((s,m)=>s+m.downloadBytes,0),
      gpuFloat32Bytes:manifest.meshes.reduce((s,m)=>s+m.gpuFloat32Bytes,0)},null,2)+'\n',{flag:'wx'});
    async function inventory(dir,prefix='') {const out={};for(const e of await readdir(dir,{withFileTypes:true})) {
      if(e.isSymbolicLink())throw Error('Symlink in mesh revision');const name=prefix+e.name;
      if(e.isDirectory())Object.assign(out,await inventory(path.join(dir,e.name),name+'/'));
      else out[name]=await fileHash(path.join(dir,e.name));
    }return out;}
    const selection={schema:'fd-character-mesh-selection',version:2,id:'badger',revision:values.revision,status:manifest.status,files:await inventory(output)};
    await writeFile(path.join(output,'selection.json'),JSON.stringify(selection,null,2)+'\n',{flag:'wx'});
    await runTool(values.python,['-B',path.join(output,'source-tools/archive-character-passes.py'),'--create',output],output);
    await writeFile(path.join(output,'archive-receipt.json'),JSON.stringify({archiveSha256:await fileHash(path.join(output,'source-bundle.zip')),
      selectionSha256:await fileHash(path.join(output,'selection.json'))},null,2)+'\n',{flag:'wx'});
    await mkdir(reviewParent,{recursive:true});await mkdir(localReview);
    for(const e of await readdir(path.join(output,'review')))await copyFile(path.join(output,'review',e),path.join(localReview,e),constants.COPYFILE_EXCL);
    console.log(JSON.stringify({output,review:localReview,status:'awaiting-human-review',wallSeconds:(performance.now()-started)/1000},null,2));
  }
}
