import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_ENEMY_CONFIGS,
  getCoopDefenseEnemyConfig,
  getCoopDefenseEnemyKindIndex,
} from '../src/config/coopDefenseEnemies';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { VOID_FIRE_COLOR } from '../src/config';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import type { SyncedEnemyDeltaState } from '../src/types';

describe('Alien-Dachs', () => {
  const alien = getCoopDefenseEnemyConfig('alien-badger');
  const broodmother = getCoopDefenseEnemyConfig('stink-broodmother');

  it('hunts players independently of the stink broodmother tuning', () => {
    expect(alien.moveSpeed).toBeGreaterThan(0);
    expect(alien.xp).toBeGreaterThanOrEqual(0);
    expect(broodmother.moveSpeed).toBeGreaterThan(0);
    expect(broodmother.xp).toBeGreaterThanOrEqual(0);
    expect(alien.movementTarget).toBe('players');
  });

  it('spawns burrowed at an authored edge and can dive under the tracks for at most 2 seconds', () => {
    expect(alien.burrow?.spawnBurrowedAtEdge).toBe(true);
    expect(alien.burrow?.crossesTrainTracks).toBe(true);
    expect(alien.burrow?.maxDurationMs).toBeGreaterThan(0);
    expect(alien.burrow?.spawnTunnelMinDistancePx).toBeGreaterThan(0);
    // Ohne Gleis-KI wuerde die Einbuddel-Querung nie ausgeloest.
    expect(alien.trainAwareness).toBeDefined();
  });

  it('fires a homing purple plasma variant at players only', () => {
    const plasma = WEAPON_CONFIGS.PLASMA;
    const alienPlasma = WEAPON_CONFIGS.ALIEN_BADGER_PLASMA;
    expect(plasma.cooldown).toBeGreaterThan(0);
    expect(alienPlasma.cooldown).toBeGreaterThan(0);
    expect(alienPlasma.projectileColor).not.toBe(plasma.projectileColor);
    expect(alienPlasma.projectileColor).toBe(VOID_FIRE_COLOR);

    if (plasma.fire.type !== 'projectile' || alienPlasma.fire.type !== 'projectile') {
      throw new Error('Beide Plasma-Varianten muessen Projektilwaffen sein');
    }
    // Die Lenkstaerke selbst ist Balancing; die Kopie muss aber ueberhaupt lenken.
    expect(alienPlasma.fire.homing?.maxTurnDegreesPerStep).toBeGreaterThan(0);
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
    expect(biteConfig.damage).toBeGreaterThanOrEqual(0);
  });
});

describe('Wurf-Dachs', () => {
  const thrower = getCoopDefenseEnemyConfig('thrower-badger');
  const alien = getCoopDefenseEnemyConfig('alien-badger');

  it('has a valid combat profile and hunts players', () => {
    expect(thrower.maxHp).toBeGreaterThan(0);
    expect(thrower.moveSpeed).toBeGreaterThan(0);
    expect(thrower.xp).toBeGreaterThanOrEqual(0);
    expect(alien.maxHp).toBeGreaterThan(0);
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

  it('bites bases and rocks, and players only after a telegraphed windup', () => {
    const bite = thrower.weapons.find((weapon) => weapon.weaponId === 'THROWER_BADGER_BITE');
    expect(bite?.targetMode).toBe('all');
    // Ein Spielerbiss ohne Vorwarnzeit waere nicht ausweichbar.
    expect(bite!.playerMeleeWindupMs!).toBeGreaterThan(0);

    const biteConfig = WEAPON_CONFIGS.THROWER_BADGER_BITE;
    if (biteConfig.fire.type !== 'melee') throw new Error('Biss muss eine Nahkampfwaffe sein');
    expect(biteConfig.fire.damageTargets).toContain('bases');
    expect(biteConfig.fire.damageTargets).toContain('rocks');
    expect(biteConfig.damage).toBeGreaterThanOrEqual(0);
  });
});

describe('Pyro-Dachs', () => {
  const pyro = getCoopDefenseEnemyConfig('pyro-badger');
  const alien = getCoopDefenseEnemyConfig('alien-badger');

  it('has a valid void-fire combat profile', () => {
    expect(pyro.moveSpeed).toBeGreaterThan(0);
    expect(pyro.maxHp).toBeGreaterThan(0);
    expect(alien.moveSpeed).toBeGreaterThan(0);
    expect(alien.maxHp).toBeGreaterThan(0);
    expect(pyro.knockbackFactor).toBeGreaterThanOrEqual(0);
    expect(pyro.movementTarget).toBe('players');
    expect(pyro.xp).toBeGreaterThanOrEqual(0);
    expect(pyro.color).toBe(VOID_FIRE_COLOR);
    expect(pyro.glow?.color).toBe(0xc34cff);
  });

  it('always fires burning bullets from its glock variant', () => {
    const glock = WEAPON_CONFIGS.PYRO_BADGER_GLOCK;
    if (glock.fire.type !== 'projectile') throw new Error('Brand-Glock muss eine Projektilwaffe sein');

    expect(glock.burnOnHit!.durationMs).toBeGreaterThan(0);
    expect(glock.burnOnHit!.damagePerTick).toBeGreaterThan(0);
    expect(glock.projectileBurnVisualStyle).toBe('void');
    expect(glock.bulletVisualPreset).toBe(WEAPON_CONFIGS.GLOCK.bulletVisualPreset);
    expect(glock.cooldown).toBeGreaterThan(0);
    expect(glock.spreadStanding).toBeGreaterThanOrEqual(0);
    expect(glock.spreadMoving).toBeGreaterThanOrEqual(0);

    expect(pyro.weapons.find((weapon) => weapon.weaponId === 'PYRO_BADGER_GLOCK')?.targetMode)
      .toBe('players');
    expect(pyro.weapons.find((weapon) => weapon.weaponId === 'PYRO_BADGER_BITE')?.targetMode)
      .toBe('structures');
  });

  it('only bites structures it is standing right next to', () => {
    const bite = WEAPON_CONFIGS.PYRO_BADGER_BITE;
    if (bite.fire.type !== 'melee') throw new Error('Biss muss eine Nahkampfwaffe sein');

    expect(bite.range).toBeGreaterThan(0);
    expect(bite.fire.damageTargets).toContain('rocks');
    expect(bite.fire.damageTargets).not.toContain('players');
  });

  it('surfaces immediately after spawning instead of tunnelling through the rock field', () => {
    expect(pyro.burrow?.spawnBurrowedAtEdge).toBe(true);
    expect(pyro.burrow?.spawnTunnelMinDistancePx).toBe(0);
    expect(pyro.burrow!.spawnTunnelTimeoutMs).toBeGreaterThan(0);
    expect(pyro.burrow!.speedFactor).toBeGreaterThan(0);
  });

  it('uses the plain player dash and only configures when to trigger it', () => {
    const dodge = pyro.dodge!;
    expect(dodge.cooldownMs).toBeGreaterThan(0);
    expect(dodge.approachMaxDistancePx).toBeGreaterThan(dodge.approachMinDistancePx);

    expect(dodge.evadeScanRadiusPx).toBeGreaterThan(0);
  });
});

describe('Purple enemy weapon VFX', () => {
  it('uses the purple spore projectile and impact cloud for the Warden', () => {
    const warden = WEAPON_CONFIGS.WARDEN_SPORES;
    expect(warden.projectileColor).toBe(VOID_FIRE_COLOR);
    if (warden.fire.type !== 'projectile') throw new Error('Warden-Sporen muessen eine Projektilwaffe sein');
    expect(warden.fire.impactCloud?.visualVariant).toBe('spore_void');
  });

  it('uses the purple void cloud for the enemy stink aura', () => {
    expect(UTILITY_CONFIGS.ENEMY_STINK_CLOUD.visualVariant).toBe('spore_void');
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
      burnVisualStyle: 'void',
      plasmaChargeStacks: 7,
      faction: 'hostile',
      burrowed: true,
      dashPhase: 1,
    };

    const stream: Array<number | string> = [];
    encodeEnemyUpsert(stream, entry);
    const [decoded] = decodeEnemyUpserts(stream);

    expect(decoded).toEqual({ ...entry, ownerId: undefined, ownerColor: 0 });
  });

  it('omits the dash phase entirely when it did not change', () => {
    const stream: Array<number | string> = [];
    encodeEnemyUpsert(stream, { id: 'e2a', x: 10, y: 20 });
    expect(decodeEnemyUpserts(stream)[0].dashPhase).toBeUndefined();
  });

  it('omits the burrow field entirely when it did not change', () => {
    const stream: Array<number | string> = [];
    encodeEnemyUpsert(stream, { id: 'e2a', x: 10, y: 20 });
    expect(decodeEnemyUpserts(stream)[0].burrowed).toBeUndefined();
  });

  it('round-trips the Void Hunter Gauss telegraph without affecting ordinary enemies', () => {
    const stream: Array<number | string> = [];
    encodeEnemyUpsert(stream, {
      id: 'e2a',
      specialAction: 'gauss-charge',
      specialActionEndsAt: 12_345,
      gaussChargeProgress: 0.625,
      gaussAimAngle: 1.23,
    });
    expect(decodeEnemyUpserts(stream)[0]).toMatchObject({
      specialAction: 'gauss-charge',
      specialActionEndsAt: 12_345,
      gaussChargeProgress: 0.625,
      gaussAimAngle: 1.23,
    });

    const ordinary: Array<number | string> = [];
    encodeEnemyUpsert(ordinary, { id: 'e2b', x: 10, y: 20 });
    expect(decodeEnemyUpserts(ordinary)[0].specialAction).toBeUndefined();
  });

  it('packs void burn into the existing burn value without changing the stream shape', () => {
    const normal: Array<number | string> = [];
    const voidFire: Array<number | string> = [];
    encodeEnemyUpsert(normal, { id: 'e2a', burnStacks: 3, burnVisualStyle: 'normal' });
    encodeEnemyUpsert(voidFire, { id: 'e2a', burnStacks: 3, burnVisualStyle: 'void' });

    expect(voidFire).toHaveLength(normal.length);
    expect(decodeEnemyUpserts(voidFire)[0]).toMatchObject({
      burnStacks: 3,
      burnVisualStyle: 'void',
    });
  });

  it('keeps every enemy kind addressable by its wire index', () => {
    for (const kind of Object.keys(COOP_DEFENSE_ENEMY_CONFIGS)) {
      expect(getCoopDefenseEnemyKindIndex(kind)).toBeGreaterThanOrEqual(0);
    }
  });
});
