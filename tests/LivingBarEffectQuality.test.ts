import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  Geom: { Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} } },
}));

import { LivingBarEffect } from '../src/ui/LivingBarEffect';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';
import type { GraphicsQuality } from '../src/graphics/GraphicsQuality';

function makeScene(quality: GraphicsQuality) {
  const created: unknown[] = [];
  const tweens: unknown[] = [];
  const scene = {
    textures: { exists: () => true, createCanvas: () => null },
    add: {
      particles: () => {
        const emitter = {
          addEmitZone: () => emitter,
          setScrollFactor: () => emitter,
          start: () => emitter,
          stop: () => emitter,
          destroy: () => emitter,
          emitting: true,
          once: () => emitter,
          off: () => emitter,
          explode: () => undefined,
          emitParticleAt: () => undefined,
          setFrequency: () => emitter,
        };
        created.push(emitter);
        return emitter;
      },
    },
    tweens: { add: (cfg: unknown) => { tweens.push(cfg); return { destroy: () => undefined }; } },
  } as never;

  // Der Controller registriert sich per attach() fuer getGraphicsQualityProfile(scene).
  const controller = new GraphicsQualityController(quality);
  controller.attach(scene);
  return { scene, created, tweens, controller };
}

const container = { add: () => undefined } as never;
const palette = { dark: 0x111111, mid: 0x222222, light: 0x333333 };

describe('LivingBarEffect quality gating', () => {
  it('creates its two emitters on high', () => {
    const { scene, created } = makeScene('high');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    expect(created.length).toBe(2);
    expect(effect.idleCore).not.toBeNull();
    expect(effect.idleOuter).not.toBeNull();
  });

  it('creates nothing at all on low', () => {
    const { scene, created, tweens } = makeScene('low');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    // Weder Emitter noch Puls-Tween: Ohne den Schalter blieben nur die Partikel aus,
    // die Emitter-Objekte und der Glow-Tween liefen weiter.
    expect(created.length).toBe(0);
    expect(tweens.length).toBe(0);
    expect(effect.idleCore).toBeNull();
    expect(effect.idleOuter).toBeNull();
  });

  it('stays inert on low when the bar is later filled', () => {
    const { scene, created, tweens } = makeScene('low');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    // setFilledWidth()/start() rufen intern ensureGlow() – der Glow darf nicht nachwachsen.
    effect.setFilledWidth(38);
    effect.start();
    expect(created.length).toBe(0);
    expect(tweens.length).toBe(0);
    expect(effect.breathGlow).toBeNull();
    // Aufraeumen muss ohne Emitter fehlerfrei durchlaufen.
    expect(() => effect.destroy()).not.toThrow();
  });
  it('recreates its emitters when quality goes back up from low', () => {
    const { scene, created, controller } = makeScene('low');
    const effect = new LivingBarEffect(scene, container, 0, 0, 40, 14, palette);
    expect(created.length).toBe(0);

    // Regression: Der Effekt las die Qualitaet nur im Konstruktor und blieb nach einem
    // Wechsel low -> high dauerhaft abgeschaltet.
    controller.setLevel('high');
    expect(created.length).toBe(2);
    expect(effect.idleCore).not.toBeNull();

    controller.setLevel('low');
    expect(effect.idleCore).toBeNull();
    expect(effect.idleOuter).toBeNull();
  });
});
