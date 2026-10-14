import { describe, expect, it } from 'vitest';
import { checkpointMarkers, CoopMissionMarkerSource, enemyMarkers, mainObjectiveMarkers, secondaryObjectiveMarkers } from '../src/effects/markers/sources/CoopMissionMarkerSource';
import { MarkerLayoutModel } from '../src/effects/markers/MarkerLayoutModel';
import { ArenaMarkerPresentation } from '../src/scenes/arena/ArenaMarkerPresentation';
import type { MarkerDescriptor, MarkerFrame } from '../src/effects/markers/MarkerTypes';
import type { CoopDefenseMissionProgressPresentationState, CoopDefenseSecondaryObjectivePresentationEntry, SyncedCoopDefenseCarryItem } from '../src/types';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../src/config/coopDefenseMapAuthoring';

const origin = { offsetX: 100, offsetY: 200 };
const bounds = { x: 300, y: 400, width: 96, height: 64 };
const entry: CoopDefenseSecondaryObjectivePresentationEntry = { objectiveId: 'a', type: 'destroy', state: 'active', focused: true,
  progressCurrent: 1, progressTotal: 4, stateChangedAtMs: 100 };
const config: ResolvedCoopDefenseMapSecondaryObjectiveConfig = { id: 'a', type: 'destroy', targets: ['one'], targetGoal: 4,
  start: { type: 'time', atMs: 0 } };
const collect = (source: CoopMissionMarkerSource) => { const out: MarkerDescriptor[] = []; source.collect(out); return out; };
const layoutInput = { camera: { worldView: { centerX: 500, centerY: 500 }, zoom: 1, viewport: { x: 0, y: 0, width: 1000, height: 1000 } },
  localPlayer: { x: 10, y: 20 }, reservedHudRects: [], nowMs: 100, lowQuality: false };

describe('Coop marker adapters', () => {
  it('uses world geometry for the main objective and skips dormant/destroyed targets', () => {
    expect(mainObjectiveMarkers('base', bounds)[0]).toMatchObject({ kind: 'main-objective', glyph: 'base', x: 348, y: 432, targetHalfHeight: 32 });
    expect(mainObjectiveMarkers('base', { ...bounds, destroyed: true })).toEqual([]);
    expect(mainObjectiveMarkers('base', null)).toEqual([]);
  });
  it('collects all candidates before budgeting and separates mission type and focus groups', () => {
    const descriptors = secondaryObjectiveMarkers([entry], [{ ...config, targets: Array.from({ length: 12 }, (_, i) => String(i)) }], [], origin, () => bounds);
    expect(descriptors).toHaveLength(12);
    expect(descriptors[0]).toMatchObject({ glyph: 'mission-destroy', progress: .25, groundRing: { radiusPx: 48 }, focused: true });
    const hold = secondaryObjectiveMarkers([{ ...entry, type: 'hold', focused: false }], [{ ...config, type: 'hold' }], [], origin, () => bounds)[0];
    expect(hold.glyph).toBe('mission-hold');
    expect(hold.bundleKey).not.toBe(descriptors[0].bundleKey);
    expect(secondaryObjectiveMarkers([entry], [config], [], origin, () => ({ ...bounds, dormant: true }))).toEqual([]);
  });
  it('keeps carry-holder and delivery selection semantics, deriving the green ring from the authored zone', () => {
    const carryConfig = { ...config, type: 'carry' as const, targets: [], carry: {
      spawnZone: { gridX: 1, gridY: 1, widthCells: 2, heightCells: 2 },
      deliveryZone: { gridX: 5, gridY: 6, widthCells: 4, heightCells: 2 },
    } };
    const item: SyncedCoopDefenseCarryItem = { id: 'bottle', objectiveId: 'a', x: 250, y: 350, holderId: null, state: 'spawned' };
    const project = (items: SyncedCoopDefenseCarryItem[]) => secondaryObjectiveMarkers([{ ...entry, type: 'carry' }], [carryConfig], items, origin, () => null);
    expect(project([item]).filter(d => d.kind === 'carry')).toHaveLength(1);
    const held = project([{ ...item, holderId: 'player' }]);
    expect(held.filter(d => d.kind === 'carry')).toHaveLength(0);
    expect(held.find(d => d.kind === 'delivery')).toMatchObject({ glyph: 'flag', x: 324, y: 424, groundRing: { radiusPx: 64, tone: 'green' } });
  });
  it('keeps bosses offscreen-only with vulnerability and timebombs triangular through their semantic kind', () => {
    const targets = enemyMarkers([{ id: 'b', generation: 3, x: 1500, y: 500, size: 80, boss: true, vulnerable: true, timebomb: false },
      { id: 't', generation: 1, x: 400, y: 500, size: 32, boss: false, vulnerable: false, timebomb: true, fuseProgress: .6 }]);
    expect(targets[0]).toMatchObject({ visibility: 'edge-when-offscreen', vulnerable: true });
    const frame = new MarkerLayoutModel().layout({ ...layoutInput, descriptors: targets });
    expect(frame.edgeBadges[0]).toMatchObject({ glyph: 'boss', tone: 'purple', vulnerable: true });
    expect(frame.worldBadges[0]).toMatchObject({ shape: 'triangle', glyph: 'timebomb', progress: .6 });
  });
  it('projects next/active/completed checkpoints, suppresses future ones and uses explicit world offsets', () => {
    const cp = { checkpoints: ['a', 'b', 'c'].map((id, i) => ({ id, gridX: i, gridY: 2, radiusCells: 3, setRespawn: true })), barriers: [], mandatoryDefenses: [] };
    const state: CoopDefenseMissionProgressPresentationState = { roundRevision: 1, missionRevision: 1, activatedCheckpoints: [], completedCheckpoints: [], nextCheckpointId: 'a', respawnCheckpointId: null, routeLockDefenseId: null, resolvedDefenses: [], barriers: [], routeComplete: false };
    expect(checkpointMarkers(cp, state, origin)).toMatchObject([{ state: 'dormant', x: 116, y: 280, groundRing: { radiusPx: 96 } }]);
    state.activatedCheckpoints = [{ checkpointId: 'a', activatedAtRoundMs: 10 }]; state.nextCheckpointId = null;
    expect(checkpointMarkers(cp, state, origin)[0].state).toBe('active');
    state.completedCheckpoints = [{ checkpointId: 'a', completedAtRoundMs: 20 }]; state.nextCheckpointId = 'b';
    expect(checkpointMarkers(cp, state, origin).map(d => d.state)).toEqual(['completed', 'dormant']);
  });
  it('does not pop on hydration, stamps transitions once and retains a removed target for terminal feedback', () => {
    const source = new CoopMissionMarkerSource(), model = new MarkerLayoutModel();
    const descriptors = secondaryObjectiveMarkers([entry], [config], [], origin, () => bounds);
    source.setSecondary(descriptors, [entry], 100);
    expect(collect(source)[0].stateChangedAtMs).toBeUndefined();
    expect(model.layout({ ...layoutInput, descriptors: collect(source) }).worldBadges[0].scale).toBe(1);
    const completed = { ...entry, state: 'completed' as const };
    source.setSecondary([], [completed], 200);
    expect(collect(source)[0]).toMatchObject({ state: 'completed', stateChangedAtMs: 200 });
    source.setSecondary([], [completed], 300);
    expect(collect(source)[0].stateChangedAtMs).toBe(200);
    model.layout({ ...layoutInput, nowMs: 200, descriptors: collect(source) });
    expect(model.layout({ ...layoutInput, nowMs: 2800, descriptors: collect(source) }).worldBadges).toEqual([]);
    source.clear(); source.setSecondary(descriptors, [entry], 5000);
    expect(collect(source)[0].stateChangedAtMs).toBeUndefined();
  });
  it('uses authoritative completion age for a late reader and clears absent snapshots', () => {
    const source = new CoopMissionMarkerSource();
    const terminal = { ...entry, state: 'completed' as const, stateChangedAtMs: 500 };
    source.setSecondary(secondaryObjectiveMarkers([terminal], [config], [], origin, () => bounds), [terminal], 10000, 8000);
    const frame = new MarkerLayoutModel().layout({ ...layoutInput, nowMs: 10000, descriptors: collect(source) });
    expect(frame.worldBadges).toEqual([]);
    source.setSecondary([], null, 11000);
    expect(collect(source)).toEqual([]);
  });
  it('preserves focus before the shared world budget and uses the closest player-relative grouped target', () => {
    const candidates = Array.from({ length: 12 }, (_, i): MarkerDescriptor => ({
      key: String(i), kind: 'mission', state: 'active', glyph: 'mission-destroy',
      x: 400, y: 400, targetHalfHeight: 20, visibility: 'world-and-edge', focused: i === 11,
    }));
    const model = new MarkerLayoutModel();
    expect(model.layout({ ...layoutInput, descriptors: candidates }).worldBadges[0].key).toBe('11');
    const edge = model.layout({ ...layoutInput, descriptors: candidates.slice(0, 2).map((d, i) => ({ ...d,
      x: 2000 + i * 200, y: 500, bundleKey: 'same' })), localPlayer: { x: 2500, y: 500 } });
    expect(edge.edgeBadges[0]).toMatchObject({ count: 2, distanceLabel: '9 m' });
  });
});

describe('Arena marker leases', () => {
  it('clears immediately at round/activity/world detach and never reads a released source', () => {
    const frames: MarkerFrame[] = [];
    let destroyed = 0;
    const owner = new ArenaMarkerPresentation({ sync: f => frames.push(f), destroy: () => destroyed++ });
    owner.bindWorld(1); owner.bindActivity(2); owner.bindRound(3);
    const old = owner.coop!;
    old.set('main', mainObjectiveMarkers('a', bounds), 100); owner.update(layoutInput);
    expect(frames.at(-1)!.worldBadges).toHaveLength(1);
    owner.bindRound(4);
    expect(frames.at(-1)!.worldBadges).toHaveLength(0);
    old.set('main', mainObjectiveMarkers('a', bounds), 200); owner.update(layoutInput);
    expect(frames.at(-1)!.worldBadges).toHaveLength(0);
    owner.releaseActivity(); expect(owner.coop).toBeNull();
    owner.bindActivity(5); owner.bindRound(6); owner.releaseWorld();
    expect(owner.coop).toBeNull(); owner.destroy(); expect(destroyed).toBe(1);
  });
});
