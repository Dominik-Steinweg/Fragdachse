import { describe, expect, it } from 'vitest';
import { PersistentBaseEditorModel, getMissedBaseRewards } from '../src/persistentBase/PersistentBaseEditorModel';
import { getStoredCoopDefenseProgress } from '../src/utils/localPreferences';
import { applyPersistentBaseLayoutEdit, sanitizePersistentBaseLayoutEdit } from '../src/persistentBase/PersistentBaseLayoutEdit';
import { COOP_DEFENSE_MAP_CONFIGS } from '../src/config/coopDefenseMaps';
import { getPersistentBaseRewardDefinition } from '../src/persistentBase/PersistentBaseRewardCatalog';
import { PERSISTENT_BASE_REWARD_IDS } from '../src/persistentBase/PersistentBaseRewardTypes';
import type { PersistentConstruction } from '../src/persistentBase/PersistentBaseTypes';
import { resolvePersistentBaseCoreCellsRelative } from '../src/persistentBase/PersistentBaseCore';
import { getBaseEditorAppearance } from '../src/persistentBase/PersistentBaseEditorAppearance';
import { getCoopDefenseConstructionDefinition } from '../src/config/coopDefenseConstructions';

const construction: PersistentConstruction = { persistentId: 'own-wall', tool: { kind: 'construction', id: 'rock_barrier' },
  relativeGridX: 0, relativeGridY: 0, angle: .7, placementOrder: 1 };
function baseline() {
  const progress = getStoredCoopDefenseProgress();
  progress.persistentBaseUnlocked = true;
  progress.persistentBaseRewardUnlocks = [...PERSISTENT_BASE_REWARD_IDS];
  progress.personalBaseContribution = { ...progress.personalBaseContribution, constructions: [{ ...construction }] };
  return progress;
}
const pedestal = PERSISTENT_BASE_REWARD_IDS.find(id => getPersistentBaseRewardDefinition(id).category === 'basePedestal')!;
const turret = PERSISTENT_BASE_REWARD_IDS.find(id => getPersistentBaseRewardDefinition(id).category === 'baseTurret')!;

describe('personal base editor draft', () => {
  it('keeps removed personal builds in the draft list and allows placing them again without changing identity', () => {
    const model = new PersistentBaseEditorModel(baseline());
    const object = { kind: 'construction' as const, id: construction.persistentId };
    model.remove(object);
    expect(model.getPosition(object)).toBeUndefined();
    expect(model.availableConstructions).toHaveLength(1);
    expect(model.dirty).toBe(true);
    expect(model.move(object, 1, 1)).toBe(true);
    expect(model.constructions).toEqual([{ ...construction, relativeGridX: 1, relativeGridY: 1 }]);
    expect(model.move(object, 0, 0)).toBe(true);
    expect(model.dirty).toBe(false);
    expect(model.validate({ kind: 'construction', id: 'invented' }, 1, 1)).toBe('unknown');
  });
  it('uses a wall for personal turret bodies and the authored weapon for both placement and dragging', () => {
    const progress = baseline();
    const definition = getCoopDefenseConstructionDefinition('rocket_turret');
    progress.personalBaseContribution.constructions = [{ ...construction, tool: { kind: 'construction', id: definition.id } }];
    const model = new PersistentBaseEditorModel(progress);
    const object = { kind: 'construction' as const, id: construction.persistentId };
    const appearance = getBaseEditorAppearance(model, object);
    expect(definition.kind).toBe('turret');
    expect(appearance).toMatchObject({ wall: true, footprint: definition.footprint, angle: construction.angle });
    if (definition.kind === 'turret') expect(appearance?.weapon).toBe(definition.weaponId);
    model.remove(object);
    expect(getBaseEditorAppearance(model, object)).toEqual(appearance);
    expect(getBaseEditorAppearance(model, { kind: 'reward', id: turret })?.wall).toBe(false);
  });
  it('allows pedestals only on free ground and reserves solid base surfaces for reward turrets', () => {
    const model = new PersistentBaseEditorModel(baseline());
    for (const cell of resolvePersistentBaseCoreCellsRelative()) {
      const { relativeGridX: x, relativeGridY: y, domain } = cell;
      if (domain === 'base-surface') {
        expect(model.validate({ kind: 'reward', id: pedestal }, x, y)).toBe('surface');
        expect(model.validate({ kind: 'reward', id: turret }, x, y)).toBeNull();
      } else if (x !== 0 || y !== 0) {
        expect(model.validate({ kind: 'reward', id: pedestal }, x, y)).toBeNull();
      }
    }
    expect(model.validate({ kind: 'reward', id: pedestal }, 0, 0)).toBe('occupied');
    model.move({ kind: 'reward', id: pedestal }, 1, 1);
    const anotherPedestal = PERSISTENT_BASE_REWARD_IDS.find(id => id !== pedestal
      && getPersistentBaseRewardDefinition(id).category === 'basePedestal')!;
    expect(model.validate({ kind: 'reward', id: anotherPedestal }, 1, 1)).toBe('occupied');
  });
  it('keeps changes local, uses the actual surface rules, rejects occupied/outside cells and preserves angles', () => {
    const progress = baseline(); const original = structuredClone(progress);
    const model = new PersistentBaseEditorModel(progress);
    expect(model.move({ kind: 'reward', id: pedestal }, 0, 0)).toBe(false);
    expect(model.move({ kind: 'reward', id: turret }, 1, 1)).toBe(false);
    expect(model.move({ kind: 'reward', id: pedestal }, 100, 100)).toBe(false);
    expect(model.move({ kind: 'reward', id: pedestal }, 1, 1)).toBe(true);
    expect(model.move({ kind: 'construction', id: construction.persistentId }, -1, -1)).toBe(true);
    expect(model.constructions[0].angle).toBe(construction.angle);
    expect(model.rewards[0].angle).toBe(0);
    expect(model.unplaced).not.toContain(pedestal);
    model.remove({ kind: 'reward', id: pedestal });
    expect(model.unplaced).toContain(pedestal);
    expect(progress).toEqual(original);
  });
  it('lists missing rewards only for actual completed maps and removes granted rewards', () => {
    const map = COOP_DEFENSE_MAP_CONFIGS.find(map => map.secondaryObjectives?.some(o => o.rewards?.persistentBaseRewardsOnComplete?.length))!;
    const rewardId = map.secondaryObjectives!.flatMap(o => o.rewards?.persistentBaseRewardsOnComplete ?? [])[0];
    const progress = { completedMapIds: [], persistentBaseRewardUnlocks: [] };
    expect(getMissedBaseRewards(progress)).toEqual([]);
    expect(getMissedBaseRewards({ ...progress, completedMapIds: [map.mapId] })).toContainEqual(expect.objectContaining({ rewardId, mapId: map.mapId }));
    expect(getMissedBaseRewards({ completedMapIds: [map.mapId], persistentBaseRewardUnlocks: [rewardId] }).some(p => p.rewardId === rewardId)).toBe(false);
  });
});

describe('host-confirmed lobby layout edits', () => {
  it('allows moves/removals of existing objects and idempotent retry, never fabrication or rotation', () => {
    const current = baseline().personalBaseContribution;
    const edit = { worldRevision: 1, expectedRevision: current.revision, areaStage: 0 as const,
      constructions: [{ ...construction, relativeGridX: 1 }] };
    const result = applyPersistentBaseLayoutEdit(current, edit);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('edit rejected');
    expect(result.contribution.revision).toBe(current.revision + 1);
    expect(applyPersistentBaseLayoutEdit(result.contribution, edit)).toEqual(result);
    expect(applyPersistentBaseLayoutEdit(current, { ...edit, constructions: [] }).ok).toBe(true);
    for (const change of [{ persistentId: 'new' }, { angle: 0 }, { placementOrder: 20 }, { relativeGridX: 999 }]) {
      expect(applyPersistentBaseLayoutEdit(current, { ...edit, constructions: [{ ...construction, ...change }] }).ok).toBe(false);
    }
    expect(applyPersistentBaseLayoutEdit(current, { ...edit, expectedRevision: current.revision + 3 })).toEqual({ ok: false, reason: 'stale' });
    expect(sanitizePersistentBaseLayoutEdit({ ...edit, constructions: [{ ...construction, relativeGridX: NaN }] })).toBeNull();
  });
});
