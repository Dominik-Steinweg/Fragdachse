/** Verify and stage all selected enemy material passes on D:. Never imports into public/. */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { constants } from 'node:fs';
import sharp from 'sharp';
import { repoRoot, json, fileHash, verifyHash, auditEnemy, atlasRect } from './verify-published-assets.mjs';
import { rgba, tile, inspectPasses, validatePoseMapping, mapLimit } from './pass-quality.mjs';
import { relativeMember } from './enemy-mesh-contract.mjs';
import { validateAlbedoRepair, replaceTile } from './material-repair.mjs';

export async function prepareEnemies({sources='D:/Fragdachse-render',output,repairs,jobs=2,repo=repoRoot}) {
  const root=path.resolve(output);
  if(!/^D:[\\/]/i.test(root)||!root.toLowerCase().startsWith(path.resolve(sources).toLowerCase()+path.sep))throw Error('Output must be a new revision below the D: source root');
  await mkdir(root); // Exclusive revision; existing evidence is immutable.
  const started=performance.now(),runtime=await json(path.join(repo,'src/assets/manifests/enemy-mesh-families.json'));
  const catalog=(await json(path.join(repo,'scripts/asset-pipeline/catalog-v2.json'))).assets.filter(a=>a.category==='enemy').map(a=>a.id).sort();
  if(JSON.stringify(runtime.assets.map(a=>a.id).sort())!==JSON.stringify(catalog))throw Error('Incomplete enemy catalog coverage');
  const toolHashes={};for(const name of ['prepare-enemy-materials.mjs','verify-published-assets.mjs','pass-quality.mjs','material-repair.mjs'])toolHashes[name]=await fileHash(path.join(repo,'scripts/asset-pipeline',name));
  await mkdir(path.join(root,'source-tools'));
  for(const [name,hash]of Object.entries(toolHashes)){
    await copyFile(path.join(repo,'scripts/asset-pipeline',name),path.join(root,'source-tools',name),constants.COPYFILE_EXCL);
    await verifyHash(path.join(root,'source-tools',name),hash);
  }
  const results=await mapLimit(runtime.assets,jobs,async asset=>{
    const source=path.join(sources,asset.revision,asset.id),destination=path.join(root,asset.id);
    await mkdir(destination);
    const published=await auditEnemy(asset,{repo,sources});
    const manifest=await json(path.join(source,'enemy-mesh.json')),passes=await json(path.join(source,'render-passes.json'));
    const sourceRender=await json(path.join(source,'source-render.json'));
    validatePoseMapping(asset.poses,passes.frames,asset.coordinates.pivot,passes.canvas.pivot);
    const blend='render-source.blend';
    await verifyHash(path.join(source,blend),passes.sourceBlendSha256);
    const inputs={};for(const name of [blend,'enemy-mesh.json','render-passes.json','source-render.json','job.json'])inputs[name]=await fileHash(path.join(source,name));
    const rows=[],outputs={},files=Object.entries(manifest.images).filter(([name])=>/^(beauty|albedo|normal|emission)\/(masters\/frame-\d+\.png|sheet-\d+\.png)$/.test(name));
    // Copy exact accepted bytes, including masters. Sources stay read-only.
    for(const [name,hash]of files){relativeMember(name);const from=path.join(source,name),to=path.join(destination,name);
      await verifyHash(from,hash);await mkdir(path.dirname(to),{recursive:true});await copyFile(from,to,constants.COPYFILE_EXCL);await verifyHash(to,hash);outputs[name]=hash;
    }
    const repairRoot=repairs&&path.join(repairs,asset.id);
    const repair=repairRoot&&await json(path.join(repairRoot,'render-passes.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const repairEvidence=[];
    if(repair){
      if(repair.sourceBlendSha256!==passes.sourceBlendSha256||repair.persistentData!==false||repair.passMajor!==true)throw Error('Repair source/policy mismatch');
      for(const pose of repair.frames){
        if(asset.poses[pose.index]?.blenderFrame!==pose.blenderFrame)throw Error('Repair pose mismatch');
        const name=`frame-${String(pose.index).padStart(4,'0')}.png`,member='albedo/masters/'+name;
        await verifyHash(path.join(repairRoot,member),repair.outputs[member]);
        const evidence=validateAlbedoRepair(await rgba(path.join(destination,member)),await rgba(path.join(repairRoot,member)));
        await copyFile(path.join(repairRoot,member),path.join(destination,member));outputs[member]=repair.outputs[member];
        for(const file of Object.keys(outputs).filter(f=>/^albedo\/sheet-\d+\.png$/.test(f))){
          const size=Number(file.match(/\d+/)[0]),frameMember=`albedo/${size}/${name}`;
          await verifyHash(path.join(repairRoot,frameMember),repair.outputs[frameMember]);
          const sheet=await rgba(path.join(destination,file));replaceTile(sheet,await rgba(path.join(repairRoot,frameMember)),atlasRect(size,pose.index));
          await writeFile(path.join(destination,file),await sharp(sheet.data,{raw:{width:sheet.width,height:sheet.height,channels:4}}).png().toBuffer());
          outputs[file]=await fileHash(path.join(destination,file));
        }
        repairEvidence.push({pose:pose.index,...evidence,receipt:path.join(repairRoot,'render-passes.json'),receiptSha256:await fileHash(path.join(repairRoot,'render-passes.json'))});
      }
    }
    for(const pose of asset.poses){
      const name=`masters/frame-${String(pose.index).padStart(4,'0')}.png`,images={};
      for(const mode of ['beauty','albedo','normal','emission'])images[mode]=await rgba(path.join(destination,mode,name));
      if(images.beauty.width!==1024||images.beauty.height!==1024)throw Error('Master size mismatch');
      const metrics=inspectPasses(images);rows.push({pose:pose.index,size:1024,...metrics});
    }
    const staged=[];
    for(const file of Object.keys(outputs).filter(f=>/^normal\/sheet-\d+\.png$/.test(f))){
      const size=Number(file.match(/\d+/)[0]),images={};
      for(const mode of ['beauty','albedo','normal','emission'])images[mode]=await rgba(path.join(destination,`${mode}/sheet-${size}.png`));
      for(const pose of asset.poses)staged.push({pose:pose.index,size,...inspectPasses(Object.fromEntries(Object.entries(images).map(([k,v])=>[k,tile(v,atlasRect(size,pose.index))])))});
    }
    const defects=[...rows,...staged].filter(r=>r.invalidNormals||r.blackOverLitBeauty||r.alphaInteriorMismatch);
    const result={schema:'fd-enemy-material-preparation',version:1,id:asset.id,
      status:defects.length?'findings-require-review':'validated-not-imported',runtimeActivated:false,
      provenance:{schema:'fd-export-provenance',version:1,
        versions:{blender:manifest.blenderVersion??sourceRender.blenderVersion,node:process.version,sharp:sharp.versions.sharp,vips:sharp.versions.vips},
        seeds:{cycles:passes.seed},render:{device:passes.device,samples:passes.samples,
          persistentData:passes.persistentData??'not-recorded-in-legacy-receipt',passMajor:passes.passMajor??false},
        sourceRoot:source,sources:inputs,tools:toolHashes,sourceArchiveSha256:asset.sourceArchiveSha256},
      poses:asset.poses,coordinates:asset.coordinates,layout:passes.layout,
      encoding:{albedo:passes.albedoEncoding,normal:passes.normalEncoding,emission:passes.emissionEncoding},
      outputs,repairs:repairEvidence,qa:{masters:rows,published:published.rows,staged,defects},
      reuse:{policy:'hash-verified immutable selected outputs; byte copy plus declared source rerenders',masterRendersAvoided:asset.poses.length*5-repairEvidence.length*5}};
    await writeFile(path.join(destination,'manifest.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    return {id:asset.id,status:result.status,manifestSha256:await fileHash(path.join(destination,'manifest.json')),
      frames:rows.length,defects: defects.length,files:files.length,masterRendersAvoided:result.reuse.masterRendersAvoided};
  });
  const manifest={schema:'fd-enemy-material-batch',version:1,runtimeActivated:false,
    seconds:(performance.now()-started)/1000,tools:toolHashes,results};
  await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
export async function verifyPrepared(root) {
  const batch=await json(path.join(root,'manifest.json'));
  const expected=(await json(path.join(repoRoot,'scripts/asset-pipeline/catalog-v2.json'))).assets.filter(a=>a.category==='enemy').map(a=>a.id).sort();
  if(batch.runtimeActivated!==false||batch.results.some(r=>r.error)
    ||JSON.stringify(batch.results.map(r=>r.value.id).sort())!==JSON.stringify(expected))throw Error('Incomplete prepared batch');
  for(const [name,hash]of Object.entries(batch.tools))await verifyHash(path.join(root,'source-tools',relativeMember(name)),hash);
  let files=0,frames=0;
  for(const {value} of batch.results){
    const directory=path.join(root,relativeMember(value.id));await verifyHash(path.join(directory,'manifest.json'),value.manifestSha256);
    const m=await json(path.join(directory,'manifest.json'));
    if(m.status!=='validated-not-imported'||m.runtimeActivated!==false||!Number.isInteger(m.provenance.seeds.cycles)||!m.provenance.versions.blender)throw Error('Invalid preparation provenance/status');
    for(const [file,hash]of Object.entries(m.provenance.sources))await verifyHash(path.join(m.provenance.sourceRoot,relativeMember(file)),hash);
    const source=await json(path.join(m.provenance.sourceRoot,'render-passes.json'));
    validatePoseMapping(m.poses,source.frames,m.coordinates.pivot,source.canvas.pivot);
    for(const repair of m.repairs)await verifyHash(repair.receipt,repair.receiptSha256);
    for(const [file,hash]of Object.entries(m.outputs)){await verifyHash(path.join(directory,relativeMember(file)),hash);files++;}
    for(const pose of m.poses){
      const images={};for(const mode of ['beauty','albedo','normal','emission'])images[mode]=await rgba(path.join(directory,mode,`masters/frame-${String(pose.index).padStart(4,'0')}.png`));
      const qa=inspectPasses(images);if(qa.invalidNormals||qa.blackOverLitBeauty||qa.alphaInteriorMismatch)throw Error('Prepared master defect');frames++;
    }
  }
  return {status:'verified-not-imported',assets:batch.results.length,frames,files};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{sources:{type:'string',default:'D:/Fragdachse-render'},out:{type:'string'},repairs:{type:'string'},verify:{type:'string'},jobs:{type:'string',default:'2'}}});
  if(values.verify){console.log(JSON.stringify(await verifyPrepared(path.resolve(values.verify))));}
  else {
  if(!values.out)throw Error('--out D:/Fragdachse-render/<new-revision> required');
  const result=await prepareEnemies({sources:values.sources,output:values.out,repairs:values.repairs,jobs:Number(values.jobs)});
  console.log(JSON.stringify(result,null,2));if(result.results.some(r=>r.error||r.value.defects))process.exitCode=1;
  }
}
