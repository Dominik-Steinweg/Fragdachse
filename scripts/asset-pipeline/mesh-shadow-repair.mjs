/** Shadow-only anatomy adapter. Fixed rest vertex weights follow the actual baked parts. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hash, loadMeshBundle } from './mesh-shadow-contract.mjs';
const add=(a,b)=>a.map((v,k)=>v+b[k]), sub=(a,b)=>a.map((v,k)=>v-b[k]);
const mul=(a,s)=>a.map(v=>v*s), dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/Math.hypot(...a)), point=(p,i)=>Array.from(p.subarray(i*3,i*3+3));
export function anatomicalParts(body) {
  let start=0;
  return body.spec.audit.parts.map(p=>{const vertices=Array.from({length:p.proxyVertices},(_,i)=>start+i);start+=p.proxyVertices;
    const set=new Set(vertices),indices=[];for(let j=0;j<body.indices.length;j+=3)if(set.has(body.indices[j])) {
      if(!set.has(body.indices[j+1])||!set.has(body.indices[j+2]))throw Error('Cross-part anatomy triangle');
      indices.push(...body.indices.subarray(j,j+3));
    }return {name:p.object,vertices,indices:new Uint16Array(indices)};
  });
}
function mean(p,ids){return ids.reduce((a,i)=>add(a,mul(point(p,i),1/ids.length)),[0,0,0]);}
function planes(p,part) {
  const center=mean(p,part.vertices),out=[];
  for(let i=0;i<part.indices.length;i+=3){const [a,b,c]=Array.from(part.indices.subarray(i,i+3),j=>point(p,j));
    let n=cross(sub(b,a),sub(c,a));if(Math.hypot(...n)<1e-8)continue;n=unit(n);if(dot(n,sub(a,center))<0)n=mul(n,-1);
    out.push({n,d:dot(n,a)});
  }return out;
}
export function repairLegConnections(body,{radius=2.35,hipInward=.3,topFraction=.72}={}) {
  const parts=anatomicalParts(body),pelvis=parts.find(p=>p.name==='Pelvis'),legs=parts.filter(p=>/^Upright hind leg(?:\.\d+)?$/.test(p.name));
  if(!pelvis||legs.length!==2)throw Error('Badger anatomy adapter needs exactly pelvis and two legs');
  const rest=body.poses[0],rings=4,sides=12,perLeg=rings*sides+2,extra=perLeg*2;
  // Fixed convex averages of rest-selected vertices, not per-pose nearest points.
  const anchors=legs.map(leg=>{
    const zs=leg.vertices.map(i=>rest[i*3+2]),cut=Math.min(...zs)+topFraction*(Math.max(...zs)-Math.min(...zs));
    const top=leg.vertices.filter(i=>rest[i*3+2]>=cut),side=Math.sign(mean(rest,leg.vertices)[0]);
    const hip=pelvis.vertices.filter(i=>rest[i*3]*side>2 && rest[i*3+2]<17 && rest[i*3+2]>12);
    if(top.length<3||hip.length<3)throw Error('Missing attachment region');
    return {leg,top,hip};
  });
  const triangles=Array.from(body.indices),evidence=[];
  for(let l=0;l<2;l++){const base=body.spec.vertexCount+l*perLeg;
    for(let r=0;r<rings-1;r++)for(let s=0;s<sides;s++){const a=base+r*sides+s,b=base+r*sides+(s+1)%sides;
      triangles.push(a,b,a+sides,b,b+sides,a+sides);}
    for(let s=0;s<sides;s++)triangles.push(base+rings*sides,base+(s+1)%sides,base+s,
      base+rings*sides+1,base+(rings-1)*sides+s,base+(rings-1)*sides+(s+1)%sides);
  }
  const poses=body.poses.map((p,pose)=>{
    const out=new Float32Array(p.length+extra*3);out.set(p);
    for(const [l,a] of anchors.entries()) {
      const start=mean(p,a.top),end=add(mul(mean(p,a.hip),1-hipInward),mul(mean(p,pelvis.vertices),hipInward)),axis=unit(sub(end,start));
      const u=unit(cross(axis,[1,0,0])),v=unit(cross(axis,u));
      const pp=[planes(p,a.leg),planes(p,pelvis)],centers=[start,end];
      const clearance=centers.map((c,k)=>Math.min(...pp[k].map(f=>f.d-dot(f.n,c))));
      if(Math.min(...clearance)<.25)throw Error(`Attachment outside source volume P${pose} ${a.leg.name}`);
      // Endpoint disks lie strictly inside both convex source parts. Middle radii
      // never exceed the upper leg width; no screen-space dilation or hole fill.
      const radii=[Math.min(radius,clearance[0]*.9),radius,radius,Math.min(radius,clearance[1]*.9)];
      const base=body.spec.vertexCount+l*perLeg;
      for(let r=0;r<rings;r++)for(let s=0;s<sides;s++) {
        const c=add(start,mul(sub(end,start),r/(rings-1))),angle=s/sides*Math.PI*2;
        out.set(add(c,add(mul(u,Math.cos(angle)*radii[r]),mul(v,Math.sin(angle)*radii[r]))),(base+r*sides+s)*3);
      }
      out.set(start,(base+rings*sides)*3);out.set(end,(base+rings*sides+1)*3);
      evidence.push({pose,leg:a.leg.name,start,end,endpointClearanceWorld:clearance,radiiWorld:radii,lengthWorld:Math.hypot(...sub(end,start))});
    }return out;
  });
  return {poses,indices:new Uint16Array(triangles),spec:{...body.spec,vertexCount:body.spec.vertexCount+extra,triangleCount:triangles.length/3},
    repair:{method:'badger-hip-connectors-v1',baselineVertexCount:body.spec.vertexCount,baselineTriangleCount:body.spec.triangleCount,
      addedVertices:extra,addedTriangles:(triangles.length-body.indices.length)/3,endpointRule:'fixed convex rest-vertex averages; end disks inside source halfspaces',
      parameters:{radius,hipInward,topFraction},anchors:anchors.map(a=>({leg:a.leg.name,legVertexIds:a.top,pelvisVertexIds:a.hip,pelvisCenterIds:pelvis.vertices})),evidence}};
}
export function quantizeRepairedMesh(fixed) {
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const p of fixed.poses)for(let i=0;i<p.length;i++){const k=i%3;lo[k]=Math.min(lo[k],p[i]);hi[k]=Math.max(hi[k],p[i]);}
  const positions=Buffer.alloc(fixed.poses.length*fixed.spec.vertexCount*6),indices=Buffer.alloc(fixed.indices.length*2);let at=0;
  for(const p of fixed.poses)for(let i=0;i<p.length;i++){const k=i%3;positions.writeUInt16LE(Math.round((p[i]-lo[k])/(hi[k]-lo[k]||1)*65535),at);at+=2;}
  fixed.indices.forEach((v,i)=>indices.writeUInt16LE(v,i*2));
  return {positions,indices,lo,hi};
}
export async function writeRepairedProduction(root) {
  const {manifest,meshes}=await loadMeshBundle(root,'mesh-base-manifest.json'),body=meshes.get('badger'),fixed=repairLegConnections(body);
  const {positions,indices,lo,hi}=quantizeRepairedMesh(fixed);
  async function save(kind,bytes){const sha256=hash(bytes),file=`meshes/badger-repaired-${kind}-${sha256.slice(0,16)}.bin`;
    await writeFile(path.join(root,file),bytes,{flag:'wx'});return {file,bytes:bytes.length,sha256};}
  const spec={...fixed.spec,bounds:{min:lo,max:hi},positions:await save('positions',positions),indices:{...await save('indices',indices),encoding:'uint16-le-triangles'},
    downloadBytes:positions.length+indices.length,gpuFloat32Bytes:positions.length*2+indices.length,quantizationMaxErrorWorld:hi.map((x,k)=>(x-lo[k])/65535/2)};
  spec.topologySha256=spec.indices.sha256;
  manifest.meshes[0]=spec;manifest.shadowRepair={...fixed.repair,baseline:body.spec};
  manifest.status='production-unreviewed';
  manifest.downloadBytes=manifest.meshes.reduce((s,m)=>s+m.downloadBytes,0);
  manifest.gpuQuantizedBytes=manifest.downloadBytes;
  manifest.gpuFloat32Bytes=manifest.meshes.reduce((s,m)=>s+m.gpuFloat32Bytes,0);
  await writeFile(path.join(root,'mesh-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return loadMeshBundle(root);
}
