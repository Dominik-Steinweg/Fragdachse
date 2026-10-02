/** Run independent R4 render or silhouette review as each immutable geometry receipt arrives. */
import fs from 'node:fs/promises';import path from 'node:path';import {spawn}from'node:child_process';import{createWriteStream}from'node:fs';
const [revision,phase]=process.argv.slice(2);if(!/^enemy-mesh-r4-\d+$/.test(revision)||!['render','shadow','beauty'].includes(phase))throw Error('Explicit R4 revision/phase required');
const catalog=JSON.parse(await fs.readFile('scripts/asset-pipeline/enemy-mesh-families.json','utf8')).assets.map(a=>a.id).concat(['alien-badger','pyro-badger']);
const ids=process.argv[4]?process.argv[4].split(','):catalog;
if(!ids.length||ids.some(id=>!catalog.includes(id)))throw Error('Unknown queue selection');
const root=path.join('D:/Fragdachse-render',revision),blender='D:/Blender Foundation/Blender 5.2/blender.exe';const exists=p=>fs.access(p).then(()=>true,()=>false);
async function run(cmd,args,log){const sink=createWriteStream(log,{flags:'a'});try{await new Promise((resolve,reject)=>{const p=spawn(cmd,args,{windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});p.stdout.pipe(sink,{end:false});p.stderr.pipe(sink,{end:false});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Process exit '+code)));});}finally{await new Promise(r=>sink.end(r));}}
const pending=new Set(ids),results=[],deadline=Date.now()+4*60*60*1000;
while(pending.size&&Date.now()<deadline){let worked=false;for(const id of pending){const folder=path.join(root,id);if(!await exists(path.join(folder,phase==='beauty'?'render-passes.json':'geometry-receipt.json')))continue;pending.delete(id);worked=true;try{
 const file=phase==='render'?'enemy_mesh_family_render.py':'enemy_mesh_family_review_source.py',dir=path.join(folder,'review-tools');await fs.mkdir(dir,{recursive:true});const target=path.join(dir,file),bytes=await fs.readFile('scripts/asset-pipeline/'+file);if(await exists(target)){if(!bytes.equals(await fs.readFile(target)))throw Error('Changed executed tool');}else await fs.writeFile(target,bytes,{flag:'wx'});
 const result=path.join(folder,phase==='render'?'render-passes.json':phase==='beauty'?'beauty-difference.json':'silhouette-review.json');
 if(!await exists(result)){
  if(phase==='render'||phase==='shadow'&&!await exists(path.join(folder,'review-source/source.json')))await run(blender,['--factory-startup','-b','--python-exit-code','1','--python',target,'--','--job',path.join(folder,'job.json')],path.join(folder,phase+'-r4.log'));
  if(phase!=='render')await run(process.execPath,['scripts/asset-pipeline/enemy-mesh-family-review.mjs','--revision',revision,'--asset',id,'--phase',phase],path.join(folder,'silhouette-r4.log'));
 }
 results.push({id,status:'completed'});console.log(phase,id,'completed');
 }catch(e){results.push({id,status:'failed',error:String(e)});console.error(phase,id,String(e));}await fs.writeFile(path.join(root,phase+'-queue.json'),JSON.stringify({results,pending:[...pending]},null,2));}
 if(!worked)await new Promise(r=>setTimeout(r,5000));}
if(pending.size||results.some(r=>r.status==='failed'))process.exitCode=1;
