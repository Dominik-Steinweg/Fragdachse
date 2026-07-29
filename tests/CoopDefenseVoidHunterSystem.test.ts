import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    DegToRad: (degrees: number) => degrees * Math.PI / 180,
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
      Wrap: (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle)),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      Squared: (x1: number, y1: number, x2: number, y2: number) => (x2 - x1) ** 2 + (y2 - y1) ** 2,
    },
  },
}));

import { getCoopDefenseEnemyConfig, resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { LoadoutManager } from '../src/loadout/LoadoutManager';
import { ULTIMATE_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { ArmageddonSystem } from '../src/systems/ArmageddonSystem';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { CoopDefenseEnemyBurrowSystem } from '../src/systems/CoopDefenseEnemyBurrowSystem';
import type { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import {
  computeVoidHunterNukeTarget,
  CoopDefenseVoidHunterSystem,
} from '../src/systems/CoopDefenseVoidHunterSystem';

function createFixture(playerPositions = [{ x: 700, y: 100 }]) {
  const actions: string[] = [];
  const enemy = {
    id: 'e1',
    kind: 'void-hunter',
    faction: 'hostile',
    sprite: { x: 100, y: 100, active: true },
    hp: 3200,
    maxHp: 3200,
    aim: 0,
    getHp() { return this.hp; },
    getMaxHp() { return this.maxHp; },
    getAimAngle() { return this.aim; },
    stopMovement: vi.fn(),
    faceAngle(angle: number) { this.aim = angle; },
    setMoveSpeedMultiplier: vi.fn(),
    setSpecialAction: vi.fn(),
  };
  const players = playerPositions.map((position, index) => ({
    id: `p${index + 1}`,
    sprite: { ...position, active: true },
  }));
  const enemyManager = {
    getAllEnemies: () => [enemy],
    getEnemy: (id: string) => id === enemy.id ? enemy : undefined,
  };
  const playerManager = {
    getAllPlayers: () => players,
    getPlayer: vi.fn((id: string) => players.find((player) => player.id === id)),
  };
  const combat = {
    isAlive: () => true,
    canDamageTarget: () => true,
    hasLineOfSight: () => true,
  };
  const loadout = {
    fireAutomatedWeapon: vi.fn(() => {
      actions.push('gauss-shot');
      return true;
    }),
  };
  const power = {
    scheduleConfiguredNukeStrike: vi.fn(() => true),
  };
  const armageddon = {
    activate: vi.fn(() => actions.push('armageddon-start')),
    deactivate: vi.fn(),
    cancel: vi.fn(),
  };
  const burrow = {
    startScriptedBurrow: vi.fn(() => true),
  };
  const fireChunks = {
    hostCreateFireChunkBurst: vi.fn(),
  };
  const system = new CoopDefenseVoidHunterSystem(
    enemyManager as unknown as EnemyManager,
    playerManager as unknown as PlayerManager,
    combat as unknown as CombatSystem,
    loadout as unknown as LoadoutManager,
    power as unknown as PowerUpSystem,
    armageddon as unknown as ArmageddonSystem,
    burrow as unknown as CoopDefenseEnemyBurrowSystem,
    fireChunks as unknown as FlamethrowerUpgradeSystem,
  );
  return { system, enemy, players, playerManager, loadout, power, armageddon, burrow, fireChunks, actions };
}

describe('Leerenjäger', () => {
  it('owns separate NPC weapons with the fixed balance values', () => {
    expect(WEAPON_CONFIGS.VOID_HUNTER_SHOTGUN).toMatchObject({
      damage: 12,
      range: 350,
      cooldown: 850,
      pelletCount: 5,
      pelletSpreadAngle: 12,
      burnOnHit: { durationMs: 2000, damagePerTick: 2 },
    });
    expect(WEAPON_CONFIGS.VOID_HUNTER_GAUSS).toMatchObject({
      damage: 100,
      range: 1500,
      fire: { projectileSpeed: 1350, projectileSize: 16 },
    });
    expect(ULTIMATE_CONFIGS.GAUSS_RIFLE).toMatchObject({
      chargeColor: 0x78d6ff,
      projectileColor: 0xc8f6ff,
      tracerConfig: { colorCore: 0xf4ffff, colorGlow: 0x59c7ff },
    });
    expect(getCoopDefenseEnemyConfig('void-hunter')).toMatchObject({
      maxHp: 3000,
      xp: 400,
      size: 52,
      moveSpeed: 120,
      spriteRotationOffsetDegrees: 180,
      playerScaling: { maxHpFactorPerAdditionalPlayer: 0.5 },
    });
    expect(resolveCoopDefenseEnemyConfigs(2)['void-hunter']).toMatchObject({
      maxHp: 4500,
      phaseTwoGlow: { sizeFactor: 2.45 },
      voidHunterBoss: {
        phaseTwoHpRatio: 0.5,
        gauss: { maxAimTurnDegreesPerSecond: 50 },
      },
    });
  });

  it('calculates one- and multi-player Nuke targets once at the arithmetic center', () => {
    expect(computeVoidHunterNukeTarget([{ x: 400, y: 300 }], { x: 1, y: 2 }))
      .toEqual({ x: 400, y: 300 });
    expect(computeVoidHunterNukeTarget(
      [{ x: 300, y: 200 }, { x: 700, y: 600 }],
      { x: 1, y: 2 },
    )).toEqual({ x: 500, y: 400 });
  });

  it('starts phase two once, fixes the Nuke target, honors the configured emerge delay, and emits chunks at the blast', () => {
    const fixture = createFixture([{ x: 400, y: 300 }, { x: 800, y: 500 }]);
    const bossConfig = getCoopDefenseEnemyConfig('void-hunter').voidHunterBoss!;
    fixture.system.hostUpdate(0);
    fixture.enemy.hp = fixture.enemy.maxHp * bossConfig.phaseTwoHpRatio;
    fixture.system.hostUpdate(100);

    expect(fixture.enemy.setMoveSpeedMultiplier).toHaveBeenCalledTimes(1);
    expect(fixture.enemy.setMoveSpeedMultiplier).toHaveBeenCalledWith(
      bossConfig.phaseTwoSpeedMultiplier,
    );
    expect(fixture.power.scheduleConfiguredNukeStrike).toHaveBeenCalledWith(
      'e1',
      600,
      400,
      expect.objectContaining({
        countdownMs: bossConfig.nuke.countdownMs,
        radius: bossConfig.nuke.radiusPx,
        maxDamage: bossConfig.nuke.maxDamage,
        minDamage: bossConfig.nuke.minDamage,
        damageTarget: 'player-side',
        variant: 'void',
      }),
      100,
    );
    const explodeAt = 100 + bossConfig.nuke.countdownMs;
    const emergeAt = explodeAt + bossConfig.nuke.emergeDelayMs;
    expect(fixture.burrow.startScriptedBurrow).toHaveBeenCalledWith('e1', emergeAt);

    fixture.players[0].sprite.x = 1000;
    fixture.system.hostUpdate(200);
    expect(fixture.power.scheduleConfiguredNukeStrike).toHaveBeenCalledTimes(1);

    fixture.system.notifyNukeExploded({
      id: 9,
      x: 600,
      y: 400,
      radius: bossConfig.nuke.radiusPx,
      armedAt: 100,
      explodeAt,
      triggeredBy: 'e1',
      variant: 'void',
    }, explodeAt);
    expect(fixture.fireChunks.hostCreateFireChunkBurst).toHaveBeenCalledWith(
      'e1',
      600,
      400,
      bossConfig.nuke.fireChunkBurst,
      'void-hunter-nuke:9',
      explodeAt,
    );

    fixture.system.hostUpdate(emergeAt - 1);
    expect(fixture.armageddon.activate).not.toHaveBeenCalled();
    fixture.system.hostUpdate(emergeAt);
    expect(fixture.armageddon.activate).toHaveBeenCalledTimes(1);
  });

  it('waits 10 s for Gauss, samples targets every 50 ms but turns smoothly at at most 50 degrees/s', () => {
    const fixture = createFixture([{ x: 100, y: 700 }]);
    fixture.system.hostUpdate(0);
    fixture.system.hostUpdate(9999);
    expect(fixture.loadout.fireAutomatedWeapon).not.toHaveBeenCalled();

    fixture.system.hostUpdate(10000);
    expect(fixture.enemy.aim).toBe(0);
    fixture.system.hostUpdate(10050);
    expect(fixture.enemy.aim).toBeCloseTo(Math.PI / 72, 5);
    expect(fixture.playerManager.getPlayer).toHaveBeenCalledTimes(1);
    fixture.system.hostUpdate(10100);
    expect(fixture.enemy.aim).toBeCloseTo(Math.PI / 36, 5);
    expect(fixture.playerManager.getPlayer).toHaveBeenCalledTimes(2);
    fixture.system.hostUpdate(12000);

    expect(fixture.loadout.fireAutomatedWeapon).toHaveBeenCalledTimes(1);
    expect(fixture.loadout.fireAutomatedWeapon.mock.calls[0][3]).toBeCloseTo(Math.PI / 2, 5);
  });

  it('does not begin Gauss inside shotgun range', () => {
    const fixture = createFixture([{ x: 350, y: 100 }]);
    fixture.system.hostUpdate(0);
    fixture.system.hostUpdate(10000);
    fixture.system.hostUpdate(12000);
    expect(fixture.loadout.fireAutomatedWeapon).not.toHaveBeenCalled();
  });

  it('finishes a due Gauss shot before starting pending Armageddon', () => {
    const fixture = createFixture([{ x: 800, y: 100 }]);
    fixture.enemy.hp = 1600;
    fixture.system.hostUpdate(0);
    fixture.system.hostUpdate(7000);  // erstes Armageddon
    fixture.system.hostUpdate(17000); // Ende; Gauss beginnt
    fixture.actions.length = 0;
    fixture.system.hostUpdate(32000); // Armageddon wird während der noch geführten Ladung fällig
    expect(fixture.actions).toEqual(['gauss-shot', 'armageddon-start']);
  });

  it('cleans pending boss state and Armageddon on teardown', () => {
    const fixture = createFixture();
    fixture.system.hostUpdate(0);
    fixture.system.clear();
    expect(fixture.armageddon.cancel).toHaveBeenCalledWith('e1');
  });
});
