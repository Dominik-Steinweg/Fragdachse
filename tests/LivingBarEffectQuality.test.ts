import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class FakeShader {
    drawingContext = { clear: () => undefined, setClearColor: () => undefined };
    constructor(
      public scene: unknown,
      public config: { setupUniforms?: (set: (name: string, value: unknown) => void) => void },
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
    setRenderToTexture(): this { return this; }
    renderWebGLStep(): void {}
    destroy(): void {}
  }
  return {
    BlendModes: { ADD: 1 },
    GameObjects: { Shader: FakeShader },
    Geom: { Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} } },
    Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  };
});

import { LivingBarEffect } from '../src/ui/LivingBarEffect';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';
import type { GraphicsQuality } from '../src/graphics/GraphicsQuality';

interface FakeImage {
  visible: boolean;
  alpha: number;
  cropped: boolean;
  destroyed: boolean;
}

function makeScene(quality: GraphicsQuality, options: { webgl?: boolean } = {}) {
  const created: FakeImage[] = [];
  const tweens: unknown[] = [];
  const removedTextures: string[] = [];

  const makeImage = (): FakeImage & Record<string, unknown> => {
    const image = {
      visible: true,
      alpha: 1,
      cropped: false,
      destroyed: false,
      setOrigin: () => image,
      setScale: () => image,
      setBlendMode: () => image,
      setAlpha: (a: number) => { image.alpha = a; return image; },
      setVisible: (v: boolean) => { image.visible = v; return image; },
      setTint: () => image,
      setPosition: () => image,
      setDisplaySize: () => image,
      setScrollFactor: () => image,
      setCrop: () => { image.cropped = true; return image; },
      destroy: () => { image.destroyed = true; return image; },
    };
    created.push(image);
    return image;
  };

  const scene = {
    // Nur `_living_blob` existiert vorab; der Feldtexturschluessel wird vom Shader erzeugt.
    textures: {
      exists: () => true,
      createCanvas: () => null,
      remove: (key: string) => { removedTextures.push(key); },
    },
    sys: { renderer: options.webgl === false ? {} : { gl: {} } },
    scene: { key: 'FakeScene' },
    events: { on: () => undefined, once: () => undefined, off: () => undefined },
    add: {
      image: () => makeImage(),
      particles: () => { throw new Error('LivingBarEffect must not create particle emitters'); },
    },
    tweens: { add: (cfg: unknown) => { tweens.push(cfg); return { destroy: () => undefined }; } },
  } as never;

  const controller = new GraphicsQualityController(quality);
  controller.attach(scene);
  return { scene, created, tweens, controller };
}

const container = { add: () => undefined, addAt: () => undefined } as never;
const palette = { dark: 0x111111, mid: 0x222222, light: 0x333333 };

describe('LivingBarEffect quality gating', () => {
  it('shows a single tinted field window on high, without any emitter', () => {
    const { scene, created } = makeScene('high');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    // Ein 40 px breiter Balken passt in eine Kachel.
    expect(created.length).toBe(1);
    expect(created[0].visible).toBe(true);
    expect(created[0].cropped).toBe(true);
    expect(() => effect.destroy()).not.toThrow();
  });

  it('tiles wide bars instead of stretching the field', () => {
    const { scene, created } = makeScene('high');
    // Die Kachelbreite haengt an der Balkenhoehe (16 * h); 12 px Hoehe ergeben 192 px je Kachel.
    new LivingBarEffect(scene, container, 0, 0, 600, 12, palette);
    expect(created.length).toBe(Math.ceil(600 / 192));
  });

  it('creates nothing at all on low', () => {
    const { scene, created, tweens } = makeScene('low');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    // Weder Feldfenster noch Puls: Ohne den Schalter bliebe die geteilte Feldtextur fuer einen
    // unsichtbaren Balken am Rendern.
    expect(created.length).toBe(0);
    expect(tweens.length).toBe(0);
    expect(effect.breathAura).toBeNull();
  });

  it('stays inert on low when the bar is later filled', () => {
    const { scene, created, tweens } = makeScene('low');
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
    const { scene, created, controller } = makeScene('low');
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
    const { scene, created } = makeScene('high', { webgl: false });
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    expect(created.length).toBe(0);
    expect(() => effect.setFilledWidth(30)).not.toThrow();
    expect(() => effect.destroy()).not.toThrow();
  });
});
