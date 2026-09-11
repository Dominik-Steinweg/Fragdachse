import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { RockGridIndex } from '../../src/arena/RockGridIndex';
import { RockHpRegistry } from '../../src/arena/RockHpRegistry';
import type { CombatSource } from '../../src/combat/CombatScope';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { PlacementSystem } from '../../src/systems/PlacementSystem';
import type { ArenaLayout, SyncedPlaceableRock } from '../../src/types';
import { ConstructionWorldRuntime } from '../../src/world/ConstructionWorldRuntime';
import { WorldObjectMutationRuntime } from '../../src/world/WorldObjectMutationRuntime';
import { WorldRockRuntime } from '../../src/world/WorldRockRuntime';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';

const SOURCE: CombatSource = Object.freeze({
  gameplaySource: { kind: 'player', id: 'attacker' },
  attribution: { kind: 'player', id: 'attacker' },
  allegiance: { ownerId: 'attacker' },
  authoredSourceId: 'integration.explosion',
  origin: 'explosion',
});

function resolvedDamage(amount: number) {
  return Object.freeze({
    amount,
    damageKind: 'explosion' as const,
    basis: { kind: 'source-resolved' as const, amount, sourceFactors: [] },
    sourceFactors: [],
    targetFactors: [],
    isCritical: false,
  });
}

function createFixture(options: { readonly throwFromVisuals?: boolean; readonly mgRange?: () => number } = {}) {
  const layout: ArenaLayout = {
    seed: 17,
    rocks: [
      { gridX: 1, gridY: 1 },
      { gridX: 2, gridY: 1, indestructible: true },
    ],
    trees: [],
    tracks: [],
    dirt: [],
    powerUpPedestals: [],
  };
  const metrics = resolveActiveArenaWorldMetrics();
  const rockGrid = new RockGridIndex(layout.rocks, {
    cols: metrics.gridCols,
    rows: metrics.gridRows,
  });
  const placement = new PlacementSystem(
    layout,
    rockGrid,
    { getAllPlayers: () => [] } as never,
    metrics,
  );
  const registry = new RockHpRegistry(layout);
  const rockVisualState = new Map<number, { active: boolean }>([
    [0, { active: true }],
    [1, { active: true }],
  ]);
  const arena = {
    rockPhysicsProxies: [{}, {}],
    rockGroup: { remove: vi.fn() },
    rockGrid,
    rockVisualStates: {
      get: (id: number) => rockVisualState.get(id),
      patch: (id: number, patch: { active?: boolean }) => {
        rockVisualState.set(id, { ...rockVisualState.get(id), ...patch, active: patch.active ?? true });
      },
    },
  };
  const targetStatusCleanup = vi.fn();
  const energyInjectorCleanup = vi.fn();
  const unregisterConstructionPedestal = vi.fn(() => true);
  const unregisterPersistentBaseRewardPedestal = vi.fn(() => true);
  const emitGridChanged = vi.fn();
  const removeVisual = vi.fn(() => {
    if (options.throwFromVisuals) throw new Error('renderer unavailable');
  });
  const updateVisual = vi.fn(() => {
    if (options.throwFromVisuals) throw new Error('renderer unavailable');
  });
  const destroyed: { runtime: SyncedPlaceableRock; cause: string; attackerId?: string }[] = [];
  let spawnedAfterDeath: SyncedPlaceableRock | null = null;

  const construction = new ConstructionWorldRuntime({
    scene: {} as never,
    playerManager: {} as never,
    combatSystem: {} as never,
    placementSystem: placement,
    utilityAction: { useInspectorUtility: vi.fn(), setUtilityPlacementCapability: vi.fn() },
    targetStatusSystem: { removeTarget: targetStatusCleanup } as never,
    energyInjectorSystem: { removeTarget: energyInjectorCleanup } as never,
    powerUpSystem: {
      unregisterConstructionPedestal,
      unregisterPersistentBaseRewardPedestal,
    } as never,
    modifierReadPort: options.mgRange ? { getNumericStat: () => 0,
      getPercentageStat: (_id: string, stat: string) => stat === 'construction.machine_gun_turret.range' ? options.mgRange!() : 0 } as never : null,
    tunnelPlacementPort: null,
    gameAudioSystem: {} as never,
    getGameMode: () => 'coop_defense',
    getPlayerCapabilities: () => ({}) as never,
    getCurrentLoadout: () => null,
    getPersistentBaseContext: () => null,
    persistentBaseBinding: null,
    resolveOwnerId: (id) => id,
    getLocalPlayerId: () => 'owner',
    isHost: () => true,
    acceptsPersistentBaseMutation: () => true,
    mayManagePersistentBase: () => true,
    getRewardPlacementRuntime: () => null,
    emitGridChanged,
    relocatePresentation: vi.fn(),
    reconcilePersistentBaseWorld: vi.fn(),
    publishImmediateContribution: vi.fn(),
    persistRewards: vi.fn(),
    publishRewardSessionState: vi.fn(),
    publishUtilityCooldown: vi.fn(),
    recordConstructionBuilt: vi.fn(),
    onConstructionDestroyed: (runtime, cause, attackerId) => {
      destroyed.push({ runtime, cause, attackerId });
      if (!spawnedAfterDeath && cause === 'damage') {
        spawnedAfterDeath = placement.materializePersistentPlaceable(
          COOP_DEFENSE_CONSTRUCTIONS.rock_barrier,
          7,
          7,
          0,
          'death-spawn',
          0xffffff,
        );
      }
    },
    rockVisualHelper: {
      gridToWorld: (gridX, gridY) => ({ x: gridX, y: gridY }),
      materializePlaceableRock: vi.fn(),
      updatePlaceableRock: updateVisual,
      removePlaceableRockVisual: removeVisual,
    },
  });
  const rocks = new WorldRockRuntime({
    registry,
    arena: arena as never,
    layout,
    metrics,
    onIntegrityChanged: options.throwFromVisuals
      ? () => { throw new Error('renderer unavailable'); }
      : undefined,
  });
  const mutations = new WorldObjectMutationRuntime({
    scope: { worldRevision: 17, runtimeGeneration: 3 },
    metrics,
    rockRegistry: registry,
    rockRuntime: rocks,
    placement,
    construction,
    bases: null,
    train: null,
  });

  return {
    construction,
    destroyed,
    emitGridChanged,
    energyInjectorCleanup,
    mutations,
    placement,
    registry,
    rockGrid,
    removeVisual,
    spawnedAfterDeath: () => spawnedAfterDeath,
    targetStatusCleanup,
    unregisterConstructionPedestal,
    unregisterPersistentBaseRewardPedestal,
    updateVisual,
  };
}

describe('WorldObjectMutationRuntime real-owner integration', () => {
  it('restores personal MG range from current owner data and shares it with placement previews', () => {
    let range = .4;
    const f = createFixture({ mgRange: () => range }), base = COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret;
    const candidate = { gridX: 10, gridY: 10,
      blueprint: { persistentId: 'saved-mg', tool: { kind: 'construction' as const, id: base.id }, relativeGridX: 0, relativeGridY: 0, angle: 0, placementOrder: 0 },
      tool: { kind: 'construction' as const, id: base.id, footprint: base.footprint, maxHp: base.maxHp, capacityCost: base.capacityCost, unlocked: true } };
    const restored = f.construction.materializeRestoreCandidate(candidate, 'owner', 0xffffff, 'host-persistent')!;
    expect(restored.targetRange).toBeCloseTo(base.targetRange * 1.4);
    expect(restored.maxHp).toBe(base.maxHp);
    range = .6;
    const effective = f.construction.getEffectiveDefinition('machine_gun_turret', 'owner');
    const metrics = resolveActiveArenaWorldMetrics(), x = metrics.offsetX + metrics.widthPx / 2, y = metrics.offsetY + metrics.heightPx / 2;
    const preview = f.placement.getConstructionPlacementPreview(effective, x, y, x, y);
    expect(preview?.targetRange).toBeCloseTo(base.targetRange * 1.6);
    expect(f.construction.getEffectiveDefinition('machine_gun_turret', 'owner', false)).toBe(base);
    const independent = f.construction.materializeRestoreCandidate({ ...candidate, gridX: 12 }, 'owner', 0xffffff, 'base-owned')!;
    expect(independent.targetRange).toBe(base.targetRange);
    f.mutations.destroy(); f.construction.destroy();
  });
  it('commits rock damage and repair at the real HP owner without renderer authority', () => {
    const fixture = createFixture({ throwFromVisuals: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const damage = fixture.mutations.applyResolvedDamage(
      'rock', 0, 40, 'attacker', 'integration.rock', 'direct',
    );
    expect(damage).toMatchObject({
      kind: 'damage-applied',
      actualDamage: 40,
      transition: { kind: 'none' },
      target: { kind: 'rock', id: 0 },
      source: { authoredSourceId: 'integration.rock' },
    });
    expect(damage?.outcomeId).toMatch(/^world:damage:rock:0:1:/);
    expect(fixture.registry.readIntegrity(0)?.integrity).toBeGreaterThan(0);

    const repair = fixture.mutations.applyRepair('rock', 0, 15, 'repairer', 'integration.repair');
    expect(repair).toMatchObject({ kind: 'support-applied', supportKind: 'repair', actualAmount: 15 });
    expect(fixture.registry.readIntegrity(0)?.integrity).toBe(
      fixture.registry.getMaxHP(0) - 25,
    );

    const immune = fixture.mutations.applyResolvedDamage(
      'rock', 1, 999, 'attacker', 'integration.immune', 'explosion',
    );
    expect(immune).toMatchObject({ kind: 'accepted-no-effect', reason: 'immune' });
    expect(fixture.registry.readIntegrity(1)?.destroyed).toBe(false);

    const destroyed = fixture.mutations.applyResolvedDamage(
      'rock', 0, 9999, 'attacker', 'integration.terminal', 'explosion',
    );
    expect(destroyed).toMatchObject({
      kind: 'damage-applied',
      transition: { kind: 'destroyed', facts: { targetCategory: 'rock' } },
      resultingState: { destroyed: true },
    });
    expect(fixture.rockGrid.getIndex(1, 1)).toBe(-1);
    expect(fixture.mutations.applyResolvedDamage(
      'rock', 0, 1, 'attacker', 'integration.inert', 'direct',
    )).toMatchObject({ kind: 'rejected', reason: 'target-dead' });
    expect(fixture.mutations.applyRepair(
      'rock', 0, 1, 'repairer', 'integration.inert-repair',
    )).toMatchObject({ kind: 'rejected', reason: 'target-dead' });
  });

  it('deduplicates aliases before mutation and finalizes a renderer-free death exactly once', () => {
    const fixture = createFixture({ throwFromVisuals: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const placed = fixture.placement.materializePersistentPlaceable(
      COOP_DEFENSE_CONSTRUCTIONS.rock_barrier,
      5,
      5,
      0,
      'owner',
      0xffffff,
    );
    expect(placed).not.toBeNull();
    if (!placed) return;

    const partial = fixture.mutations.applyResolvedDamage(
      'construction', placed.id, 50, 'attacker', 'integration.partial', 'direct',
    );
    expect(partial).toMatchObject({ kind: 'damage-applied', actualDamage: 50 });
    expect(fixture.placement.readIntegrity(placed.id)?.integrity).toBe(150);
    expect(fixture.mutations.applyRepair(
      'construction', placed.id, 25, 'repairer', 'integration.repair',
    )).toMatchObject({ kind: 'support-applied', actualAmount: 25 });
    expect(fixture.placement.readIntegrity(placed.id)?.integrity).toBe(175);

    const outcomes = fixture.mutations.commitDamageUnit([
      { kind: 'rock', id: placed.id, damage: resolvedDamage(999) },
      { kind: 'construction', id: placed.id, damage: resolvedDamage(999) },
    ], SOURCE);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      kind: 'damage-applied',
      actualDamage: 175,
      transition: { kind: 'destroyed' },
      target: { kind: 'construction', id: placed.id },
      source: { authoredSourceId: 'integration.explosion' },
    });
    expect(outcomes[0]?.outcomeId).toMatch(
      new RegExp(`^world:damage:placement:${placed.id}:\\d+$`),
    );
    expect(fixture.placement.getRuntimeRock(placed.id)).toBeUndefined();
    expect(fixture.targetStatusCleanup).toHaveBeenCalledOnce();
    expect(fixture.energyInjectorCleanup).toHaveBeenCalledOnce();
    expect(fixture.emitGridChanged).toHaveBeenCalledOnce();
    expect(fixture.destroyed).toEqual([{ runtime: expect.objectContaining({ id: placed.id }), cause: 'damage', attackerId: 'attacker' }]);
    expect(fixture.removeVisual).toHaveBeenCalledOnce();

    const spawned = fixture.spawnedAfterDeath();
    expect(spawned).not.toBeNull();
    expect(spawned && fixture.placement.readIntegrity(spawned.id)?.destroyed).toBe(false);
    expect(fixture.mutations.applyResolvedDamage(
      'construction', placed.id, 999, 'attacker', 'integration.duplicate', 'direct',
    )).toBeNull();
    fixture.construction.finalizeRemovedRuntime(placed, 'removal', false);
    expect(fixture.targetStatusCleanup).toHaveBeenCalledOnce();
    expect(fixture.removeVisual).toHaveBeenCalledOnce();
  });

  it('keeps collider-free rewards inert and deregisters external teardown only once', () => {
    const fixture = createFixture();
    const reward = fixture.placement.materializePersistentBaseReward(
      COOP_DEFENSE_CONSTRUCTIONS.spore_turret,
      'base_spore_turret',
      9,
      9,
      0,
      'base-owner',
      0xffffff,
    );
    expect(reward).toMatchObject({ collisionMode: 'none', indestructible: true });
    if (!reward) return;

    expect(fixture.mutations.applyResolvedDamage(
      'construction', reward.id, 999, 'attacker', 'integration.collider-free', 'explosion',
    )).toMatchObject({ kind: 'accepted-no-effect', reason: 'immune' });
    const removed = fixture.placement.removeRock(reward.id);
    expect(removed).not.toBeUndefined();
    if (!removed) return;
    fixture.mutations.finalizeRemovedConstruction(removed, 'teardown', false);
    fixture.mutations.finalizeRemovedConstruction(removed, 'removal', false);

    expect(fixture.unregisterPersistentBaseRewardPedestal).toHaveBeenCalledOnce();
    expect(fixture.unregisterConstructionPedestal).not.toHaveBeenCalled();
    expect(fixture.targetStatusCleanup).toHaveBeenCalledOnce();
    expect(fixture.removeVisual).toHaveBeenCalledOnce();
    expect(fixture.destroyed).toEqual([{ runtime: expect.objectContaining({ id: reward.id }), cause: 'teardown', attackerId: undefined }]);
  });
});
