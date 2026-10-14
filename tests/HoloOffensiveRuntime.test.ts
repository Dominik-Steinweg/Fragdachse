import { describe, expect, it, vi } from 'vitest';
import type { HoloOffensiveUltimateConfig } from '../src/loadout/LoadoutTypes';
import type { AutomatedTurret } from '../src/systems/TurretFireSource';
import type { EnergyInjectorConstructionEffect } from '../src/types';
import type { FireControlConstructionFacts } from '../src/systems/fireControl/FireControlCopyPlan';
import { FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS } from '../src/systems/fireControl/FireControlEligibility';
import { createFireControlDeploymentIdSource, fireControlHoloSourceId } from '../src/systems/fireControl/FireControlSnapshot';
import { HoloOffensiveRuntime } from '../src/systems/fireControl/HoloOffensiveRuntime';
import { HoloTemplateSelection } from '../src/systems/fireControl/HoloTemplateSelection';
import { HoloSpawnLayout } from '../src/systems/fireControl/HoloSpawnLayout';

// Contract fixtures for the independent rules lane; authored content is supplied by lane A1.
const base: HoloOffensiveUltimateConfig = {
  id: 'HOLO_OFFENSIVE', type: 'holo_offensive', cooldown: 0, rageRequired: 300,
  ragePerSpawnSecond: 50, spawnIntervalMs: 750, copyLifetimeMs: 6000, materializeMs: 400,
  spawnRingRadiiPx: [120, 80, 160], spawnRingSlots: 12, clearanceRadiusPx: 16,
  minCopySpacingPx: 32, injectorProjectionEnabled: 0,
};
const full: HoloOffensiveUltimateConfig = { ...base, rageRequired: 150, spawnIntervalMs: 600,
  copyLifetimeMs: 9000, injectorProjectionEnabled: 1 };
const start = 100_000;
const duration = (config: HoloOffensiveUltimateConfig, rage: number) => rage / config.ragePerSpawnSecond * 1000;
const count = (config: HoloOffensiveUltimateConfig, rage: number) => Math.ceil(duration(config, rage) / config.spawnIntervalMs);
const fact = (id = 1, overrides: Partial<FireControlConstructionFacts> = {}): FireControlConstructionFacts => ({
  id, ownerId: 'p1', baseOwned: false, constructionId: 'machine_gun_turret', weaponFireType: 'projectile',
  combatReady: true, manned: false, x: 0, y: 0, angle: 0.7, weaponId: 'TURRET_MG', ...overrides,
});

function fixture(config = base) {
  const state = {
    facts: [fact()], owner: { x: 10, y: 20, color: 0xabcdef } as { x: number; y: number; color: number } | null,
    foreign: [] as { x: number; y: number }[], slots: ['machine_gun_turret'],
  };
  const definition = { id: 1, ownerId: 'p1', ownerColor: 123, x: 0, y: 0, angle: .7,
    weaponId: 'TURRET_MG', damage: 33, targetRange: 333, projectileRange: 444, cooldownMs: 50,
    secondProjectileDamageFactor: .5, muzzleOffset: 12, rotationSpeedDegPerSec: 90, aimToleranceDeg: 3,
    targetMode: 'enemies', skipRockIndex: 1, sourceCarrierBaseId: 'carrier',
    footprint: { left: 0, top: 0, right: 20, bottom: 20 } } satisfies AutomatedTurret;
  const ids = { next: vi.fn(createFireControlDeploymentIdSource().next) };
  const isPointFree = vi.fn(() => true);
  const readTurretDefinition = vi.fn((_id: number): AutomatedTurret | null => definition);
  const isPersonalMg = vi.fn(() => true);
  const resolveInjectorEffect = vi.fn((_constructionId: string): EnergyInjectorConstructionEffect | null =>
    ({ type: 'damage_turret', damageMultiplier: 1.25 }));
  const runtime = new HoloOffensiveRuntime({ ids, readConstructions: () => state.facts,
    readSlotOrder: () => state.slots, readOwner: () => state.owner, readTurretDefinition, isPointFree,
    readForeignCopyPositions: () => state.foreign, isPersonalMg, resolveInjectorEffect });
  const activate = (rage = 300, playerId = 'p1', nowMs = start) =>
    runtime.tryActivate({ config, consumedRage: rage, playerId, nowMs });
  const snapshot = (now = start) => runtime.getSnapshotDeployments(now)[0];
  return { runtime, state, ids, definition, isPointFree, readTurretDefinition, isPersonalMg,
    resolveInjectorEffect, activate, snapshot };
}

describe('Holo spawn schedule and lifetime', () => {
  it.each([base, full])('derives totals, concurrency and the exclusive window from config ($spawnIntervalMs ms)', config => {
    const totals: number[] = [];
    for (const rage of [300, 600]) {
      const f = fixture(config), seen = new Set<string>();
      expect(f.activate(rage)).toEqual({ ok: true });
      expect(f.snapshot().copies).toHaveLength(1); // Synchronous first spawn.
      let peak = 0;
      const end = start + duration(config, rage);
      for (let now = start; now <= end; now += config.spawnIntervalMs) {
        f.runtime.update(now);
        const copies = f.snapshot(now)?.copies ?? [];
        copies.forEach(copy => seen.add(copy.sourceId));
        peak = Math.max(peak, copies.length);
      }
      expect(seen.size).toBe(count(config, rage));
      expect(peak).toBe(Math.min(count(config, rage), Math.ceil(config.copyLifetimeMs / config.spawnIntervalMs)));
      expect(f.snapshot(end).copies.every(copy => copy.spawnedAt < end)).toBe(true);
      const lastAt = start + (count(config, rage) - 1) * config.spawnIntervalMs;
      expect(f.snapshot(end).expiresAt).toBe(lastAt + config.copyLifetimeMs);
      f.runtime.update(lastAt + config.copyLifetimeMs - 1);
      expect(f.runtime.isActive('p1')).toBe(true);
      f.runtime.update(lastAt + config.copyLifetimeMs);
      expect(f.runtime.isActive('p1')).toBe(false);
      expect(f.runtime.getSnapshotDeployments(lastAt + config.copyLifetimeMs)).toEqual([]);
      expect(f.runtime.getCopyPositions()).toEqual([]);
      totals.push(seen.size);
    }
    expect(totals[1]).toBe(2 * totals[0]);
  });

  it('early start changes no schedule at equal rage; fractional windows include every earlier appointment', () => {
    const early = { ...base, rageRequired: base.rageRequired / 2 };
    for (const rage of [early.rageRequired, 300, 600, base.ragePerSpawnSecond * base.spawnIntervalMs / 1000 * 1.5]) {
      const a = fixture(base), b = fixture(early);
      a.activate(rage); b.activate(rage);
      const end = start + duration(base, rage);
      a.runtime.update(end); b.runtime.update(end);
      expect(a.snapshot(end)).toEqual(b.snapshot(end));
      expect(b.snapshot(end).copies.at(-1)?.seq).toBe(count(early, rage) - 1);
      expect(b.snapshot(end).spawnUntil).toBe(end);
    }
  });

  it('skips failed appointments permanently and keeps their original window', () => {
    const f = fixture(); f.activate();
    f.isPointFree.mockReturnValue(false);
    f.runtime.update(start + base.spawnIntervalMs);
    f.isPointFree.mockReturnValue(true);
    f.state.facts = [];
    f.runtime.update(start + 2 * base.spawnIntervalMs);
    f.state.facts = [fact()];
    f.runtime.update(start + 2 * base.spawnIntervalMs + 1);
    expect(f.snapshot().copies).toHaveLength(1);
    f.runtime.update(start + 3 * base.spawnIntervalMs);
    expect(f.snapshot().copies.map(copy => copy.spawnedAt)).toEqual([start, start + 3 * base.spawnIntervalMs]);
    expect(f.snapshot().spawnUntil).toBe(start + duration(base, 300));
    expect(new Set(f.snapshot().copies.map(copy => copy.sourceId)).size).toBe(f.snapshot().copies.length);
  });

  it('processes long frames at scheduled times around the current position, without repeat spawns', () => {
    const f = fixture(); f.activate();
    const original = f.snapshot().copies[0];
    f.state.owner = { x: 1000, y: 2000, color: 123 };
    const now = start + 3 * base.spawnIntervalMs + 10;
    f.runtime.update(now);
    const copies = f.snapshot(now).copies;
    expect(copies.map(copy => copy.spawnedAt)).toEqual(Array.from({ length: 4 }, (_, k) => start + k * base.spawnIntervalMs));
    expect(copies[0]).toEqual(original);
    for (const copy of copies.slice(1)) {
      expect(Math.hypot(copy.x - f.state.owner.x, copy.y - f.state.owner.y)).toBeCloseTo(base.spawnRingRadiiPx[0]);
    }
    expect(f.snapshot(now)).toMatchObject({ x: 10, y: 20, ownerColor: 0xabcdef });
    f.runtime.update(now);
    expect(f.snapshot(now).copies).toEqual(copies);
  });

  it('matches short ticks across owners when long frames cross copy expirations', () => {
    const config = { ...full, spawnRingRadiiPx: [120], spawnRingSlots: 3, minCopySpacingPx: 100 };
    const small = fixture(config), large = fixture(config);
    for (const f of [small, large]) {
      f.state.facts.push(fact(2, { ownerId: 'p2' }));
      f.activate(600); f.activate(600, 'p2', start + config.spawnIntervalMs / 2);
    }
    const end = start + duration(config, 600);
    for (let now = start + config.spawnIntervalMs / 2; now <= end; now += config.spawnIntervalMs / 2) small.runtime.update(now);
    large.runtime.update(end);
    expect(large.runtime.getSnapshotDeployments(end)).toEqual(small.runtime.getSnapshotDeployments(end));
  });

  it.each(['sources', 'definition', 'placement', 'owner'] as const)('fails atomically without consuming an ID: %s', failure => {
    const f = fixture();
    if (failure === 'sources') f.state.facts = [];
    if (failure === 'definition') f.readTurretDefinition.mockReturnValue(null);
    if (failure === 'placement') f.isPointFree.mockReturnValue(false);
    if (failure === 'owner') f.state.owner = null;
    expect(f.activate()).toEqual({ ok: false, reason: failure === 'owner' ? 'blocked'
      : failure === 'placement' ? 'placement' : 'no_fire_sources' });
    expect(f.ids.next).not.toHaveBeenCalled();
    expect(f.runtime.isActive('p1')).toBe(false);
    expect(f.runtime.getSnapshotDeployments(start)).toEqual([]);
    expect(f.runtime.getCopyPositions()).toEqual([]);
  });
});

describe('Holo template rotation', () => {
  it('uses the shared six-type eligibility, ignoring manning and distance', () => {
    const f = fixture();
    f.state.slots = [];
    const eligible = FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS.map((constructionId, index) => fact(index + 1, {
      constructionId, manned: true, x: 1_000_000, weaponFireType: constructionId === 'flame_turret' ? 'flamethrower' : 'projectile',
    }));
    f.state.facts = [...eligible, fact(101, { ownerId: 'enemy' }), fact(102, { baseOwned: true }),
      fact(103, { combatReady: false }), fact(104, { constructionId: 'tesla_turret' }),
      fact(105, { weaponFireType: 'beam' })];
    f.activate();
    for (let k = 1; k < eligible.length; k++) f.runtime.update(start + k * base.spawnIntervalMs);
    expect(f.runtime.deriveFireSources(start + (eligible.length - 1) * base.spawnIntervalMs + base.materializeMs)
      .map(source => source.projection!.templateId)).toEqual(
      [...eligible].sort((a, b) => a.constructionId! < b.constructionId! ? -1 : 1).map(source => source.id));
  });

  it('ignores a relay pause while retaining regular combat-readiness exclusions', () => {
    const selection = new HoloTemplateSelection();
    const paused = { ...fact(), pausedByCopies: true, manned: true };
    expect(selection.next('p1', { x: 0, y: 0 }, [paused], [])?.id).toBe(paused.id);
    expect(selection.next('p1', { x: 0, y: 0 }, [{ ...paused, combatReady: false }], [])).toBeNull();
  });

  it('cycles types in slot order then alphabetically, and originals by initial distance then ID', () => {
    const selection = new HoloTemplateSelection(), owner = { x: 0, y: 0 };
    const facts = [fact(2, { x: 20 }), fact(3, { x: 10 }), fact(1, { x: -10 }),
      fact(4, { constructionId: 'rocket_turret' }), fact(5, { constructionId: 'flame_turret', weaponFireType: 'flamethrower' }),
      fact(6, { constructionId: 'gravity_turret' })];
    const slots = ['rocket_turret', 'machine_gun_turret', 'rocket_turret'];
    const chosen = Array.from({ length: facts.length * 2 }, () => selection.next('p1', owner, facts, slots)!.id);
    expect(chosen).toEqual([4, 1, 5, 6, 4, 3, 5, 6, 4, 2, 5, 6]);
  });

  it('appends newly admitted originals by current distance and preserves the next survivor on deletion', () => {
    const selection = new HoloTemplateSelection();
    let facts = [fact(1, { x: 1 }), fact(2, { x: 2 }), fact(3, { x: 3 })];
    let owner = { x: 0, y: 0 };
    const next = () => selection.next('p1', owner, facts, [])!.id;
    expect(next()).toBe(1);
    owner = { x: 100, y: 0 };
    facts = [facts[0], facts[2], fact(4, { x: 90 }), fact(5, { x: 100 })];
    expect(next()).toBe(3); // Deleted next member (2) advances to 3, not to the newly closer 5.
    expect(next()).toBe(5);
    facts = facts.filter(source => source.id !== 1); // Deletion before the cursor must not skip 4.
    expect(next()).toBe(4);
    expect(next()).toBe(3);
    facts = [];
    expect(selection.next('p1', owner, facts, [])).toBeNull();
    facts = [fact(9)];
    expect(next()).toBe(9);
  });
});

describe('Holo placement', () => {
  const owner = { x: 10, y: 20 };
  it('exhausts each ring in configured order and passes the configured clearance', () => {
    const layout = new HoloSpawnLayout(), visited: { x: number; y: number; radius: number }[] = [];
    const targetRing = base.spawnRingRadiiPx.length - 1;
    const position = layout.find(owner, base, [], (x, y, radius) => {
      visited.push({ x, y, radius });
      return visited.length > targetRing * base.spawnRingSlots;
    });
    expect(position).not.toBeNull();
    visited.forEach((point, index) => {
      expect(point.radius).toBe(base.clearanceRadiusPx);
      expect(Math.hypot(point.x - owner.x, point.y - owner.y)).toBeCloseTo(
        base.spawnRingRadiiPx[Math.floor(index / base.spawnRingSlots)]);
    });
    const next = layout.find(owner, base, [], () => true)!;
    const angle = Math.PI * 2 / base.spawnRingSlots;
    expect(next.x).toBeCloseTo(owner.x + Math.cos(angle) * base.spawnRingRadiiPx[0]);
    expect(next.y).toBeCloseTo(owner.y + Math.sin(angle) * base.spawnRingRadiiPx[0]);
  });

  it('checks other slots before fallback rings and accepts exactly the minimum spacing', () => {
    const layout = new HoloSpawnLayout();
    const first = { x: owner.x + base.spawnRingRadiiPx[0], y: owner.y };
    const occupied = [{ x: first.x + base.minCopySpacingPx - 1, y: first.y }];
    const position = layout.find(owner, base, occupied, () => true)!;
    expect(position).not.toEqual(first);
    expect(Math.hypot(position.x - owner.x, position.y - owner.y)).toBeCloseTo(base.spawnRingRadiiPx[0]);
    expect(new HoloSpawnLayout().find(owner, base,
      [{ x: first.x + base.minCopySpacingPx, y: first.y }], () => true)).toEqual(first);
    expect(layout.find(owner, base, [], () => false)).toBeNull();
  });

  it('spaces all owners and relay copies, including materializing copies', () => {
    const f = fixture();
    f.state.facts.push(fact(2, { ownerId: 'p2' }));
    f.state.foreign = [{ x: f.state.owner!.x + base.spawnRingRadiiPx[0], y: f.state.owner!.y }];
    f.activate(); f.activate(300, 'p2');
    const positions = [...f.runtime.getCopyPositions(), ...f.state.foreign];
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      expect(Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y)).toBeGreaterThanOrEqual(base.minCopySpacingPx);
    }
  });
});

describe('Holo independent sources, snapshots and teardown', () => {
  it.each<EnergyInjectorConstructionEffect>([
    { type: 'damage_turret', damageMultiplier: 1.25 },
    { type: 'gravity_pull', pullStrengthMultiplier: 1.5 },
    { type: 'slow_bubble', slowStrengthMultiplier: 1.5 },
  ])('preserves the injected $type definition without applying or converting it', effect => {
    const f = fixture(full);
    f.resolveInjectorEffect.mockReturnValue(effect);
    f.activate();
    const source = f.runtime.deriveFireSources(start + full.materializeMs)[0];
    expect(source.projection!.injectorEffect).toEqual(effect);
    expect(source.projection!.injectorEffect).not.toBe(effect);
    expect(source.damage).toBe(f.definition.damage);
  });

  it.each([base, full])('freezes permanent facts, independent identities and injector provenance ($injectorProjectionEnabled)', config => {
    const f = fixture(config);
    const effect = { type: 'damage_turret' as const, damageMultiplier: 1.6 };
    f.resolveInjectorEffect.mockReturnValue(effect);
    f.activate();
    const copy = f.snapshot().copies[0];
    expect(copy.sourceId).toBe(fireControlHoloSourceId(f.snapshot().id, copy.seq));
    expect(f.runtime.deriveFireSources(start + config.materializeMs - 1)).toEqual([]);
    const source = f.runtime.deriveFireSources(start + config.materializeMs)[0];
    expect(source).toMatchObject({ id: copy.sourceId, identityId: copy.sourceId, sequenceKey: copy.sourceId,
      visualId: copy.sourceId, fireState: 'active', targetRange: f.definition.targetRange,
      projectileRange: f.definition.projectileRange, damage: f.definition.damage, cooldownMs: f.definition.cooldownMs,
      targetMode: f.definition.targetMode, projection: { deploymentId: f.snapshot().id, templateId: 1,
        personalMg: true, injectorEffect: config.injectorProjectionEnabled ? effect : null } });
    for (const key of ['portal', 'sequenceSeedKey', 'footprint', 'skipRockIndex', 'sourceCarrierBaseId']) {
      expect(source).not.toHaveProperty(key);
    }
    expect(Object.isFrozen(source.projection)).toBe(true);
    if (config.injectorProjectionEnabled) {
      expect(source.projection!.injectorEffect).not.toBe(effect);
      expect(Object.isFrozen(source.projection!.injectorEffect)).toBe(true);
      expect(f.resolveInjectorEffect).toHaveBeenCalledWith('machine_gun_turret');
    } else expect(f.resolveInjectorEffect).not.toHaveBeenCalled();
    f.definition.damage = 999; f.definition.targetRange = 999; effect.damageMultiplier = 9;
    f.isPersonalMg.mockReturnValue(false);
    f.runtime.update(start + config.spawnIntervalMs);
    const sources = f.runtime.deriveFireSources(start + config.spawnIntervalMs + config.materializeMs);
    expect(sources[0]).toEqual(source);
    expect(sources[1].damage).toBe(f.definition.damage);
    expect(sources[1].projection!.personalMg).toBe(false);
    expect(new Set(sources.map(item => item.sequenceKey)).size).toBe(sources.length);
    f.state.facts = []; f.readTurretDefinition.mockReturnValue(null);
    f.runtime.update(start + 2 * config.spawnIntervalMs);
    expect(f.runtime.deriveFireSources(start + 2 * config.spawnIntervalMs)[0]).toEqual(source);
    expect(f.runtime.setCopyAngle(copy.sourceId, 1.2)).toBe(true);
    expect(f.runtime.deriveFireSources(start + 2 * config.spawnIntervalMs)[0].angle).toBe(1.2);
    expect(f.snapshot().copies[0].angle).toBe(1.2);
    expect(f.runtime.setCopyAngle('fc-copy:1:0', 1)).toBe(false);
    expect(f.runtime.setCopyAngle(copy.sourceId, NaN)).toBe(false);
    f.runtime.update(start + config.copyLifetimeMs);
    expect(f.runtime.deriveFireSources(start + config.copyLifetimeMs).some(item => item.id === copy.sourceId)).toBe(false);
    expect(f.runtime.setCopyAngle(copy.sourceId, 0)).toBe(false);
  });

  it('freezes config arrays and changes expiresAt from planned to actual after the final failed spawn', () => {
    const config = { ...base, spawnRingRadiiPx: [...base.spawnRingRadiiPx] };
    const f = fixture(config); f.activate();
    const plannedEnd = start + (count(base, 300) - 1) * base.spawnIntervalMs + base.copyLifetimeMs;
    expect(f.snapshot().expiresAt).toBe(plannedEnd);
    config.copyLifetimeMs = 1; config.spawnRingRadiiPx[0] = 9999;
    f.runtime.update(start + base.spawnIntervalMs);
    expect(f.snapshot().copyLifetimeMs).toBe(base.copyLifetimeMs);
    expect(Math.hypot(f.snapshot().copies[1].x - f.state.owner!.x,
      f.snapshot().copies[1].y - f.state.owner!.y)).toBeCloseTo(base.spawnRingRadiiPx[0]);
    f.state.facts = [];
    f.runtime.update(start + duration(base, 300));
    expect(f.snapshot(start + duration(base, 300)).expiresAt).toBe(start + base.spawnIntervalMs + base.copyLifetimeMs);
  });

  it('stops exclusively on death, preserves living copies and blocks until they expire', () => {
    const f = fixture(); f.activate(600);
    f.runtime.update(start + base.spawnIntervalMs);
    const death = start + 2 * base.spawnIntervalMs;
    const copies = f.snapshot().copies;
    f.runtime.stopSpawning('p1', death);
    f.runtime.stopSpawning('p1', death + 1);
    f.runtime.update(death);
    expect(f.snapshot(death)).toMatchObject({ spawnUntil: death, copies,
      expiresAt: start + base.spawnIntervalMs + base.copyLifetimeMs });
    expect(f.activate()).toEqual({ ok: false, reason: 'blocked' });
    f.runtime.update(start + base.spawnIntervalMs + base.copyLifetimeMs);
    expect(f.runtime.isActive('p1')).toBe(false);
    expect(f.activate(300, 'p1', death + base.copyLifetimeMs)).toEqual({ ok: true });
  });

  it('processes overdue appointments before death once, but never an appointment at death or later', () => {
    const f = fixture(); f.activate(600);
    const death = start + 3 * base.spawnIntervalMs;
    f.runtime.stopSpawning('p1', death);
    f.runtime.update(death + 1);
    const expected = Array.from({ length: Math.ceil((death - start) / base.spawnIntervalMs) },
      (_, index) => start + index * base.spawnIntervalMs);
    expect(f.snapshot(death + 1).copies.map(copy => copy.spawnedAt)).toEqual(expected);
    f.runtime.update(death + 2);
    expect(f.snapshot(death + 2).copies.map(copy => copy.spawnedAt)).toEqual(expected);
    expect(f.snapshot(death + 2).expiresAt).toBe(expected.at(-1)! + base.copyLifetimeMs);
  });

  it('keeps an empty deployment while appointments remain, then removes it after the final failure', () => {
    const config = { ...base, copyLifetimeMs: base.spawnIntervalMs / 2 };
    const f = fixture(config); f.activate(); f.state.facts = [];
    f.runtime.update(start + config.copyLifetimeMs);
    expect(f.snapshot().copies).toEqual([]);
    expect(f.runtime.isActive('p1')).toBe(true);
    f.runtime.update(start + duration(config, 300));
    expect(f.runtime.isActive('p1')).toBe(false);
    expect(f.runtime.getSnapshotDeployments(start + duration(config, 300))).toEqual([]);
  });

  it('isolates owners, clears all state and never resets the shared deployment IDs', () => {
    const f = fixture();
    f.state.facts.push(fact(2, { ownerId: 'p2' }));
    f.activate(); f.activate(300, 'p2');
    f.runtime.removeOwner('p1'); f.runtime.removeOwner('p1');
    expect(f.runtime.isActive('p1')).toBe(false);
    expect(f.runtime.isActive('p2')).toBe(true);
    const previous = f.runtime.getSnapshotDeployments(start)[0].id;
    const otherDeployment = f.ids.next(); // Shared relay/portal consumer.
    f.runtime.clear(); f.runtime.clear();
    f.runtime.update(start + base.spawnIntervalMs);
    expect(f.runtime.getCopyPositions()).toEqual([]);
    expect(f.runtime.deriveFireSources(start + base.materializeMs)).toEqual([]);
    expect(f.runtime.getSnapshotDeployments(start)).toEqual([]);
    f.activate();
    expect(f.snapshot().id).toBeGreaterThan(Math.max(previous, otherDeployment));
  });
});
