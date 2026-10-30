/** Incremental mesh/material derivation from an immutable V2 selection. */
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {verifySelectionV2} from './export-v2.mjs';
import {enemyCoordinates,enemyPoses,meshProfile,validateEnemyMeshManifest,decodeEnemyMesh,ENEMY_MESH_VIEWS,relativeMember} from './enemy-mesh-contract.mjs';
import {project,extents,raster,compare} from './enemy-mesh-raster.mjs';
import {rgba,inspectPasses} from './pass-quality.mjs';
import {readPipelineRegistry} from './pipeline-registry.mjs';

const repo=path.resolve(process.cwd());
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const fileHash=async p=>hash(await readFile(p));
const write=async(p,value)=>writeFile(p,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const [mode,id,revision,sourceRevision]=process.argv.slice(2);
if(!/^[a-z0-9-]+$/.test(id??'')||!/^enemy-mesh-[a-z0-9-]+$/.test(revision??''))throw Error('Usage: enemy-mesh-selected.mjs prepare|validate|import <id> <enemy-mesh-revision> [source-revision]');
const root=path.join(repo,'art/poc/pipeline-v2/enemy-mesh',revision,id);
if(mode==='prepare'){
  if(!/^[a-z0-9-]+$/.test(sourceRevision??''))throw Error('Source revision required');
  const source=path.join(repo,'art/poc/pipeline-v2/runs',sourceRevision,id),selection=await verifySelectionV2(source);
  const render=await read(path.join(source,selection.variant,'render.json'));
  const sourceFiles={};
  await mkdir(root,{recursive:true});
  for(const [from,to] of [[selection.variant+'/asset.blend','candidate.blend'],[selection.variant+'/render.json','source-render.json'],['selection.json','source-selection.json'],['source-bundle.zip','source-bundle.zip']]){
    const dest=path.join(root,to);await copyFile(path.join(source,from),dest,constants.COPYFILE_EXCL);sourceFiles[to]=await fileHash(dest);
  }
  await mkdir(path.join(root,'source-tools'));
  for(const name of await readdir(path.join(repo,'scripts/asset-pipeline')))if(/\.(py|mjs)$/.test(name)){
    const member='source-tools/'+name;await copyFile(path.join(repo,'scripts/asset-pipeline',name),path.join(root,member),constants.COPYFILE_EXCL);sourceFiles[member]=await fileHash(path.join(root,member));
  }

  await write(path.join(root,'job.json'),{id,revision,sourceRevision,source,outputRoot:path.dirname(root),render,profile:meshProfile(render),
    poses:enemyPoses(render),coordinates:enemyCoordinates(render),layout:selection.layout,sourceFiles});
  console.log(path.join(root,'job.json'));
}else if(mode==='validate'){
  const job=await read(path.join(root,'job.json')),m=validateEnemyMeshManifest(await read(path.join(root,'mesh-manifest.json')));
  for(const [file,h] of Object.entries(job.sourceFiles))if(await fileHash(path.join(root,relativeMember(file)))!==h)throw Error('Changed source '+file);
  const mesh=decodeEnemyMesh(m.mesh,await readFile(path.join(root,m.mesh.positions.file)),await readFile(path.join(root,m.mesh.indices.file)));
  const referenceIndices=await readFile(path.join(root,m.reference.indices.file));
  const indices=new Uint32Array(referenceIndices.buffer.slice(referenceIndices.byteOffset,referenceIndices.byteOffset+referenceIndices.byteLength));
  const rows=[];
  for(const pose of m.poses){
    const bytes=await readFile(path.join(root,m.reference.poses[pose.index].file));
    if(hash(bytes)!==m.reference.poses[pose.index].sha256)throw Error('Changed dense reference');
    const full=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const proxy=mesh.positions.subarray(pose.index*m.mesh.vertexCount*3,(pose.index+1)*m.mesh.vertexCount*3);
    for(const view of [...ENEMY_MESH_VIEWS,{azimuth:0,elevation:90}]){
      const a=project(full,view.azimuth,view.elevation),b=project(proxy,view.azimuth,view.elevation),aa=extents(a),bb=extents(b);
      const bounds=[Math.min(aa[0],bb[0])-1,Math.min(aa[1],bb[1])-1,Math.max(aa[2],bb[2])+1,Math.max(aa[3],bb[3])+1];
      const scores=[6,12].map(d=>compare(raster(a,indices,bounds,d),raster(b,mesh.indices,bounds,d)).iou);
      rows.push({pose:pose.index,...view,iou:scores[0],fineIou:scores[1]});
    }
    console.log('silhouettes',pose.index,Math.min(...rows.filter(r=>r.pose===pose.index).map(r=>r.fineIou)));
  }
  const validation={samples:rows.length,minimumIou:Math.min(...rows.map(r=>r.iou)),minimumFineIou:Math.min(...rows.map(r=>r.fineIou)),rows};
  await write(path.join(root,'silhouette-review.json'),validation);
  if(validation.minimumIou<.95||validation.minimumFineIou<.95)throw Error('Silhouette gate below 95%');
  console.log(JSON.stringify({...validation,rows:undefined}));
}else if(mode==='seal'){
  const job=await read(path.join(root,'job.json')),m=validateEnemyMeshManifest(await read(path.join(root,'mesh-manifest.json')));
  const silhouettes=await read(path.join(root,'silhouette-review.json'));
  const visual=await read(path.resolve(repo,sourceRevision));
  if(visual.status!=='reviewed'||!visual.assessment)throw Error('Actual visual review JSON required');
  if(silhouettes.samples!==m.poses.length*81||silhouettes.minimumIou<.95||silhouettes.minimumFineIou<.95)throw Error('Failed silhouette gate');
  for(const [file,h] of Object.entries(job.sourceFiles))if(await fileHash(path.join(root,relativeMember(file)))!==h)throw Error('Changed source '+file);
  const selected=await verifySelectionV2(job.source),images={},qa=[];
  if(m.profile==='rigid'){
    // Rigid assets keep their selected sprite material; only the shadow proxy is new. The Beauty sheet at
    // source size binds the mesh to the exact live sheet it was baked from.
    const member=`beauty/sheet-${job.layout.frameWidth}.png`,dest=path.join(root,member);
    await mkdir(path.dirname(dest),{recursive:true});
    await copyFile(path.join(job.source,selected.variant,`sheet-${job.layout.frameWidth}.png`),dest,constants.COPYFILE_EXCL);
    images[member]=await fileHash(dest);
    const validation={fullSilhouettes:silhouettes.samples,minimumIou:silhouettes.minimumIou,minimumFineIou:silhouettes.minimumFineIou,
      materialMetrics:[],evidence:{'candidate.blend':job.sourceFiles['candidate.blend'],'silhouette-review.json':await fileHash(path.join(root,'silhouette-review.json'))}};
    const final={...m,status:'reviewed-not-imported',layout:job.layout,images,validation,visualReview:visual,materialEncoding:null,
      provenance:{source:'selected-v2',sourceRevision:job.sourceRevision,blenderVersion:m.blenderVersion}};
    validateEnemyMeshManifest(final);
    await write(path.join(root,'enemy-mesh.json'),final);
    await copyFile(fileURLToPath(import.meta.url),path.join(root,'sealed-import-tool.mjs'),constants.COPYFILE_EXCL);
    await write(path.join(root,'review-result.json'),{status:'reviewed-not-imported',id,revision,validation});
    console.log('Sealed',id);
    process.exit(0);
  }
  const passes=await read(path.join(root,'render-passes.json'));
  if(passes.frames.length!==m.poses.length||passes.sourceBlendSha256!==job.sourceFiles['candidate.blend']||passes.persistentData!==false||!passes.passMajor)throw Error('Material source/policy mismatch');
  for(const [file,h] of Object.entries(passes.outputs))if(await fileHash(path.join(root,relativeMember(file)))!==h)throw Error('Changed pass '+file);
  for(const pose of m.poses){
    const name=`frame-${String(pose.index).padStart(4,'0')}.png`,data={};
    // Approved Beauty remains the exact selected bytes; data passes never replace it.
    data.beauty=await rgba(path.join(job.source,selected.variant,'masters',name));
    for(const mode of ['albedo','normal','emission'])data[mode]=await rgba(path.join(root,mode,'masters',name));
    const metrics=inspectPasses(data);qa.push({pose:pose.index,size:1024,...metrics});
    if(metrics.invalidNormals||metrics.blackOverLitBeauty||metrics.alphaInteriorMismatch)throw Error('Material master defect '+pose.index);
  }
  for(const size of [64,128]){
    const columns=job.layout.columns,rows=Math.ceil(m.poses.length/columns),width=columns*(size+4),height=rows*(size+4);
    for(const pass of ['beauty','albedo','normal','emission']){
      const member=`${pass}/sheet-${size}.png`,dest=path.join(root,member);
      if(pass==='beauty')await copyFile(path.join(job.source,selected.variant,`sheet-${size}.png`),dest,constants.COPYFILE_EXCL);
      else{
        const data=Buffer.alloc(width*height*4);
        for(const pose of m.poses){
          const name=`frame-${String(pose.index).padStart(4,'0')}.png`,tile=await rgba(path.join(root,pass,String(size),name));
          if(tile.width!==size||tile.height!==size)throw Error('Tile size mismatch');
          const x=2+pose.index%columns*(size+4),y=2+Math.floor(pose.index/columns)*(size+4);
          for(let row=0;row<size;row++)tile.data.copy(data,((y+row)*width+x)*4,row*size*4,(row+1)*size*4);
        }
        await writeFile(dest,await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer(),{flag:'wx'});
      }
      images[member]=await fileHash(dest);
    }
    const sheets={};for(const pass of ['beauty','albedo','normal','emission'])sheets[pass]=await rgba(path.join(root,pass,`sheet-${size}.png`));
    const metrics=inspectPasses(sheets);qa.push({size,...metrics});
    if(metrics.invalidNormals||metrics.blackOverLitBeauty||metrics.alphaInteriorMismatch)throw Error('Material sheet defect '+size);
  }
  // A larger source size (the Grave Titan's 336) keeps the 64/128 material sheets; its Beauty still binds the mesh.
  if(![64,128].includes(job.layout.frameWidth)){
    const member=`beauty/sheet-${job.layout.frameWidth}.png`,dest=path.join(root,member);
    await copyFile(path.join(job.source,selected.variant,`sheet-${job.layout.frameWidth}.png`),dest,constants.COPYFILE_EXCL);
    images[member]=await fileHash(dest);
  }
  const validation={fullSilhouettes:silhouettes.samples,minimumIou:silhouettes.minimumIou,minimumFineIou:silhouettes.minimumFineIou,
    beautyOutsideRepairPixels:0,beautyOutsideRepairAlphaPixels:0,materialMetrics:qa,
    evidence:{'candidate.blend':job.sourceFiles['candidate.blend'],'silhouette-review.json':await fileHash(path.join(root,'silhouette-review.json')),'render-passes.json':await fileHash(path.join(root,'render-passes.json'))}};
  const final={...m,status:'reviewed-not-imported',layout:job.layout,images,validation,visualReview:visual,
    materialEncoding:{albedo:passes.albedoEncoding,normal:passes.normalEncoding,emission:passes.emissionEncoding},
    provenance:passes.provenance};
  validateEnemyMeshManifest(final);
  await write(path.join(root,'enemy-mesh.json'),final);
  await copyFile(fileURLToPath(import.meta.url),path.join(root,'sealed-import-tool.mjs'),constants.COPYFILE_EXCL);
  await write(path.join(root,'review-result.json'),{status:'reviewed-not-imported',id,revision,validation});
  console.log('Sealed',id);
}else if(mode==='import'){
  const bytes=await readFile(path.join(root,'enemy-mesh.json')),m=validateEnemyMeshManifest(JSON.parse(bytes));
  const receipt=await read(path.join(root,'archive-receipt.json'));
  if(m.status!=='reviewed-not-imported'||!receipt.verified||await fileHash(path.join(root,relativeMember(receipt.file)))!==receipt.sha256)throw Error('Verified archive required');
  for(const [file,entry] of Object.entries(receipt.files))if(await fileHash(path.join(root,relativeMember(file)))!==entry.sha256)throw Error('Changed archive input '+file);
  const registry=await readPipelineRegistry(repo),live=registry.assets.find(a=>a.id===id);
  if(live?.revision!==m.sourceRevision||live.layout.frameCount!==m.poses.length)throw Error('Live selection mismatch');
  const folder=`assets/sprites/pipeline-v2/${id}/mesh/${revision}`,mesh={...m.mesh},images={},copies=[];
  delete mesh.audit;
  for(const part of ['positions','indices']){
    const spec=m.mesh[part],data=await readFile(path.join(root,relativeMember(spec.file)));
    if(hash(data)!==spec.sha256||data.length!==spec.bytes)throw Error('Changed mesh');
    const file=`${folder}/${id}-${part}-${spec.sha256}.bin`;
    mesh[part]={...spec,file,url:`${file}?v=${spec.sha256}`};copies.push({file,data});
  }
  for(const [member,h] of Object.entries(m.images)){
    const data=await readFile(path.join(root,relativeMember(member)));if(hash(data)!==h)throw Error('Changed image');
    const [,pass,size]=member.match(/^(beauty|albedo|normal|emission)\/sheet-(\d+)\.png$/);
    // Rigid assets, and a creature's Beauty at a source size without material sheets, reference the live Beauty
    // sheet the game already ships instead of a copy.
    if(m.profile==='rigid'||(pass==='beauty'&&!m.images[`albedo/sheet-${size}.png`])){
      images[`${pass}${size}`]={file:live.sheetPath.replace(/^\.\//,''),sha256:h};continue;
    }
    const file=`${folder}/${pass}-${size}.png`;images[`${pass}${size}`]={file,sha256:h};copies.push({file,data});
  }
  if(images[`beauty${live.sourceSize}`].sha256!==live.hashes.sheet)throw Error('Selected Beauty changed');
  const asset={id,revision:live.revision,meshRevision:revision,...(m.profile==='rigid'?{profile:'rigid'}:{}),coordinates:m.coordinates,poses:m.poses,contacts:m.contacts,
    provenance:m.provenance,mesh,images,materialEncoding:m.materialEncoding,sourceManifestSha256:hash(bytes),sourceArchiveSha256:receipt.sha256,
    inheritedEyeAnchorSource:live.eyeAnchors?.source??null,validation:m.validation};
  const file=path.join(repo,'src/assets/manifests/enemy-mesh-families.json'),manifest=await read(file);
  // Preserve every unrelated family, including their accepted revisions and bytes.
  manifest.assets=[...manifest.assets.filter(a=>a.id!==id),asset];
  for(const c of copies){const target=path.join(repo,'public',c.file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,c.data);}
  await writeFile(file,JSON.stringify(manifest,null,2)+'\n');
  for(const c of copies)if(await fileHash(path.join(repo,'public',c.file))!==hash(c.data))throw Error('Import readback failed');
  console.log('Imported selected enemy mesh and material sheets:',copies.length,'files');
}else throw Error('Unknown stage');
