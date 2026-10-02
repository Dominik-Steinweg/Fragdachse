import { expect, it } from 'vitest';
import { characterDirectShadow, characterShadowOpacity, characterShadowCoreDarkening, characterLightAzimuth, characterShadowSample, createCharacterShadowSelection,
  displayedShadowPose, selectCharacterShadows } from '../src/effects/CharacterShadowModel';
import { CHARACTER_SHADOW_MANIFEST as manifest, CHARACTER_SHADOW_FILES } from '../src/assets/CharacterShadowAssetManifest';
import { CHARACTER_SHADOW_FRAGMENT } from '../src/effects/characterShadowShader';
import { CHARACTER_SHADOW_CONFIG, SHADOW_CASTERS } from '../src/effects/ShadowConfig';
import { DEPTH, getHeldItemAnchor, HELD_ITEM_TEXTURE_SIZE } from '../src/config';

it('uses inverse displayed rotation in right/south axes and the actual sheet frame', () => {
  expect(characterLightAzimuth(1, 0, 0)).toBe(0);
  expect(characterLightAzimuth(1, 0, Math.PI / 2)).toBe(270);
  expect(characterLightAzimuth(0, -1, 0)).toBe(270);
  for (let r = -6; r < 6; r += .1) expect(characterLightAzimuth(Math.cos(r), Math.sin(r), r)).toBeCloseTo(0);
  for (const pose of manifest.poses) {
    expect(displayedShadowPose(String(pose.index))).toBe(pose.index);
    for (let c = 0; c < manifest.canvases.length; c++) expect(characterShadowSample(pose.index, c).pose).toBe(pose.index);
  }
  expect(displayedShadowPose('__BASE')).toBe(0);
});
it('normalizes the single mask sum with cyclic azimuth and cotangent elevation', () => {
  const out = createCharacterShadowSelection(), lo = manifest.grid.elevationDegrees[0], hi = manifest.grid.elevationDegrees[1];
  const mid = Math.atan(2 / (1 / Math.tan(lo * Math.PI / 180) + 1 / Math.tan(hi * Math.PI / 180)));
  selectCharacterShadows(348.75, mid, out);
  for (const w of out.weights) expect(w).toBeCloseTo(.25);
  expect(out.canvases.map(c => manifest.canvases[c].azimuthIndex)).toEqual([15, 0, 15, 0]);
  for (let a = -720; a < 720; a += 13) for (const e of [0, .5, .6, 1.3]) {
    selectCharacterShadows(a, e, out);
    expect(out.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1);
    expect(out.weights.every(w => w >= 0 && w <= 1)).toBe(true);
    expect(out.canvases.every(c => c >= 0)).toBe(true);
  }
  const copy = structuredClone(out); selectCharacterShadows(710, 1.3, out);
  selectCharacterShadows(710, 1.3, copy); expect(copy).toEqual(out);
});
it('keeps night contact without direct shadow and draws above ground fog but below figures', () => {
  expect(characterDirectShadow(0, .6)).toBe(0); expect(characterDirectShadow(1, 0)).toBe(0);
  expect(characterDirectShadow(1, -.1)).toBe(0); expect(characterDirectShadow(.7, .6)).toBe(.7);
  expect(CHARACTER_SHADOW_CONFIG.depth).toBeGreaterThan(DEPTH.WATER);
  expect(CHARACTER_SHADOW_CONFIG.depth).toBeGreaterThan(DEPTH.GROUND_FOG);
  expect(CHARACTER_SHADOW_CONFIG.depth).toBeGreaterThan(DEPTH.ROCK_VEGETATION + .02);
  expect(CHARACTER_SHADOW_CONFIG.depth).toBe(SHADOW_CASTERS.player.layerDepth);
  expect(CHARACTER_SHADOW_CONFIG.depth).toBeLessThan(DEPTH.PLAYERS);
  expect(CHARACTER_SHADOW_CONFIG.waterResponse).toBeGreaterThan(0);
  expect(CHARACTER_SHADOW_CONFIG.waterResponse).toBeLessThan(1);
});
it('varies direct contrast continuously with projected length and preserves cloud/receiver attenuation', () => {
  const lo=manifest.grid.elevationDegrees[0]*Math.PI/180;
  const hi=manifest.grid.elevationDegrees.at(-1)!*Math.PI/180;
  const low=characterShadowOpacity(1,lo),high=characterShadowOpacity(1,hi);
  expect(low).toBeCloseTo(CHARACTER_SHADOW_CONFIG.lowSunOpacity);
  expect(high).toBeCloseTo(CHARACTER_SHADOW_CONFIG.directOpacity);
  expect(low).toBeLessThan(high);
  let previous=0;
  for(let e=lo;e<=hi;e+=.001){
    const opacity=characterShadowOpacity(1,e);
    expect(opacity).toBeGreaterThanOrEqual(previous);expect(opacity).toBeLessThanOrEqual(1);
    expect(characterShadowOpacity(.5,e)).toBeCloseTo(opacity*.5);previous=opacity;
  }
  for(const e of [-1,0,NaN,Infinity])expect(characterShadowOpacity(1,e)).toBe(0);
  expect(characterShadowOpacity(0,hi)).toBe(0);
  const core=characterShadowCoreDarkening(high,1,1,1);
  expect(core).toBeGreaterThan(0);expect(core).toBeLessThan(high);
  for(const [cloud,receiver,alpha] of [[.2,1,1],[1,CHARACTER_SHADOW_CONFIG.waterResponse,1],[1,0,1],[1,1,0]])
    expect(characterShadowCoreDarkening(high,cloud,receiver,alpha)).toBeCloseTo(core*cloud*receiver*alpha);
  // Shader colour and diagnostic use the same config, so the estimate describes MULTIPLY.
  expect(CHARACTER_SHADOW_FRAGMENT).toContain(`vec3(${CHARACTER_SHADOW_CONFIG.colour.join(',')})*alpha`);
});
it('uses only published data pages and declares every consumed shader uniform', () => {
  expect(CHARACTER_SHADOW_FILES).toHaveLength(manifest.pages.filter(p => p.pass === 'shadow').length);
  for (const file of CHARACTER_SHADOW_FILES) { expect(file.kind).toBe('data'); expect(file.url).toContain(file.sha256); }
  const declared = new Set([...CHARACTER_SHADOW_FRAGMENT.matchAll(/uniform\s+\w+\s+([^;]+);/g)]
    .flatMap(m => m[1].split(',').map(s => s.trim())));
  for (const [name] of CHARACTER_SHADOW_FRAGMENT.matchAll(/\bu[A-Z]\w*/g)) expect(declared).toContain(name);
  for (const dst of [0, .3, 1]) for (const alpha of [0, .1, 1]) expect(alpha * dst + dst * (1 - alpha)).toBeCloseTo(dst);
});

import { bodyMeshMatrix, characterHandSocket, extendMeshBounds, meshPose, meshShadowOpacity, projectMeshPoint, weaponMeshMatrix } from '../src/effects/CharacterMeshModel';
import { CHARACTER_MESH_MANIFEST as meshManifest } from '../src/assets/CharacterMeshAssets';
import { CHARACTER_MESH_VERTEX, CHARACTER_MESH_BLUR, CHARACTER_MESH_COMPOSITE } from '../src/effects/characterMeshShaders';

const meshSprite = () => ({ x: 100, y: 200, rotation: 0, scaleX: .3, scaleY: .3, displayWidth: 38.4,
  displayHeight: 38.4, originX: .5, originY: .5, flipX: false, flipY: false,
  frame: { name: '0', realWidth: 128, realHeight: 128 } });
it('mesh projection is continuous, world anchored, rotation aware and keeps contact on the plane', () => {
  const s=meshSprite(), m=bodyMeshMatrix(s);
  expect(projectMeshPoint([0,0,10],m,[0,-1,1])).toEqual([100,210]);
  expect(projectMeshPoint([3,4,-1],m,[0,-1,1])).toEqual([103,204]);
  for(const angle of [0,.23,1.5,3,6.28])for(const elevation of [20,28,35,45,60]) {
    const e=elevation*Math.PI/180, sun=[.3*Math.cos(e),-Math.sqrt(.91)*Math.cos(e),Math.sin(e)];
    s.rotation=angle;bodyMeshMatrix(s,m);
    const q=projectMeshPoint([5,7,20],m,sun);
    expect(q[0]).toBeCloseTo(100+Math.cos(angle)*5-Math.sin(angle)*7-sun[0]*20/sun[2],4);
    expect(q[1]).toBeCloseTo(200+Math.sin(angle)*5+Math.cos(angle)*7-sun[1]*20/sun[2],4);
    const b=[Infinity,Infinity,-Infinity,-Infinity];extendMeshBounds(b,meshManifest.meshes[0],m,sun);
    expect(b[2]).toBeGreaterThan(b[0]);expect(b[3]).toBeGreaterThan(b[1]);
    const next=projectMeshPoint([5,7,20],bodyMeshMatrix({...s,rotation:angle+.00001}),sun);
    expect(Math.hypot(next[0]-q[0],next[1]-q[1])).toBeLessThan(.001);
    expect(meshShadowOpacity(1,e)).toBeCloseTo(characterShadowOpacity(1,e));
  }
  expect(meshShadowOpacity(0,.6)).toBe(0);expect(meshShadowOpacity(1,-.1)).toBe(0);
});
it('uses the shared visual grip, pose height and actual held-image recoil, without quantizing facing', () => {
  const s=meshSprite();
  for(const pose of meshManifest.poses){
    s.frame.name=String(pose.index);s.rotation=.83;
    expect(meshPose(s.frame.name)).toBe(pose.index);
    const h=characterHandSocket(s), p=meshManifest.sockets[pose.index].weapon.position;
    const anchor=getHeldItemAnchor(s.x,s.y,s.rotation,s.displayWidth/HELD_ITEM_TEXTURE_SIZE);
    expect(h.x).toBeCloseTo(anchor.x);expect(h.y).toBeCloseTo(anchor.y);
    expect(h.z).toBeCloseTo(p[2]);
    const w={...s,x:h.x+2,y:h.y-1,rotation:h.yaw+.12,originY:.75};
    const wm=weaponMeshMatrix(w,s);
    expect(wm[12]).toBeCloseTo(w.x,4);expect(wm[13]).toBeCloseTo(w.y,4);expect(wm[14]).toBeCloseTo(h.z,4);
    expect(Math.atan2(wm[1],wm[0])).toBeCloseTo(w.rotation,4);
  }
});
it('mesh shader uses world projection, north-at-v1 RTTs and an alpha-preserving PMA multiply output', () => {
  expect(CHARACTER_MESH_VERTEX).toContain('(uModel*vec4(inPosition,1.0)).xyz');
  expect(CHARACTER_MESH_VERTEX).toContain('1.0-uv.y*2.0');
  expect(CHARACTER_MESH_COMPOSITE).toContain('1.0-outTexCoord.y');
  expect(CHARACTER_MESH_COMPOSITE).toContain('cloudTransmission(world)');
  expect(CHARACTER_MESH_BLUR).toContain('uStep');
  for(const mask of [0,.01,.3,1])for(const destinationAlpha of [.2,1]) {
    // MULTIPLY alpha factors are DST_ALPHA / ONE_MINUS_SRC_ALPHA.
    expect(mask*destinationAlpha+destinationAlpha*(1-mask)).toBeCloseTo(destinationAlpha);
  }
});
