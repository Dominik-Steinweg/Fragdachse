import { expect, it } from 'vitest';
import { characterDirectShadow, characterShadowOpacity, characterShadowCoreDarkening, characterLightAzimuth, characterShadowSample, createCharacterShadowSelection,
  displayedShadowPose, selectCharacterShadows } from '../src/effects/CharacterShadowModel';
import { CHARACTER_SHADOW_MANIFEST as manifest, CHARACTER_SHADOW_FILES } from '../src/assets/CharacterShadowAssetManifest';
import { CHARACTER_SHADOW_FRAGMENT } from '../src/effects/characterShadowShader';
import { CHARACTER_SHADOW_CONFIG, SHADOW_CASTERS } from '../src/effects/ShadowConfig';
import { DEPTH } from '../src/config';

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
