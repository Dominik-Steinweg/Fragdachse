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
import { CoopDefenseMortarSystem } from '../../src/systems/CoopDefenseMortarSystem';
import { CoopDefenseMortarStrikeSystem } from '../../src/systems/CoopDefenseMortarStrikeSystem';
import { EnemyAiTargetCatalog } from '../../src/systems/EnemyAiTargetCatalog';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

function fixture(faction: 'hostile' | 'allied') {
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const scene = healthBarTestScene().scene;
  const configs = resolveCoopDefenseEnemyConfigs(1);
  for (const kind of ['mortar-badger', 'zombie-badger']) {
    configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  }
  const enemies = new EnemyManager(scene, configs);
  cleanups.push(() => enemies.destroy());
  const cfg = getCoopDefenseEnemyConfig('mortar-badger').mortar!;
  const x = cfg.preferredRangeMinPx, y = 0;
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
    ? enemies.hostSpawnAllyAtWorld(0, 0, 'mortar-badger', 'owner', 0xffffff, 1)
    : enemies.hostSpawnAtWorld(0, 0, 'mortar-badger');
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
  const host = new HostUpdateCoordinator(scene, { getWorldCombatCore: () => combat,
    playerManager, decoySystem: decoys } as never, {} as never, {} as never, {} as never);
  host.setWorldFramePort({ getEnemyManager: () => enemies, getWorldMutationRuntime: () => mutation,
    getTrainRuntime: () => ({ getCurrentTrain: () => ({ getNetSnapshot: () => ({ alive: true }),
      getSegmentPositions: () => [{ x, y }] }) }),
    getWorldRuntime: () => ({ context: { metrics: { offsetX: 0, offsetY: 0 } }, materialization: {
      bases, placement, arena: { rockPhysicsProxies: [{ active: true, x, y }, { active: true, x, y }],
        rockGrid: { forEachRockInRadius: (_x: number, _y: number, _r: number, _ox: number, _oy: number, _size: number,
          visit: (id: number) => void) => { visit(0); visit(1); } } },
    } }),
  } as never);
  const damageBase = vi.spyOn(combat, 'applyBaseStatusDamage').mockReturnValue(null);
  const kills = vi.fn(), damage = vi.fn();
  combat.setKillCallback(kills); combat.setDamageDealtHandler(damage);
  const catalog = new EnemyAiTargetCatalog();
  catalog.updateTargets(players.map(player => ({ kind: 'player' as const, id: player.id, x, y })));
  const strikes = new CoopDefenseMortarStrikeSystem({ impact: (strike, at) => host.applyMortarStrikeDamage(strike, at) });
  const mortar = new CoopDefenseMortarSystem(enemies, playerManager as never, combat, catalog, bases as never, placement as never, strikes);
  return { cfg, enemies, source, hostile, ally, combat, mortar, strikes, mutation, damageBase, decoys, kills, damage,
    update(at: number) { now = at; mortar.hostUpdate(at); strikes.hostUpdate(at); } };
}

describe('mortar faction and credit through real Combat and deferred execution', () => {
  it.each(['alive', 'despawn', 'killed-at-launch'] as const)('allied source %s: damages only hostile enemies and credits its necromancer', removal => {
    const f = fixture('allied');
    f.update(0);
    const shot = f.mortar.getSnapshot()[0];
    expect(shot).toMatchObject({ faction: 'allied', targetX: f.hostile.sprite.x });
    if (removal === 'killed-at-launch') {
      f.mortar.handleKilled({ id: f.source.id }, shot.launchAt);
      f.enemies.hostRemoveEnemy(f.source.id);
    } else {
      f.update(shot.launchAt);
      if (removal === 'despawn') f.enemies.hostRemoveEnemy(f.source.id);
    }
    f.update(shot.impactAt);
    expect(f.hostile.getHp()).toBe(100 - f.cfg.maxDamage);
    expect(f.ally.getHp()).toBe(100);
    for (const id of ['owner', 'other-player']) expect(f.combat.getHP(id)).toBe(100);
    expect(f.damageBase).not.toHaveBeenCalled();
    expect(f.mutation.applyResolvedDamage).not.toHaveBeenCalled();
    expect(f.decoys.applyDamage).not.toHaveBeenCalled();
    expect(f.damage).toHaveBeenCalledWith('enemy', f.hostile.id, 'owner', f.cfg.maxDamage, 'explosion', 'hostile');
  });

  it('keeps lethal owner credit after the launched source is removed', () => {
    const f = fixture('allied');
    f.enemies.hostSetVitalsBaseline(f.hostile.id, 1, 100);
    f.update(0); const shot = f.mortar.getSnapshot()[0];
    f.update(shot.launchAt); f.enemies.hostRemoveEnemy(f.source.id);
    f.update(shot.impactAt); f.update(shot.impactAt + 1);
    expect(f.enemies.hasEnemy(f.hostile.id)).toBe(false);
    expect(f.kills).toHaveBeenCalledOnce();
    expect(f.kills).toHaveBeenCalledWith('owner', f.hostile.id, 'enemy.mortar', shot.targetX, shot.targetY,
      expect.objectContaining({ provenance: expect.objectContaining({
        actor: { kind: 'enemy', id: f.source.id }, attribution: { kind: 'player', id: 'owner' },
        allegiance: { ownerId: f.source.id, factionId: 'allied' },
      }) }));
  });

  it('preserves hostile splash after source removal: players, allied actors, base, rocks and constructs', () => {
    const f = fixture('hostile'); f.update(0);
    const shot = f.mortar.getSnapshot()[0]; f.update(shot.launchAt);
    f.enemies.hostRemoveEnemy(f.source.id); f.update(shot.impactAt);
    expect(f.hostile.getHp()).toBe(100);
    expect(f.ally.getHp()).toBe(100 - f.cfg.maxDamage);
    for (const id of ['owner', 'other-player']) expect(f.combat.getHP(id)).toBe(100 - f.cfg.maxDamage);
    expect(f.damageBase).toHaveBeenCalledWith('friendly-base', f.cfg.maxDamage * f.cfg.baseDamageMult,
      expect.objectContaining({ allegiance: { ownerId: f.source.id, factionId: 'hostile' } }), shot.impactAt);
    expect(f.mutation.applyResolvedDamage.mock.calls.map(call => call.slice(0, 3))).toEqual([
      ['rock', 0, Math.round(f.cfg.maxDamage * f.cfg.rockDamageMult)],
      ['rock', 1, Math.round(f.cfg.maxDamage * f.cfg.constructionDamageMult)],
    ]);
    expect(f.decoys.applyDamage).toHaveBeenCalledOnce();
  });
});
