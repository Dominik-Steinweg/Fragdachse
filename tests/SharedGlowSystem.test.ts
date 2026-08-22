import { describe, expect, it, vi } from 'vitest';
import {
  GRAPHICS_QUALITY_PROFILES,
  GraphicsQualityController,
} from '../src/graphics/GraphicsQuality';
import {
  canUseSharedGlow,
  isSharedGlowTargetVisible,
  resolveSharedGlowAlpha,
  resolveSharedGlowBandWeights,
  resolveSharedGlowTargetAlpha,
} from '../src/effects/sharedGlowModel';

describe('shared glow model', () => {
  it('maps glow distances into the two shared bands', () => {
    expect(resolveSharedGlowBandWeights(6)).toEqual({ near: 1, far: 0 });
    expect(resolveSharedGlowBandWeights(11)).toEqual({ near: 7 / 12, far: 0.5 });
    expect(resolveSharedGlowBandWeights(16)).toEqual({ near: 1 / 6, far: 1 });
    expect(resolveSharedGlowBandWeights(100)).toEqual({ near: 0, far: 1 });
  });

  it('keeps source alpha bounded and proportional to outer strength', () => {
    expect(resolveSharedGlowAlpha(-1)).toBe(0);
    expect(resolveSharedGlowAlpha(0)).toBe(0);
    expect(resolveSharedGlowAlpha(2)).toBeCloseTo(0.36);
    expect(resolveSharedGlowAlpha(100)).toBe(1);
  });

  it('ignores hidden or transparent parent containers', () => {
    const hiddenParent = { visible: false, alpha: 1, parentContainer: null };
    const target = { visible: true, active: true, alpha: 1, parentContainer: hiddenParent };
    expect(isSharedGlowTargetVisible(target)).toBe(false);

    hiddenParent.visible = true;
    hiddenParent.alpha = 0;
    expect(isSharedGlowTargetVisible(target)).toBe(false);
    expect(resolveSharedGlowTargetAlpha(target)).toBe(0);
  });

  it('preserves the effective alpha of nested capture targets', () => {
    const target = {
      alpha: 0.8,
      parentContainer: { alpha: 0.5, parentContainer: null },
    };
    expect(resolveSharedGlowTargetAlpha(target)).toBeCloseTo(0.4);
  });

  it('only accepts outer-only non-knockout glows', () => {
    expect(canUseSharedGlow(0, false)).toBe(true);
    expect(canUseSharedGlow(-0.1, false)).toBe(true);
    expect(canUseSharedGlow(0.01, false)).toBe(false);
    expect(canUseSharedGlow(0, true)).toBe(false);
  });
});

describe('shared glow quality policy', () => {
  it('keeps high and medium on the shared path while low keeps only critical glow', () => {
    expect(GRAPHICS_QUALITY_PROFILES.high.sharedGlow).toMatchObject({
      enabled: true,
      bufferScale: 1,
      importance: { critical: true, standard: true, decorative: true },
    });
    expect(GRAPHICS_QUALITY_PROFILES.medium.sharedGlow).toMatchObject({
      enabled: true,
      bufferScale: 0.5,
      importance: { critical: true, standard: true, decorative: true },
    });
    expect(GRAPHICS_QUALITY_PROFILES.low.sharedGlow).toMatchObject({
      enabled: true,
      bufferScale: 0.25,
      importance: { critical: true, standard: false, decorative: false },
      far: null,
    });
  });

  it('applies runtime quality and filter ablation to shared handles', () => {
    const controller = new GraphicsQualityController('high');
    const target = { once: vi.fn(), off: vi.fn() };
    const handle = { active: false, setActive: vi.fn(function setActive(active: boolean) {
      handle.active = active;
      return handle;
    }) };

    controller.trackSharedGlow(target, handle, 'standard');
    expect(handle.active).toBe(true);

    controller.setLevel('low');
    expect(handle.active).toBe(false);
    controller.setLevel('medium');
    expect(handle.active).toBe(true);
    controller.setAblationFiltersDisabled(true);
    expect(handle.active).toBe(false);
    controller.setAblationFiltersDisabled(false);
    expect(handle.active).toBe(true);
  });
});
