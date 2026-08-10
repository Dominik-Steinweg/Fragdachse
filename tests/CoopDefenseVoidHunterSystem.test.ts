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
    fireAutomatedGaussWeapon: vi.fn(() => {
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
  it('keeps boss-only loadout configs in their dedicated registries', () => {
    const shotgun = WEAPON_CONFIGS.VOID_HUNTER_SHOTGUN;
    const gauss = ULTIMATE_CONFIGS.VOID_HUNTER_GAUSS;
    const bossConfig = getCoopDefenseEnemyConfig('void-hunter');

    expect(shotgun.allowedSlots).toEqual([]);
    expect(gauss.type).toBe('gauss');
    expect(gauss.projectileStyle).toBe('gauss');
    expect(gauss.projectileSpeed).toBeGreaterThan(0);
    expect(gauss.projectileSize).toBeGreaterThan(0);
    expect(gauss.range).toBeGreaterThan(bossConfig.voidHunterBoss!.shotgunRangePx);
    expect(bossConfig.voidHunterBoss!.gauss.weaponId).toBe(gauss.id);
    expect(WEAPON_CONFIGS).not.toHaveProperty(gauss.id);
    expect(ULTIMATE_CONFIGS.GAUSS_RIFLE.type).toBe('gauss');

    expect(resolveCoopDefenseEnemyConfigs(2)['void-hunter'].voidHunterBoss).toBeDefined();
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

    expect(fixture.system.hasReachedPhase(1)).toBe(false);
    expect(fixture.system.hasReachedPhase(2)).toBe(true);
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

  it('waits for Gauss, samples at the configured interval, and turns at the configured limit', () => {
    const bossConfig = getCoopDefenseEnemyConfig('void-hunter').voidHunterBoss!;
    const gaussConfig = ULTIMATE_CONFIGS.VOID_HUNTER_GAUSS;
    const initialDelay = bossConfig.gauss.initialDelayMs;
    const chargeDuration = bossConfig.gauss.chargeDurationMs;
    const aimUpdateInterval = bossConfig.gauss.aimUpdateIntervalMs;
    const targetDistance = (bossConfig.shotgunRangePx + gaussConfig.range) / 2;
    const fixture = createFixture([{ x: 100, y: 100 + targetDistance }]);
    fixture.system.hostUpdate(0);
    fixture.system.hostUpdate(Math.max(0, initialDelay - 1));
    expect(fixture.loadout.fireAutomatedGaussWeapon).not.toHaveBeenCalled();

    fixture.system.hostUpdate(initialDelay);
    expect(fixture.enemy.aim).toBe(0);
    if (aimUpdateInterval > 0) {
      for (let elapsed = aimUpdateInterval; elapsed < chargeDuration; elapsed += aimUpdateInterval) {
        fixture.system.hostUpdate(initialDelay + elapsed);
      }
    }
    fixture.system.hostUpdate(initialDelay + chargeDuration);

    expect(fixture.loadout.fireAutomatedGaussWeapon).toHaveBeenCalledTimes(1);
    const expectedAngle = Math.min(
      Math.PI / 2,
      (bossConfig.gauss.maxAimTurnDegreesPerSecond * Math.PI / 180) * chargeDuration / 1000,
    );
    expect(fixture.loadout.fireAutomatedGaussWeapon.mock.calls[0][3]).toBeCloseTo(expectedAngle, 5);
    expect(fixture.playerManager.getPlayer).toHaveBeenCalledTimes(
      aimUpdateInterval > 0 ? Math.floor(chargeDuration / aimUpdateInterval) : 0,
    );
  });

  it('does not begin Gauss inside shotgun range', () => {
    const bossConfig = getCoopDefenseEnemyConfig('void-hunter').voidHunterBoss!;
    const fixture = createFixture([{ x: 100 + bossConfig.shotgunRangePx, y: 100 }]);
    fixture.system.hostUpdate(0);
    fixture.system.hostUpdate(bossConfig.gauss.initialDelayMs);
    fixture.system.hostUpdate(bossConfig.gauss.initialDelayMs + bossConfig.gauss.chargeDurationMs);
    expect(fixture.loadout.fireAutomatedGaussWeapon).not.toHaveBeenCalled();
  });

  it('finishes a due Gauss shot before starting pending Armageddon', () => {
    const bossConfig = getCoopDefenseEnemyConfig('void-hunter').voidHunterBoss!;
    const gaussConfig = ULTIMATE_CONFIGS.VOID_HUNTER_GAUSS;
    const targetDistance = (bossConfig.shotgunRangePx + gaussConfig.range) / 2;
    const fixture = createFixture([{ x: 100 + targetDistance, y: 100 }]);
    fixture.enemy.hp = fixture.enemy.maxHp * bossConfig.phaseTwoHpRatio;
    fixture.system.hostUpdate(0);
    const firstArmageddonAt = bossConfig.nuke.countdownMs + bossConfig.nuke.emergeDelayMs;
    const gaussStartsAt = firstArmageddonAt + bossConfig.armageddonDurationMs;
    fixture.system.hostUpdate(firstArmageddonAt); // erstes Armageddon
    fixture.system.hostUpdate(gaussStartsAt); // Ende; Gauss beginnt
    fixture.actions.length = 0;
    const pendingArmageddonAt = gaussStartsAt + Math.max(
      bossConfig.gauss.chargeDurationMs,
      bossConfig.armageddonCooldownMs,
    );
    fixture.system.hostUpdate(pendingArmageddonAt); // Armageddon wird während der noch geführten Ladung fällig
    expect(fixture.actions).toEqual(['gauss-shot', 'armageddon-start']);
  });

  it('cleans pending boss state and Armageddon on teardown', () => {
    const fixture = createFixture();
    fixture.system.hostUpdate(0);
    fixture.system.clear();
    expect(fixture.armageddon.cancel).toHaveBeenCalledWith('e1');
  });
});
