import { describe, expect, it } from 'vitest';
import {
  BurnStateMachine,
  MAX_BURN_CATCH_UP_TICKS,
} from '../src/combat/rules/BurnStateMachine';
import { BURN_TICK_INTERVAL_MS } from '../src/config';

describe('BurnStateMachine (Phaser-unabhängiger Shared Burn Core)', () => {
  it('1. Ein Burn-Hit erzeugt exakt 1 Stack mit korrekt gerundeter Expiration', () => {
    const sm = new BurnStateMachine();
    const applied = sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 100,
    });

    expect(applied).toBe(true);
    expect(sm.getStackCount('dummy', 100)).toBe(1);

    // Expiration: Math.ceil((100 + 1000) / 250) * 250 = Math.ceil(1100 / 250) * 250 = 5 * 250 = 1250
    const sources = sm.getActiveSources('dummy', 100);
    expect(sources.length).toBe(1);
    expect(sources[0].stackCount).toBe(1);
    expect(sources[0].damagePerTick).toBe(5);
    expect(sources[0].effectiveDamagePerSecond).toBe((5 * 1000) / BURN_TICK_INTERVAL_MS); // 20 DPS
  });

  it('2. Zwei Treffer derselben Quelle im selben Zeitfenster komprimieren in 1 Bucket (stackCount: 2)', () => {
    const sm = new BurnStateMachine();
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 100,
    });
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 200, // Im selben 250ms-Intervall: ceil((200+1000)/250)*250 = 1250
    });

    expect(sm.getStackCount('dummy', 200)).toBe(2);
    const sources = sm.getActiveSources('dummy', 200);
    expect(sources.length).toBe(1);
    expect(sources[0].stackCount).toBe(2);
    expect(sources[0].effectiveDamagePerSecond).toBe((10 * 1000) / BURN_TICK_INTERVAL_MS); // 40 DPS
  });

  it('3. Unterschiedliche Quellen (attackerId oder sourceKey) bleiben separat', () => {
    const sm = new BurnStateMachine();
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 0,
    });
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p2',
      durationMs: 1000,
      damagePerTick: 8,
      sourceKey: 'molotov',
      sourceId: 'weapon.MOLOTOV',
      now: 0,
    });

    expect(sm.getStackCount('dummy', 0)).toBe(2);
    const sources = sm.getActiveSources('dummy', 0);
    expect(sources.length).toBe(2);
  });

  it('4. Unterschiedlicher damagePerTick derselben Quelle erzeugt getrennte Buckets', () => {
    const sm = new BurnStateMachine();
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 0,
    });
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 10,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 0,
    });

    expect(sm.getStackCount('dummy', 0)).toBe(2);
    const sources = sm.getActiveSources('dummy', 0);
    expect(sources.length).toBe(1);
    expect(sources[0].stackCount).toBe(2);
    expect(sources[0].damagePerTick).toBe(7.5); // Durchschnitt: (5 + 10) / 2
  });

  it('5. Expiration: expiresAt === tickAt verursacht keinen weiteren Tick (nur expiresAt > tickAt ist aktiv)', () => {
    const sm = new BurnStateMachine();
    // Treffer bei now = 0, duration = 250ms -> expiresAt = 250ms
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 250,
      damagePerTick: 5,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 0,
    });

    // Advance auf 250ms: Tick 250 feuert NICHT mehr für diesen Stack, da expiresAt (250) nicht > tickAt (250) ist
    // Moment: Bei now=0 wird nextBurnTickAt = 250 initialisiert.
    // Bei tickAt = 250 prüft die Filterung: bucket.expiresAt > 250. 250 > 250 ist false!
    // Aber wenn durationMs = 500ms -> expiresAt = 500ms. Bei tickAt = 250 ist 500 > 250 (true, 1 Tick). Bei tickAt = 500 ist 500 > 500 (false, abgelaufen).
    const sm500 = new BurnStateMachine();
    sm500.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 500,
      damagePerTick: 10,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 0,
    });

    // 1. Tick bei 250ms: feuert 10 Schaden
    const contribs1 = sm500.advanceTo(250);
    expect(contribs1.length).toBe(1);
    expect(contribs1[0].damage).toBe(10);

    // 2. Tick bei 500ms: expiresAt = 500, 500 > 500 ist false -> kein weiterer Schaden!
    const contribs2 = sm500.advanceTo(500);
    expect(contribs2.length).toBe(0);
    expect(sm500.hasAnyActiveBurns(500)).toBe(false);
  });

  it('6. Catch-up verarbeitet maximal 4 Ticks und überspringt größeren Backlog', () => {
    const sm = new BurnStateMachine();
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 5000,
      damagePerTick: 5,
      sourceKey: 'glock',
      sourceId: 'weapon.GLOCK',
      now: 0,
    });

    // Riesiger Sprung in die Zukunft (z.B. nach Tab-Pause: now = 5000ms, also 20 Ticks)
    const contribs = sm.advanceTo(5000);
    // Sollte maximal MAX_BURN_CATCH_UP_TICKS (4) Ticks abarbeiten
    expect(contribs.length).toBe(MAX_BURN_CATCH_UP_TICKS);
    for (const c of contribs) {
      expect(c.damage).toBe(5);
    }
  });

  it('7. Deterministische Sortierung fälliger Beiträge', () => {
    const sm = new BurnStateMachine();
    // 3 Quellen mit unterschiedlichem Schaden und Namen
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p2',
      durationMs: 1000,
      damagePerTick: 10,
      sourceKey: 'k1',
      sourceId: 'srcB',
      now: 0,
    });
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 20,
      sourceKey: 'k2',
      sourceId: 'srcA',
      now: 0,
    });
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 10,
      sourceKey: 'k3',
      sourceId: 'srcC',
      now: 0,
    });

    const contribs = sm.advanceTo(250);
    expect(contribs.length).toBe(3);
    // 1. Höchster Schaden: 20 (p1, srcA)
    expect(contribs[0].damage).toBe(20);
    expect(contribs[0].attackerId).toBe('p1');
    // 2. Schaden 10: p1 vor p2 lexikografisch
    expect(contribs[1].damage).toBe(10);
    expect(contribs[1].attackerId).toBe('p1');
    // 3. Schaden 10: p2
    expect(contribs[2].damage).toBe(10);
    expect(contribs[2].attackerId).toBe('p2');
  });

  it('8. Clear-Target und Clear-by-Attacker', () => {
    const sm = new BurnStateMachine();
    sm.applyHit({
      targetId: 't1',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'k',
      sourceId: 's',
      now: 0,
    });
    sm.applyHit({
      targetId: 't2',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'k',
      sourceId: 's',
      now: 0,
    });

    sm.clearTarget('t1');
    expect(sm.hasTarget('t1')).toBe(false);
    expect(sm.hasTarget('t2')).toBe(true);

    sm.clearByAttacker('p1');
    expect(sm.hasTarget('t2')).toBe(false);
    expect(sm.hasAnyActiveBurns()).toBe(false);
  });

  it('9. Visual State priorisiert void vor normal', () => {
    const sm = new BurnStateMachine();
    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p1',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'k1',
      sourceId: 's1',
      visualStyle: 'normal',
      now: 0,
    });
    expect(sm.getVisualState('dummy', 0).visualStyle).toBe('normal');

    sm.applyHit({
      targetId: 'dummy',
      attackerId: 'p2',
      durationMs: 1000,
      damagePerTick: 5,
      sourceKey: 'k2',
      sourceId: 's2',
      visualStyle: 'void',
      now: 0,
    });
    expect(sm.getVisualState('dummy', 0).visualStyle).toBe('void');
    expect(sm.getVisualState('dummy', 0).stackCount).toBe(2);
  });
});
