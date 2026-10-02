/** Validate fixed-topology binary/contact contracts against the active R4 selection. */
import assert from'node:assert/strict';import fs from'node:fs/promises';import{createHash}from'node:crypto';import{validateEnemyMeshManifest,decodeEnemyMesh}from'./enemy-mesh-contract.mjs';
const manifest=JSON.parse(await fs.readFile('src/assets/manifests/enemy-mesh-families.json','utf8'));
assert.equal(manifest.assets.length,14);assert.equal(new Set(manifest.assets.map(a=>a.id)).size,14);
let total=0;
for(const a of manifest.assets){const sourceFiles={'source.blend':'0'.repeat(64)},m={...a,schema:'fd-projected-enemy-mesh',version:1,status:'diagnostic',sourceFiles};validateEnemyMeshManifest(m);
 const buffers=await Promise.all(['positions','indices'].map(async key=>{const spec=m.mesh[key],bytes=await fs.readFile('public/'+spec.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);return bytes;}));
 const d=decodeEnemyMesh(m.mesh,...buffers);assert.equal(d.positions.length,31*m.mesh.vertexCount*3);assert(d.positions.every(Number.isFinite));total+=m.mesh.vertexCount;
 assert.equal(m.contacts[0].feet.length,['alien-badger','pyro-badger'].includes(a.id)?2:4);
 for(const mutate of [x=>x.contacts.pop(),x=>x.contacts[1].feet.pop(),x=>x.contacts[0].feet[0].leg='wrong',x=>x.mesh.positions.bytes++,x=>x.mesh.vertexCount=2001]){const broken=structuredClone(m);mutate(broken);assert.throws(()=>validateEnemyMeshManifest(broken));}
 const indices=Buffer.from(buffers[1]);indices.writeUInt16LE(m.mesh.vertexCount,0);assert.throws(()=>decodeEnemyMesh(m.mesh,buffers[0],indices));
}
console.log('R4 active contracts passed: 14 types, 31 poses each, explicit biped/quadruped feet, hashes, budgets, malformed-input rejection;',total,'vertices per complete type set');
