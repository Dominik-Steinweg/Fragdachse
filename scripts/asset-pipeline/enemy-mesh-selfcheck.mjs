import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enemyCoordinates, enemyPoses, enemyReviewSamples, validateEnemyMeshManifest,
  ENEMY_MESH_VIEWS, ENEMY_LEGS, relativeMember, decodeEnemyMesh } from './enemy-mesh-contract.mjs';
import { selectedEnemySource } from './enemy-mesh-sources.mjs';
import {project,raster,compare} from './enemy-mesh-raster.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pilots = JSON.parse(await readFile(path.join(repo, 'scripts/asset-pipeline/enemy-mesh-pilot.json')));
assert.equal(ENEMY_MESH_VIEWS.length, 80);
// Raster QA must preserve an exterior-open slit, regardless of triangle winding.
const square=new Float32Array([0,0,2,0,2,2,0,2]);
const full=raster(square,new Uint16Array([0,1,2,0,2,3]),[0,0,2,2],4);
assert.equal(full.data.reduce((a,b)=>a+b,0),64);
assert.equal(compare(full,raster(square,new Uint16Array([2,1,0,3,2,0]),[0,0,2,2],4)).iou,1);
const halves=new Float32Array([0,0,.75,0,.75,2,0,2,1.25,0,2,0,2,2,1.25,2]);
const slit=raster(halves,new Uint16Array([0,1,2,0,2,3,4,5,6,4,6,7]),[0,0,2,2],4);
assert.equal(compare(full,slit).iou,.75);
const projected=project(new Float32Array([2,3,-1,2,3,2]),0,45);
assert(Array.from(projected).every((v,i)=>Math.abs(v-[2,3,0,3][i])<1e-6));
for (const unsafe of ['../source.blend', '/source.blend', 'a\\b', 'D:/a', 'a//b'])
  assert.throws(() => relativeMember(unsafe));
for (const pilot of pilots.assets) {
  const selected = await selectedEnemySource(repo, pilot);
  const { render } = selected;
  const poses = enemyPoses(render), samples = enemyReviewSamples(render);
  assert.equal(poses.length, 31); assert.equal(samples.length, 118);
  assert.equal(new Set(samples.map(s => s.sampleId)).size, samples.length);
  assert.equal(poses[13].clipFrame, 0); assert.equal(poses[30].clipFrame, 17);
  assert.equal(samples.filter(s => s.exported).length, 31);
  const lastMove = samples.find(s => s.sampleId === 'move-11+0.75');
  assert(lastMove.blenderFrame > poses[12].blenderFrame);
  assert(lastMove.blenderFrame < render.clips.find(c => c.name === 'move').timelineEnd);
  assert(!samples.some(s => s.clip === 'claw' && s.clipFrame > 17));
  assert.throws(() => enemyPoses({ ...render, frames: render.frames.slice(0, 30) }));
  assert.throws(() => enemyCoordinates({ ...render, orthoScale: 0 }));
  assert.throws(() => enemyCoordinates({ ...render, pivot: [0, 0] }));
  const hash = '0'.repeat(64);
  const fixture = { schema: 'fd-projected-enemy-mesh', version: 1, id: pilot.id,
    revision: 'enemy-mesh-test', status: 'diagnostic', poses, coordinates: enemyCoordinates(render),
    sourceFiles: { 'source.blend': hash }, contacts: poses.map(p => ({ pose: p.index,
      feet: ENEMY_LEGS.map(leg => ({ leg, position: [0, 0, 0], groundWeight: 1 })) })),
    mesh: { id: pilot.id, encoding: 'uint16-le-xyz-bounds', vertexCount: 1000, triangleCount: 2000,
      bounds: { min: [-10, -10, 0], max: [10, 10, 15] }, poseIndices: poses.map(p => p.index), topologySha256: hash,
      positions: { file: 'meshes/positions.bin', bytes: 31 * 1000 * 6, sha256: hash },
      indices: { file: 'meshes/indices.bin', bytes: 2000 * 6, sha256: hash } } };
  validateEnemyMeshManifest(fixture);
  const positions = Buffer.alloc(fixture.mesh.positions.bytes), indices = Buffer.alloc(fixture.mesh.indices.bytes);
  positions.writeUInt16LE(65535, 0);
  const decoded = decodeEnemyMesh(fixture.mesh, positions, indices);
  assert.equal(decoded.positions[0], 10); assert.equal(decoded.positions[1], -10);
  assert.equal(decoded.positions.length, 31 * 1000 * 3);
  indices.writeUInt16LE(1000, 0);
  assert.throws(() => decodeEnemyMesh(fixture.mesh, positions, indices));
  assert.throws(() => decodeEnemyMesh(fixture.mesh, positions.subarray(2), indices));
  for (const mutate of [m => m.mesh.vertexCount = 2001, m => m.mesh.positions.bytes++,
    m => m.contacts.pop(), m => m.contacts[0].feet[0].position[2] = NaN,
    m => m.mesh.poseIndices.reverse(), m => m.mesh.indices.file = '../wrong.bin',
    m => m.coordinates.worldPxPerBlenderUnit *= 2, m => m.sourceFiles = {},
    m => m.mesh.bounds.max[0] = -20]) {
    const copy = structuredClone(fixture); mutate(copy); assert.throws(() => validateEnemyMeshManifest(copy));
  }
  console.log(`${pilot.id}: selected hashes, 31 poses, 118 samples, coordinate/contact/binary contracts passed`);
}
console.log('Enemy mesh selfcheck passed; no Blender renders or files written.');
