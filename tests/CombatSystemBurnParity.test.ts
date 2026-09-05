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

import { CombatSystem } from '../src/systems/CombatSystem';

describe('CombatSystem & BurnStateMachine Parity', () => {
  function createTestSetup() {
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

    return { cs, damageCalls };
  }

  it('1. Delegiert Brandtreffer, Schadensbeiträge und Abfragen 1:1 an die BurnStateMachine', () => {
    const { cs, damageCalls } = createTestSetup();
    const observedDamage = vi.fn();
    const unsubscribe = cs.addDamageDealtObserver(observedDamage);

    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK', 'generic', 'normal');

    const visual = cs.getBurnVisualState('p_target');
    expect(visual.stackCount).toBe(1);
    expect(visual.visualStyle).toBe('normal');
    expect(cs.getBurnStackCount('p_target')).toBe(1);

    const active = cs.getActiveBurnSources('p_target');
    expect(active.length).toBe(1);
    expect(active[0].attackerId).toBe('p1');
    expect(active[0].sourceId).toBe('weapon.GLOCK');
    expect(active[0].stackCount).toBe(1);

    const now = Date.now();
    cs.updateBurnEffects(now + 250);

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
    const { cs, damageCalls } = createTestSetup();

    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK');
    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK');

    expect(cs.getBurnStackCount('p_target')).toBe(2);

    const now = Date.now();
    cs.updateBurnEffects(now + 250);

    expect(damageCalls.length).toBe(1);
    expect(damageCalls[0].damage).toBe(10); // 2 Stacks * 5 = 10
  });

  it('3. Mehrere Quellen sortieren deterministisch nach Schaden absteigend und attackerId', () => {
    const { cs, damageCalls } = createTestSetup();

    cs.applyBurnHit('p_target', 'p2', 2000, 4, 'molotov', 'weapon.MOLOTOV');
    cs.applyBurnHit('p_target', 'p1', 2000, 10, 'flamethrower', 'weapon.FLAME');

    const now = Date.now();
    cs.updateBurnEffects(now + 250);

    expect(damageCalls.length).toBe(2);
    // Höherer Schaden (p1, 10) zuerst!
    expect(damageCalls[0].attackerId).toBe('p1');
    expect(damageCalls[0].damage).toBe(10);
    expect(damageCalls[1].attackerId).toBe('p2');
    expect(damageCalls[1].damage).toBe(4);
  });

  it('4. Bereinigt Brand bei Tod des Ziels', () => {
    const { cs, damageCalls } = createTestSetup();

    cs.applyBurnHit('p_target', 'p1', 2000, 5, 'glock', 'weapon.GLOCK');
    expect(cs.getBurnStackCount('p_target')).toBe(1);

    // Ziel stirbt durch Direktschaden
    cs.applyDamage('p_target', 2000, false, 'p1', 'weapon.RAILGUN');

    const now = Date.now();
    cs.updateBurnEffects(now + 250);

    // Kein weiterer Brandschaden auf tote Spieler
    const burnDamages = damageCalls.filter((c) => c.damageKind === 'burn');
    expect(burnDamages.length).toBe(0);
    expect(cs.getBurnStackCount('p_target')).toBe(0);
  });
});
