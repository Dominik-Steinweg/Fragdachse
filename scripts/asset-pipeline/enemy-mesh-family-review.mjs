import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {ENEMY_MESH_VIEWS,decodeEnemyMesh,validateEnemyMeshManifest} from './enemy-mesh-contract.mjs';
import {project,extents,raster,compare} from './enemy-mesh-raster.mjs';

const {values}=parseArgs({options:{revision:{type:'string'},phase:{type:'string',default:'all'},asset:{type:'string'},family:{type:'string',default:'all'}}});
if(!/^enemy-mesh-[a-z0-9-]+$/.test(values.revision)||!['all','shadow','beauty'].includes(values.phase))throw Error('Explicit revision and review phase required');
const root=path.resolve('D:/Fragdachse-render',values.revision), review=path.resolve('build/enemy-mesh');
const families=JSON.parse(await readFile('scripts/asset-pipeline/enemy-mesh-families.json','utf8')).assets.concat(['alien-badger','pyro-badger'].map(id=>({id,family:'biped'})));
const ids=values.asset?[values.asset]:families.filter(a=>values.family==='all'||a.family===values.family).map(a=>a.id);
if(!ids.length||ids.some(id=>!families.some(a=>a.id===id)))throw Error('Unknown family asset');
await mkdir(review,{recursive:true});
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const array=async(file,Type)=>{const b=await readFile(file);return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const frame=p=>`frame-${String(p).padStart(4,'0')}.png`;
const svg=(width,height,text)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#20272d"/><text x="12" y="25" font-family="Arial" font-size="16" fill="#eef1f3">${text}</text></svg>`);
const shadowComposites=[],beautyComposites=[],diffComposites=[],summaries=[];
const width=1440,cell=280,left=40,header=52;

for(const [assetIndex,id] of ids.entries()){
  const directory=path.join(root,id),job=await json(path.join(directory,'job.json'));
  try{await access(path.join(directory,'enemy-mesh.json'));throw Error('Review is sealed; use a fresh revision');}catch(e){if(e.code!=='ENOENT')throw e;}
  const selected=[0,4,10,19,21];
  if(values.phase!=='beauty'){
    const m=validateEnemyMeshManifest(await json(path.join(directory,'mesh-manifest.json')));
    const pb=await readFile(path.join(directory,m.mesh.positions.file)),ib=await readFile(path.join(directory,m.mesh.indices.file));
    if(sha(pb)!==m.mesh.positions.sha256||sha(ib)!==m.mesh.indices.sha256)throw Error('Changed export bytes');
    const decoded=decodeEnemyMesh(m.mesh,pb,ib),meta=await json(path.join(directory,'review-source/source.json'));
    for(const [file,hash]of Object.entries(meta.files))if(sha(await readFile(path.join(directory,'review-source',file)))!==hash)throw Error('Changed source extraction');
    const sp=await array(path.join(directory,'review-source/positions.bin'),Float32Array),si=await array(path.join(directory,'review-source/indices.bin'),Uint32Array);
    const beforeKind=meta.beforeSourceVertexCount?'source':'proxy',beforeVertices=meta.beforeSourceVertexCount??m.mesh.vertexCount;
    const bp=await array(path.join(directory,`review-source/before-${beforeKind}-positions.bin`),Float32Array),bi=await array(path.join(directory,`review-source/before-${beforeKind}-indices.bin`),Uint32Array);
    const rows=[];
    for(let pose=0;pose<31;pose++){
      const source=sp.subarray(pose*meta.vertexCount*3,(pose+1)*meta.vertexCount*3);
      const proxy=decoded.positions.subarray(pose*m.mesh.vertexCount*3,(pose+1)*m.mesh.vertexCount*3);
      for(const view of [...ENEMY_MESH_VIEWS,{azimuth:0,elevation:90}]){
        const s=project(source,view.azimuth,view.elevation),p=project(proxy,view.azimuth,view.elevation);
        const se=extents(s),pe=extents(p),bounds=[Math.floor(Math.min(se[0],pe[0]))-2,Math.floor(Math.min(se[1],pe[1]))-2,Math.ceil(Math.max(se[2],pe[2]))+2,Math.ceil(Math.max(se[3],pe[3]))+2];
        // Tiny enemies have only ~1000 binary pixels at density 3. Independently
        // sample at 6 and 12 so a handful of aliased fringe pixels cannot decide QA.
        const sm=raster(s,si,bounds,6),pm=raster(p,decoded.indices,bounds,6);
        const fine=compare(raster(s,si,bounds,12),raster(p,decoded.indices,bounds,12));
        rows.push({pose,...view,...compare(sm,pm),fineIou:fine.iou});
      }
      console.log(`FD_ENEMY_SILHOUETTE ${id} p${pose} minIoU=${Math.min(...rows.filter(r=>r.pose===pose).map(r=>r.iou)).toFixed(5)}`);
    }
    const report={samples:rows.length,texelsPerWorldPx:6,confirmationTexelsPerWorldPx:12,
      minimumIou:Math.min(...rows.map(r=>r.iou)),minimumFineIou:Math.min(...rows.map(r=>r.fineIou)),
      meanIou:rows.reduce((s,r)=>s+r.iou,0)/rows.length,below095:rows.filter(r=>r.iou<.95||r.fineIou<.95).length,rows};
    await writeFile(path.join(directory,'silhouette-review.json'),JSON.stringify(report,null,2)+'\n');
    summaries.push({id,kind:'shadow',...report,rows:undefined});
    const ybase=assetIndex*620;
    shadowComposites.push({input:svg(width,header,`${id} | P${selected.join(' / P')} | oben: altes Quellmesh, unten: neuer Export | Sonne 180/35, ungeblurt`),left:0,top:ybase});
    for(const [column,pose]of selected.entries()){
      const before=project(bp.subarray(pose*beforeVertices*3,(pose+1)*beforeVertices*3),180,35);
      const after=project(decoded.positions.subarray(pose*m.mesh.vertexCount*3,(pose+1)*m.mesh.vertexCount*3),180,35);
      const b=extents(before),a=extents(after),bounds=[Math.floor(Math.min(a[0],b[0]))-2,Math.floor(Math.min(a[1],b[1]))-2,Math.ceil(Math.max(a[2],b[2]))+2,Math.ceil(Math.max(a[3],b[3]))+2];
      for(const [row,mask]of [raster(before,bi,bounds,5),raster(after,decoded.indices,bounds,5)].entries()){
        const pixels=Buffer.alloc(mask.data.length*4);
        for(let i=0;i<mask.data.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=mask.data[i]?28:187;pixels[i*4+3]=255;}
        shadowComposites.push({input:await sharp(pixels,{raw:{width:mask.width,height:mask.height,channels:4}}).resize(cell-8,cell-8,{fit:'contain',background:'#bbbbbb',kernel:'nearest'}).png().toBuffer(),left:left+column*cell,top:ybase+header+row*cell});
      }
    }
  }
  if(values.phase!=='shadow'){
    const renders=await json(path.join(directory,'render-passes.json'));
    if(renders.frames.length!==31)throw Error('Missing material poses');
    const regions=await json(path.join(directory,'repair-bounds.json')),rows=[];
    for(const mode of ['beauty','albedo','normal','emission']){
      for(const size of [...new Set([64,128,job.layout.frameWidth])]){
        const atlasWidth=8*(size+4),atlasHeight=4*(size+4),atlas=Buffer.alloc(atlasWidth*atlasHeight*4);
        if(mode==='normal')for(let i=0;i<atlas.length;i+=4){atlas[i]=128;atlas[i+1]=128;atlas[i+2]=255;atlas[i+3]=255;}
        for(let pose=0;pose<31;pose++){
          let input;
          if(mode==='beauty'){
            input=await sharp(path.join(directory,mode,'masters',frame(pose))).resize(size,size,{kernel:'lanczos3'}).png().toBuffer();
            await writeFile(path.join(directory,mode,String(size),frame(pose)),input);
          }else input=await readFile(path.join(directory,mode,String(size),frame(pose)));
          const pixels=await sharp(input).ensureAlpha().raw().toBuffer(),x=2+(pose%8)*(size+4),y=2+Math.floor(pose/8)*(size+4);
          // Data alpha is AO, not opacity: byte-copy tiles, never alpha composite.
          for(let row=0;row<size;row++)pixels.copy(atlas,((y+row)*atlasWidth+x)*4,row*size*4,(row+1)*size*4);
        }
        await sharp(atlas,{raw:{width:atlasWidth,height:atlasHeight,channels:4}}).png().toFile(path.join(directory,mode,`sheet-${size}.png`));
      }
    }
    const ybase=assetIndex*640;
    beautyComposites.push({input:svg(width,header,`${id} | P${selected.join(' / P')} | oben: Alt, unten: Neu | identischer Zoom aus den 1024px-Mastern`),left:0,top:ybase});
    diffComposites.push({input:svg(width,header,`${id} | P${selected.join(' / P')} | Orange: lokal, Rot: ausserhalb Reparaturregion | Delta >= 8/255`),left:0,top:assetIndex*340});
    for(let pose=0;pose<31;pose++){
      const old=await sharp(path.join(directory,'source-beauty',frame(pose))).resize(128,128).ensureAlpha().raw().toBuffer();
      const current=await sharp(path.join(directory,'beauty/128',frame(pose))).raw().toBuffer();
      const mask=new Uint8Array(128*128),delta=Buffer.alloc(128*128*4),ortho=job.coordinates.orthoScaleBlender;
      // Per-object old/new anatomical bounds, plus AO/filter support (0.2 Blender units).
      for(const b of regions[pose]){
        const pad=.2*128/ortho+2;
        const x0=Math.max(0,Math.floor((.5+b.min[0]/ortho)*128-pad)),x1=Math.min(127,Math.ceil((.5+b.max[0]/ortho)*128+pad));
        const y0=Math.max(0,Math.floor((.5-b.max[1]/ortho)*128-pad)),y1=Math.min(127,Math.ceil((.5-b.min[1]/ortho)*128+pad));
        for(let y=y0;y<=y1;y++)mask.fill(1,y*128+x0,y*128+x1+1);
      }
      let changed=0,outside=0,insidePixels=0,alphaChanged=0,outsideAlpha=0,outsideSum=0,outsideCount=0;
      for(let i=0;i<mask.length;i++){
        const j=i*4,a=old[j+3]/255,b=current[j+3]/255;
        const d=Math.max(Math.abs(old[j]*a-current[j]*b),Math.abs(old[j+1]*a-current[j+1]*b),Math.abs(old[j+2]*a-current[j+2]*b),Math.abs(old[j+3]-current[j+3]));
        insidePixels+=mask[i];if(!mask[i]){outsideSum+=d;outsideCount++;}
        if(d>=8){changed++;if(!mask[i])outside++;}
        if(Math.abs(old[j+3]-current[j+3])>=8){alphaChanged++;if(!mask[i])outsideAlpha++;}
        delta[j]=d>=8?255:current[j]*b*.25;delta[j+1]=d>=8?(mask[i]?155:25):current[j+1]*b*.25;delta[j+2]=d>=8?20:current[j+2]*b*.25;delta[j+3]=255;
      }
      rows.push({pose,changedPixels:changed,outsideRepairPixels:outside,alphaChangedPixels:alphaChanged,outsideRepairAlphaPixels:outsideAlpha,repairRegionPixels:insidePixels,outsideMaximumChannelMean:outsideSum/outsideCount});
      const column=selected.indexOf(pose);
      if(column>=0){
        for(const [row,folder]of ['source-beauty','beauty/masters'].entries())beautyComposites.push({input:await sharp(path.join(directory,folder,frame(pose))).extract({left:256,top:224,width:512,height:512}).resize(cell-8,cell-8,{kernel:'lanczos3'}).png().toBuffer(),left:left+column*cell,top:ybase+header+row*cell});
        diffComposites.push({input:await sharp(delta,{raw:{width:128,height:128,channels:4}}).extract({left:32,top:28,width:64,height:64}).resize(cell-8,cell-8,{kernel:'nearest'}).png().toBuffer(),left:left+column*cell,top:assetIndex*340+header});
      }
    }
    const report={resolution:128,comparison:'premultiplied RGBA max-channel absolute delta >= 8/255',repairPaddingBlender:.2,filterPaddingPx:2,changedPixels:rows.reduce((s,r)=>s+r.changedPixels,0),outsideRepairPixels:rows.reduce((s,r)=>s+r.outsideRepairPixels,0),outsideRepairAlphaPixels:rows.reduce((s,r)=>s+r.outsideRepairAlphaPixels,0),rows};
    await writeFile(path.join(directory,'beauty-difference.json'),JSON.stringify(report,null,2)+'\n');
    summaries.push({id,kind:'beauty',...report,rows:undefined});
  }
}
for(const [name,items,height]of [['r4-shadow.png',shadowComposites,ids.length*620],['r4-beauty.png',beautyComposites,ids.length*640],['r4-difference.png',diffComposites,ids.length*340]]){
  if(items.length)await sharp({create:{width,height,channels:4,background:'#454d54'}}).composite(items).png().toFile(path.join(review,(values.asset??values.family)+'-'+name));
}
await writeFile(path.join(review,`${values.asset??values.family}-${values.phase}-metrics.json`),JSON.stringify({revision:values.revision,results:summaries},null,2)+'\n');
console.log(JSON.stringify(summaries,null,2));
