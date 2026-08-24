import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Animations: { Events: { ANIMATION_COMPLETE: 'animationcomplete' } },
  BlendModes: { ADD: 1, NORMAL: 0 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Scenes: { Events: { DESTROY: 'destroy', POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } },
  Textures: { FilterMode: { LINEAR: 0 } },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Angle: { Wrap: (angle: number) => angle },
  },
}));

import { EffectSystem } from '../src/effects/EffectSystem';
import type { SyncedDeathEffect } from '../src/types';

interface FakeDeathSprite {
  setOrigin: ReturnType<typeof vi.fn>;
  setDepth: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  complete: (() => void) | undefined;
}

function makeDeathSprite(): FakeDeathSprite {
  const sprite = {
    setOrigin: vi.fn(function(this: FakeDeathSprite) { return this; }),
    setDepth: vi.fn(function(this: FakeDeathSprite) { return this; }),
    setPosition: vi.fn(function(this: FakeDeathSprite) { return this; }),
    once: vi.fn(function(this: FakeDeathSprite, _event: string, callback: () => void) {
      this.complete = callback;
      return this;
    }),
    play: vi.fn(function(this: FakeDeathSprite) { return this; }),
    destroy: vi.fn(),
    complete: undefined,
  } as FakeDeathSprite;
  return sprite;
}

function makeEffect(targetId: string): SyncedDeathEffect {
  return {
    type: 'death',
    x: 320,
    y: 240,
    targetId,
    targetColor: 0x55cc88,
    rotation: 0,
    seed: 42,
  };
}

function makeSystem(playerTarget: (targetId: string) => boolean) {
  const sprites: FakeDeathSprite[] = [];
  const scene = {
    add: {
      sprite: vi.fn(() => {
        const sprite = makeDeathSprite();
        sprites.push(sprite);
        return sprite;
      }),
    },
  };
  const gpu = { playDeath: vi.fn() };
  const system = Object.create(EffectSystem.prototype) as EffectSystem;
  const internals = system as unknown as {
    scene: typeof scene;
    texturesGenerated: boolean;
    playDeathEffect: (effect: SyncedDeathEffect) => void;
  };
  internals.scene = scene;
  internals.texturesGenerated = true;
  system.setCombatGoreGpuRenderer(gpu as never);
  system.setPlayerDeathResolver(playerTarget);

  return { gpu, internals, scene, sprites };
}

describe('EffectSystem player death animation', () => {
  it('starts GPU death and the temporary player ghost together', () => {
    const { gpu, internals, scene, sprites } = makeSystem((targetId) => targetId === 'player-1');
    const effect = makeEffect('player-1');

    internals.playDeathEffect(effect);

    expect(gpu.playDeath).toHaveBeenCalledWith(effect, true);
    expect(scene.add.sprite).toHaveBeenCalledWith(320, 240, 'dachs_death');
    expect(sprites[0]!.setOrigin).toHaveBeenCalledWith(0.5, 1);
    expect(sprites[0]!.setPosition).toHaveBeenCalledWith(320, 256);
    expect(sprites[0]!.play).toHaveBeenCalledWith('player_death');

    sprites[0]!.complete?.();
    expect(sprites[0]!.destroy).toHaveBeenCalledOnce();
  });

  it('keeps enemy deaths on the GPU-only path', () => {
    const { gpu, internals, scene } = makeSystem((targetId) => targetId === 'player-1');

    internals.playDeathEffect(makeEffect('enemy-1'));

    expect(gpu.playDeath).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'enemy-1' }), false);
    expect(scene.add.sprite).not.toHaveBeenCalled();
  });

  it('gives consecutive player deaths independent temporary sprites', () => {
    const { internals, sprites } = makeSystem(() => true);

    internals.playDeathEffect(makeEffect('player-1'));
    internals.playDeathEffect(makeEffect('player-2'));

    expect(sprites).toHaveLength(2);
    sprites[0]!.complete?.();
    sprites[1]!.complete?.();
    expect(sprites[0]!.destroy).toHaveBeenCalledOnce();
    expect(sprites[1]!.destroy).toHaveBeenCalledOnce();
  });
});
