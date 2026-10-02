/** End-to-end SOFTWARE test with a synthetic tetrahedron, not a badger export/review. */
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MESH_COORDINATES, hash } from './mesh-shadow-contract.mjs';
import { reviewMeshShadow } from './review-mesh-shadow.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const parent=path.join(repo,'build/player-shadow/mesh-pilot');await mkdir(parent,{recursive:true});
const root=path.join(parent,'selfcheck-'+Date.now());await mkdir(root);
const source=await readFile(path.join(repo,'art/poc/pipeline-v2/runs/v2-ai/badger/standard/render.json'));
await writeFile(path.join(root,'source-body-render.json'),source,{flag:'wx'});
const render=JSON.parse(source),meshes=[];
for(const [id,v,t,n] of [['badger',1100,2100,37],['held-glock',4,4,1]]) {
  const positions=Buffer.alloc(v*3*2*n),indices=Buffer.alloc(t*6);
  const corners=[[0,0,0],[65535,0,0],[32768,65535,0],[32768,32768,65535]];
  for(let i=0;i<v*n;i++)for(let k=0;k<3;k++)positions.writeUInt16LE(corners[i%4][k],(i*3+k)*2);
  const tris=[[0,1,2],[0,3,1],[1,3,2],[2,3,0]];
  for(let i=0;i<t;i++)for(let k=0;k<3;k++)indices.writeUInt16LE(tris[i%4][k],(i*3+k)*2);
  await writeFile(path.join(root,id+'.bin'),positions);await writeFile(path.join(root,id+'-i.bin'),indices);
  meshes.push({id,vertexCount:v,triangleCount:t,poseIndices:Array.from({length:n},(_,i)=>i),encoding:'uint16-le-xyz-bounds',
    bounds:{min:id==='badger'?[-10,-10,0]:[-1,-5,-1],max:id==='badger'?[10,10,30]:[1,1,1]},
    positions:{file:id+'.bin',bytes:positions.length,sha256:hash(positions)},indices:{file:id+'-i.bin',bytes:indices.length,sha256:hash(indices),encoding:'uint16-le-triangles'},
    topologySha256:hash(indices),downloadBytes:positions.length+indices.length,gpuFloat32Bytes:v*n*12+indices.length,
    grip:[0,0,0],muzzle:[0,-5,0],beautyCanvasWorldPx:38.4,beautyGripUv:[.5,.75]});
}
const socket={position:[2,-10,20],rotationMatrix:[1,0,0,0,1,0,0,0,1],yaw:0,sourceObject:'SYNTHETIC'};
const m={schema:'fd-projected-character-mesh',version:1,status:'pilot-unreviewed',coordinates:MESH_COORDINATES,
  poses:render.frames.map(f=>{const c=render.clips.find(c=>c.frames.includes(f.index));return{index:f.index,blenderFrame:f.blenderFrame,clip:c?.name??'rest',clipFrame:c?.frames.indexOf(f.index)??0,beautySha256:f.sha256};}),
  sockets:Array.from({length:37},(_,pose)=>({pose,left:socket,right:socket,weapon:socket})),meshes,sourceFiles:{'source-body-render.json':hash(source)}};
await writeFile(path.join(root,'mesh-manifest.json'),JSON.stringify(m));
// Deliberately obvious schematic marks; never pretend these are exported badger models.
await sharp(Buffer.from('<svg width="128" height="128"><rect x="40" y="40" width="48" height="48" fill="#eee"/><text x="5" y="20" font-size="12" fill="red">SYNTHETIC TEST</text></svg>')).png().toFile(path.join(root,'beauty.png'));
await sharp(Buffer.from('<svg width="128" height="128"><rect x="60" y="70" width="8" height="30" fill="#30aaff"/></svg>')).png().toFile(path.join(root,'weapon.png'));
await copyFile(path.join(repo,'public/assets/sprites/gras_bg_tile.png'),path.join(root,'source-ground.png'));
await sharp({create:{width:64,height:64,channels:3,background:'#000'}}).greyscale().png().toFile(path.join(root,'reference.png'));
await writeFile(path.join(root,'job.json'),JSON.stringify({beauties:{0:'beauty.png'},weapon:{beauty:'weapon.png'},references:[{pose:0,azimuth:0,file:'reference.png',canvas:{boundsWorld:[-32,-32,32,32],texelsPerWorldPx:1}}]}));
const started=performance.now();
const report=await reviewMeshShadow(root,path.join(root,'review'),{poseIndices:[0]});
console.log(JSON.stringify({status:'software-smoke-only',root,seconds:(performance.now()-started)/1000,files:report.reviewFiles.length}));
