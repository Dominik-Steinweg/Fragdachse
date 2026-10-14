import { describe, expect, it } from 'vitest';
import {
  AIRSTRIKE_RUN_FALL_MS,
  planAirstrikeRun,
  resolveAirstrikeRunGeometry,
  resolveAirstrikeRunLeadPx,
  resolveScheduledAirstrikeRuns,
} from '../src/systems/AirstrikeRun';
import type { ResolvedCoopDefenseMapEventConfig } from '../src/config/coopDefenseMaps';
import { CELL_SIZE } from '../src/config';

const area = { gridX: 40, gridY: 20, widthCells: 49, heightCells: 49 };
const metrics = { offsetX: 64, offsetY: 32 };
const event = (overrides: Partial<ResolvedCoopDefenseMapEventConfig> = {}) => ({
  id: 'run', type: 'airstrike', start: { type: 'time', atMs: 12_000 }, delayMs: 500, pattern: 'zone-barrage',
  strikeCount: 6, area, orderedSweep: false, run: { headingDeg: 20, offsetRatio: 0.4, speedPxPerSec: 300 }, ...overrides,
}) as ResolvedCoopDefenseMapEventConfig;

describe('airstrike bomber run (D-47)', () => {
  it('puts every bomb on the chord inside the zone, in flight order', () => {
    for (const headingDeg of [0, 37, 90, 181, 270, 333]) for (const offsetRatio of [-0.9, 0, 0.55]) {
      const geometry = resolveAirstrikeRunGeometry(area, { headingDeg, offsetRatio, speedPxPerSec: 300 }, metrics);
      expect(geometry.lengthPx, `${headingDeg}/${offsetRatio}`).toBeGreaterThan(0);
      const plan = planAirstrikeRun(geometry, 6);
      for (const point of plan) {
        expect(point.x).toBeGreaterThanOrEqual(metrics.offsetX + area.gridX * CELL_SIZE);
        expect(point.x).toBeLessThanOrEqual(metrics.offsetX + (area.gridX + area.widthCells) * CELL_SIZE);
        expect(point.y).toBeGreaterThanOrEqual(metrics.offsetY + area.gridY * CELL_SIZE);
        expect(point.y).toBeLessThanOrEqual(metrics.offsetY + (area.gridY + area.heightCells) * CELL_SIZE);
      }
      expect(plan.map(point => point.launchOffsetMs)).toEqual([...plan.map(point => point.launchOffsetMs)].sort((a, b) => a - b));
      expect(plan[0].launchOffsetMs).toBe(0);
    }
  });

  it('flies the formation lead over each bomb just before it hits, on every peer from the definition alone', () => {
    const [run] = resolveScheduledAirstrikeRuns([event()], metrics);
    expect(run.launchAtMs).toBe(12_500);
    const strikeDelayMs = 2000;
    for (const point of planAirstrikeRun(run.geometry, run.strikeCount)) {
      const impactAtMs = run.launchAtMs + point.launchOffsetMs + strikeDelayMs;
      const lead = resolveAirstrikeRunLeadPx(run, strikeDelayMs, impactAtMs - AIRSTRIKE_RUN_FALL_MS);
      const leadX = run.geometry.startX + run.geometry.dirX * lead, leadY = run.geometry.startY + run.geometry.dirY * lead;
      expect(Math.hypot(leadX - point.x, leadY - point.y)).toBeLessThan(1);
    }
    // Seconds ahead of the first impact the formation is still on its way in.
    expect(resolveAirstrikeRunLeadPx(run, strikeDelayMs, run.launchAtMs + strikeDelayMs - 4000)).toBeLessThan(-900);
  });

  it('only schedules runs whose launch time every peer can know', () => {
    expect(resolveScheduledAirstrikeRuns([
      event({ id: 'scatter', run: undefined } as Partial<ResolvedCoopDefenseMapEventConfig>),
      event({ id: 'later', start: { type: 'after-event', eventId: 'scatter' } } as Partial<ResolvedCoopDefenseMapEventConfig>),
      event({ id: 'timed' }),
    ], metrics).map(run => run.eventId)).toEqual(['timed']);
  });
});
