import { describe, expect, it } from 'vitest';
import type { BomberSquadronUltimateConfig } from '../src/loadout/LoadoutTypes';
import {
  bomberCorridor, bomberDronePose, bomberDrops, bomberLaneOffsetPx, bomberLaneOrder,
  bomberLaunchAt, bomberPlanParamsFromConfig, bomberSquadronEndsAt, isBomberImpactInWorld,
  type BomberDronePose,
} from '../src/systems/bomberSquadron/BomberSquadronPlan';
import type { BomberSquadronDeploymentSnapshot } from '../src/systems/bomberSquadron/BomberSquadronSnapshot';

// Lokale Config-Fixtures: Lane A liefert den authored Content unabhängig von diesen Regeln.
const base: BomberSquadronUltimateConfig = {
  id: 'BOMBER_SQUADRON', type: 'bomber_squadron', cooldown: 0, rageRequired: 300, rageCost: 300,
  droneCount: 8, bombsPerPass: 6, secondPassEnabled: 0, launchIntervalMs: 250,
  approachMs: 600, approachDistancePx: 240, runSpeedPxPerSec: 400,
  corridorLeadPx: 48, corridorLengthPx: 640, corridorWidthPx: 560,
  turnMs: 1000, departureMs: 600, bombFallMs: 250,
  explosionRadius: 72, maxDamage: 24, minDamage: 8, fireChunksPerBomb: 0,
};
const full = { ...base, droneCount: 14, bombsPerPass: 9, secondPassEnabled: 1, fireChunksPerBomb: 3 };
const anchor = { x: 700, y: 900 };

function squadron(config = base, angle = Math.PI / 5): BomberSquadronDeploymentSnapshot {
  const facts = { id: 1, ownerId: 'inspector', ownerColor: 0x123456, startedAt: 100, angle,
    params: bomberPlanParamsFromConfig(config), anchors: Array(config.droneCount).fill(null), stoppedAt: null };
  return { ...facts, endsAt: bomberSquadronEndsAt(facts) };
}

function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe('BomberSquadronPlan', () => {
  it.each([
    [8, [3, 4, 2, 5, 1, 6, 0, 7]], [9, [4, 3, 5, 2, 6, 1, 7, 0, 8]], [1, [0]],
  ])('startet bei %i Bahnen in der Mitte und dann abwechselnd außen', (count, order) => {
    expect(bomberLaneOrder(count as number)).toEqual(order);
  });

  it.each([base, full])('verteilt alle Bahnen mittig über dieselbe Config-Breite ($droneCount Drohnen)', config => {
    const p = bomberPlanParamsFromConfig(config);
    const spacing = p.corridorWidthPx / p.droneCount;
    const offsets = Array.from({ length: p.droneCount }, (_, lane) => bomberLaneOffsetPx(p, lane));
    expect(offsets[0] - spacing / 2).toBeCloseTo(-p.corridorWidthPx / 2);
    expect(offsets[offsets.length - 1] + spacing / 2).toBeCloseTo(p.corridorWidthPx / 2);
    offsets.slice(1).forEach((offset, i) => expect(offset - offsets[i]).toBeCloseTo(spacing));
    expect(new Set(bomberLaneOrder(p.droneCount)).size).toBe(p.droneCount);
  });

  it('verankert jeden Korridor unabhängig bei gemeinsamer Richtung und korrekter Normale', () => {
    const s = squadron();
    const dir = { x: Math.cos(s.angle), y: Math.sin(s.angle) };
    const lanes = bomberLaneOrder(s.params.droneCount);
    for (let drone = 0; drone < s.params.droneCount; drone++) {
      const a = { x: anchor.x + drone * 23, y: anchor.y - drone * 17 };
      const c = bomberCorridor(s, drone, a);
      const offset = bomberLaneOffsetPx(s.params, lanes[drone]);
      expectPoint(c.dir, dir);
      expectPoint(c.normal, { x: -dir.y, y: dir.x });
      expectPoint(c.start, { x: a.x + dir.x * base.corridorLeadPx - dir.y * offset,
        y: a.y + dir.y * base.corridorLeadPx + dir.x * offset });
      expectPoint(c.end, { x: c.start.x + dir.x * base.corridorLengthPx,
        y: c.start.y + dir.y * base.corridorLengthPx });
    }
  });

  it.each([base, full])('berechnet mittige Abwürfe, Subframe-Zeiten und Rückflug aus Config ($secondPassEnabled)', config => {
    const s = squadron(config);
    const runMs = config.corridorLengthPx / config.runSpeedPxPerSec * 1000;
    const passCount = 1 + Number(config.secondPassEnabled > 0);
    let total = 0;
    for (let drone = 0; drone < config.droneCount; drone++) {
      const c = bomberCorridor(s, drone, anchor);
      const drops = bomberDrops(s, drone, anchor);
      expect(drops).toHaveLength(config.bombsPerPass * passCount);
      total += drops.length;
      expect(bomberLaunchAt(s, drone)).toBe(s.startedAt + drone * config.launchIntervalMs);
      drops.forEach((drop, i) => {
        const fraction = (drop.bomb + 0.5) / config.bombsPerPass;
        const distance = config.corridorLengthPx * (drop.pass === 0 ? fraction : 1 - fraction);
        expectPoint(drop, { x: c.start.x + c.dir.x * distance, y: c.start.y + c.dir.y * distance });
        expect(drop.dropAt).toBe(s.startedAt + drone * config.launchIntervalMs + config.approachMs
          + drop.pass * (runMs + config.turnMs) + runMs * fraction);
        expect(drop.impactAt - drop.dropAt).toBeCloseTo(config.bombFallMs);
        if (i > 0) expect(drop.dropAt).toBeGreaterThan(drops[i - 1].dropAt);
        const pose = bomberDronePose(s, drone, anchor, drop.dropAt)!;
        expectPoint(pose, drop);
        expect(pose.phase).toBe(drop.pass === 0 ? 'run' : 'return');
        expect(Math.cos(pose.heading - s.angle)).toBeCloseTo(drop.pass === 0 ? 1 : -1);
        if (drop.pass === 1) expectPoint(drop, drops[config.bombsPerPass - 1 - drop.bomb]);
      });
    }
    expect(total).toBe(config.droneCount * config.bombsPerPass * passCount);
  });

  it.each([base, full])('liefert Anflug, geraden Abflug, Alpha und wiederverwendbare Pose ($secondPassEnabled)', config => {
    const s = squadron(config), drone = config.droneCount - 1;
    const launchAt = bomberLaunchAt(s, drone);
    const c = bomberCorridor(s, drone, anchor);
    const runMs = config.corridorLengthPx / config.runSpeedPxPerSec * 1000;
    const departureAt = launchAt + config.approachMs + s.params.passCount * runMs
      + (s.params.passCount - 1) * config.turnMs;
    const out: BomberDronePose = { x: 0, y: 0, heading: 0, alpha: 0, phase: 'approach' };
    expect(bomberDronePose(s, drone, anchor, launchAt - 1, out)).toBeNull();
    expect(bomberDronePose(s, drone, anchor, launchAt, out)).toBe(out);
    expectPoint(out, { x: c.start.x - c.dir.x * config.approachDistancePx,
      y: c.start.y - c.dir.y * config.approachDistancePx });
    expect(out.alpha).toBe(0);
    expect(bomberDronePose(s, drone, anchor, launchAt + config.approachMs / 2)!.alpha).toBeCloseTo(0.5);
    const start = bomberDronePose(s, drone, anchor, launchAt + config.approachMs)!;
    expect(start.phase).toBe('run');
    expect(start.alpha).toBe(1);
    expectPoint(start, c.start);
    const departure = bomberDronePose(s, drone, anchor, departureAt)!;
    expect(departure.phase).toBe('departure');
    expect(departure.alpha).toBe(1);
    expectPoint(departure, s.params.passCount === 2 ? c.start : c.end);
    const halfway = bomberDronePose(s, drone, anchor, departureAt + config.departureMs / 2)!;
    const sign = s.params.passCount === 2 ? -1 : 1;
    const distance = config.runSpeedPxPerSec * config.departureMs / 2000;
    expectPoint(halfway, { x: departure.x + sign * c.dir.x * distance, y: departure.y + sign * c.dir.y * distance });
    expect(halfway.alpha).toBeCloseTo(0.5);
    expect(bomberDronePose(s, drone, anchor, departureAt + config.departureMs)).toBeNull();
  });

  it.each([8, 9])('wendet jede der %i Bahnen nach außen, stetig hinter E und zurück auf dieselbe Bahn', droneCount => {
    const s = squadron({ ...full, droneCount });
    const p = s.params, runMs = p.corridorLengthPx / p.runSpeedPxPerSec * 1000;
    const epsilon = 0.001;
    for (let drone = 0; drone < droneCount; drone++) {
      const c = bomberCorridor(s, drone, anchor);
      const turnAt = bomberLaunchAt(s, drone) + p.approachMs + runMs;
      const returnAt = turnAt + p.turnMs;
      const offset = bomberLaneOffsetPx(p, bomberLaneOrder(droneCount)[drone]);
      const side = offset > 0 ? 1 : -1;
      for (const boundary of [turnAt, returnAt]) {
        const before = bomberDronePose(s, drone, anchor, boundary - epsilon)!;
        const at = bomberDronePose(s, drone, anchor, boundary)!;
        const after = bomberDronePose(s, drone, anchor, boundary + epsilon)!;
        expectPoint(at, c.end);
        expect(Math.hypot(before.x - at.x, before.y - at.y)).toBeLessThan(0.001);
        expect(Math.hypot(after.x - at.x, after.y - at.y)).toBeLessThan(0.001);
        expect(Math.cos(before.heading - after.heading)).toBeCloseTo(1, 8);
        expect((at.x - before.x) / epsilon).toBeCloseTo((after.x - at.x) / epsilon, 4);
        expect((at.y - before.y) / epsilon).toBeCloseTo((after.y - at.y) / epsilon, 4);
      }
      expect(bomberDronePose(s, drone, anchor, turnAt)!.phase).toBe('turn');
      expect(bomberDronePose(s, drone, anchor, returnAt)!.phase).toBe('return');
      for (let step = 1; step < 100; step++) {
        const t = turnAt + p.turnMs * step / 100;
        const pose = bomberDronePose(s, drone, anchor, t)!;
        const before = bomberDronePose(s, drone, anchor, t - epsilon)!;
        const after = bomberDronePose(s, drone, anchor, t + epsilon)!;
        expect(pose.phase).toBe('turn');
        expect(pose.alpha).toBe(1);
        expect((pose.x - c.end.x) * c.dir.x + (pose.y - c.end.y) * c.dir.y).toBeGreaterThan(0);
        expect(side * ((pose.x - c.end.x) * c.normal.x + (pose.y - c.end.y) * c.normal.y)).toBeGreaterThan(0);
        const tangent = Math.atan2(after.y - before.y, after.x - before.x);
        expect(Math.cos(tangent - pose.heading)).toBeCloseTo(1, 8);
        expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0);
      }
    }
  });

  it.each([base, full])('berechnet das Ende aus allen geplanten Starts, nach Stopp nur aus vorhandenen Ankern ($secondPassEnabled)', config => {
    const s = squadron(config);
    const runMs = config.corridorLengthPx / config.runSpeedPxPerSec * 1000;
    const expected = s.startedAt + (config.droneCount - 1) * config.launchIntervalMs + config.approachMs
      + (s.params.passCount - 1) * (runMs + config.turnMs)
      + runMs * ((config.bombsPerPass - 0.5) / config.bombsPerPass) + config.bombFallMs;
    expect(bomberSquadronEndsAt(s)).toBe(expected);
    const anchors = s.anchors.map((_, i) => i < 2 ? anchor : null);
    const stopped = { ...s, anchors, stoppedAt: bomberLaunchAt(s, 3) };
    const drops = bomberDrops(s, 1, anchor);
    expect(bomberSquadronEndsAt(stopped)).toBe(drops[drops.length - 1].impactAt);
    expect(bomberSquadronEndsAt({ ...stopped, stoppedAt: bomberLaunchAt(s, 1) }))
      .toBe(bomberDrops(s, 0, anchor).slice(-1)[0].impactAt);
    expect(bomberSquadronEndsAt({ ...s, stoppedAt: s.startedAt })).toBe(s.startedAt);
  });

  it('prüft World-Grenzen halb offen, einschließlich optionaler WorldMetrics-Offsets', () => {
    const bounds = { width: 800, height: 600 };
    expect(isBomberImpactInWorld(0, 0, bounds)).toBe(true);
    expect(isBomberImpactInWorld(bounds.width - 0.001, bounds.height - 0.001, bounds)).toBe(true);
    for (const [x, y] of [[-0.001, 0], [0, -0.001], [bounds.width, 0], [0, bounds.height], [NaN, 0]]) {
      expect(isBomberImpactInWorld(x, y, bounds)).toBe(false);
    }
    const offsetBounds = { ...bounds, offsetX: 50, offsetY: 30 };
    expect(isBomberImpactInWorld(50, 30, offsetBounds)).toBe(true);
    expect(isBomberImpactInWorld(0, 0, offsetBounds)).toBe(false);
    expect(isBomberImpactInWorld(50 + bounds.width, 30, offsetBounds)).toBe(false);
  });
});
