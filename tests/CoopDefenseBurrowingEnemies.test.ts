import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_ENEMY_CONFIGS,
  getCoopDefenseEnemyConfig,
  getCoopDefenseEnemyKindIndex,
} from '../src/config/coopDefenseEnemies';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import type { SyncedEnemyDeltaState } from '../src/types';

describe('Alien-Dachs', () => {
  const alien = getCoopDefenseEnemyConfig('alien-badger');
  const broodmother = getCoopDefenseEnemyConfig('stink-broodmother');

  it('is faster and in sum more dangerous than the stink broodmother', () => {
    expect(alien.moveSpeed).toBeGreaterThan(broodmother.moveSpeed);
    expect(alien.xp).toBeGreaterThan(broodmother.xp);
    expect(alien.movementTarget).toBe('players');
  });

  it('spawns burrowed at the left edge and can dive under the tracks for at most 2 seconds', () => {
    expect(alien.burrow?.spawnBurrowedAtLeftEdge).toBe(true);
    expect(alien.burrow?.crossesTrainTracks).toBe(true);
    expect(alien.burrow?.maxDurationMs).toBeLessThanOrEqual(2000);
    expect(alien.burrow?.spawnTunnelMinDistancePx).toBeGreaterThan(0);
    // Ohne Gleis-KI wuerde die Einbuddel-Querung nie ausgeloest.
    expect(alien.trainAwareness).toBeDefined();
  });

  it('fires a slower, worse-steering red copy of the plasma gun at players only', () => {
    const plasma = WEAPON_CONFIGS.PLASMA;
    const alienPlasma = WEAPON_CONFIGS.ALIEN_BADGER_PLASMA;
    expect(alienPlasma.cooldown).toBeGreaterThan(plasma.cooldown);
    expect(alienPlasma.projectileColor).not.toBe(plasma.projectileColor);

    if (plasma.fire.type !== 'projectile' || alienPlasma.fire.type !== 'projectile') {
      throw new Error('Beide Plasma-Varianten muessen Projektilwaffen sein');
    }
    expect(alienPlasma.fire.homing?.maxTurnDegreesPerStep)
      .toBeLessThan(plasma.fire.homing!.maxTurnDegreesPerStep);
    expect(alienPlasma.energyBallVariant).toBe(plasma.energyBallVariant);

    const weaponIds = alien.weapons.map((weapon) => weapon.weaponId);
    expect(weaponIds).toContain('ALIEN_BADGER_PLASMA');
    expect(alien.weapons.find((weapon) => weapon.weaponId === 'ALIEN_BADGER_PLASMA')?.targetMode)
      .toBe('players');
  });

  it('bites bases and rocks but never players', () => {
    const bite = alien.weapons.find((weapon) => weapon.weaponId === 'ALIEN_BADGER_BITE');
    expect(bite?.targetMode).toBe('structures');

    const biteConfig = WEAPON_CONFIGS.ALIEN_BADGER_BITE;
    if (biteConfig.fire.type !== 'melee') throw new Error('Biss muss eine Nahkampfwaffe sein');
    expect(biteConfig.fire.damageTargets).toContain('bases');
    expect(biteConfig.fire.damageTargets).toContain('rocks');
    expect(biteConfig.fire.damageTargets).not.toContain('players');
    expect(biteConfig.damage).toBeGreaterThan(WEAPON_CONFIGS.RABID_BADGER_BITE.damage);
  });
});

describe('Wurf-Dachs', () => {
  const thrower = getCoopDefenseEnemyConfig('thrower-badger');
  const alien = getCoopDefenseEnemyConfig('alien-badger');

  it('is tankier and in sum more dangerous than the alien badger, and hunts players', () => {
    expect(thrower.maxHp).toBeGreaterThan(alien.maxHp);
    expect(thrower.moveSpeed).toBeLessThan(alien.moveSpeed);
    expect(thrower.xp).toBeGreaterThan(alien.xp);
    expect(thrower.movementTarget).toBe('players');
  });

  it('throws delayed brood bombs that hatch rabid badgers hunting the players', () => {
    const spawnThrow = thrower.spawnThrow;
    expect(spawnThrow?.enemyKind).toBe('rabid-badger');
    expect(spawnThrow!.count).toBeGreaterThan(0);
    expect(spawnThrow!.fuseTimeMs).toBeGreaterThan(0);
    expect(spawnThrow!.maxRange).toBeGreaterThan(spawnThrow!.minRange);
    // Die geschluepfte Brut muss selbst auf Spielerjagd gehen.
    expect(getCoopDefenseEnemyConfig(spawnThrow!.enemyKind).movementTarget).toBe('players');
  });

  it('bites bases and rocks but never players', () => {
    const bite = thrower.weapons.find((weapon) => weapon.weaponId === 'THROWER_BADGER_BITE');
    expect(bite?.targetMode).toBe('structures');

    const biteConfig = WEAPON_CONFIGS.THROWER_BADGER_BITE;
    if (biteConfig.fire.type !== 'melee') throw new Error('Biss muss eine Nahkampfwaffe sein');
    expect(biteConfig.fire.damageTargets).not.toContain('players');
    expect(biteConfig.damage).toBeGreaterThan(WEAPON_CONFIGS.ALIEN_BADGER_BITE.damage);
  });
});

describe('Enemy snapshot codec', () => {
  it('round-trips the burrow flag without disturbing the other fields', () => {
    const entry: SyncedEnemyDeltaState = {
      id: 'e2a',
      kind: 'alien-badger',
      x: 120,
      y: 340,
      rot: 1.25,
      hp: 90,
      maxHp: 150,
      burnStacks: 2,
      faction: 'hostile',
      burrowed: true,
    };

    const stream: Array<number | string> = [];
    encodeEnemyUpsert(stream, entry);
    const [decoded] = decodeEnemyUpserts(stream);

    expect(decoded).toEqual({ ...entry, ownerId: undefined, ownerColor: 0 });
  });

  it('omits the burrow field entirely when it did not change', () => {
    const stream: Array<number | string> = [];
    encodeEnemyUpsert(stream, { id: 'e2a', x: 10, y: 20 });
    expect(decodeEnemyUpserts(stream)[0].burrowed).toBeUndefined();
  });

  it('keeps every enemy kind addressable by its wire index', () => {
    for (const kind of Object.keys(COOP_DEFENSE_ENEMY_CONFIGS)) {
      expect(getCoopDefenseEnemyKindIndex(kind)).toBeGreaterThanOrEqual(0);
    }
  });
});
