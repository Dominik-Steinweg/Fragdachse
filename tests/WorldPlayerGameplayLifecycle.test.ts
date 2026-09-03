import { describe, expect, it, vi } from 'vitest';

// Teilphase 2A: die öffentliche Player-in-World-/Reconcile-Lifecycle-Grenze der
// WorldPlayerGameplayRuntime (Contract-Familie PlayerGameplayLifecyclePort).
// Der Test fixiert, dass jede Operation genau die bisher im ArenaLifecycleCoordinator
// verstreuten Child-System-Schritte in unveränderter Reihenfolge kapselt.

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
}));

import { WorldPlayerGameplayRuntime } from '../src/world/WorldPlayerGameplayRuntime';

type AnyRuntime = WorldPlayerGameplayRuntime & Record<string, any>;

function makeRuntime() {
  const order: string[] = [];
  const tag = (name: string, fn: (...args: any[]) => any = () => undefined) =>
    vi.fn((...args: any[]) => { order.push(name); return fn(...args); });

  const systems = {
    resource: {
      initPlayer: tag('resource.initPlayer'),
      removePlayer: tag('resource.removePlayer'),
      reconcilePlayerLimits: tag('resource.reconcilePlayerLimits'),
    },
    burrow: {
      initPlayer: tag('burrow.initPlayer'),
      removePlayer: tag('burrow.removePlayer'),
    },
    itemRuntime: {
      initPlayer: tag('itemRuntime.initPlayer'),
      removePlayer: tag('itemRuntime.removePlayer'),
    },
    loadout: {
      resetUltimateState: tag('loadout.resetUltimateState'),
      assignDefaultLoadout: tag('loadout.assignDefaultLoadout'),
      removePlayer: tag('loadout.removePlayer'),
      syncSelectedLoadout: tag('loadout.syncSelectedLoadout'),
    },
    tunnel: {
      removePlayer: tag('tunnel.removePlayer'),
    },
    heldAction: {
      clearPlayer: tag('heldAction.clearPlayer'),
      reset: tag('heldAction.reset'),
    },
    playerModifier: {
      syncPlayers: vi.fn(() => [] as readonly string[]),
    },
  };

  const runtime = Object.create(WorldPlayerGameplayRuntime.prototype) as AnyRuntime;
  runtime.systems = systems;
  return { runtime, systems, order };
}

describe('WorldPlayerGameplayRuntime – öffentliche Lifecycle-Grenze (2A)', () => {
  it('kapselt Player-in-World-Attach je Child-System', () => {
    const { runtime, systems } = makeRuntime();

    runtime.attachPlayerResources('p1');
    runtime.attachPlayerBurrow('p1');
    runtime.attachPlayerBuild('p1');

    expect(systems.resource.initPlayer).toHaveBeenCalledWith('p1');
    expect(systems.burrow.initPlayer).toHaveBeenCalledWith('p1');
    expect(systems.itemRuntime.initPlayer).toHaveBeenCalledWith('p1');
  });

  it('setzt beim Loadout-Attach erst den Ultimate-State zurück, dann das Default-Loadout', () => {
    const { runtime, systems, order } = makeRuntime();
    const selection = { weapon1: undefined } as never;

    runtime.attachPlayerLoadout('p1', selection);

    expect(order).toEqual(['loadout.resetUltimateState', 'loadout.assignDefaultLoadout']);
    expect(systems.loadout.assignDefaultLoadout).toHaveBeenCalledWith('p1', selection);
  });

  it('baut beim Loadout-Detach Loadout und Tunnel ab', () => {
    const { runtime, order } = makeRuntime();

    runtime.detachPlayerLoadout('p1');

    expect(order).toEqual(['loadout.removePlayer', 'tunnel.removePlayer']);
  });

  it('reconciled Loadout-Auswahl und Ressourcenmaxima zusammen', () => {
    const { runtime, systems, order } = makeRuntime();
    const selection = { weapon2: undefined } as never;

    runtime.reconcilePlayerLoadout('p1', selection);

    expect(order).toEqual(['loadout.syncSelectedLoadout', 'resource.reconcilePlayerLimits']);
    expect(systems.loadout.syncSelectedLoadout).toHaveBeenCalledWith('p1', selection);
  });

  it('invalidiert Held Actions pro Spieler bzw. am Activity-Identity-Ende', () => {
    const { runtime, systems } = makeRuntime();

    runtime.invalidateHeldActionsForPlayer('p1');
    runtime.invalidateHeldActionsOnActivityEnd();

    expect(systems.heldAction.clearPlayer).toHaveBeenCalledWith('p1');
    expect(systems.heldAction.reset).toHaveBeenCalledTimes(1);
  });
});

describe('WorldPlayerGameplayRuntime.reconcilePlayerBuildModifiers (2A)', () => {
  it('materialisiert die Item-Runtime nur für geänderte Spieler mit Build und stehender Figur', () => {
    const { runtime, systems } = makeRuntime();
    systems.playerModifier.syncPlayers.mockReturnValue(['withBuild', 'noBuild', 'absent']);
    const builds = new Map<string, any>([
      ['withBuild', { equippedItems: [{ id: 'x' }] }],
      ['noBuild', { equippedItems: [] }],
      ['absent', { coopDefenseProfile: {} }],
    ]);

    runtime.reconcilePlayerBuildModifiers(builds, (id: string) => id !== 'absent');

    expect(systems.playerModifier.syncPlayers).toHaveBeenCalledWith(builds);
    expect(systems.itemRuntime.initPlayer).toHaveBeenCalledWith('withBuild');
    expect(systems.itemRuntime.initPlayer).not.toHaveBeenCalledWith('absent');
    expect(systems.itemRuntime.removePlayer).toHaveBeenCalledWith('noBuild');
  });

  it('rührt die Item-Runtime nicht an, wenn keine Build sich geändert hat', () => {
    const { runtime, systems } = makeRuntime();
    systems.playerModifier.syncPlayers.mockReturnValue([]);

    runtime.reconcilePlayerBuildModifiers(new Map(), () => true);

    expect(systems.itemRuntime.initPlayer).not.toHaveBeenCalled();
    expect(systems.itemRuntime.removePlayer).not.toHaveBeenCalled();
  });
});
