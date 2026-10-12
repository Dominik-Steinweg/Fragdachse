import { describe, expect, it, vi } from 'vitest';
import { ProjectileVisualOverrides } from '../src/projectile/ProjectileVisualOverrides';

describe('projectile visual overrides', () => {
  it('lets a registered presenter claim projectiles by weapon source until it unregisters', () => {
    const overrides = new ProjectileVisualOverrides();
    const visual = { update: vi.fn(), destroy: vi.fn() };
    const release = overrides.register(p => p.weaponSourceId === 'kraken-eggs' ? visual : null);
    expect(overrides.create({ id: 1, weaponSourceId: 'kraken-eggs', x: 0, y: 0 })).toBe(visual);
    expect(overrides.create({ id: 2, weaponSourceId: 'ak47', x: 0, y: 0 })).toBeNull();
    expect(overrides.create({ id: 3, x: 0, y: 0 })).toBeNull();
    release();
    expect(overrides.create({ id: 4, weaponSourceId: 'kraken-eggs', x: 0, y: 0 })).toBeNull();
  });
});
