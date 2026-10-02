import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateWeaponBatch } from './mesh-shadow-batch.mjs';

export const MESH_COORDINATES = Object.freeze({ axes: 'X-right/Y-south/Z-up', blenderToAsset: [1, -1, 1],
  groundZ: 0, pivot: [0, 0, 0], bodyCanvasWorldPx: 38.4, bodyOrthoScaleBlender: 2.2 });
export const PILOT_POSES = [0, 1, 4, 7, 25];
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeFile(name) {
  if (typeof name !== 'string' || !name || /[\\:\0]/.test(name) || name.split('/').some(x => !x || x === '.' || x === '..')) throw Error('Unsafe mesh member');
  return name;
}
const assert = (condition, message) => { if (!condition) throw Error(message); };
const finite = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
export function weaponMeshLimits(mesh) {
  if(!mesh.budget)return {maxVertices:600,maxTriangles:1100}; // existing immutable pilots
  const b=mesh.budget;
  assert(['held-size-v2','held-adaptive-v3'].includes(b.policy)&&Number.isFinite(b.sizeWorld)&&b.sizeWorld>0,'Unknown weapon budget policy');
  const maxVertices=Math.min(1600,Math.max(600,Math.ceil((300+24*b.sizeWorld)/100)*100));
  if(b.policy==='held-adaptive-v3')assert(b.baseVertices===maxVertices&&b.maxVertices===1600&&b.maxTriangles===3200,'Invalid adaptive weapon budget');
  else assert(b.maxVertices===maxVertices&&b.maxTriangles===maxVertices*2,'Invalid size-scaled weapon budget');
  return b;
}
export function validateWeaponQuality(mesh,q) {
  const expected=new Set(['0/90',...[28,35,45].flatMap(e=>Array.from({length:16},(_,a)=>`${a*22.5}/${e}`))]);
  assert(q.asset===mesh.id&&q.passed===true&&q.density===3&&q.minIou===.95&&q.edgeTolerancePixels===2
    &&JSON.stringify(q.budget)===JSON.stringify(mesh.budget)&&q.rows?.length===49,'Incomplete weapon silhouette gate');
  for(const r of q.rows){assert(expected.delete(`${r.azimuth}/${r.elevation}`)&&r.iou>=.95&&r.iou<=1
    &&r.missingBeyondTolerancePixels===0&&r.extraBeyondTolerancePixels===0,'Weapon silhouette mismatch');}
  assert(expected.size===0,'Missing weapon silhouette directions');
}

/** LE, pose-major, vertex-major XYZ; one shared bound across every pose. */
export function decodePositions(mesh, bytes, poseSlot) {
  assert(Number.isInteger(poseSlot) && poseSlot >= 0 && poseSlot < mesh.poseIndices.length, 'Unknown mesh pose');
  const out = new Float32Array(mesh.vertexCount * 3), start = poseSlot * out.length * 2;
  assert(bytes.length === mesh.positions.bytes, 'Wrong position buffer size');
  for (let i = 0; i < out.length; i++) {
    const k = i % 3;
    out[i] = mesh.bounds.min[k] + bytes.readUInt16LE(start + i * 2) / 65535 * (mesh.bounds.max[k] - mesh.bounds.min[k]);
  }
  return out;
}
export function decodeIndices(mesh, bytes) {
  assert(bytes.length === mesh.triangleCount * 6, 'Wrong index buffer size');
  const out = new Uint16Array(mesh.triangleCount * 3);
  for (let i = 0; i < out.length; i++) { out[i] = bytes.readUInt16LE(i * 2); assert(out[i] < mesh.vertexCount, 'Index outside mesh'); }
  return out;
}
export function validateMeshManifest(m) {
  assert(m.schema === 'fd-projected-character-mesh' && m.version === 1 && ['pilot-unreviewed','production-unreviewed'].includes(m.status), 'Unknown mesh contract');
  assert(JSON.stringify(m.coordinates) === JSON.stringify(MESH_COORDINATES), 'Coordinate contract mismatch');
  assert(m.poses.length === 37 && m.poses.every((p, i) => p.index === i && Number.isFinite(p.blenderFrame)
    && typeof p.clip === 'string' && Number.isInteger(p.clipFrame) && /^[a-f0-9]{64}$/.test(p.beautySha256)), 'Invalid source pose mapping');
  assert(m.sockets.length === 37, 'Missing pose sockets');
  for (const s of m.sockets) {
    assert(s.pose === m.sockets.indexOf(s), 'Socket pose order');
    for (const key of ['left', 'right', 'weapon']) {
      assert(finite(s[key]?.position, 3) && finite(s[key]?.rotationMatrix, 9) && Number.isFinite(s[key]?.yaw), 'Invalid socket transform');
      const a = s[key].rotationMatrix;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const dot = a[i] * a[j] + a[3 + i] * a[3 + j] + a[6 + i] * a[6 + j];
        assert(Math.abs(dot - (i === j ? 1 : 0)) < 1e-4, 'Non-rigid socket');
      }
      const det = a[0]*(a[4]*a[8]-a[5]*a[7])-a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
      assert(Math.abs(det - 1) < 1e-4, 'Reflected socket rotation');
    }
  }
  assert(m.meshes.length >= 2 && m.meshes[0].id === 'badger', 'Body and weapon required');
  assert(new Set(m.meshes.map(x => x.id)).size === m.meshes.length, 'Duplicate mesh');
  if(m.status==='production-unreviewed') {
    const r=m.shadowRepair;
    assert(r?.method==='badger-hip-connectors-v1'&&r.evidence?.length===74&&r.anchors?.length===2,'Missing animated leg repair');
    assert(m.meshes[0].vertexCount===r.baseline.vertexCount+r.addedVertices&&m.meshes[0].triangleCount===r.baseline.triangleCount+r.addedTriangles,'Repair topology budget mismatch');
    assert(r.evidence.every(e=>e.endpointClearanceWorld.length===2&&e.endpointClearanceWorld.every(x=>Number.isFinite(x)&&x>=.25)),'Unsafe attachment endpoint');
    const ids=m.meshes.slice(1).flatMap(w=>w.gameIds??[]);
    assert(ids.length>=1&&new Set(ids).size===ids.length&&m.meshes.slice(1).every(w=>w.gameIds?.length>0),'Missing/duplicate held game IDs');
    assert(m.downloadBytes===m.meshes.reduce((s,x)=>s+x.downloadBytes,0)&&m.gpuQuantizedBytes===m.downloadBytes
      &&m.gpuFloat32Bytes===m.meshes.reduce((s,x)=>s+x.gpuFloat32Bytes,0),'Production budget totals mismatch');
  }
  for (const mesh of m.meshes) {
    assert(/^[a-z0-9][a-z0-9-]*$/.test(mesh.id),'Unsafe mesh ID');
    assert(Number.isInteger(mesh.vertexCount) && mesh.vertexCount > 2 && mesh.vertexCount < 65536, 'Invalid vertex count');
    assert(Number.isInteger(mesh.triangleCount) && mesh.triangleCount > 0, 'Invalid triangle count');
    assert(finite(mesh.bounds.min, 3) && finite(mesh.bounds.max, 3) && mesh.bounds.min.every((x, i) => x <= mesh.bounds.max[i]), 'Invalid bounds');
    assert(mesh.encoding === 'uint16-le-xyz-bounds' && mesh.indices.encoding === 'uint16-le-triangles', 'Invalid mesh encoding');
    assert(mesh.positions.bytes === mesh.vertexCount * 6 * mesh.poseIndices.length && mesh.indices.bytes === mesh.triangleCount * 6, 'Byte count mismatch');
    assert(mesh.downloadBytes === mesh.positions.bytes + mesh.indices.bytes
      && mesh.gpuFloat32Bytes === mesh.vertexCount * 12 * mesh.poseIndices.length + mesh.indices.bytes, 'Budget mismatch');
    for (const file of [mesh.positions, mesh.indices]) { safeFile(file.file); assert(/^[a-f0-9]{64}$/.test(file.sha256), 'Missing binary hash'); }
    if (mesh.id === 'badger') {
      assert(mesh.vertexCount >= 1000 && mesh.vertexCount <= 2000 && mesh.triangleCount >= 2000 && mesh.triangleCount <= 4000, 'Body proxy outside agreed budget');
      assert(JSON.stringify(mesh.poseIndices) === JSON.stringify(m.poses.map(p => p.index)), 'Incomplete body bake');
    } else {
      const limits=weaponMeshLimits(mesh);
      assert(JSON.stringify(mesh.poseIndices) === '[0]' && mesh.vertexCount <= limits.maxVertices && mesh.triangleCount <= limits.maxTriangles, 'Weapon proxy budget');
      assert(finite(mesh.grip, 3) && mesh.grip.every(x => x === 0) && finite(mesh.muzzle, 3), 'Weapon grip-local convention');
      assert(Number.isFinite(mesh.beautyCanvasWorldPx) && finite(mesh.beautyGripUv, 2), 'Weapon beauty mapping');
    }
  }
  return m;
}
export async function loadMeshBundle(root, manifestName='mesh-manifest.json') {
  const m = validateMeshManifest(JSON.parse(await readFile(path.join(root, safeFile(manifestName)))));
  const meshes = new Map();
  for (const mesh of m.meshes) {
    const buffers = await Promise.all([mesh.positions, mesh.indices].map(async f => {
      const b = await readFile(path.join(root, safeFile(f.file)));
      assert(b.length === f.bytes && hash(b) === f.sha256, 'Changed mesh binary: ' + f.file); return b;
    }));
    const indices = decodeIndices(mesh, buffers[1]);
    assert(hash(buffers[1]) === mesh.topologySha256, 'Changed topology');
    meshes.set(mesh.id, { spec: mesh, indices, poses: mesh.poseIndices.map((_, i) => decodePositions(mesh, buffers[0], i)) });
    if(mesh.budget) {
      const f=mesh.audit?.qualityReport;assert(f,'Missing weapon union quality evidence');
      const bytes=await readFile(path.join(root,safeFile(f.file)));
      assert(bytes.length===f.bytes&&hash(bytes)===f.sha256,'Changed weapon quality report');
      const q=JSON.parse(bytes);validateWeaponQuality(mesh,q);
      const picture=await readFile(path.join(root,safeFile(q.image.file)));
      assert(picture.length===q.image.bytes&&hash(picture)===q.image.sha256,'Changed weapon QA image');
    }
  }
  const source = JSON.parse(await readFile(path.join(root, 'source-body-render.json')));
  for (const p of m.poses) {
    const original = source.frames[p.index], clip = source.clips.find(c => c.frames.includes(p.index));
    assert(original?.sha256 === p.beautySha256 && original.blenderFrame === p.blenderFrame
      && p.clip === (clip?.name ?? 'rest') && p.clipFrame === (clip?.frames.indexOf(p.index) ?? 0), 'Source pose/clip mismatch');
  }
  for (const [file, sha] of Object.entries(m.sourceFiles)) assert(hash(await readFile(path.join(root, safeFile(file)))) === sha, 'Changed source: ' + file);
  if(m.meshes.some(w=>w.budget?.policy==='held-adaptive-v3')) {
    const batch=JSON.parse(await readFile(path.join(root,'weapon-batch-report.json')));
    validateWeaponBatch(batch,m.meshes.slice(1).map(w=>w.id));
    assert(batch.revision===m.revision,'Weapon batch belongs to another revision');
  }
  if(m.status==='production-unreviewed') {
    for(const file of ['source-held-registry.json','source-catalog.json','source-body-selection.json'])assert(/^[a-f0-9]{64}$/.test(m.sourceFiles[file]),'Unbound production source '+file);
    const registry=JSON.parse(await readFile(path.join(root,'source-held-registry.json'))),catalog=JSON.parse(await readFile(path.join(root,'source-catalog.json')));
    const expected=registry.assets.filter(a=>a.id.startsWith('held-')),authored=catalog.assets.filter(a=>['held-weapon','held-utility'].includes(a.recipe));
    assert(expected.length===authored.length&&expected.length===m.meshes.length-1,'Incomplete held production');
    for(const e of expected){const w=m.meshes.find(w=>w.id===e.id),c=authored.find(c=>c.id===e.id);
      assert(w&&c&&JSON.stringify(w.gameIds)===JSON.stringify(e.gameIds)&&JSON.stringify(w.gameIds)===JSON.stringify(c.gameIds),'Held registry binding mismatch');
      safeFile(w.sourceRole);
      for(const suffix of ['.blend','-render.json','-selection.json','-bundle.zip'])assert(/^[a-f0-9]{64}$/.test(m.sourceFiles[`source-${w.sourceRole}${suffix}`]),'Unbound held source');
      const selected=JSON.parse(await readFile(path.join(root,`source-${w.sourceRole}-selection.json`)));
      assert(selected.id===w.id&&selected.files[selected.idle]===e.hashes.idle&&selected.files[selected.sheet]===e.hashes.sheet,'Proxy source differs from published held Beauty');
      assert(selected.files[`${selected.variant}/asset.blend`]===m.sourceFiles[`source-${w.sourceRole}.blend`]
        &&selected.files[`${selected.variant}/render.json`]===m.sourceFiles[`source-${w.sourceRole}-render.json`],'Held blend/render selection mismatch');
    }
  }
  return { manifest: m, meshes };
}
