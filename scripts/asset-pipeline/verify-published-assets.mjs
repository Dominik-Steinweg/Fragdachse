/** Read-only audit of published character/enemy pixels, mappings, hashes and source bundles. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { rgba, tile, inspectPasses, validatePoseMapping, mapLimit } from './pass-quality.mjs';
import { decodeEnemyMesh, relativeMember } from './enemy-mesh-contract.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export async function fileHash(file) {
  const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex');
}
export async function verifyHash(file, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') || await fileHash(file) !== expected) throw Error('Hash mismatch: '+file);
}
export function atlasRect(size, pose) { return [2+(pose%8)*(size+4),2+Math.floor(pose/8)*(size+4),size,size]; }

export async function auditEnemy(asset, { repo=repoRoot, sources }={}) {
  const images = {};
  for (const [key, image] of Object.entries(asset.images)) {
    const file = path.join(repo,'public',relativeMember(image.file)); await verifyHash(file,image.sha256);
    images[key] = await rgba(file);
    const size = Number(key.match(/\d+$/)[0]);
    if (images[key].width !== (size+4)*8 || images[key].height !== (size+4)*4) throw Error('Atlas canvas mismatch');
  }
  const registry = (await json(path.join(repo,'src/config/pipelineAssets.json'))).assets.find(a=>a.id===asset.id);
  if (registry.revision === asset.revision) {
    if (registry.hashes.sheet !== asset.images['beauty'+registry.sourceSize].sha256
      || JSON.stringify(registry.pivot)!==JSON.stringify(asset.coordinates.pivot)
      || registry.layout.frameCount!==asset.poses.length) throw Error('Registry/mesh presentation mismatch');
  }
  await auditMesh(asset.mesh,repo);
  const rows=[];
  for (const key of Object.keys(images).filter(k=>k.startsWith('normal'))) {
    const size=Number(key.slice(6));
    for (const pose of asset.poses) rows.push({pose:pose.index,size,...inspectPasses(Object.fromEntries(
      ['beauty','albedo','normal'].map(mode=>[mode,tile(images[mode+size],atlasRect(size,pose.index))])))});
  }
  const source = sources ? path.join(sources,asset.revision,asset.id) : null;
  if (source) {
    await verifyHash(path.join(source,'enemy-mesh.json'),asset.sourceManifestSha256);
    const archive=await json(path.join(path.dirname(source),'archive-receipt.json'));
    if(archive.sha256!==asset.sourceArchiveSha256)throw Error('Archive receipt mismatch');
    await verifyHash(path.join(path.dirname(source),relativeMember(archive.file)),asset.sourceArchiveSha256);
    const original=await json(path.join(source,'enemy-mesh.json'));
    validatePoseMapping(asset.poses,original.poses,asset.coordinates.pivot,original.coordinates.pivot);
    for (const [file,hash] of Object.entries(original.sourceFiles)) await verifyHash(path.join(source,relativeMember(file)),hash);
    for (const [key,image] of Object.entries(asset.images)) {
      const [,mode,size]=key.match(/^(\D+)(\d+)$/), member=`${mode}/sheet-${size}.png`;
      if(original.images[member]!==image.sha256) throw Error('Publication is not bound to source '+member);
      await verifyHash(path.join(source,member),image.sha256);
    }
  }
  return {id:asset.id,revision:asset.revision,sourceVerified:!!source,rows};
}

export async function auditMesh(mesh,repo=repoRoot) {
  for (const kind of ['positions','indices']) await verifyHash(path.join(repo,'public',relativeMember(mesh[kind].file)),mesh[kind].sha256);
  const positions=await readFile(path.join(repo,'public',mesh.positions.file)),indices=await readFile(path.join(repo,'public',mesh.indices.file));
  if(positions.length!==mesh.vertexCount*mesh.poseIndices.length*6 || indices.length!==mesh.triangleCount*6
    || new Set(mesh.poseIndices).size!==mesh.poseIndices.length
    || !['min','max'].every(k=>mesh.bounds[k]?.length===3&&mesh.bounds[k].every(Number.isFinite))
    || mesh.bounds.min.some((v,i)=>v>mesh.bounds.max[i])) throw Error('Invalid shadow mesh dimensions/bounds');
  for(let i=0;i<indices.length;i+=2) if(indices.readUInt16LE(i)>=mesh.vertexCount) throw Error('Invalid shadow mesh index');
  // Existing decoder independently checks quantization and fixed pose topology.
  if(mesh.poseIndices.length===31) decodeEnemyMesh(mesh,positions,indices);
}

async function auditPlayer(manifest, repo, sources) {
  const pages=[];for(const page of manifest.pages){const file=path.join(repo,'public',relativeMember(page.file));await verifyHash(file,page.sha256);pages.push(await rgba(file));}
  const rows=[];
  const current=manifest.revision==='player-material-r2-005';
  const root=sources&&path.join(sources,current?'player-r2-005/badger':'player-shadow-21c-production');
  if(root){
    const source=await json(path.join(root,current?'geometry.json':'source-render.json'));
    const frames=current?source.render.frames:source.frames;
    validatePoseMapping(manifest.poses,frames,manifest.coordinates.bodyPivotUV,[.5,.5]);
    await verifyHash(path.join(root,'source.blend'),manifest.source.blendSha256);
    if(current)await verifyHash(path.join(root,'renders/receipt.json'),manifest.source.renderReceiptSha256);
    if(manifest.sourceArchiveSha256){
      const archive=await json(path.join(root,'archive-receipt.json'));
      if((archive.sha256??archive.archiveSha256)!==manifest.sourceArchiveSha256)throw Error('Player archive receipt mismatch');
      await verifyHash(path.join(root,archive.file??'source-bundle.zip'),manifest.sourceArchiveSha256);
    }
    let frameRoot=root;
    if(!current&&manifest.source.frames){
      const parent=path.join(sources,'player-material-21e4'),matches=[];
      for(const entry of await readdir(parent,{withFileTypes:true}))if(entry.isDirectory()){
        const receipt=path.join(parent,entry.name,'receipt.json');
        if(await fileHash(receipt).catch(()=>null)===manifest.source.renderReceiptSha256)matches.push(path.dirname(receipt));
      }
      if(matches.length!==1)throw Error('Missing/ambiguous hash-bound repair receipt');frameRoot=matches[0];
    }
    for(const frame of manifest.source.frames??[]){
      await verifyHash(path.join(frameRoot,relativeMember(frame.file)),frame.sha256);
      const sample=manifest.samples.find(s=>s.pass===frame.pass&&s.pose===frame.pose&&s.sourceSize===frame.sourceSize);
      if(!sample)throw Error('Source frame missing from atlas');
      const bytes=tile(pages[sample.page],sample.rect).data;
      if(createHash('sha256').update(bytes).digest('hex')!==frame.rgbaSha256)throw Error('Source frame/atlas pixels differ');
    }
  }
  for(const sample of manifest.samples.filter(s=>s.pass==='albedo')){
    const counterpart=manifest.samples.find(s=>s.pass==='normal'&&s.pose===sample.pose&&s.sourceSize===sample.sourceSize);
    if(!counterpart)throw Error('Missing normal frame');
    let beauty;
    if(root){
      const file=current?path.join(root,`exports/beauty-${sample.pose}-${sample.sourceSize}.png`):path.join(root,`source-beauty/masters/frame-${String(sample.pose).padStart(4,'0')}.png`);
      const input=current?file:await sharp(file).resize(sample.sourceSize,sample.sourceSize).png().toBuffer();
      beauty=await rgba(input);
    }
    rows.push({pose:sample.pose,size:sample.sourceSize,...inspectPasses({beauty,albedo:tile(pages[sample.page],sample.rect),normal:tile(pages[counterpart.page],counterpart.rect)})});
  }
  const shadows=manifest.samples.filter(s=>s.pass==='shadow');
  for(const sample of shadows){
    const data=tile(pages[sample.page],sample.rect),canvas=manifest.canvases[sample.canvasIndex];
    if(data.width!==canvas.width||data.height!==canvas.height||!Number.isInteger(sample.channel)||sample.channel<0||sample.channel>3)throw Error('Shadow canvas mismatch');
    let max=0,edge=0;
    for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){
      const v=data.data[(y*data.width+x)*4+sample.channel];max=Math.max(max,v);
      if(x<2||y<2||x>=data.width-2||y>=data.height-2)edge=Math.max(edge,v);
    }
    if(max<64||edge>4)throw Error('Empty/clipped shadow');
  }
  return {id:'badger',revision:manifest.revision,sourceVerified:!!root,rows,shadowSamples:shadows.length};
}

export async function auditPublished({repo=repoRoot,sources,jobs=2}={}) {
  const started=performance.now(),directory=path.join(repo,'src/assets/manifests');
  const registry=(await json(path.join(repo,'src/config/pipelineAssets.json'))).assets.filter(a=>['character','enemy'].includes(a.category));
  for(const asset of registry)for(const kind of ['idle','sheet'])await verifyHash(path.join(repo,'public',asset[kind+'Path'].replace(/^\.\//,'')),asset.hashes[kind]);
  const names=(await readdir(directory)).filter(n=>/^(enemy-mesh-|character-(material-|mesh-|badger-))/.test(n));
  const enemies=new Map(),players=[];let meshes=0;
  for(const name of names){const m=await json(path.join(directory,name));
    if(m.schema==='fd-enemy-mesh-runtime')for(const asset of m.assets)enemies.set(asset.id+'/'+asset.revision,asset);
    else if(m.pages)players.push(m);
    else if(m.meshes){
      for(const mesh of m.meshes){await auditMesh(mesh,repo);meshes++;}
      if(sources){
        const current=m.revision==='player-mesh-r2-005',root=path.join(sources,current?'player-r2-005/badger':m.revision);
        if(m.sourceArchiveSha256)await verifyHash(path.join(root,'source-bundle.zip'),m.sourceArchiveSha256);
        const original=await json(path.join(root,current?'geometry.json':'mesh-manifest.json'));
        validatePoseMapping(m.poses,current?original.render.frames:original.poses,[.5,.5],[.5,.5]);
        if(current){await verifyHash(path.join(root,'source.blend'),m.source.blendSha256);await verifyHash(path.join(root,'geometry.json'),m.source.geometrySha256);}
      }
    }
  }
  const tasks=[...enemies.values()].map(asset=>()=>auditEnemy(asset,{repo,sources}));
  tasks.push(...players.map(m=>()=>auditPlayer(m,repo,sources)));
  const results=await mapLimit(tasks,jobs,fn=>fn());
  const failures=results.filter(r=>r.error).map(r=>r.error),assets=results.flatMap(r=>r.value?[r.value]:[]);
  const findings=assets.flatMap(a=>a.rows.filter(r=>r.opaqueBlack||r.invalidNormals||r.alphaInteriorMismatch||r.beautyBlackIslands.count)
    .map(row=>({id:a.id,revision:a.revision,...row})));
  return {schema:'fd-published-asset-audit',version:1,seconds:(performance.now()-started)/1000,
    scope:'all checked-in player/enemy mesh and material manifests, including retained legacy revisions',
    sourcePolicy:sources?'hashes checked against external source bundles':'public hashes only; external sources not requested',
    registryAssets:registry.length,meshCount:meshes+enemies.size,frames:assets.reduce((n,a)=>n+a.rows.length,0),
    failures,findings,assets};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{sources:{type:'string'},out:{type:'string'},jobs:{type:'string',default:'2'}}});
  const report=await auditPublished({sources:values.sources,jobs:Number(values.jobs)});
  const output=path.resolve(values.out??'build/asset-audit/published.json');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,seconds:report.seconds,frames:report.frames,failures:report.failures,findings:report.findings.length}));
  if(report.failures.length)process.exitCode=1;
}
