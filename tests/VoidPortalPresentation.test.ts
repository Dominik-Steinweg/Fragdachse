import { describe, expect, it } from 'vitest';
import manifest from '../src/assets/manifests/portal-generator.json';
import {
  portalGeneratorFrame, portalGeneratorOutletOffset, resolvePortalGeneratorOutlet, resolvePortalGeneratorState,
} from '../src/effects/voidPortal/PortalGeneratorAssets';
import { portalFlankMarkers } from '../src/effects/markers/sources/CoopMissionMarkerSource';
import { buildSecondaryObjectiveViewModel, resolvePortalObjectiveStatusLines } from '../src/ui/coopDefenseSecondaryObjectiveModel';
import { voidPortalEndViews, type VoidPortalLinkView } from '../src/effects/voidPortal/VoidPortalModel';

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

describe('Generator portals in the shared portal look', () => {
  const view = (phase: 'charging' | 'open', chargeFraction: number, openAgeMs = 0): VoidPortalLinkView => ({
    id: 'flank', a: { x: 10, y: 20 }, b: { x: 900, y: 40 }, radius: 28, phase, chargeFraction, openAgeMs });

  it('forms both ends while charging and links each to its partner', () => {
    const [entry, exit] = voidPortalEndViews(view('charging', 0.4));
    expect(entry).toMatchObject({ key: 'flank:a', style: 'void', charge: 0.4, partner: { x: 900, y: 40 } });
    expect(exit).toMatchObject({ key: 'flank:b', charge: 0.4, partner: { x: 10, y: 20 } });
    // The link works both ways, so neither end prefers a direction.
    expect([entry.flow, entry.link, exit.flow, exit.link]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('opens without a charge and shows the far side once open', () => {
    const [entry] = voidPortalEndViews(view('open', 1, 0));
    expect(entry.charge).toBeUndefined();
    expect(entry.open).toBe(0);
    expect(voidPortalEndViews(view('open', 1, 400))[0]).toMatchObject({ open: 1, ground: 1 });
  });
});
