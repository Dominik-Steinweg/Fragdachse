import { describe, expect, it, vi } from 'vitest';
import type { WorldCombatGameplayBindingOptions } from '../../src/world/WorldCombatGameplayBinding';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1, SCREEN: 2 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
  Display: { Color: {
    IntegerToRGB: (color: number) => ({ r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 }),
    GetColor: (r: number, g: number, b: number) => (r << 16) | (g << 8) | b,
  } },
}));
const composed = vi.hoisted(() => ({ options: null as WorldCombatGameplayBindingOptions | null }));
vi.mock('../../src/world/WorldCombatGameplayBinding', () => ({
  WorldCombatGameplayBinding: class {
    constructor(options: WorldCombatGameplayBindingOptions) { composed.options = options; }
  },
}));
vi.mock('../../src/scenes/arena/RendererBundle', () => ({ wireProjectileRenderers: vi.fn() }));
const bridgeMock = vi.hoisted(() => ({
  broadcastExplosionEffect: vi.fn(), registerExplosionEffectHandler: vi.fn(),
}));
vi.mock('../../src/network/bridge', () => ({ bridge: bridgeMock }));

import { composeWorldCombatGameplay } from '../../src/scenes/arena/ArenaWorldCombatComposition';
import { RpcCoordinator } from '../../src/scenes/arena/RpcCoordinator';
import { EffectSystem } from '../../src/effects/EffectSystem';

describe('Time Bubble release across World composition and presentation', () => {
  it('selects exactly one source sound independently of the explosion visual style', () => {
    const audio = { playSound: vi.fn() };
    const rpc = Object.assign(Object.create(RpcCoordinator.prototype), {
      effectSystem: { playExplosionEffect: vi.fn() }, gameAudioSystem: audio,
    });
    rpc.registerExplosionEffectHandler();
    const receive = bridgeMock.registerExplosionEffectHandler.mock.lastCall![0];
    receive(10, 20, 100, undefined, 'default', undefined, 'ARMAGEDDON');
    receive(10, 20, 100, undefined, 'default', undefined, 'HE_GRENADE');
    receive(10, 20, 100, undefined, 'energy', undefined, 'enemy.void_meteor');
    receive(10, 20, 100, undefined, 'default', undefined, 'silent');
    expect(audio.playSound.mock.calls.map(call => call[0])).toEqual([
      'sfx_explosion_armageddon', 'sfx_explosion_he', 'sfx_explosion_void_armageddon',
    ]);
  });

  it('keeps the stored damage through the real World adapter so the RPC plays both the wave and energy audio', () => {
    // Capture the port supplied by the actual scene composition. Calling the Bridge directly
    // would miss adapters that silently discard optional event fields.
    composeWorldCombatGameplay({
      ctx: {}, worldRuntime: { bind: vi.fn() }, world: { metrics: {} },
    } as never, { projectiles: {}, combatSystem: { setPlayerMountedResolver: vi.fn() } } as never);
    const broadcast = composed.options!.network.effects.broadcastExplosionEffect;
    const gpu = { spawnCombatExplosion: vi.fn() };
    const lighting = { pulse: vi.fn() };
    const audio = { playSound: vi.fn() };
    const effects = Object.assign(Object.create(EffectSystem.prototype), {
      ensureTextures: vi.fn(), explosionGpuRenderer: gpu, lighting,
    });
    const rpc = Object.assign(Object.create(RpcCoordinator.prototype), {
      effectSystem: effects, gameAudioSystem: audio,
    });
    rpc.registerExplosionEffectHandler();
    const receive = bridgeMock.registerExplosionEffectHandler.mock.lastCall![0];
    bridgeMock.broadcastExplosionEffect.mockImplementation(receive);

    const x = 120, y = 240, radius = 180;
    const release = (charge: number) => broadcast(x, y, radius, 0xff5b18, 'time_bubble_release', charge, 'TIME_BUBBLE');
    release(35);
    expect(gpu.spawnCombatExplosion).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      x, y, radius, style: 'time_bubble_release', chargeDamage: 35,
    }));
    expect(audio.playSound).toHaveBeenCalledExactlyOnceWith(
      'sfx_explosion_time_bubble', x, y, undefined, expect.any(Number),
    );
    const lowVolume = audio.playSound.mock.lastCall![4];
    expect(lowVolume).toBeGreaterThan(0);
    const lowLight = lighting.pulse.mock.lastCall![3].intensity;
    release(110);
    expect(gpu.spawnCombatExplosion).toHaveBeenLastCalledWith(expect.objectContaining({ chargeDamage: 110 }));
    expect(audio.playSound.mock.lastCall![4]).toBeGreaterThan(lowVolume);
    expect(lighting.pulse.mock.lastCall![3].intensity).toBeGreaterThan(lowLight);
    release(0);
    expect(gpu.spawnCombatExplosion).toHaveBeenCalledTimes(2);
    expect(audio.playSound).toHaveBeenCalledTimes(2);
  });
});
