import { describe, expect, it } from 'vitest';
import { FORMATIONS, START, STEP, summarize, ultimateHarness } from './InspectorUltimateHarness';
import { inspectorUltimate } from './InspectorUltimateConfigs';

describe('Bomber squadron production-rule benchmark', () => {
  it('reports base/full damage, relief and overlap including chunk landings and burn tails', () => {
    const rows = [];
    for (const formation of FORMATIONS) for (const full of [false, true]) {
      const config = inspectorUltimate('BOMBER_SQUADRON', full);
      if (config.type !== 'bomber_squadron') throw Error('Expected bomber config');
      const h = ultimateHarness(formation);
      try {
        expect(h.bomber.runtime.tryActivate({ playerId: 'inspector', nowMs: START, angle: 0, config })).toEqual({ ok: true });
        for (let at = START; at <= START + 30000; at += STEP) h.advance(at);
        expect(h.bomber.runtime.getSnapshot().squadrons).toEqual([]);
        const row = { ...summarize(h, `${formation}/${full ? 'full' : 'base'}`, formation === 'boss' || formation === 'base' ? 10000 : 100),
          rage: config.rageCost, windowMs: 30000, config,
          expectedBombs: config.droneCount * config.bombsPerPass * (1 + config.secondPassEnabled) };
        expect(row.totalDamage).toBeGreaterThan(0);
        expect(Number.isFinite(row.totalDamage)).toBe(true);
        expect(h.explosionBroadcast).not.toHaveBeenCalled();
        rows.push(row);
      } finally { h.destroy(); }
    }
    console.info('BOMBER_SQUADRON_BENCHMARK ' + JSON.stringify(rows));
  }, 60000);
});
