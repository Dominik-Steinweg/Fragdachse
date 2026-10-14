import { describe, expect, it, vi } from 'vitest';
import type { WorldCombatGameplayBindingOptions } from '../../src/world/WorldCombatGameplayBinding';
import type { FireControlSnapshotSource } from '../../src/world/WorldPresentationFrameBinding';

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
const composed = vi.hoisted(() => ({ options: null as WorldCombatGameplayBindingOptions | null,
  getFireControlSnapshot: vi.fn(), getBomberSquadronSnapshot: vi.fn(),
  holo: {}, bomber: {} }));
vi.mock('../../src/world/WorldCombatGameplayBinding', () => ({
  WorldCombatGameplayBinding: class {
    constructor(options: WorldCombatGameplayBindingOptions) { composed.options = options; }
    getFireControlSnapshot = composed.getFireControlSnapshot;
    getBomberSquadronSnapshot = composed.getBomberSquadronSnapshot;
    getHoloOffensiveCapability = () => composed.holo;
    getBomberSquadronCapability = () => composed.bomber;
  },
}));
vi.mock('../../src/scenes/arena/RendererBundle', () => ({ wireProjectileRenderers: vi.fn() }));
const bridgeMock = vi.hoisted(() => ({
  isHost: vi.fn(() => true),
  setFireControlSnapshotProvider: vi.fn(), getFireControlSnapshot: vi.fn(),
  setBomberSquadronSnapshotProvider: vi.fn(), getBomberSquadronSnapshot: vi.fn(),
  getSynchronizedNow: () => 4567,
  broadcastExplosionEffect: vi.fn(), registerExplosionEffectHandler: vi.fn(),
}));
vi.mock('../../src/network/bridge', () => ({ bridge: bridgeMock }));

import { composeWorldCombatGameplay } from '../../src/scenes/arena/ArenaWorldCombatComposition';
import { RpcCoordinator } from '../../src/scenes/arena/RpcCoordinator';
import { EffectSystem } from '../../src/effects/EffectSystem';

describe('Fire control World composition', () => {
  it.each([true, false])('binds the replicated snapshot, original lookup and copy-shot port (host=%s)', host => {
    bridgeMock.isHost.mockReturnValue(host);
    const snapshot = { deployments: [{ kind: 'portal', id: 7, ownerId: 'host', ownerColor: 0xffffff,
      x: 100, y: 200, startedAt: 1000, expiresAt: 10000, localFireRelease: false, entries: [] }] };
    composed.getFireControlSnapshot.mockReset().mockReturnValue(snapshot);
    bridgeMock.getFireControlSnapshot.mockReset().mockReturnValue(snapshot);
    bridgeMock.setFireControlSnapshotProvider.mockReset();
    bridgeMock.setBomberSquadronSnapshotProvider.mockReset();
    const bomberSnapshot = { squadrons: [] };
    composed.getBomberSquadronSnapshot.mockReset().mockReturnValue(bomberSnapshot);
    bridgeMock.getBomberSquadronSnapshot.mockReset().mockReturnValue(bomberSnapshot);
    const bindFireControl = vi.fn();
    const bindBomberSquadron = vi.fn(), bind = vi.fn();
    const player = { setHoloOffensiveCapability: vi.fn(), setBomberSquadronCapability: vi.fn() };
    const presentation = { bindFireControlCopyShots: vi.fn() };
    const original = { sprite: {}, x: 23, y: 45 };
    const getTurretOriginalVisual = vi.fn(() => original);
    composeWorldCombatGameplay({
      ctx: {}, worldRuntime: { bind, presentationFrame: { bindFireControl, bindBomberSquadron } }, world: { metrics: {} },
      rockVisualHelper: { getTurretOriginalVisual },
    } as never, { player, projectiles: { getPresentationRuntime: () => presentation },
      combatSystem: { setPlayerMountedResolver: vi.fn() } } as never);
    const [source, lookup] = bindFireControl.mock.lastCall! as [FireControlSnapshotSource, (id: number) => unknown];
    expect(source(4567)).toBe(snapshot);
    expect(bridgeMock.getFireControlSnapshot).toHaveBeenCalledOnce();
    expect(bindFireControl.mock.lastCall![2]).toBe(presentation);
    expect(composed.getFireControlSnapshot).not.toHaveBeenCalled();
    if (host) {
      expect(bridgeMock.setFireControlSnapshotProvider).toHaveBeenCalledOnce();
      expect(bridgeMock.setFireControlSnapshotProvider.mock.lastCall![0]()).toBe(snapshot);
      expect(composed.getFireControlSnapshot).toHaveBeenCalledExactlyOnceWith(4567);
    } else expect(bridgeMock.setFireControlSnapshotProvider).not.toHaveBeenCalled();
    expect(lookup(9)).toBe(original);
    expect(getTurretOriginalVisual).toHaveBeenCalledExactlyOnceWith(9);
    expect(bindBomberSquadron.mock.lastCall![0]()).toBe(bomberSnapshot);
    expect(player.setHoloOffensiveCapability).toHaveBeenCalledWith(composed.holo);
    expect(player.setBomberSquadronCapability).toHaveBeenCalledWith(composed.bomber);
    if (host) expect(bridgeMock.setBomberSquadronSnapshotProvider.mock.lastCall![0]()).toBe(bomberSnapshot);
    else expect(bridgeMock.setBomberSquadronSnapshotProvider).not.toHaveBeenCalled();
    for (const [binding] of bind.mock.calls) binding.destroy?.();
    expect(player.setHoloOffensiveCapability).toHaveBeenLastCalledWith(null);
    expect(player.setBomberSquadronCapability).toHaveBeenLastCalledWith(null);
    bridgeMock.isHost.mockReturnValue(true);
  });
});

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
