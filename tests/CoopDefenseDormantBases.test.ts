import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
}));

import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { resolveCoopDefenseBases, type BaseSpec } from '../src/arena/BaseRegistry';
import { BaseManager } from '../src/entities/BaseManager';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { LightingSystem } from '../src/effects/LightingSystem';
import type { CoopDefenseSecondaryObjectiveState } from '../src/types';

function withMapChanges(changes: Partial<CoopDefenseMapConfig>): CoopDefenseMapConfig {
  return {
    ...getCoopDefenseMapConfig('0'),
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
      weaponId: 'BASE_SPOREN',
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
    const map = getCoopDefenseMapConfig('0');
    const spec = resolveCoopDefenseBases(map).find((base) => base.id === 'dev-dormant-outpost');

    expect(spec).toMatchObject({
      dormant: true,
      dormantObjectiveId: 'dev-dormant-outpost-reveal',
    });
  });

  it('rejects dormant structures without exactly one objective and rejects non-dormant targets', () => {
    const baseMap = getCoopDefenseMapConfig('0');
    const dormantBase = baseMap.bases.find((base) => base.id === 'dev-dormant-outpost')!;
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
    const baseMap = getCoopDefenseMapConfig('0');
    expect(() => normalizeCoopDefenseMapConfig(withMapChanges({
      bases: baseMap.bases.map((base) => base.id === 'dev-dormant-outpost'
        ? { ...base, role: 'main' as const }
        : base),
    }))).toThrow(/must not use role main/);
  });

  it('keeps dormant structures out of world state until the objective activates', () => {
    const { scene } = makeScene();
    const active = makeBaseSpec('active-outpost', { turret: true });
    const dormant = makeBaseSpec('dormant-outpost', {
      dormant: true,
      dormantObjectiveId: 'reveal-outpost',
      turret: true,
    });
    const manager = new BaseManager(scene, [active, dormant]);
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
    const manager = new BaseManager(scene, [dormant]);
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
