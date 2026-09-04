import { fakeEntity } from './fakeEntity';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    DegToRad: Math.PI / 180,
  },
  Scenes: {
    Events: {
      SHUTDOWN: 'shutdown',
    },
  },
}));

import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';
import type { CoopDefenseUpgradeProfile, TrackedProjectile } from '../src/types';
import { Ak47BehaviorRuntime } from '../src/world/Ak47BehaviorRuntime';
import { Ak47StrategicTargetSystem } from '../src/systems/Ak47StrategicTargetSystem';
import { Ak47StrategicTargetRenderer } from '../src/effects/Ak47StrategicTargetRenderer';

function profile(levels: Readonly<Record<string, number>>): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(Object.entries(levels).map(([id, level]) => [
      id,
      { unlocked: true, level },
    ])),
  };
}

function akConfig(levels: Readonly<Record<string, number>>) {
  return applyCoopDefenseModifiersToWeaponConfig(
    WEAPON_CONFIGS.AK47,
    'weapon2',
    getCoopDefenseResolvedEffectTotals(profile(levels)),
  );
}

function makeBehavior(config: ReturnType<typeof akConfig>): any {
  const behavior = new Ak47BehaviorRuntime({
    getEquippedWeaponConfig: (_playerId, slot) => slot === 'weapon2' ? config : undefined,
  });
  behavior.resetPlayer('p1');
  return behavior;
}

function projectile(shotId: number, overrides: Partial<TrackedProjectile> = {}): TrackedProjectile {
  return {
    id: shotId,
    ownerId: 'p1',
    ak47ShotId: shotId,
    ak47HitConfirmed: false,
    ak47FireSuperiorityShot: false,
    ...overrides,
  } as TrackedProjectile;
}

describe('AK-47 Coop-Defense-Upgradebaum', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps nine post-unlock nodes, two columns, and exactly two boss upgrades', () => {
    const ids = [
      'ak47_firepower', 'ak47_rhythm', 'ak47_rock_destruction',
      'ak47_fire_control', 'ak47_fire_superiority', 'ak47_breakthrough_magazine',
      'ak47_strategic_targets', 'ak47_target_prioritization', 'ak47_explosive_target_acquisition',
    ];
    expect(ids.every(id => COOP_DEFENSE_UPGRADE_DEFINITIONS[id])).toBe(true);
    expect(ids.filter(id => COOP_DEFENSE_UPGRADE_DEFINITIONS[id]?.bossPointCostPerLevel).sort())
      .toEqual(['ak47_fire_superiority', 'ak47_strategic_targets']);
    expect(getCoopDefenseUpgradeDefinition('ak47_fire_superiority')?.requires)
      .toEqual([{ upgradeId: 'ak47_fire_control', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('ak47_strategic_targets')?.requires).toEqual([
      { upgradeId: 'ak47_rock_destruction', minLevel: 1 },
      { upgradeId: 'ak47_breakthrough_magazine', minLevel: 1 },
    ]);
  });

  it('shares the configured stack cap and combines firepower/fire-control additively', () => {
    const firepower = akConfig({ unlock_ak47: 1, ak47_firepower: 1 });
    const control = akConfig({ unlock_ak47: 1, ak47_fire_control: 1 });
    const combined = akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_fire_control: 1, ak47_rhythm: 3 });
    expect(firepower.ak47Focus?.maxStacks).toBeGreaterThan(0);
    expect(control.ak47Focus?.maxStacks).toBe(0);
    expect(control.ak47Focus?.fireControlEnabled).toBe(1);
    expect(combined.ak47Focus?.maxStacks).toBe(firepower.ak47Focus?.maxStacks);
    expect(combined.ak47Focus?.damagePerStack).toBeGreaterThan(0);
    expect(combined.ak47Focus?.fireControlSpreadPerStack).toBeGreaterThan(0);
    expect(combined.ak47Focus?.fireControlRangePerStack).toBeGreaterThan(0);
    expect(combined.ak47Focus?.fireControlProjectileSpeedPerStack).toBeGreaterThan(0);

    const controlBehavior = makeBehavior(control);
    for (let shotId = 1; shotId <= (firepower.ak47Focus?.maxStacks ?? 0); shotId += 1) {
      controlBehavior.registerProjectileHit(projectile(shotId), shotId);
    }
    expect(controlBehavior.getHudBuffs('p1', 0)[0]).toMatchObject({
      stacks: firepower.ak47Focus?.maxStacks,
      maxStacks: firepower.ak47Focus?.maxStacks,
    });
  });

  it('resolves rhythm, rock levels, and breakthrough ammunition from the upgrade definitions', () => {
    const withoutRhythm = akConfig({ unlock_ak47: 1, ak47_firepower: 1 }).ak47Focus?.damagePerStack ?? 0;
    const withRhythm = akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_rhythm: 1 }).ak47Focus?.damagePerStack ?? 0;
    expect(withRhythm).toBeGreaterThan(withoutRhythm);

    const rockDefinition = getCoopDefenseUpgradeDefinition('ak47_rock_destruction');
    expect(rockDefinition?.maxLevel).toBeGreaterThan(0);
    const rockAtOne = akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_rhythm: 1, ak47_rock_destruction: 1 }).rockDamageMult;
    const rockPastMax = akConfig({
      unlock_ak47: 1,
      ak47_firepower: 1,
      ak47_rhythm: 1,
      ak47_rock_destruction: (rockDefinition?.maxLevel ?? 1) + 1,
    }).rockDamageMult;
    expect(rockAtOne).toBeGreaterThan(0);
    expect(rockPastMax).toBe(rockAtOne);

    const magazineMaxLevel = getCoopDefenseUpgradeDefinition('ak47_breakthrough_magazine')?.maxLevel ?? 0;
    const shotsByLevel = Array.from({ length: magazineMaxLevel + 1 }, (_, level) => (
      akConfig({ unlock_ak47: 1, ak47_fire_control: 1, ak47_fire_superiority: 1, ak47_breakthrough_magazine: level })
        .ak47Focus?.fireSuperiorityShots ?? 0
    ));
    expect(shotsByLevel[0]).toBeGreaterThanOrEqual(0);
    for (let index = 1; index < shotsByLevel.length; index += 1) {
      expect(shotsByLevel[index]).toBeGreaterThanOrEqual(shotsByLevel[index - 1]);
    }
    expect(akConfig({ unlock_ak47: 1 }).rockDamageMult).toBe(0);
  });

  it('builds one shared hit chain, protects full stacks during breakthrough, and does not retrigger while pending', () => {
    const config = akConfig({
      unlock_ak47: 1,
      ak47_firepower: 1,
      ak47_fire_control: 1,
      ak47_fire_superiority: 1,
    });
    const behavior = makeBehavior(config);
    for (let shotId = 1; shotId <= 5; shotId += 1) {
      behavior.registerProjectileHit(projectile(shotId), shotId);
    }
    expect(behavior.getHudBuffs('p1', 0)).toEqual(expect.arrayContaining([
      expect.objectContaining({ defId: 'AK47_FOCUS', stacks: 5 }),
      expect.objectContaining({ defId: 'AK47_FIRE_SUPERIORITY', availableCount: 3 }),
    ]));

    const miss = projectile(6);
    behavior.resolveProjectile(miss);
    expect(behavior.getHudBuffs('p1', 0)[0]).toMatchObject({ stacks: 5 });

    const state = (behavior as any).states.get('p1');
    state.stacks = 5;
    state.fireSuperiorityShotsAvailable = 0;
    state.pendingFireSuperiorityShotIds.add(99);
    behavior.registerProjectileHit(projectile(7), 7);
    expect(state.fireSuperiorityShotsAvailable).toBe(0);
    expect(state.pendingFireSuperiorityShotIds.has(99)).toBe(true);

    behavior.resolveProjectile(projectile(99, { ak47FireSuperiorityShot: true }));
    expect(state.stacks).toBe(0);
  });

  it('refunds the concrete strategic penetrator once and ends only after pending resolves', () => {
    const behavior = makeBehavior(akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_fire_control: 1, ak47_fire_superiority: 1 }));
    const state = (behavior as any).states.get('p1');
    state.fireSuperiorityShotsAvailable = 0;
    state.fireSuperiorityTotalShots = 1;
    state.pendingFireSuperiorityShotIds.add(10);
    const shot = projectile(10, { ak47FireSuperiorityShot: true });

    expect(behavior.registerStrategicTargetHit(shot, 'enemy-1')).toBe(true);
    expect(behavior.registerStrategicTargetHit(shot, 'enemy-2')).toBe(false);
    expect(state.fireSuperiorityShotsAvailable).toBe(1);
    expect(behavior.isFireSuperiorityActive('p1')).toBe(true);
    expect(behavior.isFireSuperiorityAvailable('p1')).toBe(true);

    behavior.resolveProjectile(shot);
    expect(state.pendingFireSuperiorityShotIds.size).toBe(0);
    expect(state.fireSuperiorityShotsAvailable).toBe(1);

    state.fireSuperiorityShotsAvailable = 0;
    state.pendingFireSuperiorityShotIds.add(11);
    expect(behavior.isFireSuperiorityActive('p1')).toBe(true);
    expect(behavior.isFireSuperiorityAvailable('p1')).toBe(false);
  });
});

function makeTargetFixture(focus: any) {
  const enemies = [
    fakeEntity({ id: 'near', kind: 'zombie-badger', faction: 'hostile', x: 1000, y: 0, rotation: 0, active: true, getHp: () => 100, isBurrowed: () => false }),
    fakeEntity({ id: 'far', kind: 'inferno-colossus', faction: 'hostile', x: 300, y: 300, rotation: 0, active: true, getHp: () => 100, isBurrowed: () => false }),
  ] as any[];
  const player = fakeEntity({ id: 'p1', x: 0, y: 0, rotation: 0 }) as any;
  const enemyManager = {
    getAllEnemies: () => enemies,
    getEnemy: (id: string) => enemies.find(enemy => enemy.id === id),
  } as any;
  const playerManager = {
    getAllPlayers: () => [player],
    getPlayer: () => player,
  } as any;
  const combat = {
    canDamageTarget: () => true,
    hasLineOfSight: (_x: number, _y: number, x: number) => x !== 1000,
  } as any;
  const loadout = {
    getEquippedWeaponConfig: () => ({ id: 'AK47', ak47Focus: focus }),
  } as any;
  const behavior = { registerStrategicTargetHit: vi.fn() };
  return {
    enemies,
    player,
    behavior,
    system: new Ak47StrategicTargetSystem(playerManager, enemyManager, combat, loadout, behavior),
  };
}

function makeRendererFixture() {
  const graphicsObjects: any[] = [];
  const containers: any[] = [];
  const tweens: any[] = [];

  const scene = {
    events: { once: vi.fn() },
    add: {
      graphics: () => {
        const g: any = {
          clear: vi.fn().mockReturnThis(),
          lineStyle: vi.fn().mockReturnThis(),
          lineBetween: vi.fn().mockReturnThis(),
          beginPath: vi.fn().mockReturnThis(),
          arc: vi.fn().mockReturnThis(),
          strokePath: vi.fn().mockReturnThis(),
          strokeCircle: vi.fn().mockReturnThis(),
          setVisible: vi.fn(function (this: any, v: boolean) { this.visible = v; return this; }),
          visible: true,
        };
        graphicsObjects.push(g);
        return g;
      },
      container: (x: number, y: number, children: any[]) => {
        const c: any = {
          x,
          y,
          children,
          visible: false,
          alpha: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          depth: 0,
          setDepth: vi.fn().mockReturnThis(),
          setVisible: vi.fn(function (this: any, v: boolean) { this.visible = v; return this; }),
          setAlpha: vi.fn(function (this: any, a: number) { this.alpha = a; return this; }),
          setScale: vi.fn(function (this: any, s: number) { this.scale = s; this.scaleX = s; this.scaleY = s; return this; }),
          setRotation: vi.fn(function (this: any, r: number) { this.rotation = r; return this; }),
          setPosition: vi.fn(function (this: any, px: number, py: number) { this.x = px; this.y = py; return this; }),
          destroy: vi.fn(),
        };
        containers.push(c);
        return c;
      },
    },
    tweens: {
      add: (config: any) => {
        const tween = {
          stop: vi.fn(),
          config,
        };
        tweens.push(tween);
        config.onComplete?.();
        return tween;
      },
    },
  } as any;

  const renderer = new Ak47StrategicTargetRenderer(scene);
  renderer.build();
  return { scene, renderer, graphicsObjects, containers, tweens };
}

describe('AK-47 Strategische Ziele', () => {
  it('stays active permanently once unlocked and debounces a replacement target for exactly 200ms after death', () => {
    const { enemies, system } = makeTargetFixture({
      strategicTargetEnabled: 1,
      strategicTargetDamageBonus: 0.25,
      targetPrioritizationEnabled: 0,
      explosiveTargetAcquisitionLevel: 0,
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    system.hostUpdate(0);
    expect(system.getNetSnapshot(0)).toHaveLength(1);
    const marked = system.getNetSnapshot(0)[0];

    // Target selection remains active independently from focus stacks.
    system.hostUpdate(100);
    expect(system.getNetSnapshot(100)).toHaveLength(1);
    expect(system.isCurrentTarget('p1', marked.enemyId)).toBe(true);

    // Target dies
    enemies.find(enemy => enemy.id === marked.enemyId).getHp = () => 0;

    system.hostUpdate(1000);
    expect(system.getNetSnapshot(1000)).toHaveLength(0);
    system.hostUpdate(1199);
    expect(system.getNetSnapshot(1199)).toHaveLength(0);
    system.hostUpdate(1200);
    expect(system.getNetSnapshot(1200)).toHaveLength(1);
    system.hostUpdate(9000);
    expect(system.getNetSnapshot(9000)).toHaveLength(1);
  });

  it('stays active when stacks are lost and does not cascade replacements on multi-kills', () => {
    const fixture = makeTargetFixture({
      strategicTargetEnabled: 1,
      strategicTargetDamageBonus: 0.25,
      targetPrioritizationEnabled: 0,
      explosiveTargetAcquisitionLevel: 0,
    });
    fixture.system.hostUpdate(0);
    const marked = fixture.system.getNetSnapshot(0)[0]?.enemyId;
    expect(marked).toBeTruthy();

    fixture.system.hostUpdate(1);
    expect(fixture.system.getNetSnapshot(1)).toHaveLength(1);
    expect(fixture.system.isCurrentTarget('p1', marked!)).toBe(true);

    const directHit = fixture.system.handleDirectAk47EnemyHit(projectile(1), marked!, 2);
    expect(directHit).toEqual({
      damageMultiplier: 1.25,
      explosionRadius: 0,
      explosionDamageFraction: 0,
    });

    fixture.enemies.forEach(enemy => { enemy.getHp = () => 0; });
    fixture.system.hostUpdate(3);
    fixture.system.hostUpdate(201);
    expect(fixture.system.getNetSnapshot(201)).toHaveLength(0);
    fixture.system.hostUpdate(202);
    expect(fixture.system.getNetSnapshot(202)).toHaveLength(0);
  });

  it('uses random visible targets normally and cursor-first selection with the follow-up', () => {
    const normal = makeTargetFixture({
      strategicTargetEnabled: 1,
      strategicTargetDamageBonus: 0.25,
      targetPrioritizationEnabled: 0,
      explosiveTargetAcquisitionLevel: 0,
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    normal.system.hostUpdate(0);
    expect(normal.system.getNetSnapshot(0)[0]?.enemyId).toBe('far');

    const prioritized = makeTargetFixture({
      strategicTargetEnabled: 1,
      strategicTargetDamageBonus: 0.25,
      targetPrioritizationEnabled: 1,
      explosiveTargetAcquisitionLevel: 3,
    });
    prioritized.system.hostUpdate(0);
    expect(prioritized.system.getNetSnapshot(0)[0]?.enemyId).toBe('near');
    for (const [level, radius, fraction] of [[1, 35, 0.2], [2, 50, 0.3], [3, 65, 0.4]] as const) {
      const fixture = makeTargetFixture({
        strategicTargetEnabled: 1,
        strategicTargetDamageBonus: 0.25,
        targetPrioritizationEnabled: 1,
        explosiveTargetAcquisitionLevel: level,
      });
      fixture.system.hostUpdate(0);
      expect(fixture.system.getNetSnapshot(0)[0]?.enemyId).toBe('near');
      expect(fixture.system.handleDirectAk47EnemyHit(projectile(level), 'near', 0))
        .toEqual({ damageMultiplier: 1.25, explosionRadius: radius, explosionDamageFraction: fraction });
    }
  });

  it('only renders the local player strategic target and filters out foreign targets', () => {
    const { renderer, containers } = makeRendererFixture();
    const enemy = fakeEntity({ id: 'e1', x: 350, y: 420, active: true, width: 32, height: 32, scaleX: 1, scaleY: 1, displayWidth: 32, displayHeight: 32, getHp: () => 100 });

    // Snapshot contains only target for foreign player 'p2'
    renderer.sync(
      [{ ownerId: 'p2', enemyId: 'e1', confirmationUntil: 0 }],
      enemy,
      'p1', // local player
      1000,
      true,
    );
    expect(containers[0].visible).toBe(false);

    // Snapshot contains target for local player 'p1'
    renderer.sync(
      [
        { ownerId: 'p2', enemyId: 'e1', confirmationUntil: 0 },
        { ownerId: 'p1', enemyId: 'e1', confirmationUntil: 0 },
      ],
      enemy,
      'p1', // local player
      1000,
      true,
    );
    expect(containers[0].visible).toBe(true);
    expect(containers[0].x).toBe(350);
    expect(containers[0].y).toBe(420);

    // If enemy dies / inactive, marker is hidden
    enemy.sprite.active = false;
    renderer.sync(
      [{ ownerId: 'p1', enemyId: 'e1', confirmationUntil: 0 }],
      enemy,
      'p1',
      1001,
      true,
    );
    expect(containers[0].visible).toBe(false);
  });

  it('shows hit confirmation graphics when confirmationUntil is active', () => {
    const { renderer, graphicsObjects } = makeRendererFixture();
    const enemy = fakeEntity({ id: 'e1', x: 100, y: 100, active: true, width: 32, height: 32, scaleX: 1, scaleY: 1, displayWidth: 32, displayHeight: 32, getHp: () => 100 });
    const confirmationGraphics = graphicsObjects[1]; // second graphics object is confirmation

    // With confirmationUntil in future (hit confirmation active)
    renderer.sync(
      [{ ownerId: 'p1', enemyId: 'e1', confirmationUntil: 1150 }],
      enemy,
      'p1',
      1000,
      true,
    );
    expect(confirmationGraphics.visible).toBe(true);

    // After confirmation expires
    renderer.sync(
      [{ ownerId: 'p1', enemyId: 'e1', confirmationUntil: 1150 }],
      enemy,
      'p1',
      1200,
      true,
    );
    expect(confirmationGraphics.visible).toBe(false);
  });
});
