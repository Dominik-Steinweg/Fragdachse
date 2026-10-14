import { describe, expect, it } from 'vitest';
import type { BomberSquadronUltimateConfig } from '../src/loadout/LoadoutTypes';
import {
  bomberDroneEntryPoint, bomberDroneFlightEndAt, chooseBomberAim, isBomberFlightPlanValid,
  bomberCorridor, bomberDronePose, bomberDrops, bomberLaneOffsetPx, bomberLaneOrder,
  bomberLaunchAt, bomberPlanParamsFromConfig, bomberSquadronEndsAt, isBomberImpactInWorld,
  type BomberDronePose,
} from '../src/systems/bomberSquadron/BomberSquadronPlan';
import type { BomberSquadronDeploymentSnapshot } from '../src/systems/bomberSquadron/BomberSquadronSnapshot';

import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';
const base = ULTIMATE_CONFIGS.BOMBER_SQUADRON as BomberSquadronUltimateConfig;
const full = { ...base, droneCount: 14, bombsPerPass: 9, secondPassEnabled: 1, fireChunksPerBomb: 3 };
const anchor = { x: 700, y: 900, aimOffset: 0, aimAngle: 0 };

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
  it('validiert den Bremsweg und endliche, begrenzte Flugparameter', () => {
    const p = bomberPlanParamsFromConfig(base);
    expect(isBomberFlightPlanValid(p)).toBe(true);
    const minimum = 1.1 * p.runSpeedPxPerSec * p.approachMs / 1000;
    expect(isBomberFlightPlanValid({ ...p, approachDistancePx: minimum })).toBe(true);
    for (const change of [{ approachDistancePx: minimum - 1 }, { approachMs: 0 }, { swayPx: NaN },
      { aimOffsetSteps: 1.5 }, { aimAngleSteps: 0 }, { departureMs: 0 }]) {
      expect(isBomberFlightPlanValid({ ...p, ...change })).toBe(false);
    }
  });

  it.each([base, full])('fliegt deterministisch von außen ein und verbindet alle Phasen stetig ($secondPassEnabled)', config => {
    const s = squadron(config), p = s.params, runMs = p.corridorLengthPx / p.runSpeedPxPerSec * 1000;
    const entries = [];
    for (let drone = 0; drone < p.droneCount; drone++) {
      const launch = bomberLaunchAt(s, drone), c = bomberCorridor(s, drone, anchor);
      const entry = bomberDroneEntryPoint(s, drone, anchor);
      expect(Math.hypot(entry.x - c.start.x, entry.y - c.start.y)).toBeGreaterThanOrEqual(p.approachDistancePx - p.entrySpreadPx);
      expect(Math.abs(entry.x - anchor.x) > 1600 / 2 || Math.abs(entry.y - anchor.y) > 1000 / 2).toBe(true);
      entries.push({ x: entry.x - c.start.x, y: entry.y - c.start.y });
      const arrival = launch + p.approachMs;
      expectPoint(bomberDronePose(s, drone, anchor, arrival)!, c.start);
      const before = bomberDronePose(s, drone, anchor, arrival - 1)!;
      expect(Math.hypot(c.start.x - before.x, c.start.y - before.y) * 1000).toBeCloseTo(p.runSpeedPxPerSec, 0);
      const boundaries = [arrival, arrival + runMs];
      if (p.passCount === 2) boundaries.push(arrival + runMs + p.turnMs, arrival + 2 * runMs + p.turnMs);
      for (const boundary of boundaries) {
        const samples = [-2, -1, 0, 1, 2].map(dt => bomberDronePose(s, drone, anchor, boundary + dt)!);
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1], b = samples[i];
          expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(p.runSpeedPxPerSec / 1000 * 1.05);
          expect(Math.abs(Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading))))
            .toBeLessThan(2 * Math.PI / Math.min(p.approachMs, p.turnMs, p.departureMs));
        }
      }
      for (const t of [launch, arrival / 2 + launch / 2, arrival, bomberDroneFlightEndAt(s, drone) - 1]) {
        const pose = bomberDronePose(s, drone, anchor, t)!;
        expect(bomberDronePose(structuredClone(s), drone, { ...anchor }, t)).toEqual(pose);
        expect(Math.abs(pose.bank)).toBeLessThanOrEqual(1);
      }
      const initial = bomberDronePose(s, drone, anchor, launch)!;
      expect(Math.cos(initial.heading - s.angle)).toBeGreaterThan(Math.cos((p.entryAngleSpreadDeg + 5) * Math.PI / 180));
    }
    expect(new Set(entries.map(e => `${e.x},${e.y}`)).size).toBe(p.droneCount);
  });

  it('wählt begrenzt und deterministisch, ohne erreichbare Ziele unverändert, mit Cluster zum Schaden hin', () => {
    const s = squadron(base, 0), p = s.params, bounds = { width: 5000, height: 5000 };
    const c = bomberCorridor(s, 0, anchor), planned = { aimOffset: 0, aimAngle: 0 };
    expect(chooseBomberAim(s, 0, anchor, [], [], bounds)).toEqual(planned);
    expect(chooseBomberAim(s, 0, anchor, [{ x: 1e6, y: 1e6, weight: 1 }], [], bounds)).toEqual(planned);
    const target = { x: c.start.x + p.corridorLengthPx / 2, y: c.start.y + p.aimOffsetPx, weight: 1 };
    const aim = chooseBomberAim(s, 0, anchor, [target], [], bounds);
    expect(aim).toEqual(chooseBomberAim(structuredClone(s), 0, anchor, [target], [], bounds));
    expect(Math.abs(aim.aimOffset)).toBeLessThanOrEqual(p.aimOffsetPx);
    expect(Math.abs(aim.aimAngle)).toBeLessThanOrEqual(p.aimAngleDeg * Math.PI / 180);
    const score = (a: typeof planned) => bomberDrops(s, 0, { ...anchor, ...a }).filter(b => b.pass === 0)
      .reduce((sum, b) => sum + Math.max(0, 1 - Math.hypot(b.x - target.x, b.y - target.y) / p.explosionRadius), 0);
    expect(score(aim)).toBeGreaterThan(score(planned));
    expect(chooseBomberAim(s, 0, anchor, [target], [], { width: 1, height: 1 })).toEqual(planned);
    // S bleibt der Drehpunkt; der zweite Überflug nutzt exakt dieselben Punkte rückwärts.
    const aimed = bomberCorridor(s, 0, { ...anchor, ...aim });
    expectPoint(aimed.start, { x: c.start.x, y: c.start.y + aim.aimOffset });
  });

  it('bestraft Überlappung mit bereits gestarteten Drohnen bei einem dichten Cluster', () => {
    const s = squadron(full, 0), p = s.params, bounds = { width: 5000, height: 5000 };
    const targets = Array.from({ length: p.bombsPerPass }, (_, i) => ({
      x: anchor.x + p.corridorLeadPx + p.corridorLengthPx * (i + 0.5) / p.bombsPerPass,
      y: anchor.y, weight: 1,
    }));
    const impacts: { x: number; y: number }[] = [], lanes: { x: number; y: number }[] = [];
    for (let drone = 0; drone < p.droneCount; drone++) {
      const aim = chooseBomberAim(s, drone, anchor, targets, impacts, bounds);
      const allDrops = bomberDrops(s, drone, { ...anchor, ...aim });
      const drops = allDrops.filter(b => b.pass === 0);
      impacts.push(...allDrops);
      lanes.push(drops[Math.floor(p.bombsPerPass / 2)]);
    }
    let minimum = Infinity;
    for (let i = 0; i < lanes.length; i++) for (let j = 0; j < i; j++) {
      minimum = Math.min(minimum, Math.hypot(lanes[i].x - lanes[j].x, lanes[i].y - lanes[j].y));
    }
    expect(minimum).toBeGreaterThan(0.4 * p.corridorWidthPx / p.droneCount);
  });
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
      const a = { ...anchor, x: anchor.x + drone * 23, y: anchor.y - drone * 17 };
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
    const flightAnchor = { ...anchor, aimOffset: config.aimOffsetPx, aimAngle: config.aimAngleDeg * Math.PI / 180 };
    const runMs = config.corridorLengthPx / config.runSpeedPxPerSec * 1000;
    const passCount = 1 + Number(config.secondPassEnabled > 0);
    let total = 0;
    for (let drone = 0; drone < config.droneCount; drone++) {
      const c = bomberCorridor(s, drone, flightAnchor);
      const drops = bomberDrops(s, drone, flightAnchor);
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
        const pose = bomberDronePose(s, drone, flightAnchor, drop.dropAt)!;
        expectPoint(pose, drop);
        expect(pose.phase).toBe(drop.pass === 0 ? 'run' : 'return');
        expect(Math.cos(pose.heading - s.angle - flightAnchor.aimAngle)).toBeCloseTo(drop.pass === 0 ? 1 : -1);
        if (drop.pass === 1) expectPoint(drop, drops[config.bombsPerPass - 1 - drop.bomb]);
      });
    }
    expect(total).toBe(config.droneCount * config.bombsPerPass * passCount);
  });

  it.each([base, full])('liefert Anflug, beschleunigten Abflug, Alpha und wiederverwendbare Pose ($secondPassEnabled)', config => {
    const s = squadron(config), drone = config.droneCount - 1;
    const launchAt = bomberLaunchAt(s, drone);
    const c = bomberCorridor(s, drone, anchor);
    const runMs = config.corridorLengthPx / config.runSpeedPxPerSec * 1000;
    const departureAt = launchAt + config.approachMs + s.params.passCount * runMs
      + (s.params.passCount - 1) * config.turnMs;
    const out: BomberDronePose = { x: 0, y: 0, heading: 0, alpha: 0, phase: 'approach' };
    expect(bomberDronePose(s, drone, anchor, launchAt - 1, out)).toBeNull();
    expect(bomberDronePose(s, drone, anchor, launchAt, out)).toBe(out);
    const entry = bomberDroneEntryPoint(s, drone, anchor);
    expect(Math.hypot(out.x - entry.x, out.y - entry.y)).toBeLessThanOrEqual(config.swayPx);
    expect(out.alpha).toBe(1);
    expect(bomberDronePose(s, drone, anchor, launchAt + config.approachMs / 2)!.alpha).toBe(1);
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
    expect(sign * ((halfway.x - departure.x) * c.dir.x + (halfway.y - departure.y) * c.dir.y))
      .toBeGreaterThan(config.runSpeedPxPerSec * config.departureMs / 2000);
    expect(halfway.alpha).toBe(1);
    expect(bomberDronePose(s, drone, anchor, departureAt + config.departureMs - 150)!.alpha).toBeCloseTo(0.5);
    expect(bomberDroneFlightEndAt(s, drone)).toBe(departureAt + config.departureMs);
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
        expect(Math.cos(tangent - pose.heading)).toBeCloseTo(1, 5);
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
