import { describe, expect, it } from 'vitest';
import { AUDIO_ASSETS, preloadAllAudio } from '../src/audio/AudioCatalog';
import { EXPLOSION_AUDIO, resolveAvailableExplosionKey, resolveExplosionAudio } from '../src/audio/ExplosionAudio';
import { WEAPON_CONFIGS } from '../src/loadout/content/LoadoutRegistry';

describe('source-owned explosion audio', () => {
  it('covers authored explosive weapons including upgrades and automated weapons', () => {
    for (const weapon of Object.values(WEAPON_CONFIGS)) {
      const fire = weapon.fire;
      const explosive = (fire.type === 'projectile' && (
        (fire.impactExplosion && !fire.impactExplosion.timeBubble && !fire.impactExplosion.reinforcementMatrix)
        || fire.enemyHitExplosion
      )) || (fire.type === 'flamethrower' && fire.fireball) || weapon.detonable;
      if (explosive) expect(weapon.id in EXPLOSION_AUDIO, weapon.id).toBe(true);
    }
  });

  it('assigns independent recordings to every registered source', () => {
    const keys = Object.values(EXPLOSION_AUDIO);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys.map(key => AUDIO_ASSETS[key])).size).toBe(keys.length);
    expect(resolveExplosionAudio('ARMAGEDDON')?.key).not.toBe(resolveExplosionAudio('HE_GRENADE')?.key);
  });

  it('provides a shipped substitute until each dedicated recording is published', () => {
    const shipped = new Set<string>();
    preloadAllAudio({ audio: (key: string) => shipped.add(key) } as never);
    for (const key of Object.values(EXPLOSION_AUDIO)) {
      expect(shipped.has(resolveAvailableExplosionKey(key, k => shipped.has(k))), key).toBe(true);
      expect(resolveAvailableExplosionKey(key, () => true)).toBe(key);
    }
  });

  it('keeps silent effects silent and only sounds charged time-bubble releases', () => {
    expect(resolveExplosionAudio('silent')).toBeUndefined();
    expect(resolveExplosionAudio('TIME_BUBBLE', 0)).toBeUndefined();
    expect(resolveExplosionAudio('TIME_BUBBLE', 70)?.key).toBe(EXPLOSION_AUDIO.TIME_BUBBLE);
    expect(resolveExplosionAudio('brood_hatch')?.key).toBe('shot_throw');
  });

  it('loads every source through its own published asset key', () => {
    const shipped = new Set<string>();
    preloadAllAudio({ audio: (key: string) => shipped.add(key) } as never);
    for (const key of Object.values(EXPLOSION_AUDIO)) {
      expect(shipped.has(key), key).toBe(true);
      expect(resolveAvailableExplosionKey(key, k => shipped.has(k))).toBe(key);
    }
  });
});
