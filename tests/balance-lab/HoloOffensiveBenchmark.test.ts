import { describe, expect, it } from 'vitest';
import { FORMATIONS, START, STEP, summarize, ultimateHarness } from './InspectorUltimateHarness';
import { HOLO_RAGE, inspectorUltimate } from './InspectorUltimateConfigs';

describe('Holo offensive production-rule benchmark', () => {
  it('reports single-original and mixed-arsenal deployments at 600 rage across four target formations', () => {
    const rows = [];
    for (const formation of FORMATIONS) for (const arsenal of ['single', 'mixed'] as const) for (const full of [false, true]) {
      const config = inspectorUltimate('HOLO_OFFENSIVE', full);
      if (config.type !== 'holo_offensive') throw Error('Expected Holo config');
      const h = ultimateHarness(formation);
      try {
        h.addArsenal(arsenal);
        expect(h.f.binding.getHoloOffensiveCapability()!.tryActivate({ playerId: 'inspector', nowMs: START,
          config, consumedRage: HOLO_RAGE })).toEqual({ ok: true });
        const spawnMs = HOLO_RAGE / config.ragePerSpawnSecond * 1000;
        // Same 30 s observation window for every build, including projectile and burn tails.
        for (let at = START; at <= START + 30000; at += STEP) h.advance(at, false);
        expect(h.f.binding.getFireControlSnapshot(START + 30000).deployments).toEqual([]);
        const row = { ...summarize(h, `${formation}/${arsenal}/${full ? 'full' : 'base'}`, formation === 'boss' || formation === 'base' ? 10000 : 100),
          rage: HOLO_RAGE, windowMs: 30000, config, expectedSpawns: Math.ceil(spawnMs / config.spawnIntervalMs),
          scope: 'ultimate copies only; neutral original turret upgrades' };
        expect(row.totalDamage).toBeGreaterThan(0);
        expect(Number.isFinite(row.totalDamage)).toBe(true);
        rows.push(row);
      } finally { h.destroy(); }
    }
    console.info('HOLO_OFFENSIVE_BENCHMARK ' + JSON.stringify(rows));
  }, 60000);
});
