/** Prepare an audited R2 bundle on D:, then import only its sealed, visually accepted bytes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=path.resolve(process.argv[2]),apply=process.argv.includes('--apply');
if(!/^D:\\Fragdachse-render\\player-r2-\d+\\badger$/i.test(root))throw Error('Expected isolated badger revision');
const json=async file=>JSON.parse(await fs.readFile(file,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const fileHash=async file=>hash(await fs.readFile(file));
const g=await json(path.join(root,'geometry.json')),revision=g.revision.replace('player-r2-','player-mesh-r2-'),materialRevision=g.revision.replace('player-r2-','player-material-r2-');
const gap=await json(path.join(root,'legacy-gap-grid.json')),decoded=await json(path.join(root,'decoded-corridors.json')),image=await json(path.join(root,'image-review.json'));
const receipt=await json(path.join(root,'renders/receipt.json')),review=await json(path.join(root,'visual-review.json'));
if(g.sourceQa.quick||g.sourceQa.samples!==145||g.sourceQa.views!==81||g.sourceQa.afterFailures||gap.samples!==2960||gap.after||decoded.samples!==5994||decoded.failed)throw Error('Incomplete geometry acceptance');
if(Math.abs(g.scale-38.4/2.2)>1e-9||g.mesh.vertexCount>2000||g.mesh.triangleCount>4000||g.sockets.length!==37||g.proxyFillers)throw Error('Invalid player mesh contract');
if(image.totals.alphaOutside||image.totals.outside>Math.max(12,image.totals.changed*.01)||image.totals.black||image.totals.holes||receipt.persistentData||!receipt.passMajor||receipt.poses.length!==37)throw Error('Incomplete image acceptance');
if(review.accepted!==true||review.geometrySha256!==await fileHash(path.join(root,'geometry.json'))||review.imageReviewSha256!==await fileHash(path.join(root,'image-review.json')))throw Error('Visual review does not bind this candidate');
if(receipt.sourceBlendSha256!==g.repairedBlendSha256){
 const proof=await json(path.join(root,'render-reuse-proof.json'));
 if(proof.beforeBlendSha256!==receipt.sourceBlendSha256||proof.afterBlendSha256!==g.repairedBlendSha256||proof.receiptSha256!==await fileHash(path.join(root,'renders/receipt.json')))throw Error('Invalid render inheritance');
}
if(await fileHash(path.join(root,'source.blend'))!==g.repairedBlendSha256)throw Error('Source Blend changed');
const registry=await json('src/config/pipelineAssets.json'),live=registry.assets.find(a=>a.id==='badger');
const oldMeshPath='src/assets/manifests/character-mesh-badger-player-mesh-22-production-r3.json',oldMatPath='src/assets/manifests/character-material-badger-player-material-21e4.json';
if(!apply){
 const oldMesh=await json(oldMeshPath),oldMaterial=await json(oldMatPath),folder=`assets/sprites/pipeline-v2/badger/mesh/${revision}`,materialFolder=`assets/sprites/pipeline-v2/badger/passes/${materialRevision}`;
 if(live.layout.frameCount!==37||live.layout.frameWidth!==128||JSON.stringify(live.pivot)!=='[0.5,0.5]')throw Error('Player layout changed');
 for(let i=0;i<37;i++)for(const hand of ['left','right','weapon']){
  const a=oldMesh.sockets[i][hand],b=g.sockets[i][hand];
  if([...a.position.map((v,j)=>Math.abs(v-b.position[j])),...a.rotationMatrix.map((v,j)=>Math.abs(v-b.rotationMatrix[j]))].some(v=>v>1e-6))throw Error('Hand socket changed');
 }
 const staged=path.join(root,'publication');await fs.mkdir(staged);const files=[];
 async function stage(file,bytes){const member='files/'+file,target=path.join(staged,member);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});files.push({file,member,sha256:hash(bytes),bytes:bytes.length});return hash(bytes);}
 const mesh={...g.mesh};delete mesh.audit;
 for(const key of ['positions','indices']){
  const b=await fs.readFile(path.join(root,g.mesh[key].file));if(hash(b)!==g.mesh[key].sha256)throw Error('Mesh changed');
  const file=`${folder}/badger-${key}-${hash(b)}.bin`;await stage(file,b);mesh[key]={...g.mesh[key],file,url:`${file}?v=${hash(b)}`};
 }
 const meshes=[mesh,...oldMesh.meshes.slice(1)];
 // Held geometry is inherited byte-for-byte; no re-export, socket relocation or new grip policy.
 for(const held of meshes.slice(1))for(const key of ['positions','indices'])if(await fileHash('public/'+held[key].file)!==held[key].sha256)throw Error('Inherited held bytes changed');
 const poses=[];for(const p of oldMesh.poses)poses.push({...p,beautySha256:await fileHash(path.join(root,'renders/beauty',`pose-${String(p.index).padStart(2,'0')}-1024.png`))});
 const meshManifest={...oldMesh,provenance:g.provenance,revision,poses,sockets:g.sockets,meshes,
  downloadBytes:meshes.reduce((s,m)=>s+m.downloadBytes,0),gpuQuantizedBytes:meshes.reduce((s,m)=>s+m.downloadBytes,0),gpuFloat32Bytes:meshes.reduce((s,m)=>s+m.gpuFloat32Bytes,0),
  shadowRepair:{method:'repaired source rig and closed hip geometry; no shadow-only fillers',addedVertices:0,addedTriangles:0},
  source:{blendSha256:g.repairedBlendSha256,geometrySha256:await fileHash(path.join(root,'geometry.json')),inheritedHeldManifestSha256:await fileHash(oldMeshPath)},
  publication:{folder,activation:'R2 source repair; existing frame/canvas/pivot and held anchors preserved',encoding:'Little-endian U16 fixed topology'}};
 delete meshManifest.sourceArchiveSha256;delete meshManifest.sourceSelectionSha256;
 const pages=[],sources=[];
 for(const [index,p]of oldMaterial.pages.entries()){
  const pixels=await sharp('public/'+p.file).ensureAlpha().raw().toBuffer();
  for(const s of oldMaterial.samples.filter(s=>s.page===index)){
   const [left,top,w,h]=s.rect,file=`renders/${s.pass}/pose-${String(s.pose).padStart(2,'0')}-${w}.png`,bytes=await fs.readFile(path.join(root,file)),frame=await sharp(bytes).ensureAlpha().raw().toBuffer();
   if(frame.length!==w*h*4)throw Error('Material frame shape changed');
   sources.push({file,sha256:hash(bytes),rgbaSha256:hash(frame),pose:s.pose,pass:s.pass,sourceSize:w});
   for(let y=-2;y<h+2;y++)for(let x=-2;x<w+2;x++){
    const from=(Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x)))*4,to=((top+y)*p.width+left+x)*4;frame.copy(pixels,to,from,from+4);
   }
  }
  const bytes=await sharp(pixels,{raw:{width:p.width,height:p.height,channels:4}}).png().toBuffer(),file=`${materialFolder}/${p.pass}-${index}-${hash(bytes)}.png`;
  await stage(file,bytes);pages.push({...p,file,url:`${file}?v=${hash(bytes)}`,sha256:hash(bytes),downloadBytes:bytes.length});
 }
 const materialManifest={...oldMaterial,provenance:receipt.provenance,revision:materialRevision,poses,pages,source:{blendSha256:g.repairedBlendSha256,geometrySha256:await fileHash(path.join(root,'geometry.json')),renderReceiptSha256:await fileHash(path.join(root,'renders/receipt.json')),frames:sources},totalDownloadBytes:pages.reduce((s,p)=>s+p.downloadBytes,0)};
 const hashes={};for(const kind of ['idle','sheet'])hashes[kind]=await stage(live[kind+'Path'].replace(/^\.\//,''),await fs.readFile(path.join(root,'exports',`${kind}-128.png`)));
 const selection={schema:'fd-biped-source-selection',revision,assetId:'badger',geometrySha256:await fileHash(path.join(root,'geometry.json')),visualReviewSha256:await fileHash(path.join(root,'visual-review.json')),files};
 await fs.writeFile(path.join(staged,'selection.json'),JSON.stringify(selection,null,2)+'\n');
 await fs.writeFile(path.join(staged,'publication.json'),JSON.stringify({files,meshManifest,materialManifest,registry:{beforeHashes:live.hashes,layout:live.layout,clips:live.clips,revision,hashes},sourceSelectionSha256:await fileHash(path.join(staged,'selection.json'))},null,2)+'\n');
 console.log('R2_PREPARED',files.length,staged);
}else{
 const p=await json(path.join(root,'publication/publication.json')),archive=await json(path.join(root,'archive-receipt.json'));
 if(!archive.verified||await fileHash(path.join(root,archive.file))!==archive.sha256)throw Error('Unsealed archive');
 for(const [member,sha]of Object.entries(archive.files))if(await fileHash(path.join(root,member))!==sha)throw Error('Selected archive member changed: '+member);
 if(JSON.stringify(live.hashes)!==JSON.stringify(p.registry.beforeHashes)||JSON.stringify(live.layout)!==JSON.stringify(p.registry.layout)||JSON.stringify(live.clips)!==JSON.stringify(p.registry.clips))throw Error('Live player source changed');
 const copies=[];for(const file of p.files){if(!file.file.startsWith('assets/sprites/pipeline-v2/badger/')||file.file.includes('..'))throw Error('Unsafe output');const bytes=await fs.readFile(path.join(root,'publication',file.member));if(hash(bytes)!==file.sha256)throw Error('Staged publication changed');copies.push({file:'public/'+file.file,bytes});}
 for(const m of [p.meshManifest,p.materialManifest]){m.sourceSelectionSha256=p.sourceSelectionSha256;m.sourceArchiveSha256=archive.sha256;}
 const meshPath=`src/assets/manifests/character-mesh-badger-${revision}.json`,materialPath=`src/assets/manifests/character-material-badger-${materialRevision}.json`;
 for(const file of [meshPath,materialPath])if(await fs.access(file).then(()=>true,()=>false))throw Error('Immutable destination exists');
 for(const c of copies){await fs.mkdir(path.dirname(c.file),{recursive:true});await fs.writeFile(c.file,c.bytes);if(await fileHash(c.file)!==hash(c.bytes))throw Error('Publication readback mismatch');}
 await fs.writeFile(meshPath,JSON.stringify(p.meshManifest,null,2)+'\n',{flag:'wx'});await fs.writeFile(materialPath,JSON.stringify(p.materialManifest,null,2)+'\n',{flag:'wx'});
 live.hashes=p.registry.hashes;live.revision=revision;await fs.writeFile('src/config/pipelineAssets.json',JSON.stringify(registry,null,2)+'\n');
 for(const [file,oldName,newName]of [['src/assets/CharacterMeshAssets.ts',path.basename(oldMeshPath),path.basename(meshPath)],['src/assets/CharacterMaterialAssetManifest.ts',path.basename(oldMatPath),path.basename(materialPath)]]){
  const text=await fs.readFile(file,'utf8');if(!text.includes(oldName))throw Error('Active manifest changed');await fs.writeFile(file,text.replace(oldName,newName));
 }
 console.log('R2_IMPORTED',revision,copies.length);
}
