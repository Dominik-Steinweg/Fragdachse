import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const phaser = (await import('./fakeArenaRenderScene')).createFakePhaserModule();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url), root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  return { ...phaser, Geom: { ...phaser.Geom, Line: require(root + 'src/geom/line/Line.js') },
    Math: { ...phaser.Math, Angle: { ...phaser.Math.Angle,
    Wrap: (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle)) } } };
});

import { resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { EnemyManager } from '../src/entities/EnemyManager';
import { WorldCombatCore } from '../src/combat/WorldCombatCore';
import { NecromancySystem } from '../src/systems/NecromancySystem';
import { GuardianSpiritSystem } from '../src/systems/GuardianSpiritSystem';
import { healthBarTestScene } from './healthBarTestScene';

function fixture() {
  const configs = resolveCoopDefenseEnemyConfigs(1);
  const kind = 'rabid-badger';
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(healthBarTestScene().scene, configs);
  const players = new Map([
    ['guardian', { id: 'guardian', active: true, x: 0, y: 0, color: 0xffffff }],
    ['necromancer', { id: 'necromancer', active: true, x: 1000, y: 0, color: 0xffffff }],
  ]);
  const manager = { getPlayer: (id: string) => players.get(id), getAllPlayers: () => [...players.values()] };
  const combat = new WorldCombatCore(manager as never, {
    isHost: () => true, getPlayerProfile: manager.getPlayer, areTeammates: () => true,
    isEnemyPair: () => false, getLocalPlayerId: () => 'guardian',
    broadcastEffect() {}, broadcastAudioFeedback() {},
  } as never);
  combat.bindPlayerVitalsScope({ worldRevision: 71, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0 });
  for (const id of players.keys()) combat.initPlayer(id);
  combat.setEnemyManager(enemies);
  const necromancy = new NecromancySystem(manager as never, enemies, combat,
    { fire: () => false } as never, new Map(), (_id, _stat, base) => base);
  const ally = necromancy.captureAlly('necromancer', 10, 0, kind)!;
  const stats: Record<string, number> = { maxCount: 1, damage: 1, spawnIntervalMs: 100,
    scanRadius: 500, attackSpeed: 1000, returnSpeed: 1000, orbitRadius: 20, attackStaggerMs: 0 };
  const spirits = new GuardianSpiritSystem(manager as never, enemies, combat, (id, stat, base) => (
    id === 'guardian' ? stats[stat.replace('player.guardianSpirit.', '')] ?? base : base
  ));
  return { enemies, combat, ally, kind, spirits, clear() { spirits.clear(); necromancy.clear(); enemies.destroy(); } };
}

describe('guardian spirit combat relationships', () => {
  it('returns without spending its charge when the target burrows during the attack', () => {
    const f = fixture();
    try {
      const hostile = f.enemies.hostSpawnAtWorld(5, 0, f.kind);
      const hp = hostile.getHp();
      f.spirits.hostUpdate(0, 0);
      expect(f.spirits.hostUpdate(100, 16)).toMatchObject([{ phase: 'attacking', targetId: hostile.id }]);
      f.enemies.setEnemyBurrowed(hostile.id, true);
      expect(f.combat.canDamageTarget('guardian', hostile.id)).toBe(false);
      expect(f.spirits.hostUpdate(200, 100)).toMatchObject([{ phase: 'returning' }]);
      expect(hostile.getHp()).toBe(hp);
    } finally { f.clear(); }
  });

  it('keeps its charge while only a teammate captured ally is nearby', () => {
    const f = fixture();
    try {
      expect(f.combat.isAlive(f.ally.id)).toBe(true);
      expect(f.combat.canDamageTarget('guardian', f.ally.id)).toBe(false);
      f.spirits.hostUpdate(0, 0);
      expect(f.spirits.hostUpdate(100, 16)).toMatchObject([{ phase: 'orbiting' }]);
      expect(f.spirits.hostUpdate(200, 100)).toMatchObject([{ phase: 'orbiting' }]);
    } finally { f.clear(); }
  });

  it('attacks a farther hostile instead of spending its spirit on a closer captured ally', () => {
    const f = fixture();
    try {
      const hostile = f.enemies.hostSpawnAtWorld(80, 0, f.kind);
      const hp = hostile.getHp();
      expect(f.combat.canDamageTarget('guardian', hostile.id)).toBe(true);
      f.spirits.hostUpdate(0, 0);
      expect(f.spirits.hostUpdate(100, 16)).toMatchObject([{ phase: 'attacking', targetId: hostile.id }]);
      expect(f.spirits.hostUpdate(200, 100)).toMatchObject([{ phase: 'impact' }]);
      expect(hostile.getHp()).toBeLessThan(hp);
      expect(f.combat.isAlive(f.ally.id)).toBe(true);
    } finally { f.clear(); }
  });
});
