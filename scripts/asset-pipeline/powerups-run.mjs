import {readFile,writeFile,mkdir,copyFile,readdir,realpath,access} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import {digest,relativePath} from './character-pass-contract.mjs';
import {fileHash,runTool} from './character-pass-bundle.mjs';
import {exportVariantV2} from './export-v2.mjs';
import {inspectMaster} from './export.mjs';
import {validatePowerupSpec,verifyPowerupBundle} from './powerups-contract.mjs';
import {compositePowerup,reviewPowerups,copyPowerupReviews} from './review-powerups.mjs';
import {finishPowerupSymbol,SYMBOL_FINISH} from './powerup-symbol-finish.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {values}=parseArgs({options:{
  plan:{type:'boolean',default:false},revision:{type:'string',default:'powerups-'+new Date().toISOString().replace(/[:.]/g,'-').toLowerCase()},
  device:{type:'string',default:'OPTIX'},blender:{type:'string',default:'D:/Blender Foundation/Blender 5.2/blender.exe'},
  python:{type:'string',default:'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'},
}});
if(!/^powerups-[a-z0-9][a-z0-9-]*$/.test(values.revision)||!['CPU','CUDA','OPTIX'].includes(values.device))throw Error('Invalid revision/device');
const output=path.join(await realpath('D:/Fragdachse-render'),values.revision);
const reviewDestination=path.join(repo,'build/powerups-blender/review',values.revision);
for(const folder of [output,reviewDestination])if(await access(folder).then(()=>true,()=>false))throw Error('Revision exists: '+folder);
const spec=validatePowerupSpec(JSON.parse(await readFile(path.join(repo,'scripts/asset-pipeline/powerups-v2.json'))));
async function walk(base,dir=''){
  const files=[];
  for(const entry of await readdir(path.join(base,dir),{withFileTypes:true})){
    if(entry.name.startsWith('.')||entry.name==='__pycache__'||entry.name==='node_modules')continue;
    const name=relativePath([dir,entry.name].filter(Boolean).join('/'));
    if(entry.isSymbolicLink())throw Error('Symlink in source: '+name);
    if(entry.isDirectory())files.push(...await walk(base,name));else if(entry.isFile())files.push(name);
  }
  return files.sort();
}
const sources=(await walk(path.join(repo,'scripts/asset-pipeline'))).filter(n=>/\.(py|mjs|json|md|ts|ps1)$/.test(n)).map(n=>'scripts/asset-pipeline/'+n);
sources.push('package.json','package-lock.json','art/icon-refresh-a03-a14/README.md',
  'art/icon-refresh-a03-a14/sources/symbol-prompts.json','art/icon-refresh-a03-a14/final-manifest.json',
  'public/assets/sprites/gras_bg_tile.png');
for(const a of spec.assets){
  sources.push(...Object.values(a.textures),a.reference);
  if(a.symbolReference)sources.push(a.symbolReference);
  for(const [name,hash] of [[a.reference,a.referenceSha256],[a.symbolReference,a.symbolReferenceSha256]]){
    if(hash&&await fileHash(path.join(repo,relativePath(name)))!==hash)throw Error('Approved reference changed: '+name);
  }
}
const files={};for(const name of [...new Set(sources)].sort())files[name]=await fileHash(path.join(repo,name));
const job={schema:'fd-powerups-job',revision:values.revision,device:values.device,files};
if(values.plan){console.log(JSON.stringify({status:'prepared-not-rendered',output,reviewDestination,
  masters:9,masterSize:1024,exports:[128,256],composites:8,pulseScales:spec.pulseScales,sources:Object.keys(files).length},null,2));}
else{
  const started=performance.now();
  await mkdir(output);await mkdir(path.join(output,'cache'));await mkdir(path.join(output,'temp'));
  for(const name of Object.keys(files)){
    const dest=path.join(output,'source',name);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(repo,name),dest);
  }
  await writeFile(path.join(output,'job.json'),JSON.stringify(job,null,2)+'\n',{flag:'wx'});
  const log=createWriteStream(path.join(output,'blender.log'),{flags:'wx'});
  try{await new Promise((resolve,reject)=>{
    const child=spawn(values.blender,['--factory-startup','-b','--python-exit-code','1','--python',
      path.join(output,'source/scripts/asset-pipeline/powerups-blender.py'),'--','--job',path.join(output,'job.json')],
      {cwd:output,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TEMP:path.join(output,'temp'),TMP:path.join(output,'temp'),OPTIX_CACHE_PATH:path.join(output,'cache')}});
    child.stdout.on('data',b=>{log.write(b);for(const line of String(b).split('\n'))if(line.startsWith('FD_'))console.log(line);});
    child.stderr.on('data',b=>log.write(b));child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Blender exited '+code+'; see '+output+'/blender.log')));
  });}finally{await new Promise(resolve=>log.end(resolve));}
  const renderWallSeconds=(performance.now()-started)/1000;
  for(const [name,hash] of Object.entries(files))if(await fileHash(path.join(repo,name))!==hash
    ||await fileHash(path.join(output,'source',name))!==hash)throw Error('Source changed during render: '+name);
  for(const a of spec.assets)await exportVariantV2(path.join(output,a.id,'standard'));
  await mkdir(path.join(output,'layers'));await mkdir(path.join(output,'composites'));
  async function imageRecord(file,bytes){
    await inspectMaster(bytes,256);await writeFile(path.join(output,file),bytes,{flag:'wx'});
    return {file,width:256,height:256,sha256:digest(bytes),downloadBytes:bytes.length,gpuBytes:256*256*4,encoding:'srgb8-straight-rgba'};
  }
  const base=await readFile(path.join(output,'powerup-base/standard/sprite-256.png'));
  const manifest={schema:'fd-layered-powerups',version:1,status:'rendered-awaiting-review',revision:values.revision,
    sourceSize:256,displaySize:22,countdownDisplaySize:16,orthoScale:2.2,pivot:[.5,.5],axes:['right','south'],symbolFinish:SYMBOL_FINISH,
    pulseScales:spec.pulseScales,animation:'Scale only symbol about shared pivot; keep base at fitted size. No per-layer alpha-bounds fit.',
    base:await imageRecord('layers/base.png',base),symbols:[]};
  for(const a of spec.assets.slice(1)){
    const rawSymbol=await readFile(path.join(output,a.id,'standard/sprite-256.png'));
    const symbol=await finishPowerupSymbol(rawSymbol);
    const id=a.model.symbol,composite=await compositePowerup(base,symbol);
    const image=await imageRecord('layers/'+id+'.png',symbol),combined=await imageRecord('composites/'+id+'.png',composite);
    // A missing/open symbol must not become an opaque copy of the common base.
    const {data}=await sharp(symbol).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i]>127)opaque++;
    if(opaque<256*256*.04||opaque>256*256*.65)throw Error('Unexpected symbol coverage: '+id);
    manifest.symbols.push({id,gameId:a.gameIds[0],spriteKey:a.spriteKey,previousComposite:a.reference,rawSymbolSha256:digest(rawSymbol),image,composite:combined});
  }
  manifest.totalDownloadBytes=[manifest.base,...manifest.symbols.flatMap(s=>[s.image,s.composite])].reduce((n,i)=>n+i.downloadBytes,0);
  manifest.layerGpuBytes=9*256*256*4;manifest.withCompositesGpuBytes=17*256*256*4;
  await writeFile(path.join(output,'powerups-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const reviews=await reviewPowerups(output,spec,manifest);
  // Preserve review access even if a later archive/final-bundle check fails.
  await copyPowerupReviews(output,reviewDestination,reviews);
  await writeFile(path.join(output,'completion.json'),JSON.stringify({renderWallSeconds,totalWallSecondsBeforeArchive:(performance.now()-started)/1000,
    ...JSON.parse(await readFile(path.join(output,'render-summary.json'))),reviewFiles:reviews,
    totalDownloadBytes:manifest.totalDownloadBytes,layerGpuBytes:manifest.layerGpuBytes},null,2)+'\n',{flag:'wx'});
  const selected={};
  for(const name of await walk(output)){
    if(name.startsWith('cache/')||name.startsWith('temp/'))continue;
    selected[name]=await fileHash(path.join(output,name));
  }
  const selection={schema:'fd-layered-powerups-selection',version:2,id:'powerups',revision:values.revision,
    status:'rendered-awaiting-review',manifest:'powerups-manifest.json',files:selected};
  const bytes=JSON.stringify(selection,null,2)+'\n';await writeFile(path.join(output,'selection.json'),bytes,{flag:'wx'});
  await runTool(values.python,['-B',path.join(repo,'scripts/asset-pipeline/archive-v2.py'),output,path.join(output,'source-bundle.zip')],output);
  await runTool(values.python,['-B',path.join(repo,'scripts/asset-pipeline/archive-character-passes.py'),'--verify',path.join(output,'source-bundle.zip'),digest(bytes)],output);
  await writeFile(path.join(output,'archive-receipt.json'),JSON.stringify({selectionSha256:digest(bytes),archiveSha256:await fileHash(path.join(output,'source-bundle.zip'))},null,2)+'\n',{flag:'wx'});
  await verifyPowerupBundle(output);
  console.log(JSON.stringify({output,reviewDestination,totalWallSeconds:(performance.now()-started)/1000},null,2));
}
