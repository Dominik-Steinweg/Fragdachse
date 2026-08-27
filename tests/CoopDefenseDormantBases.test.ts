import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
}));

import {
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { resolveCoopDefenseActivityBases, type BaseSpec } from '../src/arena/BaseRegistry';
import { BaseManager } from '../src/entities/BaseManager';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { LightingSystem } from '../src/effects/LightingSystem';
import type { CoopDefenseSecondaryObjectiveState } from '../src/types';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';

const DORMANT_BASE_ID = 'test-dormant-outpost';
const DORMANT_OBJECTIVE_ID = 'test-dormant-objective';
const TEST_WORLD_METRICS = resolveActiveArenaWorldMetrics();

function makeDormantMap(): CoopDefenseMapConfig {
  return {
    mapId: 'dormant-test',
    displayName: 'Dormant test map',
    balanceReferenceDurationSec: 60,
    objective: 'repel-assault',
    bases: [
      {
        id: 'test-friendly-main',
        hpMax: 1000,
        anchor: { kind: 'right-center', edgeInsetCells: 0 },
        shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
      },
      {
        id: DORMANT_BASE_ID,
        hpMax: 1000,
        faction: 'hostile',
        role: 'outpost',
        dormant: true,
        anchor: { kind: 'left-center', edgeInsetCells: 2 },
        shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
      },
    ],
    powerUps: [],
    encounters: [{
      id: 'test-encounter',
      start: { type: 'time', atMs: 0 },
      groups: [{ enemyKind: 'zombie-badger', count: 1 }],
    }],
    secondaryObjectives: [{
      id: DORMANT_OBJECTIVE_ID,
      type: 'destroy',
      start: { type: 'time', atMs: 0 },
      targets: [DORMANT_BASE_ID],
    }],
  };
}

function withMapChanges(changes: Partial<CoopDefenseMapConfig>): CoopDefenseMapConfig {
  return {
    ...makeDormantMap(),
    ...changes,
  };
}

function makeBaseSpec(id: string, options: {
  dormant?: boolean;
  dormantObjectiveId?: string;
  turret?: boolean;
} = {}): BaseSpec {
  return {
    id,
    cells: [{ gridX: 10, gridY: 10 }],
    region: { minGridX: 10, maxGridX: 10, minGridY: 10, maxGridY: 10 },
    hpMax: 100,
    faction: 'hostile',
    role: 'outpost',
    ...(options.dormant ? { dormant: true } : {}),
    ...(options.dormantObjectiveId ? { dormantObjectiveId: options.dormantObjectiveId } : {}),
    turrets: options.turret ? [{
      id: `${id}-turret`,
      baseId: id,
      x: 336,
      y: 336,
      initialAngle: 0,
      weaponId: 'BASE_SPORES',
    }] : [],
    powerUpPedestals: [],
  };
}

function fakeGameObject(width = 32, height = 32): Record<string, any> {
  const object: Record<string, any> = {
    active: true,
    visible: true,
    width,
    height,
    alpha: 1,
    scale: 1,
    data: new Map<string, unknown>(),
  };
  const chain = (method: (value?: any) => void = () => undefined) => (value?: any) => {
    method(value);
    return object;
  };
  object.setDisplaySize = chain((value) => { object.width = value; object.height = value; });
  object.setDepth = chain();
  object.setRotation = chain((value) => { object.rotation = value; });
  object.setTint = chain();
  object.setPosition = chain();
  object.setOrigin = chain();
  object.setStrokeStyle = chain();
  object.setFillStyle = chain();
  object.setVisible = chain((value) => { object.visible = value; });
  object.setData = (key: string, value: unknown) => {
    object.data.set(key, value);
    return object;
  };
  object.lineStyle = chain();
  object.strokeCircle = chain();
  object.strokeRect = chain();
  object.lineBetween = chain();
  object.destroy = () => { object.active = false; };
  object.getBounds = () => ({
    x: 0,
    y: 0,
    width: object.width,
    height: object.height,
    contains: (x: number, y: number) => x >= 0 && y >= 0 && x <= object.width && y <= object.height,
  });
  return object;
}

function makeScene(): { scene: any; groupObjects: any[] } {
  const groupObjects: any[] = [];
  const scene: any = {
    add: {
      image: () => fakeGameObject(),
      rectangle: (_x: number, _y: number, width: number, height: number) => fakeGameObject(width, height),
      graphics: () => fakeGameObject(),
    },
    physics: {
      add: {
        existing: (object: any) => {
          object.body = {
            setSize: vi.fn(),
            updateFromGameObject: vi.fn(),
          };
        },
        staticGroup: () => ({
          add: (object: any) => groupObjects.push(object),
          destroy: vi.fn(),
        }),
      },
    },
    tweens: {
      add: () => ({ remove: vi.fn() }),
    },
    time: {
      delayedCall: () => ({ remove: vi.fn() }),
    },
  };
  return { scene, groupObjects };
}

describe('Coop-Defense dormant mission structures', () => {
  it('resolves a dormant base with its single linked objective', () => {
    const map = makeDormantMap();
    const spec = resolveCoopDefenseActivityBases(map).find((base) => base.id === DORMANT_BASE_ID);

    expect(spec).toMatchObject({
      dormant: true,
      dormantObjectiveId: DORMANT_OBJECTIVE_ID,
    });
  });

  it('rejects dormant structures without exactly one objective and rejects non-dormant targets', () => {
    const baseMap = makeDormantMap();
    const dormantBase = baseMap.bases.find((base) => base.id === DORMANT_BASE_ID)!;
    const objective = baseMap.secondaryObjectives![0];

    expect(() => normalizeCoopDefenseMapConfig(withMapChanges({
      secondaryObjectives: undefined,
      bases: baseMap.bases,
    }))).toThrow(/must be referenced by exactly one secondary objective/);

    expect(() => normalizeCoopDefenseMapConfig(withMapChanges({
      bases: baseMap.bases.map((base) => base.id === dormantBase.id ? { ...base, dormant: false } : base),
      secondaryObjectives: [objective],
    }))).toThrow(/must be marked dormant/);

    expect(() => normalizeCoopDefenseMapConfig(withMapChanges({
      secondaryObjectives: [objective, { ...objective, id: 'duplicate-link' }],
    }))).toThrow(/must be referenced by exactly one secondary objective/);
  });

  it('rejects dormant main bases', () => {
    const baseMap = makeDormantMap();
    expect(() => normalizeCoopDefenseMapConfig(withMapChanges({
      bases: baseMap.bases.map((base) => base.id === DORMANT_BASE_ID
        ? { ...base, role: 'main' as const }
        : base),
    }))).toThrow(/must not use role main/);
  });

  it('resolves an authored damaged start state without touching the maximum', () => {
    const damaged = resolveCoopDefenseActivityBases(withMapChanges({
      bases: makeDormantMap().bases.map((base) => base.id === DORMANT_BASE_ID
        ? { ...base, startHpFactor: 0.25 }
        : base),
    })).find((base) => base.id === DORMANT_BASE_ID);
    expect(damaged).toMatchObject({ hpMax: 1000, startHp: 250 });

    // Untergrenze 1: Eine auf 0 aufgeloeste Struktur waere von Rundenbeginn an zerstoert und
    // koennte nie aktiviert werden.
    const barely = resolveCoopDefenseActivityBases(withMapChanges({
      bases: makeDormantMap().bases.map((base) => base.id === DORMANT_BASE_ID
        ? { ...base, hpMax: 10, startHpFactor: 0.0001 }
        : base),
    })).find((base) => base.id === DORMANT_BASE_ID);
    expect(barely?.startHp).toBe(1);
  });

  it('rejects an invalid startHpFactor and any damaged main base', () => {
    const damagedBase = (changes: Record<string, unknown>) => withMapChanges({
      bases: makeDormantMap().bases.map((base) => base.id === DORMANT_BASE_ID
        ? { ...base, ...changes }
        : base),
    });

    expect(() => normalizeCoopDefenseMapConfig(damagedBase({ startHpFactor: 0 })))
      .toThrow(/invalid startHpFactor/);
    expect(() => normalizeCoopDefenseMapConfig(damagedBase({ startHpFactor: 1.5 })))
      .toThrow(/invalid startHpFactor/);
    expect(() => normalizeCoopDefenseMapConfig(damagedBase({ startHpFactor: Number.NaN })))
      .toThrow(/invalid startHpFactor/);
    expect(() => normalizeCoopDefenseMapConfig(withMapChanges({
      bases: makeDormantMap().bases.map((base) => base.id === 'test-friendly-main'
        ? { ...base, startHpFactor: 0.25 }
        : base),
    }))).toThrow(/must not use startHpFactor with role main/);
  });

  it('starts a damaged structure below full hp and keeps it out of the client reset', () => {
    const { scene } = makeScene();
    const damaged: BaseSpec = { ...makeBaseSpec('damaged-outpost', {
      dormant: true,
      dormantObjectiveId: 'reveal-outpost',
    }), startHp: 25 };
    const manager = new BaseManager(scene, [damaged], TEST_WORLD_METRICS);
    const entity = manager.getBase(damaged.id)!;

    expect(entity.getHp()).toBe(25);
    expect(entity.getMaxHp()).toBe(100);
    expect(entity.isDestroyed()).toBe(false);
    // Dormanz-Garantie: kein HP-Delta im Basis-Snapshot, obwohl die Struktur beschaedigt ist.
    expect(manager.getNetSnapshot()).toHaveLength(0);

    // Der Client leitet den Startzustand aus derselben Map ab; die Delta-Konvention darf ihn
    // waehrend der Dormanz nicht auf volle HP zuruecksetzen.
    manager.applySnapshot([]);
    expect(entity.getHp()).toBe(25);

    manager.setSecondaryObjectiveStateProvider(() => 'active');
    expect(entity.isDormant()).toBe(false);
    expect(manager.getNetSnapshot()).toMatchObject([{ id: damaged.id, hp: 25, maxHp: 100 }]);

    manager.heal(damaged.id, 500);
    expect(entity.getHp()).toBe(100);
    expect(manager.getNetSnapshot()).toHaveLength(0);
  });

  it('includes a destroyed active structure as an explicit zero-hp snapshot', () => {
    const { scene } = makeScene();
    const active = makeBaseSpec('destroyed-active-outpost');
    const manager = new BaseManager(scene, [active], TEST_WORLD_METRICS);

    manager.applyDamage(active.id, active.hpMax);

    const snapshot = manager.getNetSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ id: active.id, hp: 0, maxHp: active.hpMax });
  });

  it('applies an explicit zero-hp snapshot to the client as a destroyed state', () => {
    const { scene: hostScene } = makeScene();
    const active = makeBaseSpec('destroyed-active-outpost');
    const host = new BaseManager(hostScene, [active], TEST_WORLD_METRICS);
    host.applyDamage(active.id, active.hpMax);

    const { scene: clientScene } = makeScene();
    const client = new BaseManager(clientScene, [active], TEST_WORLD_METRICS);
    client.applySnapshot(host.getNetSnapshot());

    const clientBase = client.getBase(active.id)!;
    expect(clientBase.getHp()).toBe(0);
    expect(clientBase.isDestroyed()).toBe(true);
  });

  it('does not revive a client-destroyed structure when a later delta omits it', () => {
    const { scene: hostScene } = makeScene();
    const active = makeBaseSpec('destroyed-active-outpost');
    const host = new BaseManager(hostScene, [active], TEST_WORLD_METRICS);
    host.applyDamage(active.id, active.hpMax);

    const { scene: clientScene } = makeScene();
    const client = new BaseManager(clientScene, [active], TEST_WORLD_METRICS);
    client.applySnapshot(host.getNetSnapshot());
    client.applySnapshot([]);

    const clientBase = client.getBase(active.id)!;
    expect(clientBase.getHp()).toBe(0);
    expect(clientBase.isDestroyed()).toBe(true);
  });

  it('keeps dormant structures out of world state until the objective activates', () => {
    const { scene } = makeScene();
    const active = makeBaseSpec('active-outpost', { turret: true });
    const dormant = makeBaseSpec('dormant-outpost', {
      dormant: true,
      dormantObjectiveId: 'reveal-outpost',
      turret: true,
    });
    const manager = new BaseManager(scene, [active, dormant], TEST_WORLD_METRICS);
    const dormantEntity = manager.getBase(dormant.id)!;

    expect(dormantEntity.isDormant()).toBe(true);
    expect(dormantEntity.isInert()).toBe(true);
    expect(dormantEntity.getCellBodies()).toHaveLength(0);
    expect(dormantEntity.getTurrets()).toHaveLength(0);
    expect(dormantEntity.getLightSpots()).toHaveLength(0);
    expect(manager.getObstacleRectangles()).toHaveLength(1);
    expect(manager.getActiveBaseIds()).toEqual(new Set([active.id]));
    expect(manager.getNetSnapshot().map((entry) => entry.id)).toEqual([active.id]);

    const lighting = {
      setLight: vi.fn(),
      releaseLight: vi.fn(),
    } as unknown as LightingSystem;
    manager.setLightingSystem(lighting);
    manager.syncLights();
    expect((lighting.setLight as ReturnType<typeof vi.fn>).mock.calls
      .every(([key]) => !String(key).includes(dormant.id))).toBe(true);
  });

  it('activates exactly once, restores turrets and increments obstacles', () => {
    const { scene, groupObjects } = makeScene();
    const dormant = makeBaseSpec('dormant-outpost', {
      dormant: true,
      dormantObjectiveId: 'reveal-outpost',
      turret: true,
    });
    const manager = new BaseManager(scene, [dormant], TEST_WORLD_METRICS);
    const activated = vi.fn();
    manager.setOnBaseActivated(activated);
    const state: CoopDefenseSecondaryObjectiveState = 'active';
    manager.setSecondaryObjectiveStateProvider((objectiveId) => (
      objectiveId === 'reveal-outpost' ? state : null
    ));

    expect(activated).toHaveBeenCalledTimes(1);
    expect(manager.getObstacleGeneration()).toBe(1);
    expect(manager.getObstacleRectangles()).toHaveLength(1);
    expect(manager.getActiveBaseIds()).toEqual(new Set([dormant.id]));
    expect(manager.getBase(dormant.id)!.getTurrets()).toHaveLength(1);
    expect(manager.getTurrets()[0]?.id).toBe('dormant-outpost-turret');
    expect(groupObjects).toHaveLength(1);

    manager.setTurretAngle('dormant-outpost-turret', 1.25);
    expect(manager.getTurrets()[0]?.angle).toBe(1.25);
    manager.syncDormantStates();
    expect(activated).toHaveBeenCalledTimes(1);
    expect(manager.getObstacleGeneration()).toBe(1);
  });

  it('suppresses linked pedestal registration until its base is active', () => {
    let baseActive = false;
    const layout = {
      powerUpPedestals: [{
        id: 7,
        defId: 'HEALTH_PACK',
        gridX: 12,
        gridY: 8,
        linkedBaseId: 'dormant-outpost',
      }],
      rocks: [],
      trees: [],
      tracks: [],
    } as any;
    const deps = {
      healToFull: vi.fn(),
      addArmor: vi.fn(),
      isAlive: vi.fn(() => true),
      isBurrowed: vi.fn(() => false),
      applyDamage: vi.fn(),
      applyExplosionDamage: vi.fn(),
    } as any;
    const powerUps = new PowerUpSystem(null as any, deps, layout, {
      isLinkedBaseActive: () => baseActive,
    });

    expect(powerUps.getPedestalSnapshot()).toHaveLength(0);
    baseActive = true;
    powerUps.activatePedestalsLinkedToBase('dormant-outpost');
    expect(powerUps.getPedestalSnapshot()).toHaveLength(1);
    powerUps.activatePedestalsLinkedToBase('dormant-outpost');
    expect(powerUps.getPedestalSnapshot()).toHaveLength(1);
  });
});
