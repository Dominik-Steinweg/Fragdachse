import { describe, expect, it } from 'vitest';
import type { BomberSquadronUltimateConfig } from '../src/loadout/LoadoutTypes';
import { bomberCorridor, bomberDrops, bomberLaunchAt, isBomberImpactInWorld } from '../src/systems/bomberSquadron/BomberSquadronPlan';
import { BomberSquadronRuntime, type BomberSquadronBombEvent } from '../src/systems/bomberSquadron/BomberSquadronRuntime';
import { bomberSquadronBombKey, EMPTY_BOMBER_SQUADRON_SNAPSHOT } from '../src/systems/bomberSquadron/BomberSquadronSnapshot';

import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';
const base = ULTIMATE_CONFIGS.BOMBER_SQUADRON as BomberSquadronUltimateConfig;
const full = { ...base, droneCount: 14, bombsPerPass: 9, secondPassEnabled: 1, fireChunksPerBomb: 3 };

function fixture(config = base, bounds = { width: 5000, height: 5000 }, targets: { x: number; y: number; weight: number }[] = []) {
  const owners = new Map([['inspector', { x: 1000, y: 1000, color: 0x123456 }],
    ['other', { x: 1500, y: 1500, color: 0xabcdef }]]);
  const runtime = new BomberSquadronRuntime({ readOwner: id => owners.get(id) ?? null, readTargets: () => targets, worldBounds: () => bounds });
  const activate = (playerId = 'inspector', nowMs = 100, angle = 0) => runtime.tryActivate({ playerId, nowMs, angle, config });
  return { runtime, owners, activate, bounds };
}

function expectOrdered(events: readonly BomberSquadronBombEvent[]) {
  for (let i = 1; i < events.length; i++) expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
}

describe('BomberSquadronRuntime', () => {
  it('fixiert die Ausrichtung beim Start und liefert jede ausgerichtete Bombe genau einmal', () => {
    const targets = [{ x: 1300, y: 1070, weight: 1 }];
    const f = fixture(full, { width: 5000, height: 5000 }, targets);
    f.activate();
    const initial = f.runtime.getSnapshot().squadrons[0], first = initial.anchors[0]!;
    expect(Math.abs(first.aimAngle) + Math.abs(first.aimOffset)).toBeGreaterThan(0);
    const planned = new Map<string, ReturnType<typeof bomberDrops>[number]>();
    const collect = () => {
      const s = f.runtime.getSnapshot().squadrons[0];
      if (!s) return;
      s.anchors.forEach((a, drone) => { if (a) for (const bomb of bomberDrops(s, drone, a)) {
        planned.set(bomberSquadronBombKey(s.id, drone, bomb.pass, bomb.bomb), bomb);
      } });
      expect(s.anchors[0]).toEqual(first);
    };
    collect();
    const events: BomberSquadronBombEvent[] = [];
    const frames = [0, 17, 91, 377];
    let frame = 0;
    for (let now = initial.startedAt; now < initial.endsAt; now += frames[frame++ % frames.length]) {
      targets[0].y += 1;
      events.push(...f.runtime.update(now)); collect();
      expect(f.runtime.update(now)).toEqual([]);
    }
    events.push(...f.runtime.update(initial.endsAt));
    const expectedCount = full.droneCount * full.bombsPerPass * (1 + full.secondPassEnabled);
    expect(planned.size).toBe(expectedCount);
    for (const kind of ['drop', 'impact'] as const) {
      const actual = events.filter(e => e.kind === kind);
      expect(actual).toHaveLength(expectedCount);
      expect(new Set(actual.map(e => e.bombKey)).size).toBe(expectedCount);
      for (const e of actual) expect(e).toMatchObject(planned.get(e.bombKey)!);
    }
  });
  it('blockiert fehlende Besitzer und zweite Staffeln; friert Fakten und Schadenswerte ein', () => {
    const config = { ...full };
    const f = fixture(config);
    expect(f.runtime.getSnapshot()).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
    expect(f.activate('missing')).toEqual({ ok: false, reason: 'blocked' });
    expect(f.runtime.isActive('missing')).toBe(false);
    expect(f.activate()).toEqual({ ok: true });
    expect(f.activate()).toEqual({ ok: false, reason: 'blocked' });
    const snapshot = f.runtime.getSnapshot(), s = snapshot.squadrons[0];
    expect(f.runtime.getSnapshot()).toBe(snapshot);
    expect(s).toMatchObject({ ownerId: 'inspector', ownerColor: f.owners.get('inspector')!.color,
      startedAt: 100, angle: 0, stoppedAt: null });
    expect(s.anchors).toHaveLength(config.droneCount);
    expect(s.anchors[0]).toEqual({ x: 1000, y: 1000, aimOffset: 0, aimAngle: 0 });
    expect(s.anchors.slice(1).every(a => a === null)).toBe(true);
    const originalCount = config.droneCount, originalDamage = config.maxDamage;
    config.droneCount += 20;
    config.maxDamage *= 10;
    config.bombsPerPass += 30;
    expect(s.params.droneCount).toBe(originalCount);
    f.runtime.update(s.startedAt + s.params.launchIntervalMs / 2);
    expect(f.runtime.getSnapshot()).toBe(snapshot);
    const events = f.runtime.update(s.endsAt);
    expect(events.every(e => e.config.maxDamage === originalDamage)).toBe(true);
    expect(s.anchors.slice(1).every(a => a === null)).toBe(true);
    expect(f.runtime.isActive('inspector')).toBe(false);
  });

  it('erfasst Bewegung an jedem Anflugstart und verändert bereits verankerte Bahnen nicht', () => {
    const f = fixture();
    f.activate();
    const initial = f.runtime.getSnapshot(), s = initial.squadrons[0];
    const first = bomberCorridor(s, 0, s.anchors[0]!);
    const owner = f.owners.get('inspector')!;
    for (let drone = 1; drone < base.droneCount; drone++) {
      owner.x += 31;
      owner.y += 17;
      const launchAt = bomberLaunchAt(s, drone);
      f.runtime.update(launchAt - 0.001);
      expect(f.runtime.getSnapshot().squadrons[0].anchors[drone]).toBeNull();
      f.runtime.update(launchAt);
      const current = f.runtime.getSnapshot().squadrons[0];
      expect(current.anchors[drone]).toEqual({ x: owner.x, y: owner.y, aimOffset: 0, aimAngle: 0 });
      expect(bomberCorridor(current, 0, current.anchors[0]!)).toEqual(first);
    }
    expect(initial.squadrons[0].anchors.slice(1).every(a => a === null)).toBe(true);
    const snapshot = f.runtime.getSnapshot();
    f.runtime.update(bomberLaunchAt(s, base.droneCount - 1) + 1);
    expect(f.runtime.getSnapshot()).toBe(snapshot);
  });

  it.each([base, full])('liefert jede Bombe genau einmal trotz ungleichmäßiger Frames ($secondPassEnabled)', config => {
    const f = fixture(config);
    f.activate();
    const s = f.runtime.getSnapshot().squadrons[0];
    const anchor = s.anchors[0]!;
    const expected = Array.from({ length: config.droneCount }, (_, drone) => bomberDrops(s, drone, anchor)).flat();
    let seed = 0xbee, now = s.startedAt;
    const events: BomberSquadronBombEvent[] = [];
    while (now <= s.endsAt) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      now += 1 + seed % 719;
      const due = f.runtime.update(now);
      expectOrdered(due);
      expect(due.every(e => e.at <= now)).toBe(true);
      events.push(...due);
      expect(f.runtime.update(now)).toEqual([]);
    }
    expectOrdered(events);
    const count = config.droneCount * config.bombsPerPass * (1 + Number(config.secondPassEnabled > 0));
    const drops = events.filter(e => e.kind === 'drop'), impacts = events.filter(e => e.kind === 'impact');
    expect(drops).toHaveLength(count);
    expect(impacts).toHaveLength(count);
    expect(new Set(drops.map(e => e.bombKey)).size).toBe(count);
    expect(new Set(impacts.map(e => e.bombKey)).size).toBe(count);
    for (const planned of expected) {
      const bombKey = bomberSquadronBombKey(s.id, planned.drone, planned.pass, planned.bomb);
      expect(drops.find(e => e.bombKey === bombKey)).toMatchObject({ ...planned, bombKey,
        ownerId: s.ownerId, squadronId: s.id, at: planned.dropAt });
      expect(impacts.find(e => e.bombKey === bombKey)).toMatchObject({ ...planned, bombKey,
        ownerId: s.ownerId, squadronId: s.id, at: planned.impactAt });
    }
    expect(f.runtime.isActive(s.ownerId)).toBe(false);
    expect(f.runtime.getSnapshot()).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
  });

  it('holt alle Termine auch in einem einzigen Frame bis zum Ende nach und sortiert mehrere Besitzer gemeinsam', () => {
    const f = fixture(full);
    f.activate();
    f.activate('other', 101, Math.PI / 3);
    const squadrons = f.runtime.getSnapshot().squadrons;
    const end = Math.max(...squadrons.map(s => s.endsAt));
    const events = f.runtime.update(end);
    expectOrdered(events);
    for (const s of squadrons) {
      expect(events.filter(e => e.ownerId === s.ownerId))
        .toHaveLength(s.params.droneCount * s.params.bombsPerPass * s.params.passCount * 2);
    }
    expect(f.runtime.update(end + 1)).toEqual([]);
    expect(f.runtime.getSnapshot().squadrons).toEqual([]);
  });

  it('liefert bei gleichzeitigem Abwurf und Einschlag den Abwurf zuerst', () => {
    const f = fixture({ ...base, bombFallMs: 0, launchIntervalMs: 0 });
    f.activate();
    const s = f.runtime.getSnapshot().squadrons[0];
    const events = f.runtime.update(s.endsAt);
    expect(events).toHaveLength(base.droneCount * base.bombsPerPass * 2);
    expectOrdered(events);
    for (const impact of events.filter(e => e.kind === 'impact')) {
      expect(events.findIndex(e => e.bombKey === impact.bombKey && e.kind === 'drop')).toBeLessThan(events.indexOf(impact));
    }
  });

  it.each([false, true])('verwirft Bomben außerhalb der World, ohne das nominelle Ende zu verkürzen (alle außerhalb: %s)', allOutside => {
    const bounds = { width: 1300, height: 1200 };
    const f = fixture(full, bounds);
    if (allOutside) f.owners.get('inspector')!.x = bounds.width;
    f.activate();
    const s = f.runtime.getSnapshot().squadrons[0];
    const planned = Array.from({ length: full.droneCount }, (_, i) => bomberDrops(s, i, s.anchors[0]!)).flat();
    const inside = planned.filter(drop => isBomberImpactInWorld(drop.x, drop.y, bounds));
    expect(inside.length).toBeLessThan(planned.length);
    if (allOutside) expect(inside).toHaveLength(0);
    else expect(inside.length).toBeGreaterThan(0);
    const early = f.runtime.update(s.endsAt - 0.001);
    expect(f.runtime.isActive(s.ownerId)).toBe(true);
    expect(f.runtime.getSnapshot().squadrons[0].endsAt).toBe(s.endsAt);
    const events = [...early, ...f.runtime.update(s.endsAt)];
    expect(events.filter(e => e.kind === 'drop')).toHaveLength(inside.length);
    expect(events.filter(e => e.kind === 'impact')).toHaveLength(inside.length);
    expect(events.every(e => isBomberImpactInWorld(e.x, e.y, bounds))).toBe(true);
    expect(f.runtime.isActive(s.ownerId)).toBe(false);
  });

  it('stoppt beim Tod neue Drohnen, lässt gestartete inklusive Rückflug auslaufen und hält die Sperre bis zur Auslieferung', () => {
    const f = fixture(full);
    f.activate();
    const initial = f.runtime.getSnapshot().squadrons[0];
    const stopAt = bomberLaunchAt(initial, Math.floor(full.droneCount / 2));
    const events = [...f.runtime.update(stopAt - 0.001)];
    const started = f.runtime.getSnapshot().squadrons[0].anchors.filter(Boolean).length;
    f.runtime.cancelUnlaunched(initial.ownerId, stopAt);
    const snapshot = f.runtime.getSnapshot(), s = snapshot.squadrons[0];
    expect(s.stoppedAt).toBe(stopAt);
    expect(s.endsAt).toBeLessThan(initial.endsAt);
    expect(s.anchors.filter(Boolean)).toHaveLength(started);
    f.runtime.cancelUnlaunched(initial.ownerId, stopAt + 1000);
    expect(f.runtime.getSnapshot()).toBe(snapshot);
    f.owners.delete(initial.ownerId);
    events.push(...f.runtime.update(s.endsAt - 0.001));
    expect(f.runtime.isActive(initial.ownerId)).toBe(true);
    expect(f.activate()).toEqual({ ok: false, reason: 'blocked' });
    const final = f.runtime.update(s.endsAt);
    expect(final.some(e => e.kind === 'impact' && e.impactAt === s.endsAt)).toBe(true);
    events.push(...final);
    expect(events.filter(e => e.kind === 'impact')).toHaveLength(started * full.bombsPerPass * s.params.passCount);
    expect(events.some(e => e.pass === 1)).toBe(true);
    expect(events.every(e => bomberLaunchAt(s, e.drone) < stopAt)).toBe(true);
    expect(f.runtime.isActive(initial.ownerId)).toBe(false);
  });

  it('lässt den Stopp am exakten Starttermin gewinnen und startet beim Stopp keine überfälligen Anker nach', () => {
    const f = fixture();
    f.activate();
    const initial = f.runtime.getSnapshot().squadrons[0];
    const stopAt = bomberLaunchAt(initial, 1);
    f.runtime.update(stopAt);
    f.runtime.cancelUnlaunched(initial.ownerId, stopAt);
    const stopped = f.runtime.getSnapshot().squadrons[0];
    expect(stopped.anchors[1]).toBeNull();
    expect(f.runtime.update(stopped.endsAt).every(e => e.drone === 0)).toBe(true);
    f.activate('inspector', stopped.endsAt + 1);
    const next = f.runtime.getSnapshot().squadrons[0];
    f.runtime.cancelUnlaunched(next.ownerId, bomberLaunchAt(next, base.droneCount - 1));
    const lateStop = f.runtime.getSnapshot().squadrons[0];
    expect(lateStop.anchors.slice(1).every(a => a === null)).toBe(true);
    expect(f.runtime.update(lateStop.endsAt).every(e => e.drone === 0)).toBe(true);
  });

  it('räumt einen Stopp bei Aktivierung ohne Bomben auf; fehlende Besitzer stoppen weitere Starts', () => {
    const f = fixture();
    f.activate();
    const s = f.runtime.getSnapshot().squadrons[0];
    f.runtime.cancelUnlaunched(s.ownerId, s.startedAt);
    expect(f.runtime.update(s.startedAt)).toEqual([]);
    expect(f.runtime.isActive(s.ownerId)).toBe(false);
    f.activate();
    f.owners.delete(s.ownerId);
    const events = f.runtime.update(s.endsAt);
    expect(events.filter(e => e.kind === 'impact')).toHaveLength(base.bombsPerPass);
    expect(events.every(e => e.drone === 0)).toBe(true);
    expect(f.runtime.isActive(s.ownerId)).toBe(false);
  });

  it('entfernt Besitzer und clear vollständig; IDs werden innerhalb der World nicht wiederverwendet', () => {
    const f = fixture();
    f.activate();
    f.activate('other');
    const initial = f.runtime.getSnapshot();
    const maxId = Math.max(...initial.squadrons.map(s => s.id));
    f.runtime.removeOwner('inspector');
    expect(f.runtime.isActive('inspector')).toBe(false);
    expect(f.runtime.isActive('other')).toBe(true);
    expect(f.runtime.update(1000).every(e => e.ownerId === 'other')).toBe(true);
    f.runtime.clear();
    expect(f.runtime.update(10000)).toEqual([]);
    expect(f.runtime.getSnapshot()).toBe(EMPTY_BOMBER_SQUADRON_SNAPSHOT);
    expect(f.runtime.isActive('other')).toBe(false);
    f.activate('inspector', 10001);
    expect(f.runtime.getSnapshot().squadrons[0].id).toBeGreaterThan(maxId);
    expect(initial.squadrons).toHaveLength(2);
  });
});
