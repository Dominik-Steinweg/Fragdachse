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
  it('observes predicted hitscan once, skips its echo and disconnects only the owning fog sink', () => {
    const system = Object.create(EffectSystem.prototype) as EffectSystem;
    Object.assign(system, { scene: { time: { now: 10 } }, bridge: { getLocalPlayerId: () => 'local' },
      ensureTextures: vi.fn(), emitHitscanBeamLight: vi.fn(), pendingPredictedTracerIds: new Map(), processedSyncedTracerKeys: new Map(),
      asmdPrimaryRenderer: { playTracer: vi.fn() } });
    const sink = { hitscan: vi.fn(), melee: vi.fn() }, replacement = { hitscan: vi.fn(), melee: vi.fn() };
    const release = system.bindGroundFogCombat(sink);
    system.playPredictedHitscanTracer(300, 300, 600, 300, 0xffffff, 2, 7, 'none', 'asmd_primary');
    system.playSyncedHitscanTracer({ startX: 300, startY: 300, endX: 600, endY: 300, color: 0xffffff,
      thickness: 2, shooterId: 'local', shotId: 7, visualPreset: 'asmd_primary' });
    expect(sink.hitscan).toHaveBeenCalledExactlyOnceWith(300, 300, 600, 300, 2);
    const releaseReplacement = system.bindGroundFogCombat(replacement); release();
    system.playHitscanTracer(300, 300, 600, 300, 0xffffff, 2, 'none', 'asmd_primary');
    expect(replacement.hitscan).toHaveBeenCalledOnce();
    releaseReplacement(); system.playHitscanTracer(300, 300, 600, 300, 0xffffff, 2, 'none', 'asmd_primary');
    expect(replacement.hitscan).toHaveBeenCalledOnce();
  });
  it('observes bite and taser after swing deduplication, including their specialized VFX paths', () => {
    const system = Object.create(EffectSystem.prototype) as EffectSystem;
    Object.assign(system, { scene: { time: { now: 10 } }, processedMeleeSwingKeys: new Map(),
      biteRenderer: { playSwing: vi.fn() }, zeusTaserRenderer: { playSwing: vi.fn() } });
    const sink = { hitscan: vi.fn(), melee: vi.fn() }; system.bindGroundFogCombat(sink);
    for (const [swingId, visualPreset] of [[1, 'bite'], [2, 'zeus_taser']] as const) {
      const swing = { shooterId: 'player', swingId, visualPreset, x: 300, y: 300, angle: .5, arcDegrees: 90, range: 100, color: 0xffffff };
      system.playSyncedMeleeSwing(swing); system.playSyncedMeleeSwing(swing);
    }
    expect(sink.melee).toHaveBeenCalledTimes(2);
    expect(sink.melee).toHaveBeenLastCalledWith(300, 300, .5, 90, 100);
  });
  it('observes the generic melee entry before rendering and releases its sink', () => {
    const system = Object.create(EffectSystem.prototype) as EffectSystem;
    const stop = new Error('graphics gate');
    Object.assign(system, { scene: { add: { graphics: () => { throw stop; } } } });
    const sink = { hitscan: vi.fn(), melee: vi.fn() }, release = system.bindGroundFogCombat(sink);
    expect(() => system.playMeleeSwingEffect(300, 300, 0, 90, 100, 0xffffff)).toThrow(stop);
    expect(sink.melee).toHaveBeenCalledExactlyOnceWith(300, 300, 0, 90, 100);
    release(); expect(() => system.playMeleeSwingEffect(300, 300, 0, 90, 100, 0xffffff)).toThrow(stop);
    expect(sink.melee).toHaveBeenCalledOnce();
  });
  it('delivers destructive fog impulses before individual VFX gates and detaches their owner', () => {
    const system = Object.create(EffectSystem.prototype) as EffectSystem;
    const sink = vi.fn(), stop = new Error('VFX preparation gate');
    Object.assign(system, { ensureTextures: () => { throw stop; } });
    const release = system.bindGroundFogExplosion(sink);
    expect(() => system.playExplosionEffect(10, 20, 50, undefined, 'mini_rocket')).toThrow(stop);
    expect(sink).toHaveBeenCalledExactlyOnceWith(10, 20, 50, 'mini_rocket');
    expect(() => system.playExplosionEffect(10, 20, 50, undefined, 'regeneration')).toThrow(stop);
    release(); expect(() => system.playExplosionEffect(10, 20, 50)).toThrow(stop);
    expect(sink).toHaveBeenCalledTimes(1);
  });
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
