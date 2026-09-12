import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../src/utils/phaserFx', () => ({
  addExternalGlow: vi.fn(() => ({ outerStrength: 0 })),
  removeExternalFx: vi.fn(),
}));

vi.mock('phaser', () => {
  class FakeShader {
    renders = 0;
    destroyed = false;
    drawingContext = { clear: () => undefined, setClearColor: () => undefined };
    constructor(
      public scene: any,
      public config: { setupUniforms?: (set: (name: string, value: unknown) => void) => void },
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) { scene.shaders.push(this); }
    setRenderToTexture(key: string): this {
      this.scene.textureKeys.add(key);
      this.renderWebGLStep();
      return this;
    }
    renderWebGLStep(): void { this.renders++; }
    destroy(): void { this.destroyed = true; }
  }
  return {
    BlendModes: { ADD: 1 },
    GameObjects: { Shader: FakeShader, Events: { DESTROY: 'destroy' } },
    Geom: { Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} } },
    Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  };
});

import { LivingBarEffect } from '../src/ui/LivingBarEffect';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';
import type { GraphicsQuality } from '../src/graphics/GraphicsQuality';
import { addExternalGlow, removeExternalFx } from '../src/utils/phaserFx';

interface FakeImage {
  visible: boolean;
  alpha: number;
  cropped: boolean;
  destroyed: boolean;
  key: string;
  x: number;
  y: number;
  scale: number;
  crop: { x: number; y: number; width: number; height: number } | null;
  cropWrites: number;
  tints: number[];
}

function makeScene(quality: GraphicsQuality, options: { webgl?: boolean } = {}) {
  const created: FakeImage[] = [];
  const tweens: unknown[] = [];
  const removedTextures: string[] = [];
  const textureKeys = new Set(['_living_blob']);
  const shaders: { renders: number; destroyed: boolean }[] = [];
  const events = new EventEmitter();
  const children: object[] = [];
  const container = Object.assign(new EventEmitter(), {
    list: children,
    add: (image: object) => { children.push(image); },
    addAt: (image: object, index: number) => { children.splice(index, 0, image); },
    getIndex: (image: object) => children.indexOf(image),
  });

  const makeImage = (x: number, y: number, key: string): FakeImage & Record<string, unknown> => {
    const image = {
      x, y, key, scale: 1, crop: null as FakeImage['crop'], cropWrites: 0, tints: [] as number[],
      visible: true,
      alpha: 1,
      cropped: false,
      destroyed: false,
      setOrigin: () => image,
      setScale: (s: number) => { image.scale = s; return image; },
      setBlendMode: () => image,
      setAlpha: (a: number) => { image.alpha = a; return image; },
      setVisible: (v: boolean) => { image.visible = v; return image; },
      setTint: (...tints: number[]) => { image.tints = tints; return image; },
      setPosition: (x: number, y: number) => { image.x = x; image.y = y; return image; },
      setDisplaySize: () => image,
      setScrollFactor: () => image,
      setCrop: (x: number, y: number, width: number, height: number) => {
        image.cropped = true; image.crop = { x, y, width, height }; image.cropWrites++; return image;
      },
      destroy: () => {
        image.destroyed = true;
        const index = children.indexOf(image);
        if (index >= 0) children.splice(index, 1);
        return image;
      },
    };
    created.push(image);
    return image;
  };

  const scene = {
    shaders, textureKeys,
    // Nur `_living_blob` existiert vorab; der Feldtexturschluessel wird vom Shader erzeugt.
    textures: {
      exists: (key: string) => textureKeys.has(key),
      createCanvas: () => null,
      remove: (key: string) => { removedTextures.push(key); textureKeys.delete(key); },
    },
    sys: { renderer: options.webgl === false ? {} : { gl: {} } },
    scene: { key: 'FakeScene' },
    events,
    add: {
      image: makeImage,
      particles: () => { throw new Error('LivingBarEffect must not create particle emitters'); },
    },
    tweens: { add: (cfg: unknown) => { tweens.push(cfg); return { destroy: () => undefined }; } },
  } as never;

  const controller = new GraphicsQualityController(quality);
  controller.attach(scene);
  return { scene, created, tweens, controller, shaders, textureKeys, events, children,
    container: container as never, destroyContainer: () => container.emit('destroy'),
    tick: (delta = 50) => events.emit('update', 0, delta) };
}

const palette = { dark: 0x111111, mid: 0x222222, light: 0x333333 };

describe('LivingBarEffect quality gating', () => {
  it('shows a single tinted field window on high, without any emitter', () => {
    const { scene, created, container } = makeScene('high');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    // Ein 40 px breiter Balken passt in eine Kachel.
    expect(created.length).toBe(1);
    expect(created[0].visible).toBe(true);
    expect(created[0].cropped).toBe(true);
    expect(() => effect.destroy()).not.toThrow();
  });

  it('tiles wide bars instead of stretching the field', () => {
    const { scene, created, container } = makeScene('high');
    // Die Kachelbreite haengt an der Balkenhoehe (16 * h); 12 px Hoehe ergeben 192 px je Kachel.
    new LivingBarEffect(scene, container, 0, 0, 600, 12, palette);
    expect(created.length).toBe(Math.ceil(600 / 192));
  });

  it('creates nothing at all on low', () => {
    const { scene, created, tweens, container } = makeScene('low');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    // Weder Feldfenster noch Puls: Ohne den Schalter bliebe die geteilte Feldtextur fuer einen
    // unsichtbaren Balken am Rendern.
    expect(created.length).toBe(0);
    expect(tweens.length).toBe(0);
    expect(effect.breathAura).toBeNull();
  });

  it('stays inert on low when the bar is later filled', () => {
    const { scene, created, tweens, container } = makeScene('low');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    // setFilledWidth()/start() rufen intern ensureAura() – die Aura darf nicht nachwachsen.
    effect.setFilledWidth(38);
    effect.start();
    expect(created.length).toBe(0);
    expect(tweens.length).toBe(0);
    expect(effect.breathAura).toBeNull();
    expect(() => effect.destroy()).not.toThrow();
  });

  it('recreates its field window when quality goes back up from low', () => {
    const { scene, created, controller, container } = makeScene('low');
    new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    expect(created.length).toBe(0);

    // Regression: Der Effekt las die Qualitaet nur im Konstruktor und blieb nach einem
    // Wechsel low -> high dauerhaft abgeschaltet.
    controller.setLevel('high');
    expect(created.length).toBe(1);
    expect(created[0].destroyed).toBe(false);

    controller.setLevel('low');
    expect(created[0].destroyed).toBe(true);
  });

  it('stays silent without a WebGL renderer', () => {
    const { scene, created, container } = makeScene('high', { webgl: false });
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    expect(created.length).toBe(0);
    expect(() => effect.setFilledWidth(30)).not.toThrow();
    expect(() => effect.destroy()).not.toThrow();
  });

  it('keeps weighted compact samples stable across energy and quality changes', () => {
    const { scene, container, created, controller, shaders } = makeScene('high');
    const effect = new LivingBarEffect(scene, container, -22, -22, 44, 44, palette,
      { sampling: 'compact', variantKey: 'node-a', intensity: 0.32 });
    const original = created.map(image => ({ crop: image.crop, alpha: image.alpha, scale: image.scale }));
    expect(original.length).toBeGreaterThan(1);
    expect(new Set(original.map(sample => sample.crop!.x)).size).toBe(original.length);
    expect(new Set(original.map(sample => sample.crop!.y)).size).toBe(original.length);
    expect(shaders).toHaveLength(1);
    effect.setEnergyIntensity(1);
    const energized = created.map(image => image.alpha);
    energized.forEach((alpha, i) => expect(alpha / energized[0]).toBeCloseTo(original[i].alpha / original[0].alpha));
    controller.setLevel('low');
    expect(created.every(image => image.destroyed)).toBe(true);
    controller.setLevel('high');
    const rebuilt = created.filter(image => !image.destroyed);
    rebuilt.forEach((image, i) => {
      expect(image.crop).toEqual(original[i].crop);
      expect(image.scale).toBe(original[i].scale);
      expect(image.alpha).toBeCloseTo(energized[i]);
    });
    const before = created.length;
    new LivingBarEffect(scene, container, -22, -22, 44, 44, palette,
      { sampling: 'compact', variantKey: 'node-b', intensity: 0.32 });
    expect(created[before].crop).not.toEqual(rebuilt[0].crop);
  });

  it('maps clipped bands continuously in source space and keeps the fill edge straight', () => {
    const { scene, container, created } = makeScene('high');
    new LivingBarEffect(scene, container, -22, 0, 44, 22, palette, {
      sampling: 'compact',
      clipShape: { kind: 'roundedRect', x: -22, y: -22, width: 44, height: 44, radius: 10 },
    });
    const firstSample = created.filter(image => image.alpha === created[0].alpha);
    expect(firstSample.length).toBeGreaterThan(1);
    firstSample.forEach(image => {
      // Cropped Phaser Images retain the source offset in their local quad geometry.
      expect(image.x).toBeCloseTo(firstSample[0].x);
      expect(image.y).toBeCloseTo(firstSample[0].y);
      expect(image.y + image.crop!.y * image.scale).toBeGreaterThanOrEqual(0);
      expect(image.y + (image.crop!.y + image.crop!.height) * image.scale).toBeLessThanOrEqual(22);
      const left = image.x + image.crop!.x * image.scale;
      const expected = Math.round(0x11 + (0x33 - 0x11) * (left + 22) / 44);
      expect(image.tints[0] & 0xff).toBe(expected);
    });
    expect(firstSample[0].x + firstSample[0].crop!.x * firstSample[0].scale).toBeCloseTo(-22);
    expect(firstSample[0].crop!.width * firstSample[0].scale).toBeCloseTo(44);
    expect(firstSample.at(-1)!.crop!.width * firstSample.at(-1)!.scale).toBeLessThan(44);
  });

  it('tiles shallow compact fills within source bounds without stretching or gaps', () => {
    const { scene, container, created, shaders } = makeScene('high');
    new LivingBarEffect(scene, container, 0, 0, 44, 1, palette, { sampling: 'compact' });
    for (const image of created) {
      const crop = image.crop!;
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(1024 + 1e-7);
      expect(crop.y + crop.height).toBeLessThanOrEqual(128 + 1e-7);
      expect(image.scale).toBe(1 / 64);
    }
    for (const alpha of new Set(created.map(image => image.alpha))) {
      const sample = created.filter(image => image.alpha === alpha);
      let end = 0;
      sample.forEach(image => {
        expect(image.x + image.crop!.x * image.scale).toBeCloseTo(end);
        end += image.crop!.width * image.scale;
      });
      expect(end).toBeCloseTo(44);
    }
    expect(shaders).toHaveLength(1);
  });

  it('balances active ownership per effect through repeated starts, fills and stops', () => {
    const { scene, container, created, shaders, tick, textureKeys } = makeScene('high');
    const first = new LivingBarEffect(scene, container, 0, 0, 44, 44, palette,
      { sampling: 'compact', startActive: false });
    const second = new LivingBarEffect(scene, container, 0, 0, 80, 12, palette, { startActive: false });
    tick();
    expect(shaders[0].renders).toBe(1);
    expect(created.every(image => !image.visible)).toBe(true);
    first.start(); first.start(); second.start();
    tick();
    expect(shaders[0].renders).toBe(2);
    first.stop(); first.stop();
    tick();
    expect(shaders[0].renders).toBe(3);
    second.setFilledWidth(4);
    tick();
    expect(shaders[0].renders).toBe(3);
    first.setFilledWidth(20); // Hidden updates must not resume the field.
    tick();
    expect(shaders[0].renders).toBe(3);
    first.start();
    tick(1);
    expect(shaders[0].renders).toBe(4);
    const cropWrites = created.map(image => image.cropWrites);
    first.start(); first.setFilledWidth(20);
    expect(created.map(image => image.cropWrites)).toEqual(cropWrites);
    first.destroy(); first.destroy();
    tick();
    expect(shaders[0].renders).toBe(4);
    expect(shaders[0].destroyed).toBe(false);
    second.destroy();
    expect(shaders[0].destroyed).toBe(true);
    expect([...textureKeys]).toEqual(['_living_blob']);
  });

  it('does not render for a fill entirely outside its clip', () => {
    const { scene, container, created, shaders, tick } = makeScene('high');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 20, palette, {
      clipShape: { kind: 'roundedRect', x: 20, y: 0, width: 20, height: 20, radius: 5 },
    });
    effect.setFilledWidth(10);
    tick();
    expect(created.every(image => !image.visible)).toBe(true);
    expect(shaders[0].renders).toBe(1);
    effect.setFilledWidth(30);
    tick();
    expect(shaders[0].renders).toBe(2);
  });

  it('keeps hidden consumers and their glow inert across quality rebuilds and parent teardown', () => {
    vi.mocked(addExternalGlow).mockClear();
    vi.mocked(removeExternalFx).mockClear();
    const { scene, container, shaders, controller, tick, destroyContainer } = makeScene('high');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette,
      { startActive: false, glowTarget: {} as never });
    controller.setLevel('low');
    controller.setLevel('high');
    tick();
    expect(addExternalGlow).not.toHaveBeenCalled();
    expect(shaders.at(-1)!.renders).toBe(1);
    effect.start();
    expect(addExternalGlow).toHaveBeenCalledTimes(1);
    tick();
    const glow = effect.breathGlow!;
    effect.stop();
    const strength = glow.outerStrength;
    tick(400);
    expect(glow.outerStrength).toBe(strength);
    expect(removeExternalFx).toHaveBeenCalledTimes(1);
    effect.start();
    destroyContainer();
    expect(shaders.every(shader => shader.destroyed)).toBe(true);
    const count = shaders.length;
    controller.setLevel('low'); controller.setLevel('high');
    effect.start(); effect.destroy();
    expect(shaders).toHaveLength(count);
  });

  it.each(['high', 'low'] as const)('preserves authored layering when rebuilding from initial %s quality', quality => {
    const { scene, container, children, created, controller } = makeScene(quality);
    const fillA = {}, labelA = {}, fillB = {}, labelB = {};
    children.push(fillA);
    new LivingBarEffect(scene, container, 0, 0, 44, 44, palette, { sampling: 'compact' });
    children.push(labelA, fillB);
    new LivingBarEffect(scene, container, 50, 0, 44, 44, palette, { sampling: 'compact' });
    children.push(labelB);
    controller.setLevel('low');
    expect(children).toEqual([fillA, labelA, fillB, labelB]);
    controller.setLevel('high');
    const images = created.filter(image => !image.destroyed);
    expect(children[0]).toBe(fillA);
    expect(children.at(-1)).toBe(labelB);
    for (const image of images) {
      const left = image.x + image.crop!.x * image.scale;
      const [fill, label] = left < 50 ? [fillA, labelA] : [fillB, labelB];
      expect(children.indexOf(image)).toBeGreaterThan(children.indexOf(fill));
      expect(children.indexOf(image)).toBeLessThan(children.indexOf(label));
    }
    expect(images.length).toBeGreaterThan(0);
  });
});
