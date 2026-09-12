import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 }, Math: {
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  Average: (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length,
  Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)),
} }));
vi.mock('../src/utils/phaserFx', () => ({ addExternalGlow: () => null, removeExternalFx() {} }));
import { CoopDefenseUpgradesOverlay, COOP_UPGRADE_TREE_BOUNDS } from '../src/ui/CoopDefenseUpgradesOverlay';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';

describe('upgrade tree and action strip separation', () => {
  it.each(['dachs_nukem', 'dachs_of_steel', 'inspector_gadachs'] as const)('keeps every category of %s in its reserved viewport', classId => {
    const progress = getCoopDefenseProgressSnapshot(90000, undefined, 30, classId);
    const overlay: any = new CoopDefenseUpgradesOverlay({} as never, () => progress,
      () => false, () => false, () => false, () => false, () => false, () => false, () => {}, () => false,
      () => false, () => ({ weapon1: null, weapon2: null, utility: null, ultimate: null }), () => false, () => {}, () => {});
    overlay.upgradesContainer = { removeAll() {} };
    overlay.renderFlowingDots = () => {};
    overlay.renderTreeBackground = (_signature: string, lanes: { x: number; y: number; width: number; height: number }[]) => {
      for (const lane of lanes) {
        expect(lane.y - lane.height / 2).toBeGreaterThanOrEqual(COOP_UPGRADE_TREE_BOUNDS.top);
        expect(lane.y + lane.height / 2).toBeLessThanOrEqual(COOP_UPGRADE_TREE_BOUNDS.bottom);
        expect(lane.x - lane.width / 2).toBeGreaterThanOrEqual(COOP_UPGRADE_TREE_BOUNDS.left);
        expect(lane.x + lane.width / 2).toBeLessThanOrEqual(COOP_UPGRADE_TREE_BOUNDS.right);
      }
    };
    overlay.renderNode = () => {};
    for (let index = 0; index < progress.upgradeCategories.length; index++) {
      overlay.activeCategoryIndex = index; overlay.renderActiveCategory(progress);
    }
  });
});
