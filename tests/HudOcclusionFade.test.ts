import { describe, expect, it } from 'vitest';
import {
  advanceHudOcclusionFade,
  createHudOcclusionFadeState,
  isPointNearRect,
  resetHudOcclusionFade,
  HUD_OCCLUSION_ENTITY_MARGIN_PX,
  HUD_OCCLUSION_HOLD_MS,
  HUD_OCCLUSION_MIN_ALPHA,
} from '../src/ui/hudOcclusionFade';

const FRAME_MS = 16;
const RECT = { left: 100, right: 500, top: 40, bottom: 220 };

function runFrames(
  state: ReturnType<typeof createHudOcclusionFadeState>,
  occluded: boolean,
  durationMs: number,
): number {
  let alpha = state.alpha;
  for (let elapsed = 0; elapsed < durationMs; elapsed += FRAME_MS) {
    alpha = advanceHudOcclusionFade(state, occluded, FRAME_MS);
  }
  return alpha;
}

describe('HUD occlusion fade', () => {
  it('starts fully visible and clears the column quickly once something moves under it', () => {
    const state = createHudOcclusionFadeState();
    expect(state.alpha).toBe(1);

    const afterOneFrame = advanceHudOcclusionFade(state, true, FRAME_MS);
    expect(afterOneFrame).toBeLessThan(1);
    // Zusammen mit dem Vorlauf um das Rechteck ist die Spalte durchsichtig, bevor eine Figur
    // sie erreicht: nach einer Drittelsekunde ist der größte Teil des Weges zurückgelegt.
    expect(runFrames(state, true, 330)).toBeLessThan(0.3);
    expect(runFrames(state, true, 600)).toBe(HUD_OCCLUSION_MIN_ALPHA);
  });

  it('holds the transparency briefly before coming back', () => {
    const state = createHudOcclusionFadeState();
    runFrames(state, true, 900);

    // Innerhalb der Nachlaufzeit bleibt sie unten – sonst flackert sie, sobald eine Figur an
    // der Kante entlangläuft.
    expect(runFrames(state, false, HUD_OCCLUSION_HOLD_MS - 2 * FRAME_MS))
      .toBe(HUD_OCCLUSION_MIN_ALPHA);
    expect(runFrames(state, false, 400)).toBeGreaterThan(HUD_OCCLUSION_MIN_ALPHA);
    // Die Rückkehr ist bewusst gemächlich und braucht deutlich länger als das Ausweichen.
    expect(runFrames(state, false, 2_600)).toBe(1);
  });

  it('does not bounce back during a single free frame between occluded frames', () => {
    const state = createHudOcclusionFadeState();
    const alphas: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      alphas.push(advanceHudOcclusionFade(state, index % 3 === 0, FRAME_MS));
    }

    // Streng monoton fallend: Eine Lücke von einem Frame darf die Spalte nicht kurz aufblitzen
    // lassen, weil die Nachlaufzeit dabei nie abläuft.
    expect(alphas.every((alpha, index) => index === 0 || alpha <= alphas[index - 1])).toBe(true);
    expect(state.alpha).toBe(HUD_OCCLUSION_MIN_ALPHA);
  });

  it('ignores a zero or invalid frame time', () => {
    const state = createHudOcclusionFadeState();
    expect(advanceHudOcclusionFade(state, true, 0)).toBe(1);
    expect(advanceHudOcclusionFade(state, true, Number.NaN)).toBe(1);
  });

  it('snaps through a very long frame instead of crawling', () => {
    const state = createHudOcclusionFadeState();
    expect(advanceHudOcclusionFade(state, true, 5_000)).toBe(HUD_OCCLUSION_MIN_ALPHA);
  });

  it('resets to fully visible for a fresh round', () => {
    const state = createHudOcclusionFadeState();
    runFrames(state, true, 200);
    resetHudOcclusionFade(state);

    expect(state.alpha).toBe(1);
    // Der Reset darf keine Nachlaufzeit hinterlassen, die die Spalte sofort wieder abdunkelt.
    expect(advanceHudOcclusionFade(state, false, FRAME_MS)).toBe(1);
  });

  it('reacts before an entity actually reaches the panel edge', () => {
    expect(isPointNearRect(300, 130, RECT, 0)).toBe(true);
    expect(isPointNearRect(520, 130, RECT, 0)).toBe(false);
    // Vorlauf: knapp außerhalb zählt bereits als Verdeckung.
    expect(isPointNearRect(
      RECT.right + HUD_OCCLUSION_ENTITY_MARGIN_PX - 1, 130, RECT, HUD_OCCLUSION_ENTITY_MARGIN_PX,
    )).toBe(true);
    expect(isPointNearRect(
      RECT.right + HUD_OCCLUSION_ENTITY_MARGIN_PX + 1, 130, RECT, HUD_OCCLUSION_ENTITY_MARGIN_PX,
    )).toBe(false);
    expect(isPointNearRect(300, RECT.top - HUD_OCCLUSION_ENTITY_MARGIN_PX - 1, RECT, HUD_OCCLUSION_ENTITY_MARGIN_PX))
      .toBe(false);
  });
});
