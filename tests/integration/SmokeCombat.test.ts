import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  class Line {
    constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {}
    setTo(x1: number, y1: number, x2: number, y2: number) { Object.assign(this, { x1, y1, x2, y2 }); return this; }
    static Length(line: Line) { return Math.hypot(line.x2 - line.x1, line.y2 - line.y1); }
  }
  return { ...phaser, Geom: { ...phaser.Geom, Line } };
});
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { WorldSmokeBinding } from '../../src/world/WorldSmokeBinding';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { TargetStatusSystem } from '../../src/systems/TargetStatusSystem';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';
import { smokeEffect } from '../SmokeTestHelper';

describe('smoke confirmed Combat integration', () => {
  it.each(['storm', 'friendly-hit'] as const)('secures a lethal %s before cleanup and tears down the world observer', trigger => {
    let now = 0;
    const scene = healthBarTestScene().scene;
    const kind = COOP_DEFENSE_ENEMY_KINDS[0];
    const configs = resolveCoopDefenseEnemyConfigs(1);
    configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
    const enemies = new EnemyManager(scene, configs);
    const enemy = enemies.hostSpawnAtWorld(300, 100, kind);
    const player = fakeEntity({ id: 'p1', x: 150, y: 100, color: 0xffffff });
    const players = { getPlayer: (id: string) => id === 'p1' ? player : undefined, getAllPlayers: () => [player] };
    const network = { isHost: () => true, getPlayerProfile: players.getPlayer, areTeammates: () => false,
      getLocalPlayerId: () => 'p1', isEnemyPair: () => true, broadcastEffect: vi.fn() };
    const combat = new WorldCombatCore(players as never, network as never);
    combat.bindPlayerVitalsScope({ worldRevision: 7340, runtimeGeneration: 5 });
    combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 });
    combat.initPlayer('p1'); combat.setEnemyManager(enemies);
    const liveOutgoing = vi.fn((_id, _target, amount: number) => ({ amount: amount * 9, isCritical: false }));
    combat.setPlayerOutgoingDamageResolver(liveOutgoing);
    const status = new TargetStatusSystem();
    combat.setTargetIncomingDamageMultiplierResolver((target, time) => status.getIncomingDamageMultiplier(target, time));
    const spawn = vi.fn();
    const binding = new WorldSmokeBinding(combat, () => enemies, status, { spawnProjectile: spawn });
    const config = smokeEffect({ vulnerabilityEnabled: 1 }, { dotDamagePerTick: trigger === 'storm' ? enemy.getHp() * 2 : 1 });
    binding.createCloud({ projectileId: 1, x: 300, y: 100, effect: config,
      provenance: { gameplaySourceId: 'p1', attributionId: 'p1', allegiance: { ownerId: 'p1', kind: 'player' }, sourceSlot: 'utility' } }, now);
    let growthAtCleanup = -1;
    combat.setEnemyLifeEndedHandler(() => {
      growthAtCleanup = binding.runtime.getSnapshots(now)[0].growthSequence!;
      expect(binding.runtime.getTargetSnapshots(now)).toEqual([]);
    });
    try {
      now = 100; binding.step(now);
      expect(liveOutgoing).not.toHaveBeenCalled();
      if (trigger === 'friendly-hit') {
        expect(binding.runtime.getTargetSnapshots(now)[0].chargedUntil).toBeGreaterThan(now);
        now = 101;
        combat.applyDamage(enemy.id, enemy.getHp() * 2, false, 'p1', 'burn-source', undefined,
          { damageKind: 'burn', sourceSlot: 'weapon1', allowCritical: false });
        expect(spawn).toHaveBeenCalledTimes(config.behavior.dischargeCount);
      } else expect(spawn).not.toHaveBeenCalled();
      expect(growthAtCleanup).toBe(1);
      expect(binding.runtime.getSnapshots(now)[0].growthSequence).toBe(1);
      binding.refresh(now + 1);
      expect(binding.runtime.getTargetSnapshots(now + 1)).toEqual([]);
      binding.destroy();
      const next = enemies.hostSpawnAtWorld(300, 100, kind);
      if (trigger === 'friendly-hit') {
        liveOutgoing.mockClear();
        const bolt = spawn.mock.calls[0][0];
        const impact = combat.resolveDirectImpact({ projectileId: 2, target: { kind: 'enemy', id: next.id },
          impact: { x: 300, y: 100 }, velocity: { x: 1, y: 0 }, augments: [],
          provenance: bolt.provenance, directHit: bolt.interaction.directHit });
        expect(impact.actualDamage).toBeCloseTo(bolt.interaction.directHit.damage);
        expect(liveOutgoing).not.toHaveBeenCalled();
      }
      combat.applyDamage(next.id, 1, false, 'p1');
      expect(binding.runtime.getSnapshots(now)).toEqual([]);
    } finally { binding.destroy(); enemies.destroy(); }
  });
});
