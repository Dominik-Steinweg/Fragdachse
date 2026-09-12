import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import type { PlayerManager } from '../src/entities/PlayerManager';

interface TestParticle {
  x: number;
  y: number;
}

class TestEmitter {
  private readonly alive: TestParticle[] = [];
  private readonly dead: TestParticle[] = [];

  emitParticleAt(x: number, y: number): TestParticle {
    const particle = this.dead.pop() ?? { x: 0, y: 0 };
    particle.x += x;
    particle.y += y;
    this.alive.push(particle);
    return particle;
  }

  killAll(): void {
    while (this.alive.length > 0) this.dead.push(this.alive.pop()!);
  }

  forEachDead(callback: (particle: TestParticle, emitter: TestEmitter) => void): void {
    for (const particle of this.dead) callback(particle, this);
  }

  addParticleProcessor(): void {}
}

const createdEmitters: TestEmitter[] = [];

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  Math: { Between: () => 30, Linear: (a: number, b: number, t: number) => a + (b-a)*t },
  Utils: { Array: { GetRandom: (a: unknown[]) => a[0] } },
  GameObjects: {
    Particles: {
      ParticleProcessor: class {},
    },
  },
}));

vi.mock('../src/effects/EffectUtils', () => ({
  createEmitter: () => {
    const emitter = new TestEmitter();
    createdEmitters.push(emitter);
    return emitter;
  },
  killAllAndResetParticlePositions: (emitter: TestEmitter) => {
    emitter.killAll();
    emitter.forEachDead((particle) => {
      particle.x = 0;
      particle.y = 0;
    });
  },
  destroyEmitter: () => {},
  ensureCanvasTexture: () => {},
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

describe('FlamethrowerUpgradeRenderer particle pools', () => {
  it('keeps only the ring emitters classic and reuses their particles after clear()', () => {
    const renderer = new FlamethrowerUpgradeRenderer(
      {} as Phaser.Scene,
      {} as PlayerManager,
    );
    // Das Bodenfeuer laeuft ueber GPUFX; klassisch bleiben allein Ringflammen und Ringfunken,
    // die an eigener Ringgeometrie und am RingTurbulenceProcessor haengen.
    expect(createdEmitters).toHaveLength(2);
    for (const emitter of createdEmitters) emitter.emitParticleAt(512, 640);

    // Ohne `registerGpuVfx()` darf der Bodenpfad nur nichts tun, nicht werfen.
    renderer.clear();

    for (const emitter of createdEmitters) {
      const reused = emitter.emitParticleAt(96, 128);
      expect(reused).toMatchObject({ x: 96, y: 128 });
    }
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
