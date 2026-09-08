import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(max, n)),
  Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) },
} }));
const bridgeMock = vi.hoisted(() => ({ registerBurrowVisualHandler: vi.fn() }));
vi.mock('../../src/network/bridge', () => ({ bridge: bridgeMock }));

import { SHOCKWAVE_RADIUS } from '../../src/config';
import { EffectSystem } from '../../src/effects/EffectSystem';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { RpcCoordinator } from '../../src/scenes/arena/RpcCoordinator';
import { ClientUpdateCoordinator } from '../../src/scenes/arena/ClientUpdateCoordinator';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import type { BurrowPhase } from '../../src/types';

beforeEach(() => vi.clearAllMocks());

function presentation() {
  const entity = {
    id: 'p', x: 20, y: 30, displayObject: {} as object | undefined,
    setBurrowPhase: vi.fn(), getAimAngle: vi.fn(() => 1.2),
  };
  const players = new Map([['p', entity]]);
  const playerManager = { getPlayer: (id: string) => players.get(id) };
  const effects = {
    playPlayerBurrowPhaseEffect: vi.fn(), playBurrowPhaseEffect: vi.fn(),
    syncPlayerBurrowState: vi.fn(), syncBurrowState: vi.fn(),
  };
  const audio = { startLoop: vi.fn(() => ({})), stopLoop: vi.fn(), updateLoopPosition: vi.fn() };
  const ctx = { effectSystem: effects, gameAudioSystem: audio, playerManager };
  const client = Object.assign(Object.create(ClientUpdateCoordinator.prototype), {
    ctx, prevBurrowPhases: new Map([['p', 'underground']]), burrowLoopHandles: new Map([['p', {}]]),
  });
  const host = Object.assign(Object.create(HostUpdateCoordinator.prototype), {
    ctx, presentationActive: true,
    prevBurrowPhases: new Map([['p', 'underground']]), burrowLoopHandles: new Map([['p', {}]]),
  });
  const rpc = Object.assign(Object.create(RpcCoordinator.prototype), {
    playerManager, effectSystem: effects, clientUpdate: client,
  });
  rpc.registerBurrowVisualHandler();
  const receive = bridgeMock.registerBurrowVisualHandler.mock.calls.at(-1)![0] as (
    id: string, phase: BurrowPhase, x?: number, y?: number,
  ) => void;
  return { entity, players, effects, audio, client, host, receive };
}

describe('authoritative Burrow presentation', () => {
  it('binds ongoing player Burrow to GPU sources and releases surface, missing, and removed players without CPU effects', () => {
    const renderer = {
      syncUnderground: vi.fn(), clearUnderground: vi.fn(), clearAllUnderground: vi.fn(),
      playEnter: vi.fn(), playExit: vi.fn(),
    };
    const add = { circle: vi.fn(), graphics: vi.fn(), particles: vi.fn() };
    const tweens = { add: vi.fn() };
    const effects = Object.assign(Object.create(EffectSystem.prototype), {
      burrowGpuRenderer: renderer, burrowVisuals: new Map(), scene: { add, tweens },
    }) as EffectSystem;
    const legacy = vi.spyOn(effects, 'syncBurrowState');
    const discrete = vi.spyOn(effects, 'playPlayerBurrowPhaseEffect');
    const sprite = { x: 100, y: 200, rotation: 1.2, active: true } as never;
    for (const phase of ['underground', 'trapped'] as const) {
      effects.syncPlayerBurrowState('p', phase, sprite);
      expect(renderer.syncUnderground).toHaveBeenLastCalledWith('p', sprite);
      effects.syncPlayerBurrowState('p', phase);
      expect(renderer.clearUnderground).toHaveBeenLastCalledWith('p');
    }
    for (const phase of ['idle', 'windup', 'recovery'] as const) {
      renderer.clearUnderground.mockClear();
      effects.syncPlayerBurrowState('p', phase, sprite);
      expect(renderer.clearUnderground).toHaveBeenCalledExactlyOnceWith('p');
    }
    renderer.clearUnderground.mockClear();
    effects.clearBurrowState('departed');
    expect(renderer.clearUnderground).toHaveBeenCalledExactlyOnceWith('departed');
    effects.clearAllBurrowStates();
    expect(renderer.clearAllUnderground).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
    expect(discrete).not.toHaveBeenCalled();
    expect(renderer.playEnter).not.toHaveBeenCalled();
    expect(renderer.playExit).not.toHaveBeenCalled();
    for (const factory of Object.values(add)) expect(factory).not.toHaveBeenCalled();
    expect(tweens.add).not.toHaveBeenCalled();
  });

  it.each(['host', 'client'] as const)('binds an initial underground snapshot on %s without replaying a burst', role => {
    const h = presentation();
    h[role].prevBurrowPhases.clear();
    h[role].applyBurrowVisual(h.entity, 'underground');
    expect(h.effects.syncPlayerBurrowState).toHaveBeenCalledExactlyOnceWith('p', 'underground', h.entity.displayObject);
    expect(h.effects.syncBurrowState).not.toHaveBeenCalled();
    expect(h.effects.playPlayerBurrowPhaseEffect).not.toHaveBeenCalled();
    expect(h.effects.playBurrowPhaseEffect).not.toHaveBeenCalled();
    h.entity.displayObject = undefined;
    h[role].applyBurrowVisual(h.entity, 'underground');
    expect(h.effects.syncPlayerBurrowState).toHaveBeenLastCalledWith('p', 'underground', undefined);
  });

  it('routes ongoing underground RPCs through the player binding even when its display disappears', () => {
    const h = presentation();
    h.receive('p', 'underground');
    expect(h.effects.syncPlayerBurrowState).toHaveBeenCalledExactlyOnceWith('p', 'underground', h.entity.displayObject);
    h.entity.displayObject = undefined;
    h.receive('p', 'trapped');
    expect(h.effects.syncPlayerBurrowState).toHaveBeenLastCalledWith('p', 'trapped', undefined);
    expect(h.effects.syncBurrowState).not.toHaveBeenCalled();
    expect(h.effects.playPlayerBurrowPhaseEffect).not.toHaveBeenCalled();
    expect(h.effects.playBurrowPhaseEffect).not.toHaveBeenCalled();
  });

  it('routes both player phases directly to GPU earth without creating legacy graphics or emitters', () => {
    const renderer = { playEnter: vi.fn(), playExit: vi.fn() };
    const add = { circle: vi.fn(), graphics: vi.fn(), particles: vi.fn() };
    const tweens = { add: vi.fn() };
    const effects = Object.assign(Object.create(EffectSystem.prototype), {
      burrowGpuRenderer: renderer, scene: { add, tweens },
    }) as EffectSystem;
    const legacy = vi.spyOn(effects, 'playBurrowPhaseEffect');
    effects.playPlayerBurrowPhaseEffect(100, 200, 'windup', 1.2);
    effects.playPlayerBurrowPhaseEffect(100, 200, 'recovery', 1.2);
    expect(renderer.playEnter).toHaveBeenCalledExactlyOnceWith(100, 200, 1.2);
    expect(renderer.playExit).toHaveBeenCalledExactlyOnceWith(100, 200);
    expect(legacy).not.toHaveBeenCalled();
    for (const factory of Object.values(add)) expect(factory).not.toHaveBeenCalled();
    expect(tweens.add).not.toHaveBeenCalled();
  });

  it.each(['host', 'client'] as const)('plays one exit burst on %s in either event/snapshot order', role => {
    for (const eventFirst of [true, false]) {
      const h = presentation();
      const snapshot = () => h[role].applyBurrowVisual(h.entity, 'recovery');
      if (eventFirst) h.receive('p', 'recovery', 100, 200);
      snapshot(); snapshot();
      if (!eventFirst) h.receive('p', 'recovery', 100, 200);
      snapshot();
      expect(h.effects.playPlayerBurrowPhaseEffect).toHaveBeenCalledExactlyOnceWith(100, 200, 'recovery', 1.2);
      expect(h.effects.playBurrowPhaseEffect).not.toHaveBeenCalled();
      expect(h.entity.setBurrowPhase).toHaveBeenCalledWith('recovery', expect.any(Boolean));
    }
  });

  it.each(['host', 'client'] as const)('plays one entrance burst with its position and facing on %s in either event/snapshot order', role => {
    for (const eventFirst of [true, false]) {
      const h = presentation();
      h.host.prevBurrowPhases.set('p', 'idle');
      h.client.prevBurrowPhases.set('p', 'idle');
      const snapshot = () => h[role].applyBurrowVisual(h.entity, 'windup');
      if (eventFirst) h.receive('p', 'windup', 100, 200);
      snapshot(); snapshot();
      if (!eventFirst) h.receive('p', 'windup', 100, 200);
      snapshot();
      expect(h.effects.playPlayerBurrowPhaseEffect).toHaveBeenCalledExactlyOnceWith(100, 200, 'windup', 1.2);
      expect(h.effects.playBurrowPhaseEffect).not.toHaveBeenCalled();
      expect(h.entity.setBurrowPhase).toHaveBeenCalledWith('windup', expect.any(Boolean));
    }
  });

  it('restores an initial recovery snapshot without replaying a past exit', () => {
    const h = presentation();
    h.client.prevBurrowPhases.clear();
    h.client.applyBurrowVisual(h.entity, 'recovery');
    expect(h.effects.playPlayerBurrowPhaseEffect).not.toHaveBeenCalled();
    expect(h.entity.setBurrowPhase).toHaveBeenCalledWith('recovery', false);
  });

  it('restores an initial windup snapshot without replaying the entrance burst', () => {
    const h = presentation();
    h.client.prevBurrowPhases.clear();
    h.client.applyBurrowVisual(h.entity, 'windup');
    expect(h.effects.playPlayerBurrowPhaseEffect).not.toHaveBeenCalled();
    expect(h.effects.playBurrowPhaseEffect).not.toHaveBeenCalled();
    expect(h.entity.setBurrowPhase).toHaveBeenCalledWith('windup', expect.any(Boolean));
  });

  it('plays a positioned entrance before entity arrival with neutral facing', () => {
    const h = presentation();
    h.players.delete('p');
    h.receive('p', 'windup', 100, 200);
    expect(h.effects.playPlayerBurrowPhaseEffect).toHaveBeenCalledExactlyOnceWith(100, 200, 'windup', 0);
    expect(h.effects.playBurrowPhaseEffect).not.toHaveBeenCalled();
    expect(h.entity.getAimAngle).not.toHaveBeenCalled();
  });

  it('uses the complete authoritative position before entity arrival and supports old positionless events', () => {
    const h = presentation();
    h.receive('p', 'recovery');
    expect(h.effects.playPlayerBurrowPhaseEffect).toHaveBeenLastCalledWith(20, 30, 'recovery', 1.2);
    h.receive('p', 'recovery', 999, undefined);
    expect(h.effects.playPlayerBurrowPhaseEffect).toHaveBeenLastCalledWith(20, 30, 'recovery', 1.2);
    h.players.delete('p');
    h.receive('p', 'recovery', 100, 200);
    expect(h.effects.playPlayerBurrowPhaseEffect).toHaveBeenLastCalledWith(100, 200, 'recovery', 0);
    const count = h.effects.playPlayerBurrowPhaseEffect.mock.calls.length;
    h.receive('p', 'recovery');
    expect(h.effects.playPlayerBurrowPhaseEffect).toHaveBeenCalledTimes(count);
  });

  it('transports exit positions and resolved damage radii, with defaults only for older events', async () => {
    const network = new NetworkBridge();
    const broadcast = vi.spyOn(network as any, 'broadcastGameplayEvent').mockImplementation(() => {});
    const burrow = vi.fn(), shockwave = vi.fn();
    network.registerBurrowVisualHandler(burrow);
    network.registerShockwaveEffectHandler(shockwave);
    const handlers = (network as unknown as { allRpcHandlers: Map<string, (data: unknown) => Promise<unknown>> }).allRpcHandlers;
    network.broadcastBurrowVisual('p', 'recovery', 15, 25);
    expect(broadcast).toHaveBeenLastCalledWith('bfx', { id: 'p', p: 'recovery', x: 15, y: 25 });
    await handlers.get('bfx')!({ id: 'p', p: 'recovery', x: 15, y: 25 });
    expect(burrow).toHaveBeenLastCalledWith('p', 'recovery', 15, 25);
    await handlers.get('bfx')!({ id: 'p', p: 'recovery' });
    expect(burrow).toHaveBeenLastCalledWith('p', 'recovery', undefined, undefined);
    await handlers.get('bfx')!({ id: 'p', p: 'recovery', x: 15 });
    expect(burrow).toHaveBeenLastCalledWith('p', 'recovery', undefined, undefined);
    network.broadcastShockwaveEffect(15, 25, 175);
    expect(broadcast).toHaveBeenLastCalledWith('shockfx', { x: 15, y: 25, r: 175 });
    await handlers.get('shockfx')!({ x: 15, y: 25, r: 175 });
    expect(shockwave).toHaveBeenLastCalledWith(15, 25, 175);
    await handlers.get('shockfx')!({ x: 15, y: 25 });
    expect(shockwave).toHaveBeenLastCalledWith(15, 25, SHOCKWAVE_RADIUS);
    await handlers.get('shockfx')!({ x: 15, y: 25, r: 0 });
    expect(shockwave).toHaveBeenLastCalledWith(15, 25, 0);
    broadcast.mockRestore();
  });
});
