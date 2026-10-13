import { describe, expect, it } from 'vitest';
import { createDefaultDawnProgress, DAWN_MAX_EXPANSION_LEVEL } from '../src/dawn/economy/DawnProgress';
import { resolveDawnExpansionCost } from '../src/dawn/economy/DawnEconomy';
import { buildPersistentBaseAreaBoundary, buildPersistentBaseExpansionPreview, getPersistentBaseEditorSize } from '../src/persistentBase/PersistentBaseExpansionPreview';
import { CELL_SIZE } from '../src/config';
import { isCellInsidePersistentBaseBuildArea, PERSISTENT_BASE_AREA_STAGES, resolvePersistentBaseBuildAreaForStage } from '../src/persistentBase/PersistentBaseCore';

describe('persistent base expansion preview', () => {
  it('fits the entire next contour even when campaign area rewards were skipped', () => {
    for (const campaignStage of [0, 1, 2] as const) {
      const current = resolvePersistentBaseBuildAreaForStage(campaignStage);
      const expansion = buildPersistentBaseExpansionPreview(createDefaultDawnProgress(), campaignStage, true, 6)!;
      const halfSize = getPersistentBaseEditorSize(current, expansion.area) / CELL_SIZE / 2;
      expect(getPersistentBaseEditorSize(current, expansion.area)).toBeGreaterThan(getPersistentBaseEditorSize(current));
      for (const edge of expansion.edges) {
        expect(Math.max(Math.abs(edge.x1), Math.abs(edge.x2), Math.abs(edge.y1), Math.abs(edge.y2))).toBeLessThan(halfSize);
      }
      expect(getPersistentBaseEditorSize(expansion.area, current)).toBe(getPersistentBaseEditorSize(expansion.area));
    }
  });
  it('hides locked/maximal expansion and suppresses geometry above the site ceiling', () => {
    const progress = createDefaultDawnProgress();
    expect(buildPersistentBaseExpansionPreview(progress, 2, false, 6)).toBeNull();
    expect(buildPersistentBaseExpansionPreview({ expansionLevel: DAWN_MAX_EXPANSION_LEVEL }, 2, true, 11)).toBeNull();
    const next = buildPersistentBaseExpansionPreview(progress, 2, true, 6)!;
    expect(next.cost).toBe(resolveDawnExpansionCost(progress.expansionLevel));
    expect(next.dawnOnly).toBe(false);
    expect(next.edges.length).toBeGreaterThan(0);
    const atCeiling = buildPersistentBaseExpansionPreview(progress, 2, true, next.stage)!;
    expect(atCeiling.edges).toEqual(next.edges);
    const beyond = buildPersistentBaseExpansionPreview(progress, 2, true, 2)!;
    expect(beyond).toMatchObject({ dawnOnly: true, cost: next.cost, radius: next.radius, edges: [] });
  });

  it('traces exactly exposed cell edges for every supported area, including cardinal strips', () => {
    for (const stage of PERSISTENT_BASE_AREA_STAGES) {
      const area = resolvePersistentBaseBuildAreaForStage(stage);
      const edges = buildPersistentBaseAreaBoundary(area);
      expect(buildPersistentBaseAreaBoundary(area)).toEqual(edges);
      const vertices = new Map<string, number>();
      const unique = new Set<string>();
      for (const edge of edges) {
        const { x1, y1, x2, y2 } = edge;
        expect(Math.abs(x2 - x1) + Math.abs(y2 - y1)).toBe(1);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const nx = -(y2 - y1) / 2, ny = (x2 - x1) / 2;
        // Clockwise edges have exactly one buildable neighbour; no internal grid line leaks into the outline.
        expect(isCellInsidePersistentBaseBuildArea(mx + nx, my + ny, area)).toBe(true);
        expect(isCellInsidePersistentBaseBuildArea(mx - nx, my - ny, area)).toBe(false);
        unique.add(JSON.stringify(edge));
        for (const key of [`${x1},${y1}`, `${x2},${y2}`]) vertices.set(key, (vertices.get(key) ?? 0) + 1);
      }
      expect(unique.size).toBe(edges.length);
      expect([...vertices.values()].every(count => count === 2)).toBe(true);
    }
  });
});
