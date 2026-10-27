import { describe, expect, it } from 'vitest';
import { createDefaultDawnProgress, DAWN_MAX_EXPANSION_LEVEL } from '../src/dawn/economy/DawnProgress';
import { resolveDawnExpansionCost } from '../src/dawn/economy/DawnEconomy';
import { buildPersistentBaseAreaBoundary, buildPersistentBaseExpansionPreview, getPersistentBaseEditorSize,
  getPersistentBaseEditorFraming, projectPersistentBaseBoundary, getPersistentBaseExpansionLabelPosition } from '../src/persistentBase/PersistentBaseExpansionPreview';
import { CELL_SIZE } from '../src/config';
import { isCellInsidePersistentBaseBuildArea, PERSISTENT_BASE_AREA_STAGES, resolvePersistentBaseBuildAreaForStage } from '../src/persistentBase/PersistentBaseCore';

describe('persistent base expansion preview', () => {
  const panel = { x: 88, y: 236, width: 648, height: 680 };

  it('frames every radius from 0 to 15 with room for the complete contour and its under-stroke', () => {
    for (let radiusCells = 0; radiusCells <= 15; radiusCells++) {
      const area = { kind: 'radius' as const, radiusCells };
      const frame = getPersistentBaseEditorFraming(panel, area);
      expect(frame.zoom).toBeGreaterThan(0);
      expect(frame.zoom).toBeLessThanOrEqual(1);
      expect(frame.world.width * frame.zoom).toBeCloseTo(frame.view.width);
      // The base sits in the middle of its own World.
      expect(frame.anchor.x).toBeCloseTo(frame.view.x + frame.view.width / 2);
      expect(frame.anchor.y).toBeCloseTo(frame.view.y + frame.view.height / 2);
      expect(frame.view.x).toBeGreaterThan(panel.x);
      expect(frame.view.y + frame.view.height).toBeLessThan(panel.y + panel.height);
      const edges = projectPersistentBaseBoundary(buildPersistentBaseAreaBoundary(area), frame);
      expect(edges.length).toBeGreaterThan(0);
      for (const e of edges) for (const [x, y] of [[e.x1, e.y1], [e.x2, e.y2]]) {
        expect(x).toBeGreaterThan(frame.view.x + 3);
        expect(x).toBeLessThan(frame.view.x + frame.view.width - 3);
        expect(y).toBeGreaterThan(frame.view.y + 3);
        expect(y).toBeLessThan(frame.view.y + frame.view.height - 3);
      }
    }
  });

  it('anchors labels to northeast contour edges and keeps both locales inside the viewport', () => {
    for (const stage of PERSISTENT_BASE_AREA_STAGES) {
      const area = resolvePersistentBaseBuildAreaForStage(stage);
      const frame = getPersistentBaseEditorFraming(panel, area);
      const edges = projectPersistentBaseBoundary(buildPersistentBaseAreaBoundary(area), frame);
      for (const width of [180, 260]) {
        const label = { width, height: 36 };
        const position = getPersistentBaseExpansionLabelPosition(edges, frame.view, label)!;
        expect(position.anchorX).toBeGreaterThanOrEqual(frame.view.x + frame.view.width / 2);
        expect(position.anchorY).toBeLessThan(frame.view.y + frame.view.height / 2);
        expect(edges.some(e => (e.x1 + e.x2) / 2 === position.anchorX && (e.y1 + e.y2) / 2 === position.anchorY)).toBe(true);
        expect(position.x).toBeGreaterThan(frame.view.x);
        expect(position.x + width).toBeLessThan(frame.view.x + frame.view.width);
        expect(position.y).toBeGreaterThan(frame.view.y);
        expect(position.y + label.height).toBeLessThan(position.anchorY);
      }
    }
    expect(getPersistentBaseExpansionLabelPosition([], panel, { width: 200, height: 36 })).toBeNull();
  });

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
    expect(beyond).toMatchObject({ dawnOnly: true, cost: next.cost, radius: next.radius });
    expect(beyond?.edges.length).toBeGreaterThan(0);
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
