import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import type { PlayerManager } from '../src/entities/PlayerManager';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { ArenaLayout } from '../src/types';
import type { CombatSystem } from '../src/systems/CombatSystem';

describe('configured Nuke variants', () => {
  it('snapshots the fixed Void target and leaves normal player Nukes normal', () => {
    const players = {
      getPlayer: () => ({ id: 'p1', sprite: { x: 100, y: 100 } }),
    };
    const combat = {
      isAlive: () => true,
    };
    const layout: ArenaLayout = {
      seed: 1,
      rocks: [],
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
    };
    const system = new PowerUpSystem(
      players as unknown as PlayerManager,
      combat as unknown as CombatSystem,
      layout,
    );

    expect(system.scheduleConfiguredNukeStrike('e1', 640, 420, {
      countdownMs: 5000,
      radius: 600,
      maxDamage: 1000,
      minDamage: 50,
      allowTeamDamage: true,
      damageTarget: 'player-side',
      variant: 'void',
    }, 1000)).toBe(true);
    expect(system.getNukeSnapshot()[0]).toMatchObject({
      x: 640,
      y: 420,
      radius: 600,
      armedAt: 1000,
      explodeAt: 6000,
      triggeredBy: 'e1',
      variant: 'void',
    });

    expect(system.scheduleNukeStrike('p1', 500, 300)).toBe(true);
    expect(system.getNukeSnapshot()[1].variant).toBe('normal');
  });
});
