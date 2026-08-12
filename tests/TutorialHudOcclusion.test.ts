import { describe, expect, it } from 'vitest';
import {
  advanceHudOcclusionFade,
  createHudOcclusionFadeState,
  HUD_OCCLUSION_HOLD_MS,
} from '../src/ui/hudOcclusionFade';
import { doHudRectsOverlap, getWorldRectOnScreen } from '../src/ui/hudOcclusionProbe';
import {
  COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT,
} from '../src/ui/CoopDefenseSecondaryObjectiveLayout';
import { getCoopDefenseObjectiveAnnouncementHudRect } from '../src/ui/CoopDefenseObjectiveAnnouncement';
import {
  COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
  getCoopDefenseTutorialPanelHeight,
  getCoopDefenseTutorialPanelTopY,
} from '../src/config/coopDefenseTutorial';

const TUTORIAL_FADE = {
  minAlpha: 0.02,
  fadeOutMs: 90,
  fadeInMs: 520,
  holdMs: 260,
} as const;

function makeCamera(scrollY = 0, zoom = 1) {
  return {
    x: 0,
    y: 0,
    width: 1_920,
    height: 1_080,
    originX: 0,
    originY: 0,
    zoom,
    scrollX: 0,
    scrollY,
  } as never;
}

function tutorialWorldRect(showControls: boolean) {
  const centerX = 960;
  const top = getCoopDefenseTutorialPanelTopY();
  return {
    left: centerX - COOP_DEFENSE_TUTORIAL_PANEL_WIDTH / 2,
    right: centerX + COOP_DEFENSE_TUTORIAL_PANEL_WIDTH / 2,
    top,
    bottom: top + getCoopDefenseTutorialPanelHeight(showControls),
  };
}

function runFrames(
  state: ReturnType<typeof createHudOcclusionFadeState>,
  occluded: boolean,
  durationMs: number,
): number {
  let alpha = state.alpha;
  for (let elapsed = 0; elapsed < durationMs; elapsed += 16) {
    alpha = advanceHudOcclusionFade(state, occluded, 16, TUTORIAL_FADE);
  }
  return alpha;
}

describe('World-Space-Tutorial und Screen-Space-HUD-Occlusion', () => {
  it('maps the tutorial rectangle with vertical camera scroll', () => {
    const screenRect = getWorldRectOnScreen(tutorialWorldRect(false), makeCamera(150));

    expect(screenRect.top).toBe(getCoopDefenseTutorialPanelTopY() - 150);
    expect(screenRect.bottom - screenRect.top).toBe(getCoopDefenseTutorialPanelHeight(false));
  });

  it('detects actual overlap with the current reserved announcement rectangle', () => {
    const tutorialRect = getWorldRectOnScreen(tutorialWorldRect(false), makeCamera(150));
    const announcementRect = getCoopDefenseObjectiveAnnouncementHudRect(
      960,
      COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.centerY
        + COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.entryOffsetY,
      0.9,
      0.9,
    );

    expect(doHudRectsOverlap(tutorialRect, announcementRect, 0)).toBe(true);
    expect(doHudRectsOverlap(tutorialRect, {
      ...announcementRect,
      top: tutorialRect.bottom + 20,
      bottom: tutorialRect.bottom + 40,
    }, 0)).toBe(false);
  });

  it('keeps the tutorial fully visible when no reserved rectangle overlaps', () => {
    const state = createHudOcclusionFadeState();
    expect(advanceHudOcclusionFade(state, false, 16, TUTORIAL_FADE)).toBe(1);
    expect(doHudRectsOverlap(
      getWorldRectOnScreen(tutorialWorldRect(false), makeCamera(0)),
      { left: 20, right: 400, top: 20, bottom: 100 },
      6,
    )).toBe(false);
  });

  it('fades almost completely on overlap and returns more slowly after the hold', () => {
    const state = createHudOcclusionFadeState();
    expect(runFrames(state, true, 500)).toBeLessThan(0.05);

    const alphaAfterClear = runFrames(state, false, HUD_OCCLUSION_HOLD_MS + 20);
    expect(alphaAfterClear).toBeGreaterThan(0.02);
    expect(alphaAfterClear).toBeLessThan(0.5);
    expect(runFrames(state, false, 4_000)).toBe(1);
  });

  it('uses the larger controls panel for the same world-space footprint contract', () => {
    const standard = tutorialWorldRect(false);
    const controls = tutorialWorldRect(true);
    expect(controls.left).toBe(standard.left);
    expect(controls.right).toBe(standard.right);
    expect(controls.bottom).toBeGreaterThan(standard.bottom);
  });
});
