import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { EnemyManager } from '../src/entities/EnemyManager';
import { NecromancySystem } from '../src/systems/NecromancySystem';
import { healthBarTestScene } from './healthBarTestScene';

function fixture(necromancyEnabled = false) {
  const kind = COOP_DEFENSE_ENEMY_KINDS[0];
  const configs = resolveCoopDefenseEnemyConfigs(1);
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(healthBarTestScene().scene, configs);
  const players = new Map([['owner', { id: 'owner', active: true, x: 200, y: 100, color: 0xffffff }]]);
  const manager = { getPlayer: (id: string) => players.get(id), getAllPlayers: () => [...players.values()] };
  const system = new NecromancySystem(manager as never, enemies,
    { isAlive: (id: string) => players.has(id) } as never,
    { fire: () => false } as never, new Map(), (_id, stat, base) => {
      if (!necromancyEnabled) return base;
      if (stat === 'player.necromancy.enabled') return 1;
      if (stat === 'player.necromancy.maxAllies') return 10;
      return base;
    });
  return { kind, enemies, players, system };
}

describe('captured ally ownership', () => {
  it.each(['owner-leave', 'clear'] as const)(
    'releases a captured ally when %s occurs before the first host update', transition => {
      const f = fixture();
      try {
        const ally = f.system.captureAlly('owner', 250, 100, f.kind)!;
        expect(f.enemies.getAlliedEnemies('owner')).toEqual([ally]);
        if (transition === 'owner-leave') {
          f.players.clear();
          f.system.hostUpdate(1_000, 16);
        } else {
          f.system.clear();
          f.system.clear();
        }
        expect(f.enemies.getAlliedEnemies('owner')).toHaveLength(0);
        expect(f.enemies.getCombatTargetRef(ally.id)).toBeNull();
        expect(ally.sprite.active).toBe(false);
      } finally { f.system.clear(); f.enemies.destroy(); }
    },
  );

  it('only removes the departing owner’s allies and retains another owner’s captured ally', () => {
    const f = fixture();
    try {
      f.players.set('other', { ...f.players.get('owner')!, id: 'other' });
      const departing = f.system.captureAlly('owner', 250, 100, f.kind)!;
      const retained = f.system.captureAlly('other', 250, 150, f.kind)!;
      f.players.delete('owner');
      f.system.hostUpdate(1_000, 16);
      expect(f.enemies.getAlliedEnemies('owner')).toHaveLength(0);
      expect(departing.sprite.active).toBe(false);
      expect(f.enemies.getAlliedEnemies('other')).toEqual([retained]);
      expect(retained.sprite.active).toBe(true);
      f.system.clear();
      expect(f.enemies.getAlliedEnemies('other')).toHaveLength(0);
      expect(retained.sprite.active).toBe(false);
    } finally { f.system.clear(); f.enemies.destroy(); }
  });

  it('preserves an existing resurrection interval when capturing another ally', () => {
    const f = fixture(true);
    const recordCorpse = (id: string, now: number) => f.system.recordEnemyDeath({
      id, kind: f.kind, x: 250, y: 100, size: 32, faction: 'hostile', textureKey: 'test-enemy',
      frame: '', displayWidth: 32, displayHeight: 32, rotation: 0, tint: 0xffffff,
    }, now);
    try {
      recordCorpse('first', 1_000);
      f.system.hostUpdate(1_000, 16);
      expect(f.enemies.getAlliedEnemies('owner')).toHaveLength(1);
      f.system.captureAlly('owner', 250, 150, f.kind);
      recordCorpse('second', 1_100);
      f.system.hostUpdate(1_100, 16);
      expect(f.enemies.getAlliedEnemies('owner')).toHaveLength(2);
      f.system.hostUpdate(5_000, 16);
      expect(f.enemies.getAlliedEnemies('owner')).toHaveLength(3);
    } finally { f.system.clear(); f.enemies.destroy(); }
  });
});
