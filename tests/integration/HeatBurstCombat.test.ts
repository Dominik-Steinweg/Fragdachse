import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/network/bridge', () => ({ bridge: {
  getSynchronizedNow: () => 0, getLocalPlayerId: () => 'owner',
  getConnectedPlayers: () => [], getActivityDescriptor: () => null,
} }));
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url), root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  const Line = require(root + 'src/geom/line/Line.js');
  return { ...phaser, Geom: { ...phaser.Geom,
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Line: Object.assign(Line, { Length: (l: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }) } };
});

import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { getCoopDefenseEnemyConfig, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

const heat = getCoopDefenseEnemyConfig('demon-badger').heatBurst!;
const burst = heat.burst;

/** Everything stands in the burst centre, so every hit takes the full centre damage. */
function fixture(faction: 'hostile' | 'allied') {
  const now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const scene = healthBarTestScene().scene;
  const configs = resolveCoopDefenseEnemyConfigs(1);
  for (const kind of ['demon-badger', 'zombie-badger']) {
    configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  }
  const enemies = new EnemyManager(scene, configs);
  cleanups.push(() => enemies.destroy());
  const x = 0, y = 0;
  const players = ['owner', 'other-player'].map(id => fakeEntity({ id, x, y, active: true, color: 0xffffff }));
  const playerManager = { getAllPlayers: () => players, getPlayer: (id: string) => players.find(player => player.id === id) };
  const network = { isHost: () => true, getPlayerProfile: playerManager.getPlayer, areTeammates: () => false,
    isEnemyPair: () => true, broadcastEffect: vi.fn(), broadcastAudioFeedback: vi.fn() };
  const combat = new WorldCombatCore(playerManager as never, network as never);
  combat.bindPlayerVitalsScope({ worldRevision: 18, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.5 });
  for (const player of players) combat.initPlayer(player.id);
  combat.setEnemyManager(enemies);
  const source = faction === 'allied'
    ? enemies.hostSpawnAllyAtWorld(x, y, 'demon-badger', 'owner', 0xffffff, 1)
    : enemies.hostSpawnAtWorld(x, y, 'demon-badger');
  const hostile = enemies.hostSpawnAtWorld(x, y, 'zombie-badger');
  const ally = enemies.hostSpawnAllyAtWorld(x, y, 'zombie-badger', 'owner', 0xffffff, 1);
  enemies.hostSetVitalsBaseline(hostile.id, 100, 100);
  enemies.hostSetVitalsBaseline(ally.id, 100, 100);
  const base = { id: 'friendly-base', faction: 'friendly', getHp: () => 100, isInert: () => false, getTurrets: () => [],
    getNearestSurfacePoint: () => ({ x, y }),
    getCellBodies: () => [{ getBounds: () => ({ left: x, right: x, top: y, bottom: y }) }] };
  const bases = { getBasesByFaction: () => [base], getObstacleGeneration: () => 0, getBase: () => base };
  const construction = { id: 1, hp: 100, kind: 'rock', constructionId: 'test-construction', gridX: x, gridY: y };
  const placement = { getAllRuntimeRocks: () => [], forEachRuntimeRockInRadius: () => {}, getCarrierBaseId: () => undefined,
    getWorldPointForCell: () => ({ x, y }), getRuntimeRock: (id: number) => id === 1 ? construction : undefined };
  const mutation = { applyResolvedDamage: vi.fn(() => null) };
  const decoys = { getHostTargets: () => [{ id: 7, x, y }], applyDamage: vi.fn() };
  const chunks = vi.fn();
  const host = new HostUpdateCoordinator(scene, { getWorldCombatCore: () => combat, playerManager, decoySystem: decoys,
    hostPhysics: { applyRadialImpulse: vi.fn() } } as never, {} as never, {} as never, {} as never);
  host.setWorldFramePort({ getEnemyManager: () => enemies, getWorldMutationRuntime: () => mutation,
    getTrainRuntime: () => ({ getCurrentTrain: () => ({ getNetSnapshot: () => ({ alive: true }),
      getSegmentPositions: () => [{ x, y }] }) }),
    getWorldRuntime: () => ({ context: { metrics: { offsetX: 0, offsetY: 0 } }, materialization: {
      bases, placement, arena: { rockPhysicsProxies: [{ active: true, x, y }, { active: true, x, y }],
        rockGrid: { forEachRockInRadius: (_x: number, _y: number, _r: number, _ox: number, _oy: number, _size: number,
          visit: (id: number) => void) => { visit(0); visit(1); } } },
    } }),
  } as never);
  host.setPlayerFramePort({ getPlayerGameplayRuntime: () => ({ hostCreateFireChunkBurst: chunks }), getPowerUpRuntime: () => null } as never);
  const damageBase = vi.spyOn(combat, 'applyBaseStatusDamage').mockReturnValue(null);
  const fire = () => host.applyEnemyHeatBurst({ enemyId: source.id, kind: 'demon-badger', faction,
    ownerId: faction === 'allied' ? 'owner' : undefined, x, y, config: heat, cycle: 0, nowMs: now });
  return { source, hostile, ally, combat, mutation, damageBase, decoys, chunks, fire, now };
}

describe('heat burst targets through real Combat', () => {
  it('a hostile burst hits players, decoys, allied enemies and structures by their multipliers, never rocks or hostiles', () => {
    const f = fixture('hostile');
    f.fire();
    for (const id of ['owner', 'other-player']) expect(f.combat.getHP(id)).toBe(100 - burst.damage);
    expect(f.ally.getHp()).toBe(100 - burst.damage);
    expect(f.hostile.getHp()).toBe(100);
    expect(f.decoys.applyDamage).toHaveBeenCalledOnce();
    expect(f.damageBase).toHaveBeenCalledWith('friendly-base', burst.damage * burst.friendlyBaseDamageMult,
      expect.objectContaining({ allegiance: { ownerId: f.source.id, factionId: 'hostile' } }), f.now);
    const hits = f.mutation.applyResolvedDamage.mock.calls.map(call => call.slice(0, 3));
    expect(hits).toContainEqual(['rock', 1, Math.round(burst.damage * burst.constructionDamageMult)]);
    expect(hits.some(([kind, id]) => kind === 'rock' && id === 0)).toBe(false);
    expect(hits).toContainEqual(['train', 'main', Math.round(burst.damage * burst.trainDamageMult)]);
    // Burning chunks keep the hostile void fire against players.
    expect(f.chunks).toHaveBeenCalledWith(f.source.id, 0, 0, expect.objectContaining({ visualStyle: 'void', damageTarget: 'players' }),
      expect.any(String), f.now, expect.anything());
  });

  it('an allied burst hits only hostile enemies and throws allied fire', () => {
    const f = fixture('allied');
    f.fire();
    expect(f.hostile.getHp()).toBe(100 - burst.damage);
    expect(f.ally.getHp()).toBe(100);
    for (const id of ['owner', 'other-player']) expect(f.combat.getHP(id)).toBe(100);
    expect(f.damageBase).not.toHaveBeenCalled();
    expect(f.mutation.applyResolvedDamage).not.toHaveBeenCalled();
    expect(f.decoys.applyDamage).not.toHaveBeenCalled();
    expect(f.chunks).toHaveBeenCalledWith(f.source.id, 0, 0, expect.objectContaining({ visualStyle: 'allied', damageTarget: 'enemies' }),
      expect.any(String), f.now, expect.anything());
  });
});
