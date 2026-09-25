import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import type { PlayerNetState } from '../src/types';

const { createdQuads, TestShaderQuad } = vi.hoisted(() => {
  const createdQuads: { x: number; y: number; visible: boolean; destroyed: boolean }[] = [];
  class TestShaderQuad {
    x = 0;
    y = 0;
    visible = true;
    destroyed = false;
    constructor(_scene: unknown, readonly config: { setupUniforms: (set: (name: string, value: unknown) => void) => void }) {
      createdQuads.push(this);
    }
    setOrigin(): this { return this; }
    setDepth(): this { return this; }
    setBlendMode(): this { return this; }
    setSize(): this { return this; }
    setVisible(visible: boolean): this { this.visible = visible; return this; }
    setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
    destroy(): void { this.destroyed = true; }
  }
  return { createdQuads, TestShaderQuad };
});

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1, NORMAL: 0 },
  Math: {
    Between: () => 30,
    Linear: (a: number, b: number, t: number) => a + (b-a)*t,
    Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)),
    Easing: { Quadratic: { Out: (t: number) => t * (2 - t) } },
  },
  Utils: { Array: { GetRandom: (a: unknown[]) => a[0] } },
  GameObjects: { Shader: TestShaderQuad },
}));

vi.mock('../src/effects/EffectUtils', () => ({
  registerGraphicsObject: (_scene: unknown, _family: string, object: unknown) => object,
  ensureCanvasTexture: () => {},
}));

vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityProfile: () => ({ level: 'high' }),
}));

vi.mock('../src/utils/phaserFx', () => ({
  addInternalBlur: () => {},
  addInternalGlow: () => {},
  setInternalFxPadding: () => {},
}));

vi.mock('../src/effects/FlameShared', () => ({
  ensureFlameTextures: () => {},
  ensureVoidFlameTextures: () => {},
  // Der Atlas zieht die Jet-Motive aus demselben Modul, auch wenn dieser Renderer sie nicht
  // benutzt – ohne die Exporte scheitert schon der Import.
  ensureFlameJetTextures: () => {},
  TEX_FLAME_BILLOW: 'flame-billow',
  TEX_FLAME_TONGUE: 'flame-tongue',
  TEX_FLAME_BED: 'flame-bed',
  FLAME_COLORS_CORE: [0xffffff],
  FLAME_COLORS_OUTER: [0xffffff],
  FLAME_COLORS_SPARK: [0xffffff],
  TEX_FLAME_CORE: 'flame-core',
  TEX_FLAME_EMBER: 'flame-ember',
  TEX_FLAME_SPARK: 'flame-spark',
  TEX_VOID_FLAME_CORE: 'void-flame-core',
  TEX_VOID_FLAME_EMBER: 'void-flame-ember',
  TEX_VOID_FLAME_SPARK: 'void-flame-spark',
  VOID_FLAME_COLORS_CORE: [0xffffff],
  VOID_FLAME_COLORS_OUTER: [0xffffff],
  VOID_FLAME_COLORS_SPARK: [0xffffff],
}));

vi.mock('../src/effects/FireSystem', () => ({
  GROUND_FIRE_CELL_SIZE: 16,
}));

vi.mock('../src/effects/LightingConfig', () => ({
  GROUND_FIRE_LIGHT_BUCKET_SIZE: 64,
  MAX_GROUND_FIRE_LIGHTS: 1,
}));

import { FlamethrowerUpgradeRenderer } from '../src/effects/FlamethrowerUpgradeRenderer';

function ringState(radius: number): PlayerNetState {
  return { flameRingRadius: radius, alive: true, isBurrowed: false } as PlayerNetState;
}

describe('FlamethrowerUpgradeRenderer flame ring', () => {
  it('draws one GPU quad per ring, lets it burn out after replication ends and releases its lights at once', () => {
    createdQuads.length = 0;
    const scene = {
      sys: { renderer: { gl: {} } },
      time: { now: 1_000 },
      cameras: { main: { zoomX: 1, zoomY: 1 } },
      add: { existing: vi.fn() },
      tweens: { killTweensOf: vi.fn() },
    };
    const owners = { getOwnerVisualState: () => ({ x: 120, y: 80, visible: true }) };
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
    const renderer = new FlamethrowerUpgradeRenderer(scene as unknown as Phaser.Scene, owners as never);
    renderer.setLightingSystem(lighting as never);

    renderer.syncRings({ p1: ringState(64) });
    renderer.update(0);
    renderer.update(16);
    expect(createdQuads).toHaveLength(1);
    expect(createdQuads[0]).toMatchObject({ x: 120, y: 80, visible: true, destroyed: false });
    expect(lighting.setLight).toHaveBeenCalled();

    renderer.syncRings({});
    const releasedKeys = lighting.releaseLight.mock.calls.map(([key]) => key as string);
    expect(releasedKeys.filter(key => key.startsWith('flamering:p1:'))).toHaveLength(12);
    lighting.setLight.mockClear();
    scene.time.now += 100;
    renderer.update(116);
    expect(createdQuads[0].destroyed).toBe(false);
    expect(lighting.setLight).not.toHaveBeenCalled();

    scene.time.now += 1_000;
    renderer.update(1_116);
    expect(createdQuads[0].destroyed).toBe(true);
    expect(createdQuads).toHaveLength(1);
  });

  it('allocates no GPU objects for headless presentation', () => {
    createdQuads.length = 0;
    const renderer = new FlamethrowerUpgradeRenderer(
      { time: { now: 0 } } as unknown as Phaser.Scene,
      { getOwnerVisualState: () => ({ x: 0, y: 0, visible: true }) } as never,
    );
    renderer.syncRings({ p1: ringState(64) });
    renderer.update(0);
    expect(createdQuads).toHaveLength(0);
    // Ohne `registerGpuVfx()` darf der Bodenpfad nur nichts tun, nicht werfen.
    renderer.clear();
  });
});


describe('fire-chunk authoritative presentation times', () => {
  it('uses the remaining flight time without a minimum delay and removes counters on teardown', () => {
    const images: any[] = [], counters: any[] = [];
    const scene = {
      add: { image: (x: number, y: number) => {
        const image: any = { x, y, active: true, destroy: vi.fn(() => { image.active = false; }) };
        for (const method of ['setDepth','setBlendMode','setTint','setScale','setRotation']) image[method] = () => image;
        image.setPosition = (x: number, y: number) => { Object.assign(image, { x, y }); return image; };
        images.push(image); return image;
      } },
      tweens: { addCounter: (options: any) => {
        const tween = { ...options, remove: vi.fn() }; counters.push(tween); return tween;
      }, killTweensOf: vi.fn() },
    };
    const renderer = new FlamethrowerUpgradeRenderer(scene as never, {} as never);
    renderer.playFireChunkBurst(0, 0, [
      { x: 60, y: 0, landsAt: 1040 }, { x: 90, y: 0, landsAt: 1060 }, { x: 100, y: 0, landsAt: 1100 },
    ], 1000, 1050);
    expect(counters.map(t => t.duration)).toEqual([10, 50]);
    expect(counters[0].from).toBeCloseTo(50 / 60);
    expect(images[0].x).toBeCloseTo(75);
    counters[0].onComplete();
    expect(images[0].active).toBe(false);
    renderer.clear();
    expect(counters[1].remove).toHaveBeenCalledOnce();
    expect(images.every(image => !image.active)).toBe(true);
  });
});
