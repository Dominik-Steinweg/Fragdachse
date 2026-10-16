import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Angle: { Between: (x: number, y: number, tx: number, ty: number) => Math.atan2(ty - y, tx - x) },
    Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) },
  },
}));

import {
  TurretSystem,
  toLocalTurretFireSource,
  type AutomatedTurret,
  type AutomatedTurretId,
  type TurretFireContext,
  type TurretFireSource,
} from '../src/systems/TurretSystem';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type PlaceableTurretUtilityConfig } from '../src/loadout/LoadoutConfig';

const config = UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig;
const COOLDOWN = 1000;
const COPY_ID = 'fc-copy:1:0';
const burst = WEAPON_CONFIGS.TURRET_ROCKET_BURST.turretBurst!;

function construction(overrides: Partial<AutomatedTurret> = {}): AutomatedTurret {
  return { id: 7, x: 0, y: 0, ownerId: 'owner', ownerColor: 0xffffff, targetRange: 500, muzzleOffset: 0,
    cooldownMs: COOLDOWN, weaponId: 'TURRET_MG', angle: 0, ...overrides };
}

function original(turret: AutomatedTurret, fireState: TurretFireSource['fireState'] = 'active'): TurretFireSource {
  return { ...toLocalTurretFireSource(turret), fireState };
}

/** Kopie an anderem Ort: Grundversion teilt die Folge, Parallelbetrieb startet eine eigene ab dem Original. */
function copyOf(turret: AutomatedTurret, parallel = false): TurretFireSource {
  return { ...turret, id: COPY_ID, x: 300, y: 0, identityId: turret.id, visualId: COPY_ID, fireState: 'active',
    sequenceKey: parallel ? COPY_ID : turret.id, ...(parallel ? { sequenceSeedKey: turret.id } : {}) };
}

function fixture() {
  let constructions: AutomatedTurret[] = [];
  let sources: TurretFireSource[] = [];
  const system = new TurretSystem({ getAllPlayers: () => [] } as never,
    { isAlive: () => true, isBurrowed: () => false, canDamageTarget: () => true } as never);
  const fire = vi.fn();
  const angles = vi.fn();
  system.setTurretProvider(() => constructions, angles);
  system.setFireSourceProvider(() => sources);
  // Gleich weit von Original (0, 0) und Kopie (300, 0) entfernt.
  system.setEnemyTargetProvider(() => [{ id: 'enemy', x: 150, y: 100 }]);
  system.setFireHandler(fire);
  return {
    system, fire, angles,
    set(nextConstructions: AutomatedTurret[], nextSources: TurretFireSource[]) {
      constructions = nextConstructions;
      sources = nextSources;
    },
    tick: (now: number) => system.hostUpdate(now, config, WEAPON_CONFIGS.SPORES, 16),
    shooters: () => fire.mock.calls.map(call => (call[13] as TurretFireContext).source.id),
  };
}

describe('turret fire sources', () => {
  it('keeps base aim at each source pose across a shared-sequence handoff and cleans removed copies', () => {
    const f = fixture();
    const turret = construction({ id: 1, cooldownMs: 1 });
    const copy = copyOf(turret);
    f.system.setEnemyTargetProvider(() => []);
    const candidates = vi.fn((source: TurretFireSource) => [{ id: 'base', x: source.x + 80, y: 0 }]);
    f.system.setBaseTargetCandidateProvider(candidates);
    f.set([turret], [original(turret, 'paused'), copy]);
    f.tick(0); f.tick(250);
    expect(f.fire.mock.calls.at(-1)![6]).toBe(380);
    f.set([turret], [original(turret), { ...copy, fireState: 'paused' }]);
    f.tick(500);
    expect(f.fire.mock.calls.at(-1)![6]).toBe(80);
    f.set([turret], [original(turret, 'paused')]); f.tick(501);
    f.set([turret], [original(turret, 'paused'), { ...copy, x: 500 }]);
    f.tick(502); f.tick(752);
    expect(f.fire.mock.calls.at(-1)![6]).toBe(580);
    expect(candidates.mock.calls.filter(([s]) => s.id === copy.id)).toHaveLength(2);
  });

  it.each([false, true])('waits completely for a running seed salvo, independent of order (%s)', copyFirst => {
    const f = fixture();
    const turret = construction({ weaponId: 'TURRET_ROCKET_BURST' });
    const score = vi.fn(() => 0);
    f.system.setTargetScoreProvider(score);
    f.set([turret], [original(turret)]);
    f.tick(0);
    const sources = [original(turret, 'paused'), copyOf(turret, true)];
    f.set([turret], copyFirst ? sources.reverse() : sources);
    f.angles.mockClear(); score.mockClear();
    f.tick(1);
    const end = (burst.count - 1) * burst.intervalMs;
    for (let now = burst.intervalMs; now <= end; now += burst.intervalMs) f.tick(now);
    expect(f.shooters()).toEqual(Array.from({ length: burst.count }, () => turret.id));
    expect(f.angles.mock.calls.some(([source]) => source.id === COPY_ID)).toBe(false);
    expect(score).not.toHaveBeenCalled();
    f.tick(end + 1);
    f.tick(end + COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledTimes(burst.count);
    f.tick(end + COOLDOWN);
    expect(f.shooters().at(-1)).toBe(COPY_ID);
  });

  it.each([false, true])('seeds only after an aborted salvo has booked cooldown (%s)', copyFirst => {
    const f = fixture();
    const turret = construction({ weaponId: 'TURRET_ROCKET_BURST' });
    f.set([turret], [original(turret)]);
    f.tick(0);
    f.system.setManualControlProvider(() => ({ playerId: 'pilot', revision: 1,
      targetX: 200, targetY: 0, fireHeld: false, fresh: true }));
    const sources = [original(turret), copyOf(turret, true)];
    f.set([turret], copyFirst ? sources.reverse() : sources);
    f.tick(10);
    f.tick(11);
    f.tick(10 + COOLDOWN - 1);
    expect(f.shooters()).toEqual([turret.id]);
    f.tick(10 + COOLDOWN);
    expect(f.shooters()).toEqual([turret.id, COPY_ID]);
  });

  it.each(['legacy cover', 'limited cover', 'limited angle'] as const)(
    'aborts a paused remainder once and releases the shared sequence after cooldown: %s', reason => {
      const f = fixture();
      const turret = construction({ weaponId: 'TURRET_ROCKET_BURST',
        ...(reason === 'legacy cover' ? {} : { rotationSpeedDegPerSec: 1, aimToleranceDeg: 0,
          angle: Math.atan2(100, 150) }) });
      f.set([turret], [original(turret)]);
      f.tick(0);
      const paused = { ...original(turret, 'paused'), ...(reason === 'limited angle' ? { angle: -Math.PI / 2 } : {}) };
      const copy = { ...copyOf(turret), rotationSpeedDegPerSec: undefined };
      f.set([turret], [paused, copy]);
      if (reason !== 'limited angle') f.system.setLineOfFireChecker(sx => sx > 200);
      f.tick(burst.intervalMs - 1);
      f.tick(burst.intervalMs);
      for (let now = burst.intervalMs + 1; now < burst.intervalMs + COOLDOWN; now += 100) f.tick(now);
      expect(f.shooters()).toEqual([turret.id]);
      f.tick(burst.intervalMs + COOLDOWN);
      expect(f.shooters()).toEqual([turret.id, COPY_ID]);
    });

  it.each([false, true])('charges the surviving old sequence once when its owner changes sequence (%s)', copyFirst => {
    const f = fixture();
    const turret = construction({ weaponId: 'TURRET_ROCKET_BURST' });
    f.set([turret], [original(turret, 'paused'), copyOf(turret)]);
    f.tick(0);
    const sources = [original(turret), { ...copyOf(turret, true), fireState: 'paused' as const }];
    f.set([turret], copyFirst ? sources.reverse() : sources);
    f.tick(10);
    f.tick(burst.intervalMs);
    f.tick(10 + COOLDOWN - 1);
    expect(f.shooters()).toEqual([COPY_ID]);
    f.tick(10 + COOLDOWN);
    expect(f.shooters()).toEqual([COPY_ID, turret.id]);
  });

  it('treats every construction as its own source when no fire-source provider is installed', () => {
    const f = fixture();
    const turret = construction();
    f.system.setFireSourceProvider(null);
    f.set([turret], []);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledOnce();
    expect(f.fire.mock.calls[0][10]).toBe(turret.id);
    expect((f.fire.mock.calls[0][13] as TurretFireContext).source).toMatchObject({
      id: turret.id, identityId: turret.id, sequenceKey: turret.id, visualId: turret.id, fireState: 'active' });
    expect(f.system.getTurrets()).toEqual([turret]);
  });

  it('keeps the fire sequence of a paused original instead of resetting it', () => {
    const f = fixture();
    const turret = construction();
    f.set([turret], [original(turret)]);
    f.tick(0);
    f.set([turret], [original(turret, 'paused')]);
    f.angles.mockClear();
    for (let now = 100; now <= 3000; now += 100) f.tick(now);
    expect(f.fire).toHaveBeenCalledOnce();
    expect(f.angles).not.toHaveBeenCalled();
    f.set([turret], [original(turret)]);
    f.tick(3100);
    expect(f.fire).toHaveBeenCalledTimes(2);

    // Eine Pause kurz nach einem Schuss verkürzt den Cooldown nicht.
    f.set([turret], [original(turret, 'paused')]);
    f.tick(3200);
    f.set([turret], [original(turret)]);
    f.tick(3300);
    f.tick(3100 + COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledTimes(2);
    f.tick(3100 + COOLDOWN);
    expect(f.fire).toHaveBeenCalledTimes(3);
  });

  it('lets a basic copy continue the original sequence without a free shot', () => {
    const f = fixture();
    const turret = construction();
    const buff = vi.fn((_x: number, _y: number) => null);
    const score = vi.fn((_source: TurretFireSource, _kind: string, _id: string, _now: number) => 0);
    f.system.setTurretDamageBuffProvider(buff);
    f.system.setTargetScoreProvider(score);
    f.set([turret], [original(turret)]);
    f.tick(0);
    f.set([turret], [original(turret, 'paused'), copyOf(turret)]);
    f.tick(100);
    f.tick(COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledOnce();
    f.angles.mockClear(); buff.mockClear();
    f.tick(COOLDOWN);
    expect(f.shooters()).toEqual([turret.id, COPY_ID]);

    const [ownerId, , , muzzleX, , , , , , , sourceTurretId, , , context] = f.fire.mock.calls[1];
    expect(ownerId).toBe('owner');
    expect(muzzleX).toBe(300);
    // Attribution und identitätsgebundene Effekte bleiben am Original, die Animation an der Kopie.
    expect(sourceTurretId).toBe(turret.id);
    expect((context as TurretFireContext).source.visualId).toBe(COPY_ID);
    expect(buff).toHaveBeenCalledWith(turret.x, turret.y);
    expect(score.mock.calls.some(([source]) => source.id === COPY_ID && source.identityId === turret.id)).toBe(true);
    expect(f.angles.mock.calls.map(([source]) => source.id)).toEqual([COPY_ID]);
    // Konsumenten des Konstruktionsbestands (Bemannung, Injektor, Fernsteuerung) sehen keine Kopie.
    expect(f.system.getTurrets()).toEqual([turret]);
  });

  it('hands the sequence back to the original when the projection ends', () => {
    const f = fixture();
    const turret = construction();
    f.set([turret], [original(turret, 'paused'), copyOf(turret)]);
    f.tick(0);
    expect(f.shooters()).toEqual([COPY_ID]);
    f.set([turret], [original(turret)]);
    f.tick(100);
    f.tick(COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledOnce();
    f.tick(COOLDOWN);
    expect(f.shooters()).toEqual([COPY_ID, turret.id]);
  });

  it('aborts a salvo whose entry disappears and charges the regular cooldown to the surviving sequence', () => {
    const f = fixture();
    const turret = construction({ weaponId: 'TURRET_ROCKET_BURST' });
    f.set([turret], [original(turret, 'paused'), copyOf(turret)]);
    f.tick(0);
    expect(f.shooters()).toEqual([COPY_ID]);
    f.set([turret], [original(turret)]);
    f.tick(50);
    f.tick(burst.intervalMs);
    f.tick(50 + COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledOnce();
    f.tick(50 + COOLDOWN);
    expect(f.shooters()).toEqual([COPY_ID, turret.id]);
  });

  it('lets a paused original finish its own salvo while its copy waits instead of taking it over', () => {
    const f = fixture();
    const turret = construction({ weaponId: 'TURRET_ROCKET_BURST' });
    f.set([turret], [original(turret)]);
    f.tick(0);
    f.set([turret], [original(turret, 'paused'), copyOf(turret)]);
    f.tick(10);
    const end = (burst.count - 1) * burst.intervalMs;
    for (let now = burst.intervalMs; now <= end; now += burst.intervalMs) f.tick(now);
    expect(f.shooters()).toEqual(Array.from({ length: burst.count }, () => turret.id));
    f.tick(end + COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledTimes(burst.count);
    f.tick(end + COOLDOWN);
    expect(f.shooters().at(-1)).toBe(COPY_ID);
  });

  it('ends the own salvo of a disabled (webbed) turret and keeps it silent, also manned, until it is active again', () => {
    const f = fixture();
    const turret = construction({ weaponId: 'TURRET_ROCKET_BURST' });
    f.set([turret], [original(turret)]);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledOnce();
    f.set([turret], [original(turret, 'disabled')]);
    for (let now = burst.intervalMs; now <= 3 * COOLDOWN; now += burst.intervalMs) f.tick(now);
    expect(f.fire).toHaveBeenCalledOnce();
    f.set([turret], [original(turret)]);
    f.tick(3 * COOLDOWN + 16);
    expect(f.fire).toHaveBeenCalledTimes(2);

    const manned = fixture();
    manned.system.setManualControlProvider(() => ({ playerId: 'pilot', revision: 1, targetX: 200, targetY: 0, fireHeld: true, fresh: true }));
    manned.set([turret], [original(turret, 'disabled')]);
    manned.tick(0); manned.tick(COOLDOWN);
    expect(manned.fire).not.toHaveBeenCalled();
  });

  it('starts a parallel copy sequence from the original cooldown and then fires independently', () => {
    const f = fixture();
    const turret = construction();
    f.set([turret], [original(turret)]);
    f.tick(0);
    f.set([turret], [original(turret), copyOf(turret, true)]);
    f.tick(100);
    f.tick(COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledOnce();
    f.tick(COOLDOWN);
    expect(f.shooters()).toEqual([turret.id, turret.id, COPY_ID]);
    f.tick(2 * COOLDOWN);
    expect(f.shooters()).toEqual([turret.id, turret.id, COPY_ID, turret.id, COPY_ID]);
  });

  it('silences a copy as soon as its original is no longer a construction', () => {
    for (const parallel of [false, true]) {
      const f = fixture();
      const turret = construction();
      f.set([], [copyOf(turret, parallel)]);
      f.tick(0);
      f.tick(COOLDOWN);
      expect(f.fire).not.toHaveBeenCalled();
    }
  });

  it('forgets the sequence of a destroyed original so a rebuilt construction starts fresh', () => {
    const f = fixture();
    const turret = construction();
    f.set([turret], [original(turret)]);
    f.tick(0);
    f.set([], []);
    f.tick(10);
    f.set([turret], [original(turret)]);
    f.tick(20);
    expect(f.fire).toHaveBeenCalledTimes(2);
  });

  it('offers manual control only to constructions and keeps copies autonomous', () => {
    const f = fixture();
    const turret = construction();
    const manual = vi.fn((_id: AutomatedTurretId, _now: number) =>
      ({ playerId: 'pilot', revision: 1, targetX: -200, targetY: 0, fireHeld: true, fresh: true }));
    f.system.setManualControlProvider(manual);
    f.set([turret], [original(turret), copyOf(turret, true)]);
    f.tick(0);
    expect(manual.mock.calls.map(([id]) => id)).toEqual([turret.id]);
    expect(f.fire.mock.calls.map(call => [(call[13] as TurretFireContext).source.id, call[6]]))
      .toEqual([[turret.id, -200], [COPY_ID, 150]]);
  });

  it('charges the cooldown for the own salvo when control changes, but never cancels a copy salvo', () => {
    const f = fixture();
    const turret = construction({ weaponId: 'TURRET_ROCKET_BURST' });
    let revision = 0;
    f.system.setManualControlProvider(() => revision === 0 ? null
      : { playerId: 'pilot', revision, targetX: 200, targetY: 0, fireHeld: true, fresh: true });
    f.set([turret], [original(turret)]);
    f.tick(0);
    revision = 1;
    f.tick(10);
    f.tick(burst.intervalMs);
    f.tick(10 + COOLDOWN - 1);
    expect(f.fire).toHaveBeenCalledOnce();
    f.tick(10 + COOLDOWN);
    expect(f.fire).toHaveBeenCalledTimes(2);

    const g = fixture();
    let pilotRevision = 0;
    g.system.setManualControlProvider(() => pilotRevision === 0 ? null
      : { playerId: 'pilot', revision: pilotRevision, targetX: 200, targetY: 0, fireHeld: true, fresh: true });
    g.set([turret], [original(turret, 'paused'), copyOf(turret)]);
    g.tick(0);
    pilotRevision = 1;
    g.tick(10);
    g.tick(burst.intervalMs);
    expect(g.shooters()).toEqual([COPY_ID, COPY_ID]);
  });
});
