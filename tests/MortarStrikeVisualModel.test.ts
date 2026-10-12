import { describe, expect, it } from 'vitest';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import type { SyncedMortarStrike } from '../src/types';
import { mortarFireDirection, mortarStrikePhase, MortarStrikePresentationTimeline,
  MORTAR_THUMP_JOIN_WINDOW_MS } from '../src/effects/mortarStrikeVisualModel';

const config = getCoopDefenseEnemyConfig('mortar-badger').mortar!;
const strike: SyncedMortarStrike = { id: 7, sourceEnemyId: 'mortar', sourceX: 800, sourceY: 50,
  targetX: 0, targetY: 50, radius: config.impactRadiusPx, armedAt: 100,
  launchAt: 100 + config.windupMs, impactAt: 100 + config.windupMs + config.flightMs, faction: 'hostile' };

describe('mortar presentation timeline', () => {
  it('derives progress and exact boundaries from absolute timestamps', () => {
    expect(mortarStrikePhase(strike, strike.armedAt - 1).phase).toBe('pending');
    expect(mortarStrikePhase(strike, strike.armedAt + config.windupMs / 2)).toMatchObject({ phase: 'windup', windup: 0.5 });
    expect(mortarStrikePhase(strike, strike.launchAt)).toMatchObject({ phase: 'flight', flight: 0, windup: 1 });
    expect(mortarStrikePhase(strike, strike.impactAt).phase).toBe('finished');
  });

  it('plays THUMP exactly once for an observed launch, even across delayed/repeated snapshots', () => {
    const timeline = new MortarStrikePresentationTimeline();
    expect(timeline.sample([strike], strike.launchAt - 1)[0].thump).toBe(false);
    expect(timeline.sample([strike], strike.launchAt + MORTAR_THUMP_JOIN_WINDOW_MS + 1)[0].thump).toBe(true);
    expect(timeline.sample([strike], strike.launchAt + 200)[0].thump).toBe(false);
    timeline.sample([], strike.launchAt + 210);
    expect(timeline.sample([strike], strike.launchAt + 220)[0].thump).toBe(false);
    expect(timeline.sample([strike], strike.impactAt)).toEqual([]);
  });

  it('allows the short join window but does not replay a late THUMP or its flash/shell', () => {
    for (const [age, expected] of [[0, true], [MORTAR_THUMP_JOIN_WINDOW_MS, true],
      [MORTAR_THUMP_JOIN_WINDOW_MS + 1, false]] as const) {
      const timeline = new MortarStrikePresentationTimeline();
      expect(timeline.sample([strike], strike.launchAt + age)[0]).toMatchObject({ thump: expected, showLaunch: expected });
      expect(timeline.sample([strike], strike.launchAt + age)[0].thump).toBe(false);
    }
  });

  it('removes a killed windup immediately and never emits its THUMP', () => {
    const timeline = new MortarStrikePresentationTimeline();
    timeline.sample([strike], strike.armedAt);
    expect(timeline.sample([], strike.launchAt - 1)).toEqual([]);
    expect(timeline.sample([strike], strike.launchAt)).toEqual([]);
    timeline.clear();
    expect(timeline.sample([strike], strike.launchAt)[0].thump).toBe(true);
  });
});

describe('mortar direction of fire', () => {
  it('points from the aim point toward the shooter, in world space', () => {
    const toward = (s: SyncedMortarStrike) => { const a = mortarFireDirection(s); return { x: Math.cos(a), y: Math.sin(a) }; };
    expect(toward(strike).x).toBeCloseTo(1); // shooter east of the aim point
    expect(toward({ ...strike, sourceX: strike.targetX, sourceY: strike.targetY - 500 }).y).toBeCloseTo(-1);
    expect(toward({ ...strike, sourceX: strike.targetX - 300, sourceY: strike.targetY + 300 }).x).toBeCloseTo(-Math.SQRT1_2);
  });
});
