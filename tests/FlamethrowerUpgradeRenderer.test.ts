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
