import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { reviewWeaponUnions } from './review-weapon-union.mjs';
import { loadMeshBundle, PILOT_POSES, decodePositions, decodeIndices, hash, safeFile } from './mesh-shadow-contract.mjs';
import { gapMetric, assertGapAcceptance, repairFootprintMetric } from './mesh-shadow-gap-metric.mjs';
import { transformPoint, projectPoint, projectMesh, rasterUnion, softMask, bilinear } from './mesh-shadow-raster.mjs';

const DEG = Math.PI / 180, BOUNDS = [-110, -110, 110, 80], DENSITY = 3;
const W = 220, H = 190;
const crcTable = Array.from({length:256},(_,n)=> { for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0; });
function chunk(type, data) {
  const name=Buffer.from(type), size=Buffer.alloc(4), checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);
  let crc=0xffffffff;for(const b of Buffer.concat([name,data]))crc=crcTable[(crc^b)&255]^(crc>>>8);
  checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,name,data,checksum]);
}
/** Full-frame lossless RGBA APNG; SOURCE replacement avoids any animation ghost trails. */
export function encodeApng(frames, width, height, delayMs=70) {
  if(!frames.length||frames.some(f=>f.length!==width*height*4))throw Error('APNG frame size');
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const actl=Buffer.alloc(8);actl.writeUInt32BE(frames.length);
  const chunks=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('acTL',actl)];let sequence=0;
  for(const [i,frame] of frames.entries()) {
    const control=Buffer.alloc(26);control.writeUInt32BE(sequence++);control.writeUInt32BE(width,4);control.writeUInt32BE(height,8);
    control.writeUInt16BE(delayMs,20);control.writeUInt16BE(1000,22); // dispose NONE, blend SOURCE
    chunks.push(chunk('fcTL',control));
    const rows=Buffer.alloc((width*4+1)*height);
    for(let y=0;y<height;y++)frame.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
    const compressed=deflateSync(rows);
    if(i===0)chunks.push(chunk('IDAT',compressed));
    else {const seq=Buffer.alloc(4);seq.writeUInt32BE(sequence++);chunks.push(chunk('fdAT',Buffer.concat([seq,compressed])));}
  }
  chunks.push(chunk('IEND',Buffer.alloc(0)));return Buffer.concat(chunks);
}
const png=(data,width,height)=>sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();
async function rawImage(file) { const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,w:info.width,h:info.height}; }
async function sheet(file, tiles, columns, zoom) {
  const cw=W*zoom,ch=H*zoom+24,rows=Math.ceil(tiles.length/columns),layers=[];
  for(const [i,t] of tiles.entries()) {
    const text=t.label.replace(/[&<>]/g,'');
    layers.push({input:Buffer.from(`<svg width="${cw}" height="24"><text x="5" y="17" font-family="Arial" font-size="12" fill="white">${text}</text></svg>`),left:i%columns*cw,top:Math.floor(i/columns)*ch},
      {input:await png(t.data,cw,H*zoom),left:i%columns*cw,top:Math.floor(i/columns)*ch+24});
  }
  await sharp({create:{width:cw*columns,height:ch*rows,channels:4,background:'#303832'}}).composite(layers).png().toFile(file);
}
function drawSprite(output,w,h,image,toLocal,canvasSize,uvOrigin) {
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const local=toLocal([BOUNDS[0]+(x+.5)/DENSITY,BOUNDS[1]+(y+.5)/DENSITY]);
    const u=(local[0]/canvasSize+uvOrigin[0])*image.w-.5,v=(local[1]/canvasSize+uvOrigin[1])*image.h-.5;
    const alpha=bilinear(image.data,image.w,image.h,u,v,4,3)/255;if(alpha<=0)continue;
    const i=(y*w+x)*4;
    // Premultiplied source sampling avoids dark transparent borders.
    for(let k=0;k<3;k++)output[i+k]=Math.round(output[i+k]*(1-alpha)+bilinear(image.data,image.w,image.h,u,v,4,k));
  }
}
function premultiply(image) {for(let i=0;i<image.data.length;i+=4)for(let k=0;k<3;k++)image.data[i+k]=Math.round(image.data[i+k]*image.data[i+3]/255);return image;}

export async function reviewMeshShadow(root,destination,{poseIndices=PILOT_POSES,production=false}={}) {
  const {manifest:m,meshes}=await loadMeshBundle(root), job=JSON.parse(await readFile(path.join(root,'job.json')));
  await mkdir(destination); // exclusive revision-specific review destination, never overwrite prior output
  let body=meshes.get('badger'),weapon=[...meshes.values()].find(x=>x.spec.id!=='badger');
  if(production)poseIndices=[4,5,10,11];
  if(!poseIndices.length||poseIndices.some(p=>!(production?[4,5,10,11]:PILOT_POSES).includes(p)))throw Error('Unsupported review subset');
  const beauties=new Map();for(const p of poseIndices)beauties.set(p,premultiply(await rawImage(path.join(root,job.beauties[p]))));
  let heldBeauty=premultiply(await rawImage(path.join(root,job.weapon.beauty)));
  const floor=await sharp(path.join(root,'source-ground.png')).resize(W,H).removeAlpha().raw().toBuffer();
  const files=[],metrics=[],width=W*DENSITY,height=H*DENSITY;
  if(m.meshes.some(w=>w.budget?.policy==='held-adaptive-v3')){
    await writeFile(path.join(destination,'weapon-batch-report.json'),await readFile(path.join(root,'weapon-batch-report.json')),{flag:'wx'});
    files.push('weapon-batch-report.json');
  }
  files.push(...await reviewWeaponUnions(root,destination,m));
  function mask(pose,rotation,azimuth,elevation,held=true) {
    const parts=[{xy:projectMesh(body.poses[pose],rotation*DEG,azimuth*DEG,elevation*DEG),indices:body.indices}];
    if(held)parts.push({xy:projectMesh(weapon.poses[0],rotation*DEG,azimuth*DEG,elevation*DEG,m.sockets[pose].weapon),indices:weapon.indices});
    const hard=rasterUnion(parts,BOUNDS,DENSITY);return {hard,soft:softMask(hard,.45*DENSITY)};
  }
  async function compose(pose,rotation,coverage,zoom,{held=true,markers=false,maskOnly=false,diff=null}={}) {
    const out=Buffer.alloc(width*height*4,255),r=rotation*DEG,c=Math.cos(r),s=Math.sin(r);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const p=y*width+x,i=p*4,f=(Math.floor(y/DENSITY)*W+Math.floor(x/DENSITY))*3;
      const lum=floor[f]*.213+floor[f+1]*.715+floor[f+2]*.072;
      for(let k=0;k<3;k++)out[i+k]=maskOnly?255*(1-coverage[p]):(70+lum*.3+(k===1?7:0))*(1-.58*coverage[p]);
      if(diff){out[i]=255*(diff[p]>.5?1:0);out[i+1]=out[i+2]=255*(coverage[p]>.5?1:0);}
    }
    if(!maskOnly&&!diff) {
      drawSprite(out,width,height,beauties.get(pose),([x,y])=>[c*x+s*y,-s*x+c*y],38.4,[.5,.5]);
      if(held) {
        const socket=m.sockets[pose].weapon,a=socket.rotationMatrix,t=socket.position,det=a[0]*a[4]-a[1]*a[3];
        if(Math.abs(det)<.99)throw Error('Pilot weapon beauty requires upright socket; 3D proxy supports general rotations');
        drawSprite(out,width,height,heldBeauty,([x,y])=>{const u=c*x+s*y-t[0],v=-s*x+c*y-t[1];return [(a[4]*u-a[1]*v)/det,(-a[3]*u+a[0]*v)/det];},weapon.spec.beautyCanvasWorldPx,weapon.spec.beautyGripUv);
      }
    }
    if(markers) {
      const socket=m.sockets[pose].weapon;
      for(const [p,col] of [[transformPoint([0,0,0],r,socket),[255,220,0]],
        [projectPoint(transformPoint([0,0,0],r,socket),45*DEG,35*DEG),[0,255,255]]]) {
        const xx=Math.round((p[0]-BOUNDS[0])*DENSITY),yy=Math.round((p[1]-BOUNDS[1])*DENSITY);
        for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++)if((dx===0||dy===0)&&xx+dx>=0&&xx+dx<width&&yy+dy>=0&&yy+dy<height) {
          const i=((yy+dy)*width+xx+dx)*4;out.set(col,i);
        }
      }
    }
    return zoom===3?out:sharp(out,{raw:{width,height,channels:4}}).resize(W,H).raw().toBuffer();
  }
  if(production) {
    const fixed=body,b=m.shadowRepair?.baseline;if(!b)throw Error('Production review requires unfilled baseline');
    const buffers=await Promise.all([b.positions,b.indices].map(async f=>{const bytes=await readFile(path.join(root,safeFile(f.file)));
      if(hash(bytes)!==f.sha256||bytes.length!==f.bytes)throw Error('Changed unfilled baseline');return bytes;}));
    const baseline={spec:b,indices:decodeIndices(b,buffers[1]),poses:b.poseIndices.map((_,i)=>decodePositions(b,buffers[0],i))};
    const gaps=gapMetric(baseline,fixed,{progress:p=>console.log('FD_MESH_GAP '+p)});
    gaps.footprint=repairFootprintMetric(baseline,fixed);
    await writeFile(path.join(destination,'gap-metric.json'),JSON.stringify(gaps,null,2)+'\n',{flag:'wx'});
    await writeFile(path.join(destination,'gap-by-pose.csv'),'pose,samples,before,after,maxBeforeWorld2,maxAfterWorld2\n'+gaps.byPose.map(r=>[r.pose,r.samples,r.before,r.after,r.maxMissingBeforeWorld2,r.maxMissingAfterWorld2].join(',')).join('\n')+'\n',{flag:'wx'});
    const lines=['2 world-px corridor / coverage 50% / minimum missing area 0.5 world-px2',`All ${gaps.samples} combinations: before ${gaps.before}, after ${gaps.after}`,
      'Pose    Samples    Before    After    Max missing before / after',...gaps.byPose.map(r=>`${String(r.pose).padStart(2)}         ${r.samples}        ${String(r.before).padStart(2)}         ${String(r.after).padStart(2)}           ${r.maxMissingBeforeWorld2} / ${r.maxMissingAfterWorld2}`)];
    await sharp(Buffer.from(`<svg width="720" height="${lines.length*22+12}"><rect width="100%" height="100%" fill="#303832"/>${lines.map((s,i)=>`<text x="8" y="${20+i*22}" font-size="14" font-family="monospace" fill="white" xml:space="preserve">${s}</text>`).join('')}</svg>`)).png().toFile(path.join(destination,'gap-by-pose.png'));
    files.push('gap-metric.json','gap-by-pose.csv','gap-by-pose.png');
    const detailTiles=[];
    for(const pose of poseIndices){const worst=gaps.rows.filter(r=>r.pose===pose).sort((a,b)=>Math.max(0,...b.legs.map(l=>l.missingBeforeWorld2))-Math.max(0,...a.legs.map(l=>l.missingBeforeWorld2)))[0];
      body=baseline;const a=mask(pose,0,worst.azimuth,worst.elevation,false).soft;body=fixed;const b=mask(pose,0,worst.azimuth,worst.elevation,false).soft;
      for(const mode of ['BEFORE','AFTER','DIFF','BEAUTY'])detailTiles.push({label:`P${pose} L${worst.azimuth}/${worst.elevation} ${mode}`,data:await compose(pose,0,mode==='BEFORE'?a:b,3,{held:false,maskOnly:['BEFORE','AFTER'].includes(mode),diff:mode==='DIFF'?a:null})});
    }
    await sheet(path.join(destination,'worst-gap-before-after.png'),detailTiles,4,3);files.push('worst-gap-before-after.png');
    for(const pose of poseIndices) {
      const frames={1:[],3:[]},tiles={1:[],3:[]};
      for(let rotation=0;rotation<360;rotation+=5){
        body=baseline;const before=mask(pose,rotation,45,35,false).soft;body=fixed;const after=mask(pose,rotation,45,35,false).soft;
        for(const zoom of [1,3]){const a=await compose(pose,rotation,before,zoom,{held:false}),b=await compose(pose,rotation,after,zoom,{held:false});
          tiles[zoom].push({label:`P${pose} R${rotation} BEFORE`,data:a},{label:`P${pose} R${rotation} AFTER`,data:b});
          const w=W*zoom,h=H*zoom,combined=Buffer.alloc(w*h*8);
          for(let y=0;y<h;y++){a.copy(combined,y*w*8,y*w*4,(y+1)*w*4);b.copy(combined,y*w*8+w*4,y*w*4,(y+1)*w*4);}frames[zoom].push(combined);
        }
      }
      for(const zoom of [1,3]){
        const name=`rotation-p${pose}-before-after-z${zoom}`;
        // Four 90-degree contact sheets avoid giant, unreadable PNGs.
        for(let page=0;page<4;page++){const file=`${name}-${page}.png`;await sheet(path.join(destination,file),tiles[zoom].slice(page*36,(page+1)*36),6,zoom);files.push(file);}
        await writeFile(path.join(destination,name+'.apng'),encodeApng(frames[zoom],W*zoom*2,H*zoom),{flag:'wx'});files.push(name+'.apng');
      }
      console.log('FD_MESH_PRODUCTION_REVIEW '+pose);
    }
    const weaponTiles=[];body=fixed;
    for(const w of job.weapons){weapon=meshes.get(w.render.id);if(!weapon)throw Error('Missing held proxy '+w.render.id);
      heldBeauty=premultiply(await rawImage(path.join(root,w.beauty)));
      for(const rotation of [0,45,90])weaponTiles.push({label:`${w.render.id} P4 R${rotation} sun45/35`,data:await compose(4,rotation,mask(4,rotation,45,35).soft,3,{markers:true})});
    }
    for(let at=0;at<weaponTiles.length;at+=21){const file=`weapons-in-hand-${at/21+1}.png`;await sheet(path.join(destination,file),weaponTiles.slice(at,at+21),3,3);files.push(file);}
    const report={status:gaps.after?'gap-gate-failed':'awaiting-human-review',reviewFiles:files,poseIndices,rotations:'0..355 in 5-degree steps; paired APNG left BEFORE/right AFTER; 70ms',
      zooms:[1,3],gapSummary:{samples:gaps.samples,before:gaps.before,after:gaps.after},weaponCount:job.weapons.length,
      notes:['Body-only rotation comparison; source Beauty unchanged.','Weapons use the actual palm socket and grip-local geometry; yellow=grip, cyan=ground projection.',
        '2px corridor tests the same baseline anatomical ROI before/after, not global connectivity or arm holes.','Software reference only; no Blender render, runtime or GPU visual acceptance.']};
    await writeFile(path.join(destination,'review.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    assertGapAcceptance(gaps);
    if(gaps.footprint.maxAddedWorld2>.125)throw Error('Repair widens the top-down body footprint; inspect gap-metric.json');
    return report;
  }
  const heightTiles={1:[],3:[]},anchorTiles=[];
  for(const pose of poseIndices) {
    const frames={1:[],3:[]};
    for(let rotation=0;rotation<=90;rotation+=5) {
      const coverage=mask(pose,rotation,45,35).soft;
      for(const zoom of [1,3])frames[zoom].push({label:`P${pose} R${rotation} sun45/35 zoom${zoom}`,data:await compose(pose,rotation,coverage,zoom)});
      if(rotation%30===0)anchorTiles.push({label:`P${pose} R${rotation}: yellow=grip, cyan=ground`,data:await compose(pose,rotation,coverage,3,{markers:true})});
    }
    for(const zoom of [1,3]) {
      const name=`rotation-p${pose}-z${zoom}`;
      await sheet(path.join(destination,name+'.png'),frames[zoom],5,zoom);files.push(name+'.png');
      // Ping-pong: 0..90..5, so the loop boundary also advances by exactly five degrees.
      const pingpong=[...frames[zoom],...frames[zoom].slice(1,-1).reverse()].map(f=>f.data);
      await writeFile(path.join(destination,name+'.apng'),encodeApng(pingpong,W*zoom,H*zoom),{flag:'wx'});files.push(name+'.apng');
    }
    for(const elevation of [20,28,35,45,60]) {
      const coverage=mask(pose,0,45,elevation).soft;
      for(const zoom of [1,3])heightTiles[zoom].push({label:`P${pose} sun45/${elevation} zoom${zoom}`,data:await compose(pose,0,coverage,zoom)});
    }
    const comparisons=[];
    for(const ref of job.references.filter(x=>x.pose===pose)) {
      const {data:raw,info}=await sharp(path.join(root,ref.file)).greyscale().raw().toBuffer({resolveWithObject:true});
      const coverage=new Float32Array(width*height),c=ref.canvas;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)coverage[y*width+x]=bilinear(raw,info.width,info.height,
        (BOUNDS[0]+(x+.5)/DENSITY-c.boundsWorld[0])*c.texelsPerWorldPx-.5,
        (BOUNDS[1]+(y+.5)/DENSITY-c.boundsWorld[1])*c.texelsPerWorldPx-.5)/255;
      const projected=mask(pose,0,ref.azimuth,35,false);let intersection=0,union=0;
      for(let i=0;i<coverage.length;i++){const a=coverage[i]>.5,b=projected.hard.data[i]>0;intersection+=a&&b?1:0;union+=a||b?1:0;}
      metrics.push({pose,azimuth:ref.azimuth,iouHardAtHalfCoverage:intersection/union});
      for(const mode of ['D','Mesh','Diff','Beauty'])comparisons.push({label:`P${pose} L${ref.azimuth}/35 ${mode}`,data:await compose(pose,0,mode==='D'?coverage:projected.soft,1,
        {held:false,maskOnly:mode==='D'||mode==='Mesh',diff:mode==='Diff'?coverage:null})});
    }
    const file=`reference-p${pose}.png`;await sheet(path.join(destination,file),comparisons,4,1);files.push(file);
    console.log(`FD_MESH_REVIEW pose ${pose}`);
  }
  for(const zoom of [1,3]) {const file=`elevations-z${zoom}.png`;await sheet(path.join(destination,file),heightTiles[zoom],5,zoom);files.push(file);}
  await sheet(path.join(destination,'weapon-anchors-z3.png'),anchorTiles,4,3);files.push('weapon-anchors-z3.png');
  const report={status:'awaiting-human-review',reviewFiles:files,poseIndices,rotations:'0..90 by 5 degrees; APNG ping-pong at 70ms/frame',
    zooms:[1,3],boundsWorld:BOUNDS,blurSigmaWorld:.45,metrics,
    notes:['No angular mask blending. Each frame is newly projected from fixed mesh topology.',
      'Beauty uses source right-palm socket, not the old runtime anchor. Yellow: grip in top view; cyan: its ground projection.',
      'D comparison is body-only at 35 degrees; red=D-only, cyan=mesh-only, white=overlap, black=empty.',
      'Blur is constant reference softness, not height-dependent solar penumbra. IoU is diagnostic, not visual acceptance.',
      'Source beauty retains baked lighting; no runtime/GPU/browser verification.']};
  await writeFile(path.join(destination,'review.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
