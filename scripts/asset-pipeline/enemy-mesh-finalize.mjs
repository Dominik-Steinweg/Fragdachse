/** Seal review evidence and an import-ready contract; never publishes or imports. */
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import {validateEnemyMeshManifest,decodeEnemyMesh} from './enemy-mesh-contract.mjs';
import {enemyFileHash} from './enemy-mesh-sources.mjs';
const {values}=parseArgs({options:{revision:{type:'string'},review:{type:'string'}}});
if(!/^enemy-mesh-[a-z0-9-]+$/.test(values.revision)||!values.review)throw Error('Revision and actual visual review required');
const root=path.join('D:/Fragdachse-render',values.revision),read=async file=>JSON.parse(await readFile(file,'utf8'));
const visual=await read(values.review);
if(visual.revision!==values.revision||visual.status!=='reviewed-not-imported'||!visual.assessment)throw Error('Missing own review');
const results=[],sealed=[];
for(const id of ['zombie-badger','rabid-badger']){
  const directory=path.join(root,id),job=await read(path.join(directory,'job.json'));
  for(const [member,hash]of Object.entries(job.sourceFiles))if(await enemyFileHash(path.join(directory,member))!==hash)throw Error('Changed input '+member);
  const manifest=validateEnemyMeshManifest(await read(path.join(directory,'mesh-manifest.json')));
  decodeEnemyMesh(manifest.mesh,await readFile(path.join(directory,manifest.mesh.positions.file)),await readFile(path.join(directory,manifest.mesh.indices.file)));
  const source=await read(path.join(directory,'corridors.json')),proxy=await read(path.join(directory,'proxy-corridors.json'));
  if(source.samples!==118||source.probes!==38232||proxy.probes!==10044||source.flaggedAfter||proxy.flaggedAfter
    ||source.rows.some(r=>!r.after.endpointsCovered)||proxy.rows.some(r=>!r.after.endpointsCovered))throw Error('Incomplete/failed attachment gate');
  const silhouette=await read(path.join(directory,'silhouette-review.json')),difference=await read(path.join(directory,'beauty-difference.json'));
  if(silhouette.samples!==2511||silhouette.texelsPerWorldPx!==6||silhouette.confirmationTexelsPerWorldPx!==12
    ||silhouette.minimumIou<.95||silhouette.minimumFineIou<.95)throw Error(id+' full silhouette gate requires IoU >= .95 at both densities');
  if(difference.rows.length!==31||difference.outsideRepairAlphaPixels!==0
    ||difference.outsideRepairPixels>Math.max(12,difference.changedPixels*.01))throw Error('Beauty change not sufficiently localized');
  const passes=await read(path.join(directory,'render-passes.json'));
  if(passes.frames.length!==31||passes.sourceBlendSha256!==await enemyFileHash(path.join(directory,'render-source.blend')))throw Error('Render source changed');
  const images={},materialMetrics={maxNormalLengthError:0,checkedFrames:0};
  for(const mode of ['beauty','albedo','normal','emission']){
    for(let pose=0;pose<31;pose++){
      const member=`${mode}/masters/frame-${String(pose).padStart(4,'0')}.png`,file=path.join(directory,member),meta=await sharp(file).metadata();
      if(meta.width!==1024||meta.height!==1024||meta.channels!==4)throw Error('Master canvas changed');
      images[member]=await enemyFileHash(file);
      if(mode==='beauty'&&images[member]!==passes.frames[pose].beautySha256)throw Error('Changed rendered Beauty');
    }
    for(const size of [64,128]){
      const member=`${mode}/sheet-${size}.png`,file=path.join(directory,member),meta=await sharp(file).metadata();
      const width=8*(size+4),height=4*(size+4);
      if(meta.width!==width||meta.height!==height)throw Error('Atlas layout changed');
      const sheet=await sharp(file).ensureAlpha().raw().toBuffer();images[member]=await enemyFileHash(file);
      for(let pose=0;pose<31;pose++){
        const frame=`frame-${String(pose).padStart(4,'0')}.png`,tile=await sharp(path.join(directory,mode,String(size),frame)).ensureAlpha().raw().toBuffer();
        const x=2+(pose%8)*(size+4),y=2+Math.floor(pose/8)*(size+4);
        for(let row=0;row<size;row++)if(!tile.subarray(row*size*4,(row+1)*size*4).equals(sheet.subarray(((y+row)*width+x)*4,((y+row)*width+x+size)*4)))throw Error('Atlas changed data channels');
        if(mode==='normal'){
          const albedo=await sharp(path.join(directory,'albedo',String(size),frame)).raw().toBuffer();
          for(let i=0;i<tile.length;i+=4)if(albedo[i+3]>=128){const length=Math.hypot(tile[i]/255*2-1,tile[i+1]/255*2-1,tile[i+2]/255*2-1);materialMetrics.maxNormalLengthError=Math.max(materialMetrics.maxNormalLengthError,Math.abs(length-1));}
          materialMetrics.checkedFrames++;
        }
      }
    }
  }
  if(materialMetrics.maxNormalLengthError>.015)throw Error('Invalid normal encoding');
  const evidence={};
  for(const name of ['corridors.json','proxy-corridors.json','silhouette-review.json','beauty-difference.json','render-passes.json','candidate.blend','render-source.blend','repair-bounds.json','source-geometry-proof.json'])evidence[name]=await enemyFileHash(path.join(directory,name));
  const final={...manifest,status:'reviewed-not-imported',clips:job.render.clips,layout:job.layout,
    images,materialEncoding:{albedo:passes.albedoEncoding,normal:passes.normalEncoding,emission:passes.emissionEncoding},
    validation:{sourceProbes:source.probes,decodedProbes:proxy.probes,fullSilhouettes:silhouette.samples,minimumIou:silhouette.minimumIou,
      minimumFineIou:silhouette.minimumFineIou,meanIou:silhouette.meanIou,beautyOutsideRepairPixels:difference.outsideRepairPixels,beautyOutsideRepairAlphaPixels:0,materialMetrics,evidence},
    visualReview:visual,importAuthority:'R3 after Claude review; this file performs no import'};
  validateEnemyMeshManifest(final);
  sealed.push({file:path.join(directory,'enemy-mesh.json'),value:final});
  results.push({id,vertices:manifest.mesh.vertexCount,triangles:manifest.mesh.triangleCount,downloadBytes:manifest.mesh.downloadBytes,gpuFloat32Bytes:manifest.mesh.gpuFloat32Bytes,...final.validation,evidence:undefined});
}
for(const {file,value} of sealed)await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const archiveTools=path.join(root,'review-tools');await mkdir(archiveTools);
for(const file of await readdir('scripts/asset-pipeline'))if(file.startsWith('enemy-mesh-')||file.startsWith('enemy_mesh_')||file==='ENEMY-MESH.md')await copyFile(path.join('scripts/asset-pipeline',file),path.join(archiveTools,file),constants.COPYFILE_EXCL);
await copyFile(values.review,path.join(root,'visual-review.json'),constants.COPYFILE_EXCL);
for(const file of ['r1-beauty.png','r1-shadow.png','r1-difference.png'])await copyFile(path.join('build/enemy-mesh',file),path.join(root,file),constants.COPYFILE_EXCL);
await writeFile(path.join(root,'review-result.json'),JSON.stringify({revision:values.revision,status:'reviewed-not-imported',results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results,null,2));
