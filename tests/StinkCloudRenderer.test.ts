import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
vi.mock('../src/effects/EffectUtils', () => ({
  ensureCanvasTexture() {}, registerGraphicsObject() {}, recordGraphicsWork() {},
}));
import { StinkCloudSystem } from '../src/effects/StinkCloudSystem';
import { healthBarTestScene, HealthTestObject } from './healthBarTestScene';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';
import type { DamageZoneVisualStyle, SyncedStinkCloud } from '../src/types';
import { DEPTH } from '../src/config';

function fixture(epoch = 0) {
  const { scene, cosmetic } = healthBarTestScene();
  scene.time.now = epoch;
  scene.cameras.main = { width: 800, height: 600, zoom: 1, scrollX: 0, scrollY: 0, originX: 0, originY: 0 };
  const shaders: any[] = [];
  const circles: number[][] = [];
  scene.add.graphics = () => {
    const object = Object.assign(new HealthTestObject(scene), {
      beginPath() { return this; }, arc() { return this; }, strokePath() { return this; },
      moveTo() { return this; }, lineTo() { return this; },
      strokeCircle(...args: number[]) { circles.push(args); return this; },
    });
    cosmetic.push(object); return object;
  };
  scene.add.shader = (config: any, x: number, y: number, width: number, height: number) => {
    const uniforms: Record<string, any> = {};
    const object = Object.assign(new HealthTestObject(scene, x, y, width, height), {
      uniforms, displayOriginX: 0, displayOriginY: 0,
      setOrigin(value: number) {
        this.displayOriginX = this.width * value; this.displayOriginY = this.height * value; return this;
      },
      submit() { config.setupUniforms((name: string, value: unknown) => uniforms[name] = value); },
    });
    shaders.push(object); return object;
  };
  const quality = new GraphicsQualityController('high'); quality.attach(scene);
  const renderer = new StinkCloudSystem(scene);
  const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
  renderer.setLightingSystem(lighting as any);
  const cloud: SyncedStinkCloud = { id: 1, ownerId: 'owner', ownerColor: 0xabcdef,
    x: 300, y: 250, radius: 100, alpha: .7, visualVariant: 'stink' };
  const submit = () => shaders.filter(s => s.active).forEach(s => s.submit());
  return { scene, cosmetic, shaders, circles, renderer, lighting, quality, cloud, submit };
}

describe('shared stink cloud presentation', () => {
  it('locks following auras to the rendered owner while stationary clouds stay at their snapshot position', () => {
    const f = fixture();
    const following = { ...f.cloud, followOwner: true };
    f.renderer.syncVisuals([following, { ...f.cloud, id: 2, followOwner: false }]);
    const pose = { x: 310.25, y: 270.75 };
    const lookup = vi.fn(() => pose);
    f.renderer.clientUpdate(16, lookup);
    expect([f.shaders[0].x, f.shaders[0].y]).toEqual([pose.x, pose.y]);
    expect([f.shaders[1].x, f.shaders[1].y]).toEqual([f.cloud.x, f.cloud.y]);
    pose.x = 430.5; pose.y = 290.25;
    f.renderer.clientUpdate(16, lookup);
    expect([f.shaders[0].x, f.shaders[0].y]).toEqual([pose.x, pose.y]);
    expect(lookup).toHaveBeenCalledTimes(2);
    f.renderer.clientUpdate(16, () => null);
    expect([f.shaders[0].x, f.shaders[0].y]).toEqual([following.x, following.y]);
    f.renderer.destroyAll();
  });

  it.each<DamageZoneVisualStyle>(['stink', 'spore', 'spore_void', 'electric'])(
    'keeps %s geometry and opacity tied to snapshots across quality and pose changes', variant => {
      const f = fixture();
      f.cloud.visualVariant = variant;
      f.renderer.syncVisuals([f.cloud]); f.submit();
      const body = f.shaders[0];
      expect(body.visible).toBe(true);
      expect(body.depth).toBe(DEPTH.STINK);
      expect(body.uniforms.uOpacity).toBe(f.cloud.alpha);
      expect(body.uniforms.uElectric).toBe(variant === 'electric' ? 1 : 0);
      expect(f.circles).toEqual([]);
      const palette = body.uniforms.uBody;
      const highDetail = body.uniforms.uDetail, highPixels = body.uniforms.uPixels;
      f.quality.setLevel('low'); f.renderer.clientUpdate(16); f.submit();
      expect(body.uniforms.uDetail).toBeLessThan(highDetail);
      expect(body.uniforms.uPixels).toBe(highPixels);
      expect(body.uniforms.uOpacity).toBe(f.cloud.alpha);
      expect(body.uniforms.uBody).toEqual(palette);
      const next = { ...f.cloud, x: 450, y: 280, radius: 175, alpha: .3 };
      f.renderer.syncVisuals([next]); f.renderer.clientUpdate(16); f.submit();
      expect(f.shaders).toHaveLength(1);
      expect(body.x).toBe(next.x); expect(body.y).toBe(next.y);
      expect(body.width).toBe(next.radius * 2); expect(body.height).toBe(body.width);
      expect(body.displayOriginX).toBe(next.radius); expect(body.displayOriginY).toBe(next.radius);
      expect(body.uniforms.uOpacity).toBe(next.alpha);
      f.renderer.destroyAll();
      expect([...f.shaders, ...f.cosmetic].every(o => !o.active)).toBe(true);
      expect(f.lighting.releaseLight).toHaveBeenCalledWith('stinkcloud:1');
    });

  it.each([0, Date.UTC(2026, 8, 10)])('keeps GPU time precise, culls and releases replaced or expired clouds at epoch %s', epoch => {
    const f = fixture(epoch);
    f.renderer.syncVisuals([f.cloud]); f.submit();
    const first = f.shaders[0];
    f.scene.time.now += 16;
    f.renderer.clientUpdate(16); f.submit();
    expect(Math.fround(first.uniforms.uTime)).toBeCloseTo(.016, 6);
    f.scene.cameras.main.scrollX = 2000;
    f.renderer.clientUpdate(16);
    expect(first.visible).toBe(false);
    expect(f.cosmetic.every(o => !o.visible)).toBe(true);
    f.scene.cameras.main.scrollX = 0;
    f.renderer.clientUpdate(16); expect(first.visible).toBe(true);
    f.renderer.syncVisuals([{ ...f.cloud, alpha: 0 }]); expect(first.visible).toBe(false);
    f.renderer.syncVisuals([{ ...f.cloud, radius: 0 }]); expect(first.visible).toBe(false);
    f.renderer.syncVisuals([{ ...f.cloud, visualVariant: 'electric' }, { ...f.cloud, id: 2 }]); f.submit();
    expect(first.active).toBe(false);
    const live = f.shaders.filter(s => s.active);
    expect(live).toHaveLength(2);
    expect(live[0].uniforms.uBody).not.toEqual(live[1].uniforms.uBody);
    f.renderer.syncVisuals([{ ...f.cloud, id: 2 }]);
    expect(live[0].active).toBe(false); expect(live[1].active).toBe(true);
    f.renderer.destroyAll();
    expect([...f.shaders, ...f.cosmetic].every(o => !o.active)).toBe(true);
  });
});
