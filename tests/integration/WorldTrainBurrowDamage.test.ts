import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
import { WorldTrainRuntime } from '../../src/world/WorldTrainRuntime';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';
import { TRAIN } from '../../src/train/TrainConfig';

describe('World train undermining damage', () => {
  it.each(['classic', 'coop'] as const)('resolves per-player damage on every existing %s tick, independently of direct damage', kind => {
    let multiplier = 1.2;
    const resolveDamage = vi.fn((_id: string, base: number) => base * multiplier);
    const player = { id: 'p', active: true, x: 0, y: 0 };
    const group = { add: vi.fn(), refresh: vi.fn(), destroy: vi.fn() };
    const scene = {
      physics: { add: { staticGroup: () => group } },
      add: { rectangle: () => ({ active: true, setVisible: vi.fn(), setPosition: vi.fn(), destroy: vi.fn(),
        body: { enable: false, reset: vi.fn(), updateFromGameObject: vi.fn() } }) },
    };
    const runtime = new WorldTrainRuntime({
      scene, playerManager: { getAllPlayers: () => [player] },
      worldMetrics: resolveCoopDefenseWorldMetrics(undefined, undefined), presentationRequired: false,
      projectileTrain: { setTrainGroup: vi.fn(), setTrainImpactPort: vi.fn() },
      combatSystem: { setTrainSegments: vi.fn() }, hostPhysics: {}, gameAudioSystem: {},
      network: { clock: { getArenaStartTime: () => 0, now: () => 0 },
        trainEvents: { isHost: () => true, get: () => undefined, publish: vi.fn(), clear: vi.fn() },
        effects: { broadcastTrainBurrowSparks: vi.fn() } },
      getEnemyManager: () => null, isPlayerBurrowed: () => true, resolveBurrowDamage: resolveDamage,
      getTimeBubbleSystem: () => ({ getTrainMovementFactorAt: () => 0 }),
      setTranslocatorTrainManager: vi.fn(), getPowerUpSystem: () => null,
      setClassicTrainSpawned: vi.fn(), onRendererChanged: vi.fn(),
    } as never);
    try {
      if (kind === 'classic') runtime.setupClassicTrain(2);
      else runtime.materializeAuthoredTrain(2, 1);
      const train = runtime.getCurrentTrain()!;
      train.spawn(); player.x = train.getTrackX(); player.y = train.segCenterYs()[0];
      const initial = train.readIntegrity().integrity;
      train.update(TRAIN.BURROW_DAMAGE_TICK_INTERVAL_MS);
      expect(resolveDamage).toHaveBeenCalledExactlyOnceWith(player.id, TRAIN.BURROW_DAMAGE_PER_TICK);
      expect(train.readIntegrity().integrity).toBeCloseTo(initial - TRAIN.BURROW_DAMAGE_PER_TICK * multiplier);
      multiplier = 1.6;
      train.update(TRAIN.BURROW_DAMAGE_TICK_INTERVAL_MS * 2);
      expect(resolveDamage).toHaveBeenCalledTimes(3);
      expect(train.readIntegrity().integrity).toBeCloseTo(initial - TRAIN.BURROW_DAMAGE_PER_TICK * (1.2 + 3.2));
      const beforeDirect = train.readIntegrity().integrity;
      train.applyDamage(17, player.id);
      expect(train.readIntegrity().integrity).toBe(beforeDirect - 17);
      player.x += TRAIN.HITBOX_WIDTH * 3;
      train.update(TRAIN.BURROW_DAMAGE_TICK_INTERVAL_MS);
      expect(resolveDamage).toHaveBeenCalledTimes(3);
    } finally { runtime.destroy(); }
  });
});
