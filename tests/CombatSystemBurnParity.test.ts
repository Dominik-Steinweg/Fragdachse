import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Line {
    x1 = 0; y1 = 0; x2 = 0; y2 = 0;
    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) { this.setTo(x1, y1, x2, y2); }
    setTo(x1: number, y1: number, x2: number, y2: number) { this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2; return this; }
  }
  class Circle {
    x = 0; y = 0; radius = 0;
    constructor(x = 0, y = 0, radius = 0) { this.setTo(x, y, radius); }
    setTo(x: number, y: number, radius: number) { this.x = x; this.y = y; this.radius = radius; return this; }
  }
  class Rectangle {
    x = 0; y = 0; width = 0; height = 0;
    constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
    setTo(x: number, y: number, width: number, height: number) { this.x = x; this.y = y; this.width = width; this.height = height; return this; }
  }
  return {
    Geom: { Line, Circle, Rectangle, Intersects: { GetLineToCircle: () => [] } },
    Math: {
      Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
      Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
    },
  };
});

import { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import { BURN_TICK_INTERVAL_MS } from '../src/config';

describe('CombatSystem & BurnStateMachine Parity', () => {
  function createTestSetup() {
    let now = 1_000;
    const playerManagerMock: any = {
      getPlayer: vi.fn().mockReturnValue(fakeEntity({ x: 0, y: 0, body: { enable: true } })),
      getAllPlayers: vi.fn().mockReturnValue([]),
    };
    const networkBridgeMock: any = {
      isHost: vi.fn().mockReturnValue(true),
      send: vi.fn(),
      broadcast: vi.fn(),
      broadcastEffect: vi.fn(),
      areTeammates: vi.fn().mockReturnValue(false),
    };

    const cs = new CombatSystem(
      playerManagerMock,
      networkBridgeMock,
    );
    cs.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 });

    cs.initPlayer('p_target', 1000);
    cs.initPlayer('p1', 1000);
    cs.initPlayer('p2', 1000);

    const damageCalls: Array<{
      targetType: string;
      targetId: string;
      attackerId: string | undefined;
      damage: number;
      damageKind: string;
    }> = [];

    cs.setDamageDealtHandler((targetType, targetId, attackerId, damage, damageKind) => {
      damageCalls.push({ targetType, targetId, attackerId, damage, damageKind });
    });

    return { cs, damageCalls, now: () => now, setNow: (value: number) => { now = value; } };
  }

  it('reveals on periodic HP or armor loss, but not merely receiving a burn stack', () => {
    const f = createTestSetup(), reveal = vi.fn();
    f.cs.setDecoySystem({ breakStealth: reveal } as never);
    f.cs.addArmor('p_target', 10);
    f.cs.applyBurnHit('p_target', 'p1', 2000, 5, 'decoy-test', 'ground_fire.generic');
    expect(reveal).not.toHaveBeenCalled();
    f.cs.updateBurnEffects(1250);
    expect(reveal).toHaveBeenCalledWith('p_target', expect.any(Number));
    expect(f.cs.getArmor('p_target')).toBeLessThan(10);
    reveal.mockClear(); f.cs.updateBurnEffects(2250);
    expect(f.cs.getHP('p_target')).toBeLessThan(100);
    expect(reveal).toHaveBeenCalled();
  });

  it('1. Delegiert Brandtreffer, Schadensbeiträge und Abfragen 1:1 an die BurnStateMachine', () => {
    const { cs, damageCalls, now } = createTestSetup();
    const observedDamage = vi.fn();
    const unsubscribe = cs.addDamageDealtObserver(observedDamage);

    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK', 'generic', 'normal');

    const visual = cs.getBurnVisualState('p_target', now());
    expect(visual.stackCount).toBe(1);
    expect(visual.visualStyle).toBe('normal');
    expect(cs.getBurnStackCount('p_target', now())).toBe(1);

    const active = cs.getActiveBurnSources('p_target', now());
    expect(active.length).toBe(1);
    expect(active[0].attackerId).toBe('p1');
    expect(active[0].sourceId).toBe('weapon.GLOCK');
    expect(active[0].stackCount).toBe(1);

    cs.updateBurnEffects(now() + 250);

    expect(damageCalls.length).toBe(1);
    expect(damageCalls[0].targetType).toBe('player');
    expect(damageCalls[0].targetId).toBe('p_target');
    expect(damageCalls[0].damage).toBe(5);
    expect(damageCalls[0].attackerId).toBe('p1');
    expect(damageCalls[0].damageKind).toBe('burn');
    expect(observedDamage).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'player',
      targetId: 'p_target',
      attackerId: 'p1',
      damage: 5,
      damageKind: 'burn',
    }));

    unsubscribe();
  });

  it('2. Stackt zwei Treffer derselben Quelle und summiert den Schaden korrekt', () => {
    const { cs, damageCalls, now } = createTestSetup();

    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK');
    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK');

    expect(cs.getBurnStackCount('p_target', now())).toBe(2);

    cs.updateBurnEffects(now() + 250);

    expect(damageCalls.length).toBe(1);
    expect(damageCalls[0].damage).toBe(10); // 2 Stacks * 5 = 10
  });

  it('3. Mehrere Quellen sortieren deterministisch nach Schaden absteigend und attackerId', () => {
    const { cs, damageCalls, now } = createTestSetup();

    cs.applyBurnHit('p_target', 'p2', 2000, 4, 'molotov', 'weapon.MOLOTOV');
    cs.applyBurnHit('p_target', 'p1', 2000, 10, 'flamethrower', 'weapon.FLAME');

    cs.updateBurnEffects(now() + 250);

    expect(damageCalls.length).toBe(2);
    // Höherer Schaden (p1, 10) zuerst!
    expect(damageCalls[0].attackerId).toBe('p1');
    expect(damageCalls[0].damage).toBe(10);
    expect(damageCalls[1].attackerId).toBe('p2');
    expect(damageCalls[1].damage).toBe(4);
  });

  it('4. Bereinigt Brand bei Tod des Ziels', () => {
    const { cs, damageCalls, now } = createTestSetup();

    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK');
    expect(cs.getBurnStackCount('p_target', now())).toBe(1);

    // Ziel stirbt durch Direktschaden
    cs.applyDamage('p_target', 2000, false, 'p1', 'weapon.RAILGUN');

    cs.updateBurnEffects(now() + 250);

    // Kein weiterer Brandschaden auf tote Spieler
    const burnDamages = damageCalls.filter((c) => c.damageKind === 'burn');
    expect(burnDamages.length).toBe(0);
    expect(cs.getBurnStackCount('p_target', now() + 250)).toBe(0);
  });

  it('5. Behaelt committed Burn nach Source-Tod und entfernt ihn erst beim finalen Source-Detach', () => {
    const { cs, damageCalls, now } = createTestSetup();

    cs.applyBurnHit('p_target', 'p1', 2_000, 5, 'glock', 'weapon.GLOCK');
    cs.applyDamage('p1', 2_000, false, 'p2', 'weapon.RAILGUN');
    cs.updateBurnEffects(now() + 250);

    expect(damageCalls.filter((call) => call.damageKind === 'burn')).toHaveLength(1);

    cs.removePlayer('p1');
    cs.updateBurnEffects(now() + 500);

    expect(damageCalls.filter((call) => call.damageKind === 'burn')).toHaveLength(1);
  });

  it.each(['detach', 'reattach', 'death'] as const)(
    'revalidates buffered and catch-up Burn after a DamageTaken hook causes source %s', (change) => {
      const { cs, damageCalls, now, setNow } = createTestSetup();
      const tick = BURN_TICK_INTERVAL_MS;
      cs.applyBurnHit('p_target', 'p1', 10 * tick, 2, 'first', 'weapon.FIRST');
      cs.applyBurnHit('p_target', 'p2', 10 * tick, 1, 'second', 'weapon.SECOND');
      const oldSource = cs.getPlayerCombatTarget('p2');
      let handled = false;
      cs.setPlayerDamageTakenHandler((_target, attacker) => {
        if (handled || attacker !== 'p1') return;
        handled = true;
        if (change === 'death') cs.applyDamage('p2', 2000, false, 'p1', 'weapon.RAILGUN');
        else {
          cs.removePlayer('p2');
          if (change === 'reattach') {
            cs.initPlayer('p2');
            // Reattach within the same World runtime must not reactivate the buffered source facts.
            expect(cs.getPlayerCombatTarget('p2')?.scope).toEqual(oldSource?.scope);
            cs.applyBurnHit('p_target', 'p2', 10 * tick, 1, 'second', 'weapon.SECOND');
          }
        }
      });
      setNow(now() + 3 * tick);
      cs.updateBurnEffects(now());
      const secondSourceDamage = () => damageCalls.filter(call => call.damageKind === 'burn' && call.attackerId === 'p2');
      expect(secondSourceDamage()).toHaveLength(change === 'death' ? 3 : 0);
      setNow(now() + tick);
      cs.updateBurnEffects(now());
      expect(secondSourceDamage()).toHaveLength(change === 'death' ? 4 : change === 'reattach' ? 1 : 0);
    },
  );
});
