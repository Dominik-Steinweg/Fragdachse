import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ENEMY_MESH_MANIFEST, EnemyMeshAssets, type EnemyMeshData } from '../../src/assets/EnemyMeshAssets';
import { enemyMeshMatrix, enemyMeshPose, enemyShadowBounds, ENEMY_SHADOW_PAD } from '../../src/effects/EnemyMeshShadowModel';
import { projectMeshPoint, extendMeshBounds } from '../../src/effects/CharacterMeshModel';
import { registerEnemyMeshWarmup, subscribeEnemyMeshWarmup, prepareEnemyMeshWarmups } from '../../src/effects/EnemyMeshWarmup';
import registry from '../../src/config/pipelineAssets.json';
const asset = ENEMY_MESH_MANIFEST.assets[0];
const mesh: EnemyMeshData = { asset, positions: new Float32Array(), indices: new Uint16Array() };
it('extends projected bounds exactly like the reference corners, including below-ground vertices and low sun', () => {
  for (const a of ENEMY_MESH_MANIFEST.assets) for (const sun of [[1, 0, 0], [0, -1, .2], [-.4, .7, 1]]) {
    const matrix = new Float32Array([.7, -.3, 0, 0, -.2, -1.2, 0, 0, .1, .2, 1.4, 0, 100, -200, -3, 1]);
    const expected = [-5, -10, 5, 10], actual = [...expected];
    for (let i = 0; i < 8; i++) {
      const b = a.mesh.bounds;
      const q = projectMeshPoint([b[i & 1 ? 'max' : 'min'][0], b[i & 2 ? 'max' : 'min'][1], b[i & 4 ? 'max' : 'min'][2]], matrix, sun);
      expected[0] = Math.min(expected[0], q[0]); expected[1] = Math.min(expected[1], q[1]);
      expected[2] = Math.max(expected[2], q[0]); expected[3] = Math.max(expected[3], q[1]);
    }
    extendMeshBounds(actual, a.mesh, matrix, sun);
    expect(actual).toEqual(expected);
  }
});
it('maps actual frames, rejects foreign poses, keeps baked jump Z and final sprite transforms', () => {
  for (const pose of asset.poses) expect(enemyMeshPose(String(pose.index), mesh)).toBe(pose.index);
  expect(enemyMeshPose('__BASE', mesh)).toBe(0); expect(enemyMeshPose('other', mesh)).toBe(-1);
  expect(enemyMeshPose(31, mesh)).toBe(-1);
  const m = new Float32Array(16), canvas = asset.coordinates.canvasWorldPx;
  enemyMeshMatrix({ x:70, y:50, rotation:Math.PI/2, scaleX:2, scaleY:.5, displayWidth:canvas*2, displayHeight:canvas*.5,
    originX:.5, originY:.5, flipX:true, flipY:false, frame:{realWidth:canvas,realHeight:canvas,name:19}}, canvas, m);
  expect(m[14]).toBe(0); expect(m[10]).toBe(1);
  const q = projectMeshPoint([3,4,8],m,[1,0,1]); expect(q[0]).toBeCloseTo(60);expect(q[1]).toBeCloseTo(44);
  expect(projectMeshPoint([3,4,-8],m,[1,0,1])[0]).toBeCloseTo(68);
});
it('encloses rotated/flipped projected extremes and isolates the blur gutter at low sun', () => {
  const m = new Float32Array([0,-1,0,0,2,0,0,0,0,0,1.4,0,100,200,0,1]);
  for (const sun of [[1,0,.05],[0,1,.8],[-1,-.5,.3]]) {
    const b:number[]=[]; enemyShadowBounds(mesh,m,sun,64,b);
    for(let i=0;i<8;i++) {
      const bounds=asset.mesh.bounds;
      const q=projectMeshPoint([bounds[i&1?'max':'min'][0],bounds[i&2?'max':'min'][1],bounds[i&4?'max':'min'][2]],m,sun);
      for(let a=0;a<2;a++) {const uv=(q[a]-b[a])/b[a+2];expect(uv).toBeGreaterThanOrEqual(ENEMY_SHADOW_PAD/64);expect(uv).toBeLessThanOrEqual(1-ENEMY_SHADOW_PAD/64);}
    }
  }
});
it('does not fetch unsupported types and deduplicates type prefetch', () => {
  const fetchMock=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetchMock);
  try {const owner=new EnemyMeshAssets();owner.prefetch(['zombie-badger','not-an-enemy']);owner.prefetch(['zombie-badger']);expect(fetchMock).toHaveBeenCalledTimes(2);}
  finally {vi.unstubAllGlobals();}
});
it('hash-checks binary inputs and only publishes complete meshes after budgeted decode', async () => {
  const fetchMock=vi.fn(async (url:string)=>{
    const spec=url.includes('positions')?asset.mesh.positions:asset.mesh.indices;
    return new Response(await readFile('public/'+spec.file));
  });
  vi.stubGlobal('fetch',fetchMock);
  try {
    const owner=new EnemyMeshAssets();owner.prefetch([asset.id]);
    await vi.waitFor(()=>expect(owner.inspect().pending).toBe(1));
    for(let i=0;i<30;i++){owner.pump(i);owner.pump(i);expect(owner.ready.size).toBe(0);}
    owner.pump(30);expect(owner.ready.get(asset.id)?.positions.length).toBe(asset.mesh.vertexCount*31*3);
    owner.prefetch([asset.id]);expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {vi.unstubAllGlobals();}
});
it('releases world probes and budgets warmup to one probe per invocation', () => {
  const scene={} as never,wake=vi.fn(),unsubscribe=subscribeEnemyMeshWarmup(scene,wake);
  const first=vi.fn(()=>true),second=vi.fn(()=>false);
  registerEnemyMeshWarmup(scene,first);const release=registerEnemyMeshWarmup(scene,second);
  expect(wake).toHaveBeenCalledTimes(2);expect(prepareEnemyMeshWarmups(scene)).toBe(false);
  expect(first).toHaveBeenCalledTimes(1);expect(second).not.toHaveBeenCalled();release();
  expect(prepareEnemyMeshWarmups(scene)).toBe(true);unsubscribe();
});
it('binds Beauty, all poses, binary topology and material sheets to the accepted revision', async () => {
  for (const a of ENEMY_MESH_MANIFEST.assets) {
    const live=registry.assets.find(x=>x.id===a.id)!;
    expect(live.revision).toBe(a.revision);expect(live.hashes.sheet).toBe((a.images as Record<string,{sha256:string}>)[`beauty${live.sourceSize}`].sha256);
    expect(live.pivot).toEqual(a.coordinates.pivot);expect(a.mesh.poseIndices).toEqual(a.poses.map(p=>p.index));
    expect(a.contacts.map(p=>p.pose)).toEqual(a.mesh.poseIndices);
    for (const spec of [a.mesh.positions,a.mesh.indices]) {
      const bytes=await readFile('public/'+spec.file);expect(bytes.length).toBe(spec.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(spec.sha256);
      if(spec===a.mesh.indices)for(let i=0;i<bytes.length;i+=2)expect(bytes.readUInt16LE(i)).toBeLessThan(a.mesh.vertexCount);
    }
    expect(a.mesh.positions.bytes).toBe(a.mesh.vertexCount*a.poses.length*6);
    for(const [key,image]of Object.entries(a.images)) {
      const bytes=await readFile('public/'+image.file);expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
      const size=Number(key.match(/(\d+)$/)![1]);
      expect(await sharp(bytes).metadata()).toMatchObject({width:(size+4)*8,height:(size+4)*4,hasAlpha:true});
    }
  }
});
