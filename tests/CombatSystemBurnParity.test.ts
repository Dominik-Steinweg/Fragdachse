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
  it('delegiert Brandtreffer, Schadensbeiträge und Abfragen 1:1 an die BurnStateMachine', () => {
    const playerManagerMock: any = {
      getPlayer: vi.fn().mockReturnValue({ sprite: { x: 0, y: 0 } }),
      getAllPlayers: vi.fn().mockReturnValue([]),
    };
    const enemyManagerMock: any = {
      isEnemy: vi.fn().mockReturnValue(false),
    };
    const projectileManagerMock: any = {
      getTrackedProjectiles: vi.fn().mockReturnValue([]),
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
      projectileManagerMock,
      networkBridgeMock,
    );

    // Initialisierung eines Ziels
    cs.initPlayer('p_target', 100);
    cs.initPlayer('p_attacker', 100);

    const damageCalls: any[] = [];
    cs.setDamageDealtHandler((targetType, targetId, attackerId, damage, damageKind) => {
      damageCalls.push({ targetType, targetId, attackerId, damage, damageKind });
    });

    // 1. Brandtreffer anwenden
    cs.applyBurnHit('p_target', 'p_attacker', 2000, 5, 'glock', 'weapon.GLOCK', 'generic', 'normal');

    // 2. Abfragen vor dem Tick
    const visual = cs.getBurnVisualState('p_target');
    expect(visual.stackCount).toBe(1);
    expect(visual.visualStyle).toBe('normal');
    expect(cs.getBurnStackCount('p_target')).toBe(1);

    const active = cs.getActiveBurnSources('p_target');
    expect(active.length).toBe(1);
    expect(active[0].attackerId).toBe('p_attacker');
    expect(active[0].sourceId).toBe('weapon.GLOCK');
    expect(active[0].stackCount).toBe(1);

    // 3. Ticks ausführen
    const now = Date.now();
    cs.updateBurnEffects(now + 250);

    expect(damageCalls.length).toBe(1);
    expect(damageCalls[0].targetType).toBe('player');
    expect(damageCalls[0].targetId).toBe('p_target');
    expect(damageCalls[0].damage).toBe(5);
    expect(damageCalls[0].attackerId).toBe('p_attacker');
    expect(damageCalls[0].damageKind).toBe('burn');
  });
});
