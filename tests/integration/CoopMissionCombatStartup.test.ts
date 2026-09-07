import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Scene: class {},
  GameObjects: {
    Image: class {}, Sprite: class {}, Container: class {},
    Particles: { ParticleProcessor: class {} },
  },
  Math: {
    Vector2: class {},
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
  BlendModes: { ADD: 1, NORMAL: 0 },
  Geom: { Circle: class {}, Rectangle: class {} },
}));
vi.mock('../../src/network/bridge', () => ({
  bridge: { getRoundState: () => null },
}));
vi.mock('../../src/activity/CoopMissionActivityConfig', () => ({
  resolveCoopMissionActivityConfiguration: () => ({ mapConfig: {} }),
}));
vi.mock('../../src/arena/BaseRegistry', () => ({
  resolveCoopDefenseActivityBaseOverlays: () => [],
}));

import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';
import { CoopMissionRuntime } from '../../src/activity/CoopMissionRuntime';
import type { ActivityDescriptor } from '../../src/world/ActivityDescriptor';

const activity: ActivityDescriptor = {
  activityRevision: 2,
  worldRevision: 1,
  kind: 'coop-mission',
  definitionId: 'activity:coop-mission:1',
};

describe('Coop mission combat startup', () => {
  it('attaches base overlays before combat exists and projects later changes into the current core', () => {
    let publish = () => {};
    const obstacles = [{ x: 10, y: 20, width: 30, height: 40 }];
    // Exercise the production coordinator callback without constructing a renderer or scene.
    const coordinator = Object.create(ArenaLifecycleCoordinator.prototype);
    coordinator.worldGameplay = null;
    coordinator.worldRuntime = {
      context: { definition: {}, metrics: {} },
      materialization: {
        bases: {
          getObstacleRectangles: () => obstacles,
          createActivityBinding: (_overlays: unknown, onChanged: () => void) => {
            publish = onChanged;
            return { attach: onChanged, detach: onChanged };
          },
        },
      },
    };
    const runtime = new CoopMissionRuntime(activity);
    expect(() => coordinator.attachCoopMissionBaseBinding(activity, runtime)).not.toThrow();

    const setBaseObstacles = vi.fn();
    const syncBaseObstacles = vi.fn();
    coordinator.worldGameplay = {
      combatSystem: { setBaseObstacles },
      geometry: { syncBaseObstacles },
    };
    publish();
    expect(setBaseObstacles).toHaveBeenCalledWith(obstacles);
    expect(syncBaseObstacles).toHaveBeenCalledOnce();

    // A failed/partial World build must also be able to release its Activity bindings.
    coordinator.worldGameplay = null;
    expect(() => runtime.destroy()).not.toThrow();
  });
});
