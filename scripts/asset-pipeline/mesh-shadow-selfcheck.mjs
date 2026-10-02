/** Focused offline contract checks, also callable from the proposed asset-suite patch. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { MESH_COORDINATES, decodePositions, decodeIndices, validateMeshManifest, safeFile, hash, weaponMeshLimits, validateWeaponQuality } from './mesh-shadow-contract.mjs';
import { projectPoint, transformPoint, projectMesh, rasterUnion, softMask } from './mesh-shadow-raster.mjs';
import { encodeApng } from './review-mesh-shadow.mjs';

export async function meshShadowSelfcheck() {
  let assertions=0;
  const near=(a,b)=>{assert(Math.abs(a-b)<1e-5,`${a} != ${b}`);assertions++;};
  const equal=(a,b)=>{assert.deepEqual(a,b);assertions++;};
  const rejects=f=>{assert.throws(f);assertions++;};
  equal(projectPoint([3,4,-1],0,.5),[3,4]);near(projectPoint([3,4,2],0,Math.PI/4)[0],1);
  rejects(()=>projectPoint([0,0,1],0,0));
  const socket={position:[2,-14,27],rotationMatrix:[1,0,0,0,1,0,0,0,1],yaw:0,sourceObject:'test'};
  for(let degree=0;degree<=360;degree+=5) {
    const r=degree*Math.PI/180;
    // The weapon's local grip and the body-space hand project to the same point.
    const grip=projectPoint(transformPoint([0,0,0],r,socket),.6,.7);
    const hand=projectPoint(transformPoint(socket.position,r),.6,.7);
    near(grip[0],hand[0]);near(grip[1],hand[1]);
  }
  const vertices=new Float32Array([-2,-2,3,2,-2,3,2,2,3,-2,2,3]),indices=new Uint16Array([0,1,2,0,2,3]);
  const xy=projectMesh(vertices,.3,.6,.7),bounds=[-15,-15,15,15];
  const one=rasterUnion([{xy,indices}],bounds,2);
  const repeated=rasterUnion([{xy,indices:new Uint16Array([2,1,0,3,2,0])},{xy,indices}],bounds,2);
  equal(one.data,repeated.data);assert(one.data.some(x=>x===255));assertions++;
  const blur=softMask(one,1);assert(blur.every(x=>x>=0&&x<=1.000001)&&blur.some(x=>x>0&&x<1));assertions++;
  rejects(()=>rasterUnion([{xy,indices}],[0,0,1,1],1));
  let previous=null;
  for(let degree=0;degree<=90;degree+=5) {
    const p=projectMesh(vertices,degree*Math.PI/180,.6,.7);
    if(previous)for(let i=0;i<p.length;i++)assert(Math.abs(p[i]-previous[i])<.4);
    previous=p;assertions++;
  }
  const binary=Buffer.alloc(18);[0,32768,65535,65535,0,0,32768,65535,0].forEach((v,i)=>binary.writeUInt16LE(v,i*2));
  const spec={vertexCount:3,poseIndices:[0],bounds:{min:[-5,0,7],max:[5,10,7]},positions:{bytes:18},triangleCount:1};
  const decoded=decodePositions(spec,binary,0);near(decoded[0],-5);near(decoded[2],7);near(decoded[3],5);
  rejects(()=>decodePositions(spec,binary,1));
  const ib=Buffer.from([0,0,1,0,2,0]);equal([...decodeIndices(spec,ib)],[0,1,2]);
  rejects(()=>decodeIndices(spec,Buffer.from([0,0,1,0,3,0])));
  for(const name of ['../file','/file','a\\b','D:/x','a//b'])rejects(()=>safeFile(name));
  function mesh(id,v,t,n){return {id,vertexCount:v,triangleCount:t,poseIndices:Array.from({length:n},(_,i)=>i),encoding:'uint16-le-xyz-bounds',
    bounds:{min:[0,0,0],max:[1,1,1]},positions:{file:id+'.bin',bytes:v*6*n,sha256:hash(binary)},
    indices:{file:id+'-i.bin',bytes:t*6,sha256:hash(ib),encoding:'uint16-le-triangles'},downloadBytes:v*6*n+t*6,gpuFloat32Bytes:v*12*n+t*6,
    grip:[0,0,0],muzzle:[0,-1,0],beautyCanvasWorldPx:38.4,beautyGripUv:[.5,.75]};}
  const m={schema:'fd-projected-character-mesh',version:1,status:'pilot-unreviewed',coordinates:MESH_COORDINATES,
    poses:Array.from({length:37},(_,index)=>({index,blenderFrame:index,clip:'move',clipFrame:index,beautySha256:hash(binary)})),
    sockets:Array.from({length:37},(_,pose)=>({pose,left:socket,right:socket,weapon:socket})),meshes:[mesh('badger',1500,2900,37),mesh('held-glock',200,300,1)]};
  validateMeshManifest(m);assertions++;
  const scaled=structuredClone(m),budget={policy:'held-size-v2',sizeWorld:30,maxVertices:1100,maxTriangles:2200};
  scaled.meshes[1]={...mesh('held-p90',1000,1900,1),budget};validateMeshManifest(scaled);assertions++;
  const over=structuredClone(scaled);over.meshes[1].budget.maxVertices=2000;rejects(()=>validateMeshManifest(over));
  const legacyOver=structuredClone(scaled);delete legacyOver.meshes[1].budget;rejects(()=>validateMeshManifest(legacyOver));
  equal(weaponMeshLimits(m.meshes[1]),{maxVertices:600,maxTriangles:1100});
  const adaptive={budget:{policy:'held-adaptive-v3',sizeWorld:18,baseVertices:800,maxVertices:1600,maxTriangles:3200}};
  equal(weaponMeshLimits(adaptive).maxVertices,1600);
  const excess=structuredClone(adaptive);excess.budget.maxVertices=2000;rejects(()=>weaponMeshLimits(excess));
  const noBase=structuredClone(adaptive);delete noBase.budget.baseVertices;rejects(()=>weaponMeshLimits(noBase));
  const qa={asset:'held-p90',passed:true,density:3,minIou:.95,edgeTolerancePixels:2,budget,
    rows:[[0,90],...[28,35,45].flatMap(e=>Array.from({length:16},(_,a)=>[a*22.5,e]))].map(([azimuth,elevation])=>({azimuth,elevation,iou:1,missingBeyondTolerancePixels:0,extraBeyondTolerancePixels:0}))};
  validateWeaponQuality(scaled.meshes[1],qa);assertions++;
  for(const mutation of [q=>q.rows.pop(),q=>q.rows[1]=q.rows[0],q=>q.rows[0].iou=.9,q=>q.rows[0].missingBeyondTolerancePixels=1,q=>q.edgeTolerancePixels=10]){
    const wrong=structuredClone(qa);mutation(wrong);rejects(()=>validateWeaponQuality(scaled.meshes[1],wrong));
  }
  const bad=structuredClone(m);bad.meshes[0].poseIndices.pop();rejects(()=>validateMeshManifest(bad));
  const wrong=structuredClone(m);wrong.sockets[0].weapon.rotationMatrix[0]=-1;rejects(()=>validateMeshManifest(wrong));
  const red=Buffer.from([255,0,0,255,255,0,0,255]),blue=Buffer.from([0,0,255,255,0,0,255,255]);
  const apng=encodeApng([red,blue],2,1),types=[];let at=8;const seq=[];
  while(at<apng.length){const n=apng.readUInt32BE(at),type=apng.toString('ascii',at+4,at+8);types.push(type);
    if(type==='fcTL'||type==='fdAT')seq.push(apng.readUInt32BE(at+8));
    if(type==='fcTL')equal(apng[at+8+25],0); // SOURCE replacement
    at+=n+12;
  }
  equal(types,['IHDR','acTL','fcTL','IDAT','fcTL','fdAT','IEND']);equal(seq,[0,1,2]);
  const decodedPng=await sharp(apng).ensureAlpha().raw().toBuffer();equal(decodedPng,red);
  return {status:'passed',assertions};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await meshShadowSelfcheck()));
