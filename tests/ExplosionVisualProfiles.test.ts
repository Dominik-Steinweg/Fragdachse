import { describe, expect, it } from 'vitest';
import type { ExplosionVisualStyle } from '../src/types';
import {
  EXPLOSION_VISUAL_PROFILES,
  getCombatExplosionProfile,
  isCombatExplosionStyle,
} from '../src/effects/ExplosionVisualProfiles';

describe('explosion visual profiles', () => {
  it('classifies every wire-compatible style exhaustively', () => {
    const styles: ExplosionVisualStyle[] = [
      'default', 'holy', 'energy', 'lightning', 'nuke', 'void_nuke', 'rocket',
      'mini_rocket', 'mini_rocket_cascade', 'train', 'brood_hatch', 'regeneration',
      'timebomb', 'timebomb_pop',
    ];
    expect(Object.keys(EXPLOSION_VISUAL_PROFILES).sort()).toEqual([...styles].sort());
    for (const style of styles) {
      expect(getCombatExplosionProfile(style)).toBe(EXPLOSION_VISUAL_PROFILES[style]);
    }
  });

  it('keeps healing and hatching outside destructive combat profiles', () => {
    expect(isCombatExplosionStyle('regeneration')).toBe(false);
    expect(isCombatExplosionStyle('brood_hatch')).toBe(false);
    expect(isCombatExplosionStyle('default')).toBe(true);
  });

  it('maps specialized styles to their authored families', () => {
    expect(getCombatExplosionProfile('mini_rocket_cascade')?.family).toBe('cascade');
    expect(getCombatExplosionProfile('timebomb')?.family).toBe('energy');
    expect(getCombatExplosionProfile('timebomb_pop')?.family).toBe('pop');
    expect(getCombatExplosionProfile('holy')?.family).toBe('holy');
    expect(getCombatExplosionProfile('lightning')?.family).toBe('lightning');
    expect(getCombatExplosionProfile('train')?.family).toBe('train');
    expect(getCombatExplosionProfile('void_nuke')?.family).toBe('nuke');
  });
});
