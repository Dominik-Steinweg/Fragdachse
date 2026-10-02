import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { MULTIPLY: 2, ADD: 1, SCREEN: 3 },
  Utils: { Array: { Remove: (items: object[], item: object) => { items.splice(items.indexOf(item), 1); } } },
  Textures: { FilterMode: { LINEAR: 1 } },
  Renderer: { WebGL: { Utils: { getTintAppendFloatAlpha: (color: number) => color } } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
  GameObjects: { Shader: class {
    visible = true;
    depth = 0;
    blendMode = 0;
    vao = { destroy: vi.fn() };
    renderNode = {
      programManager: { programs: { main: { vao: this.vao } } },
      renderer: { glVAOWrappers: [this.vao], deleteBuffer: vi.fn() },
      vertexBufferLayout: { buffer: {} },
    };
    destroy = vi.fn();
    constructor(_scene: unknown, public config: { setupUniforms: (set: (name: string, value: unknown) => void) => void },
      public x: number, public y: number, public width: number, public height: number, public textures: unknown[]) {}
    setupUniforms(set: (name: string, value: unknown) => void) { this.config.setupUniforms(set); }
    setOrigin() { return this; } setScrollFactor() { return this; }
    setTextureCoordinatesFromFrame() {}
    setDepth(depth: number) { this.depth = depth; return this; }
    setBlendMode(mode: number) { this.blendMode = mode; return this; }
    setVisible(visible: boolean) { this.visible = visible; return this; }
  }, SpriteGPULayer: class {
    memberCount = 0;
    timeElapsed = 0;
    nextMemberF32 = new Float32Array(42);
    frame = { realWidth: 256, realHeight: 256 };
    members: object[] = [];
    constructor(_scene: unknown, _texture: unknown, public size: number) {}
    setVisible() { return this; } setBlendMode() { return this; } setName() { return this; }
    addMember(member: object) { this.members[this.memberCount++] = { ...member }; }
    addData(data: Float32Array) { this.members[this.memberCount++] = { alpha: data[20] }; }
    resize(size: number) { this.size = size; } destroy = vi.fn();
  }, Image: class {
    setOrigin() { return this; }
    setBlendMode() { return this; }
    destroy() {}
  } },
}));

import { AdrenalineEssenceLighting } from '../src/adrenalineEssence/AdrenalineEssenceLighting';
import { LightingSystem } from '../src/effects/LightingSystem';
import * as Phaser from 'phaser';
import { resolveSkyState } from '../src/effects/TimeOfDay';
import * as TimeOfDay from '../src/effects/TimeOfDay';
import { GraphicsQualityController, type GraphicsQuality } from '../src/graphics/GraphicsQuality';
import { ADRENALINE_ESSENCE_LIGHTING as ESSENCE_CONFIG } from '../src/effects/LightingConfig';

function fixture(quality: GraphicsQuality = 'high') {
  const stamps = vi.fn();
  const draws = vi.fn();
  const fills = vi.fn();
  const shaders: Phaser.GameObjects.Shader[] = [];
  const targets: { texture: object; visible: boolean; depth: number }[] = [];
  const scene = {
    time: { now: 100 },
    textures: { exists: () => true, get: () => ({}) },
    cameras: { main: { scrollX: 0, scrollY: 0 } },
    make: { graphics: () => ({ destroy() {} }) },
    add: {
      particles: vi.fn(),
      existing: (shader: Phaser.GameObjects.Shader) => { shaders.push(shader); return shader; },
      renderTexture: (x: number, y: number) => {
        const target = {
          x, y, visible: true, depth: 0, displayWidth: 0, displayHeight: 0, frame: {},
          texture: { key: 'fake-lightmap', setFilter() {} },
          setOrigin() { return this; },
          setDisplaySize(w: number, h: number) { this.displayWidth = w; this.displayHeight = h; return this; },
          setScrollFactor() { return this; }, setDepth(depth: number) { this.depth = depth; return this; },
          setBlendMode() { return this; }, setRenderMode() { return this; },
          setVisible(value: boolean) { this.visible = value; return this; },
          fill: fills, draw: draws, stamp: stamps, destroy() {},
        };
        targets.push(target);
        return target;
      },
    },
  };
  const qualityController = new GraphicsQualityController(quality);
  qualityController.attach(scene as never);
  const lighting = new LightingSystem(scene as never);
  lighting.setTimeOfDay(0);
  lighting.setActive(true);
  return { scene, lighting, stamps, draws, fills, shaders, targets, qualityController };
}

describe('light bleed lifecycle', () => {
  it('skips a zero bleed factor even with visible lights and non-neutral ambient', () => {
    const resolver = vi.spyOn(TimeOfDay, 'resolveSkyState')
      .mockReturnValue({ ...resolveSkyState(0), bleedFactor: 0 });
    const { lighting, shaders, stamps } = fixture();
    resolver.mockRestore();
    lighting.setLight('source', 'muzzleFlash', 100, 100);
    lighting.update();
    expect(stamps).toHaveBeenCalledOnce();
    expect(shaders).toHaveLength(0);
    lighting.destroy();
  });

  it.each(['high', 'medium'] as const)('reuses the composited map on %s and skips empty, suppressed and noon frames', (quality) => {
    const { lighting, shaders, targets, fills } = fixture(quality);
    lighting.update();
    expect(shaders).toHaveLength(0);
    const targetCount = targets.length;
    lighting.setLight('source', 'muzzleFlash', 100, 100);
    lighting.update();
    expect(shaders).toHaveLength(1);
    expect(targets).toHaveLength(targetCount);
    const shader = shaders[0];
    const map = targets[targets.length - 1];
    expect(shader.textures).toEqual([map.texture]);
    expect(shader.depth).toBeGreaterThan(map.depth);
    expect(shader.visible).toBe(true);
    const uniforms = new Map<string, unknown>();
    shader.setupUniforms((key, value) => uniforms.set(key, value), {} as never);
    expect(uniforms.get('uBleedFactor')).toBe(resolveSkyState(0).bleedFactor);
    const ambient = resolveSkyState(0).ambientColor;
    expect(Array.from(uniforms.get('uAmbient') as Float32Array)).toEqual(Array.from(new Float32Array([
      ((ambient >> 16) & 255) / 255, ((ambient >> 8) & 255) / 255, (ambient & 255) / 255,
    ])));
    lighting.setCompositeSuppressed(true);
    expect(shader.visible).toBe(false);
    lighting.update();
    expect(shader.visible).toBe(false);
    lighting.setCompositeSuppressed(false); lighting.update();
    expect(shader.visible).toBe(true);
    lighting.setTimeOfDay(12 * 60); fills.mockClear(); lighting.update();
    expect(shader.visible).toBe(false);
    expect(map.visible).toBe(false);
    expect(fills).not.toHaveBeenCalled();
    lighting.setTimeOfDay(0); lighting.update();
    expect(shader.visible).toBe(true);
    lighting.clear();
    expect(shader.visible).toBe(false);
    lighting.update();
    expect(shader.visible).toBe(false);
    lighting.destroy();
  });

  it('releases the shader on quality changes and keeps low quality free of bleed', () => {
    const { lighting, shaders, targets, qualityController } = fixture('low');
    lighting.setLight('source', 'muzzleFlash', 100, 100);
    lighting.update();
    expect(shaders).toHaveLength(0);
    qualityController.setLevel('high'); lighting.update();
    const first = shaders[0];
    const node = first.renderNode;
    const vao = Object.values(node.programManager.programs)[0].vao;
    qualityController.setLevel('low'); lighting.update();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(vao.destroy).toHaveBeenCalledOnce();
    expect(node.renderer.glVAOWrappers).toHaveLength(0);
    expect(node.renderer.deleteBuffer).toHaveBeenCalledWith(node.vertexBufferLayout.buffer);
    expect(shaders).toHaveLength(1);
    qualityController.setLevel('medium'); lighting.update();
    expect(shaders[1].textures).toEqual([targets[targets.length - 1].texture]);
    lighting.setActive(false);
    expect(shaders[1].visible).toBe(false);
    lighting.destroy();
    expect(shaders[1].destroy).toHaveBeenCalledOnce();
  });
});

describe('keyed light lifecycle', () => {
  it.each(['high', 'medium', 'low'] as const)('batches every eye light outside the %s budget and clears the previously lit map', (quality) => {
    const { lighting, draws, fills } = fixture(quality);
    lighting.setPerformanceMetricsEnabled(true);
    // Exceed even the high-quality budget with normal lights.
    for (let i = 0; i < 250; i++) lighting.setLight(`flash:${i}`, 'muzzleFlash', 100, 100);
    const lights = Array.from({ length: 120 }, (_, i) => ({ x: 100 + i, y: 100, radiusPx: 30, intensity: .18, color: 0xbb72ff }));
    lighting.setEnemyEyeLights({ lights, lightCount: lights.length });
    lighting.update();
    expect(draws).toHaveBeenCalledTimes(1);
    expect(draws.mock.lastCall?.[0].memberCount).toBe(lights.length);
    expect(lighting.getDebugStats().enemyEyeLights).toBe(lights.length);
    expect(lighting.getPerformanceMetrics().presetCounts.enemyEyes).toBe(lights.length);
    const alpha = draws.mock.lastCall?.[0].members[0].alpha;
    lighting.setTimeOfDay(12 * 60); lighting.update();
    expect(lighting.getDebugStats().enemyEyeLights).toBe(0);
    lighting.setTimeOfDay(0); lighting.update();
    expect(draws.mock.lastCall?.[0].members[0].alpha).toBe(alpha);
    lighting.clear(); fills.mockClear(); lighting.update();
    expect(lighting.getDebugStats().enemyEyeLights).toBe(0);
    expect(fills).toHaveBeenCalledOnce();
    lighting.destroy();
  });
  it('keeps canopy falloff circular, including square bounds and distant light sources', () => {
    const { lighting } = fixture();
    const ambient = lighting.resolveCanopyTint(100, 100);
    lighting.setLight('near', 'adrenalineEssence', 100, 100, { radiusPx: 100, intensity: 1 });
    lighting.setLight('far', 'adrenalineEssence', 1000, 1000, { radiusPx: 100, intensity: 1 });
    lighting.update();
    expect(lighting.resolveCanopyTint(100, 100)).not.toBe(ambient);
    expect(lighting.resolveCanopyTint(150, 100)).not.toBe(ambient);
    for (const [x, y] of [[0, 100], [200, 100], [100, 0], [100, 200], [175, 175], [300, 300]]) {
      expect(lighting.resolveCanopyTint(x, y)).toBe(ambient);
    }
    lighting.destroy();
  });

  it('keeps normal release fading, but immediate release removes active and already fading lights', () => {
    const { scene, lighting, stamps } = fixture();
    lighting.setLight('pickup', 'adrenalineEssence', 100, 100);
    lighting.update();
    const initialAlpha = stamps.mock.lastCall?.[4].alpha as number;
    expect(initialAlpha).toBeGreaterThan(0);
    lighting.releaseLight('pickup');
    expect(lighting.getDebugStats().activeLights).toBe(1);
    scene.time.now += 10;
    lighting.update();
    expect(stamps.mock.lastCall?.[4].alpha).toBeLessThan(initialAlpha);
    lighting.releaseLight('pickup', { immediate: true });
    expect(lighting.getDebugStats()).toMatchObject({ activeLights: 0, renderedLights: 0 });
    lighting.setLight('pickup', 'adrenalineEssence', 150, 150);
    expect(lighting.getDebugStats().activeLights).toBe(1);
    lighting.releaseLight('pickup', { immediate: true });
    lighting.releaseLight('pickup', { immediate: true });
    expect(lighting.getDebugStats().activeLights).toBe(0);
  });

  it('uses the same sky attenuation and direct lightmap path for stationary essence across the day', () => {
    const { scene, lighting, stamps, draws, fills, shaders } = fixture();
    const helper = new AdrenalineEssenceLighting(lighting);
    const sources = [{ id: 'ground', x: 100, y: 100, value: 2, alpha: 1 }];
    const ambient = lighting.resolveCanopyTint(100, 100);
    helper.update(sources, 'high', null);
    lighting.update();
    expect(stamps).not.toHaveBeenCalled();
    expect(draws).toHaveBeenCalledOnce();
    const batch = draws.mock.lastCall?.[0];
    const initialAlpha = batch.members[0].alpha;
    expect(initialAlpha).toBeGreaterThan(0);
    expect(shaders[0].visible).toBe(true);
    expect(lighting.resolveCanopyTint(100, 100)).not.toBe(ambient);
    expect(lighting.resolveCanopyTint(1000, 1000)).toBe(ambient);
    lighting.setTimeOfDay(12 * 60);
    scene.time.now += 1000;
    helper.update(sources, 'high', null);
    lighting.update();
    expect(draws).toHaveBeenCalledOnce();
    expect(shaders[0].visible).toBe(false);
    lighting.setTimeOfDay(0);
    scene.time.now += 1000;
    helper.update(sources, 'high', null);
    lighting.update();
    expect(draws).toHaveBeenCalledTimes(2);
    expect(batch.members[0].alpha).toBe(initialAlpha);
    expect(lighting.getDebugStats()).toMatchObject({ activeLights: 0, essenceLights: 1 });
    // No keyed-light timeout can drop quiet ground pearls between renderer updates.
    scene.time.now += 10000;
    lighting.update();
    expect(batch.members[0].alpha).toBe(initialAlpha);
    expect(lighting.getDebugStats().essenceLights).toBe(1);
    helper.update([], 'high', null);
    helper.clear();
    draws.mockClear(); fills.mockClear(); lighting.update();
    expect(lighting.getDebugStats().essenceLights).toBe(0);
    expect(draws).not.toHaveBeenCalled();
    expect(fills).toHaveBeenCalledOnce();
    expect(shaders[0].visible).toBe(false);
    expect(lighting.resolveCanopyTint(100, 100)).toBe(ambient);
    helper.destroy();
    lighting.destroy();
    expect(batch.destroy).toHaveBeenCalledOnce();
  });

  it('keeps all essence cells in one draw despite saturated light budgets and quality changes', () => {
    const { lighting, draws, qualityController } = fixture();
    const helper = new AdrenalineEssenceLighting(lighting);
    const nextOwner = new AdrenalineEssenceLighting(lighting);
    const sources = Array.from({ length: 400 }, (_, i) => ({
      id: String(i), x: (i % 25) * ESSENCE_CONFIG.bucketSizePx,
      y: Math.floor(i / 25) * ESSENCE_CONFIG.bucketSizePx, value: 1, alpha: 1,
    }));
    lighting.setPerformanceMetricsEnabled(true);
    for (let i = 0; i < 250; i++) lighting.setLight(`flash:${i}`, 'muzzleFlash', 100, 100);
    for (const quality of ['high', 'medium', 'low'] as const) {
      qualityController.setLevel(quality);
      helper.update(sources, quality, null);
      nextOwner.update([sources[0]], quality, null);
      draws.mockClear(); lighting.update();
      expect(draws).toHaveBeenCalledOnce();
      expect(draws.mock.lastCall?.[0].memberCount).toBe(sources.length + 1);
      expect(lighting.getDebugStats().essenceLights).toBe(sources.length + 1);
      const metrics = lighting.getPerformanceMetrics();
      expect(metrics.presetCounts.adrenalineEssence).toBe(sources.length + 1);
      expect(metrics.commandCount).toBe(2 + metrics.presetCounts.muzzleFlash);
    }
    helper.destroy(); draws.mockClear(); lighting.update();
    expect(draws.mock.lastCall?.[0].memberCount).toBe(1);
    nextOwner.destroy(); draws.mockClear(); lighting.update();
    expect(draws).not.toHaveBeenCalled();
    lighting.destroy();
  });
});

it('invalidates the ambient-only cache, tints crowns consistently, and restores the production sky',()=>{
  const {lighting,fills}=fixture();
  lighting.setTimeOfDay(1185);lighting.update();
  const production=resolveSkyState(1185).ambientColor;
  expect(lighting.getAmbientColor()).toBe(production);
  lighting.setSunAmbient(0xa08fba);lighting.update();
  expect(lighting.getAmbientColor()).toBe(0xa08fba);
  expect(fills.mock.calls.at(-1)?.[0]).toBe(0xa08fba);
  lighting.setTimeOfDay(0);lighting.setSunAmbient(null);lighting.update();
  expect(lighting.getAmbientColor()).toBe(resolveSkyState(0).ambientColor);
  expect(fills.mock.calls.at(-1)?.[0]).toBe(resolveSkyState(0).ambientColor);
  expect(()=>lighting.setSunAmbient(NaN)).toThrow();
  lighting.destroy();
});


it('character material borrows only two dominant visible local lights, resets on clear and respects cone/occluders',()=>{
 const {lighting}=fixture();
 const samples=createCharacterMaterialLights();
 const light=(x:number,y:number,weight:number)=>({x,y,radiusPx:200,effectiveIntensity:weight,shape:'radial',angle:0,coneAngle:Math.PI/2,occludes:false});
 const state=lighting as any;
 state.renderQueue=[light(0,0,.2),light(20,0,.9),light(30,0,.8),light(50,0,.1)];
 lighting.sampleCharacterMaterialLights(0,0,samples);
 expect(samples[0].x).toBe(20);expect(samples[1].x).toBe(30);
 expect(samples[0].height).toBeGreaterThan(0);
 state.renderQueue[1].occludes=true;
 state.occluders={queryCircle:(_x:number,_y:number,_r:number,rect:Function)=>rect(5,-5,10,5)};
 lighting.sampleCharacterMaterialLights(0,0,samples);expect(samples[0].x).toBe(30);expect(samples[1].x).toBe(0);
 state.renderQueue=[{...light(0,0,1),shape:'cone',angle:Math.PI,coneAngle:.5}];
 lighting.sampleCharacterMaterialLights(30,0,samples);expect(samples.every(s=>s.weight===0)).toBe(true);
 state.renderQueue=[];lighting.sampleCharacterMaterialLights(0,0,samples);expect(samples.every(s=>s.weight===0)).toBe(true);
 lighting.setActive(false);lighting.sampleCharacterMaterialLights(0,0,samples);expect(samples.every(s=>s.weight===0)).toBe(true);
 lighting.destroy();
});
import { createCharacterMaterialLights } from '../src/effects/CharacterMaterialModel';
