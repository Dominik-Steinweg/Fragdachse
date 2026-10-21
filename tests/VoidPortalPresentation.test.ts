import { describe, expect, it } from 'vitest';
import manifest from '../src/assets/manifests/portal-generator.json';
import {
  portalGeneratorFrame, portalGeneratorOutletOffset, resolvePortalGeneratorOutlet, resolvePortalGeneratorState,
} from '../src/effects/voidPortal/PortalGeneratorAssets';
import { portalFlankMarkers } from '../src/effects/markers/sources/CoopMissionMarkerSource';
import { buildSecondaryObjectiveViewModel, resolvePortalObjectiveStatusLines } from '../src/ui/coopDefenseSecondaryObjectiveModel';

describe('Portal objective status in the HUD', () => {
  const link = { id: 'flank', generatorBaseId: 'gen', chargeDurationMs: 60_000 };
  const config = { id: 'destroy-gen', type: 'destroy' as const, targets: ['gen'], targetGoal: 1, start: { type: 'time' as const, atMs: 0 } };
  const entry = { objectiveId: 'destroy-gen', type: 'destroy' as const, state: 'active' as const, focused: false,
    progressCurrent: 0, progressTotal: 1, stateChangedAtMs: 0 };

  it('shows the charge, then the open flank, and lets a terminal state win', () => {
    const charging = resolvePortalObjectiveStatusLines([link], [config], [{ id: 'flank', phase: 'charging', chargeStartedAtMs: 0 }], 30_000);
    expect(charging.get('destroy-gen')).toMatch(/50/);
    const open = resolvePortalObjectiveStatusLines([link], [config], [{ id: 'flank', phase: 'open' }], 70_000);
    const model = buildSecondaryObjectiveViewModel([entry], [config], 70_000, open);
    expect(model.focus?.statusLine ?? model.chips[0]?.statusLine).toBe(open.get('destroy-gen'));
    const completed = buildSecondaryObjectiveViewModel([{ ...entry, state: 'completed', stateChangedAtMs: 69_000 }], [config], 70_000, open);
    expect((completed.focus ?? completed.chips[0])?.statusLine).not.toBe(open.get('destroy-gen'));
    expect(resolvePortalObjectiveStatusLines([link], [config], [{ id: 'flank', phase: 'waiting' }], 0).size).toBe(0);
  });
});

describe('Portal generator presentation contract', () => {
  it('maps state and outlet to the manifest frame and faces the outlet toward the entry', () => {
    for (const frame of manifest.frames) {
      expect(portalGeneratorFrame(frame.state as never, frame.outlet as never)).toBe(frame.index);
    }
    expect(resolvePortalGeneratorOutlet({ x: 0, y: 0 }, { x: 120, y: 30 })).toBe('east');
    expect(resolvePortalGeneratorOutlet({ x: 0, y: 0 }, { x: 10, y: -90 })).toBe('north');
    const east = portalGeneratorOutletOffset('east');
    expect(east.x).toBeGreaterThan(40);
    expect(Math.abs(east.y)).toBeLessThan(8);
  });

  it('shows damage below half its HP and rubble once destroyed', () => {
    expect(resolvePortalGeneratorState(3000, 3000, false)).toBe('intact');
    expect(resolvePortalGeneratorState(1400, 3000, false)).toBe('damaged');
    expect(resolvePortalGeneratorState(0, 3000, true)).toBe('rubble');
    expect(resolvePortalGeneratorState(null, null, false)).toBe('intact');
  });

  it('marks a charging exit in the world with its charge and an open exit urgently at the edge', () => {
    const [charging, open] = portalFlankMarkers([
      { id: 'flank', exit: { x: 10, y: 20 }, radius: 28, phase: 'charging', chargeFraction: 0.4 },
      { id: 'second', exit: { x: 30, y: 40 }, radius: 28, phase: 'open', chargeFraction: 1 },
    ]);
    expect(charging).toMatchObject({ kind: 'hazard', glyph: 'portal', visibility: 'world-only', progress: 0.4, x: 10, y: 20 });
    expect(charging.urgent).toBeUndefined();
    expect(open).toMatchObject({ visibility: 'world-and-edge', urgent: true });
    expect(open.progress).toBeUndefined();
  });
});
