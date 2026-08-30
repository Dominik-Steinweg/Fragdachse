import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { ArenaBuilder, collectRockRebindDirtyIds } from '../src/arena/ArenaBuilder';
import type { ArenaPresentationResult } from '../src/arena/ArenaBuilder';
import { createRockOverlaySource, syncRockOverlaySource } from '../src/arena/RockOverlayRegions';
import type { RockCell } from '../src/types';
import { RockVisualStateStore, type RockVisualState } from '../src/arena/rocks/RockVisualState';
import type { WorldMetrics } from '../src/world/WorldMetrics';

const METRICS = {
  offsetX: 0,
  offsetY: 0,
  gridCols: 16,
  gridRows: 16,
} as unknown as WorldMetrics;

function makeLayout(rocks: RockCell[]) {
  return {
    seed: 1,
    rocks,
    trees: [],
    tracks: [],
    dirt: [],
    decals: [],
    powerUpPedestals: [],
  };
}

function makeState(id: number, cell: RockCell, active: boolean, frame = 36): RockVisualState {
  return {
    id,
    gridX: cell.gridX,
    gridY: cell.gridY,
    x: cell.gridX * 48 + 24,
    y: cell.gridY * 48 + 24,
    active,
    frame,
    cornerTints: [0xffffff, 0xffffff, 0xffffff, 0xffffff],
    damageTint: 0xffffff,
    ownerTintStrength: 0,
    alpha: active ? 1 : 0,
    scaleX: active ? 1 : 0,
    scaleY: active ? 1 : 0,
  };
}

function buildResult(layout: ReturnType<typeof makeLayout>, states: RockVisualState[]) {
  const rockVisualStates = new RockVisualStateStore();
  for (const state of states) rockVisualStates.add(state, false);

  const overlaySource = createRockOverlaySource();
  syncRockOverlaySource(overlaySource, layout.rocks);
  const refreshRegions = vi.fn();
  const refreshAll = vi.fn();
  const result = {
    baseZoneObjects: [],
    rockVisualStates,
    rockVisualSystem: null,
    rockOverlaySource: overlaySource,
    rockOverlaySurface: { refreshRegions, refreshAll },
  } as unknown as ArenaPresentationResult;
  return { result, overlaySource, refreshRegions, refreshAll };
}

function rebind(
  layout: ReturnType<typeof makeLayout>,
  authoredLayout: ReturnType<typeof makeLayout>,
  states: RockVisualState[],
) {
  const fixture = buildResult(layout, states);
  new ArenaBuilder({} as never).rebindPresentation(
    fixture.result,
    layout,
    authoredLayout,
    METRICS,
    false,
  );
  return fixture;
}

describe('LobbyWorld fast reinstance rock overlay rebind', () => {
  it('projects no Gameplay or Physics state into the presentation handoff', () => {
    const projected = ArenaBuilder.presentationOf({
      baseZoneObjects: [],
      rockGroup: { gameplay: true },
      rockPhysicsProxies: [{ body: {} }],
      rockVisualStates: new RockVisualStateStore(),
      rockVisualSystem: null,
      rockGrid: { gameplay: true },
      trunkGroup: { gameplay: true },
      trunkBodies: [{ body: {} }],
      trunkVisuals: [],
      canopyObjects: [],
      trackObjects: [],
      groundSurface: null,
      groundCoverPlacements: [],
      rockOverlaySurface: null,
      rockOverlaySource: createRockOverlaySource(),
      rockMossPlacements: [],
      rockVegetationPlacements: [],
    } as never);

    expect(projected).not.toHaveProperty('rockGroup');
    expect(projected).not.toHaveProperty('rockPhysicsProxies');
    expect(projected).not.toHaveProperty('rockGrid');
    expect(projected).not.toHaveProperty('trunkGroup');
    expect(projected).not.toHaveProperty('trunkBodies');
  });

  it('does not rebuild overlays for unchanged authored rocks', () => {
    const authored = [{ gridX: 1, gridY: 1 }];
    const fixture = rebind(
      makeLayout(authored.map((cell) => ({ ...cell }))),
      makeLayout(authored.map((cell) => ({ ...cell }))),
      [makeState(0, authored[0], true)],
    );

    expect(fixture.refreshRegions).not.toHaveBeenCalled();
    expect(fixture.refreshAll).not.toHaveBeenCalled();
  });

  it('marks a destroyed authored rock dirty when the authored baseline restores it', () => {
    const authored = [{ gridX: 1, gridY: 1 }];
    const fixture = rebind(
      makeLayout(authored.map((cell) => ({ ...cell }))),
      makeLayout(authored.map((cell) => ({ ...cell }))),
      [makeState(0, authored[0], false)],
    );

    expect(fixture.refreshRegions).toHaveBeenCalledTimes(1);
    expect(fixture.refreshRegions).toHaveBeenCalledWith(new Set([0]));
    expect(fixture.refreshAll).not.toHaveBeenCalled();
  });

  it('marks a removed runtime slot dirty and prunes its source cell in place', () => {
    const authored = { gridX: 1, gridY: 1 };
    const runtime = { gridX: 4, gridY: 1 };
    const fixture = rebind(
      makeLayout([{ ...authored }, { ...runtime }]),
      makeLayout([{ ...authored }]),
      [makeState(0, authored, true), makeState(1, runtime, false)],
    );

    expect(fixture.refreshRegions).toHaveBeenCalledTimes(1);
    expect(fixture.refreshRegions).toHaveBeenCalledWith(new Set([1]));
    expect(fixture.overlaySource.cells).toEqual([authored]);
    expect(fixture.refreshAll).not.toHaveBeenCalled();
  });

  it('marks authored position or autotile changes dirty', () => {
    const previous = { gridX: 1, gridY: 1 };
    const next = { gridX: 2, gridY: 1 };
    const dirty = collectRockRebindDirtyIds(
      [makeState(0, previous, true, 3)],
      [makeState(0, next, true, 4)],
      1,
    );

    expect(dirty).toEqual(new Set([0]));
  });
});
