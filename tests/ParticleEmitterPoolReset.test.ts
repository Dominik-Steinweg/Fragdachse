import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';

vi.mock('phaser', () => ({}));

import { killAllAndResetParticlePositions } from '../src/effects/EffectUtils';

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
}

describe('particle emitter pool reset', () => {
  it('resets dead particles before emitParticleAt() reuses them', () => {
    const emitter = new TestEmitter();
    emitter.emitParticleAt(512, 640);

    killAllAndResetParticlePositions(
      emitter as unknown as Phaser.GameObjects.Particles.ParticleEmitter,
    );

    expect(emitter.emitParticleAt(96, 128)).toMatchObject({ x: 96, y: 128 });
  });
});
