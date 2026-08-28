import { describe, expect, it } from 'vitest';

import {
  applyRadialEnvironmentDamage,
  type EnvironmentRockSink,
} from '../src/systems/EnvironmentDamageResolver';

interface FakeRock {
  x: number;
  y: number;
  hp: number;
}

/**
 * Minimaler Felsbestand ohne Zielstatus-Regeln – genau das, was die lokale Lobby-Seite des
 * gemeinsamen Kerns liefert. Der Gameplay-Bestand hängt zusätzlich seinen Trichter davor.
 */
function createSink(rocks: FakeRock[], maxHp = 100): EnvironmentRockSink & { rocks: FakeRock[] } {
  return {
    rocks,
    forEachActiveRock(visit) {
      rocks.forEach((rock, index) => {
        if (rock.hp <= 0) return;
        visit(index, rock.x, rock.y);
      });
    },
    resolveRockDamage: (_index, damage) => damage,
    applyRockDamage(index, damage) {
      const rock = rocks[index];
      rock.hp = Math.max(0, Math.min(maxHp, rock.hp) - damage);
      return rock.hp;
    },
    onRockDestroyed: () => {},
  };
}

describe('radial environment damage', () => {
  it('damages every rock inside the radius and reports the destroyed ones', () => {
    const sink = createSink([
      { x: 0,   y: 0, hp: 100 },   // Zentrum
      { x: 40,  y: 0, hp: 100 },   // im Radius
      { x: 90,  y: 0, hp: 100 },   // im Radius, weit außen
      { x: 210, y: 0, hp: 100 },   // außerhalb
    ]);

    const result = applyRadialEnvironmentDamage(
      sink,
      { x: 0, y: 0, radius: 100, damage: 100, rockDamageMult: 1, falloff: { minDamage: 20 } },
      'attacker',
    );

    expect(result.damagedRockIndices).toEqual([0, 1, 2]);
    expect(sink.rocks[3].hp).toBe(100);
    // Falloff: voller Schaden im Zentrum, linear bis minDamage am Rand.
    expect(sink.rocks[0].hp).toBe(0);
    expect(sink.rocks[1].hp).toBe(32);
    expect(sink.rocks[2].hp).toBe(72);
    expect(result.destroyedRockIndices).toEqual([0]);
  });

  it('scales the whole radius by rockDamageMult and skips the pass entirely at zero', () => {
    const scaled = createSink([{ x: 0, y: 0, hp: 100 }]);
    applyRadialEnvironmentDamage(
      scaled,
      { x: 0, y: 0, radius: 100, damage: 50, rockDamageMult: 0.5 },
      'attacker',
    );
    expect(scaled.rocks[0].hp).toBe(75);

    const immune = createSink([{ x: 0, y: 0, hp: 100 }]);
    const result = applyRadialEnvironmentDamage(
      immune,
      { x: 0, y: 0, radius: 100, damage: 50, rockDamageMult: 0 },
      'attacker',
    );
    expect(immune.rocks[0].hp).toBe(100);
    expect(result.damagedRockIndices).toEqual([]);
  });

  it('keeps the attacker identity when a rock is destroyed', () => {
    const sink = createSink([{ x: 0, y: 0, hp: 25 }]);
    let destroyedBy: string | undefined;
    sink.onRockDestroyed = (_index, attackerId) => {
      destroyedBy = attackerId;
    };

    applyRadialEnvironmentDamage(
      sink,
      { x: 0, y: 0, radius: 100, damage: 25, rockDamageMult: 1 },
      'dachs-player',
      false,
    );

    expect(destroyedBy).toBe('dachs-player');
  });

  it('never caps the number of affected rocks', () => {
    const rocks = Array.from({ length: 24 }, (_, index) => ({ x: index * 4, y: 0, hp: 100 }));
    const sink = createSink(rocks);

    const result = applyRadialEnvironmentDamage(
      sink,
      { x: 0, y: 0, radius: 200, damage: 100, rockDamageMult: 1 },
      'attacker',
    );

    expect(result.damagedRockIndices).toHaveLength(24);
    expect(result.destroyedRockIndices).toHaveLength(24);
  });

  it('lets the target-status funnel veto a hit without touching rock state', () => {
    const rocks = [{ x: 0, y: 0, hp: 100 }, { x: 20, y: 0, hp: 100 }];
    const sink = createSink(rocks);
    sink.resolveRockDamage = (index, damage) => (index === 0 ? 0 : damage);

    const result = applyRadialEnvironmentDamage(
      sink,
      { x: 0, y: 0, radius: 100, damage: 60, rockDamageMult: 1 },
      'attacker',
    );

    expect(rocks[0].hp).toBe(100);
    expect(result.damagedRockIndices).toEqual([1]);
  });
});
