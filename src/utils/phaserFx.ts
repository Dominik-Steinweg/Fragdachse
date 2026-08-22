import * as Phaser from 'phaser';
import { getGraphicsQualityController, type VisualImportance } from '../graphics/GraphicsQuality';
import {
  getSharedGlowSystem,
  type SharedGlowHandleLike,
} from '../effects/SharedGlowSystem';

type FilterListLike = {
  addGlow?: (
    color?: number,
    outerStrength?: number,
    innerStrength?: number,
    scale?: number,
    knockout?: boolean,
    quality?: number,
    distance?: number,
  ) => unknown;
  addBlur?: (
    quality?: number,
    x?: number,
    y?: number,
    strength?: number,
    color?: number,
    steps?: number,
  ) => unknown;
  addMask?: (mask?: string | object, invert?: boolean) => unknown;
  remove?: (filter: unknown, forceDestroy?: boolean) => unknown;
};

type LegacyFxListLike = {
  setPadding?: (padding: number) => unknown;
  addGlow?: (
    color: number,
    outerStrength: number,
    innerStrength: number,
    knockout: boolean,
    quality: number,
    distance: number,
  ) => unknown;
  addShine?: (speed: number, lineWidth: number, gradient: number) => unknown;
  remove?: (fx: unknown) => unknown;
};

export interface GlowHandle {
  active?: boolean;
  setActive?: (active: boolean) => unknown;
  outerStrength: number;
  innerStrength: number;
  color: number;
  renderNode?: string;
  fallbackHandle?: GlowHandle | null;
  setFallbackHandle?: (handle: GlowHandle | null) => void;
  destroy?: () => void;
  setPaddingOverride?: (left?: number | null, top?: number, right?: number, bottom?: number) => void;
}

export interface FxHandle {
  active?: boolean;
  setActive?: (active: boolean) => unknown;
  renderNode?: string;
  destroy?: () => void;
}

const internalPaddingOverrides = new WeakMap<object, number>();
const removedFxHandles = new WeakSet<object>();

function getLegacyInternalFx(target: object): LegacyFxListLike | null {
  return ((target as { preFX?: LegacyFxListLike | null }).preFX) ?? null;
}

function getLegacyExternalFx(target: object): LegacyFxListLike | null {
  return ((target as { postFX?: LegacyFxListLike | null }).postFX) ?? null;
}

/**
 * In Phaser 4, filters.internal/external only exist after enableFilters() is called.
 * This helper calls it if available (no-op if already called or not a P4 GameObject).
 */
function ensureFilters(target: object): void {
  (target as { enableFilters?: () => void }).enableFilters?.();
}

function getInternalFilters(target: object): FilterListLike | null {
  return ((target as { filters?: { internal?: FilterListLike | null } }).filters?.internal) ?? null;
}

function getExternalFilters(target: object): FilterListLike | null {
  return ((target as { filters?: { external?: FilterListLike | null } }).filters?.external) ?? null;
}

function normalizeGlowQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 10;
  if (quality <= 1) return Math.max(1, Math.round(quality * 100));
  return Math.max(1, Math.round(quality));
}

function applyInternalPadding(target: object, glow: GlowHandle | null): void {
  if (!glow?.setPaddingOverride) return;
  const padding = internalPaddingOverrides.get(target);
  if (padding === undefined) return;
  glow.setPaddingOverride(-padding, -padding, padding, padding);
}

function isFilterController(handle: FxHandle): handle is FxHandle & { renderNode: string } {
  return typeof handle.renderNode === 'string';
}

function isObjectHandle(handle: unknown): handle is object {
  return typeof handle === 'object' && handle !== null;
}

function markFxRemoved(handle: unknown): boolean {
  if (!isObjectHandle(handle)) return false;
  if (removedFxHandles.has(handle)) return true;
  removedFxHandles.add(handle);
  return false;
}

function attachDestroyCleanup(target: object, cleanup: () => void): void {
  (target as { once?: (event: string, listener: () => void) => void }).once?.(
    Phaser.GameObjects.Events.DESTROY,
    cleanup,
  );
}

function addFilterGlow(
  target: object,
  external: boolean,
  color: number,
  outerStrength: number,
  innerStrength: number,
  knockout: boolean,
  quality: number,
  distance: number,
  importance: VisualImportance,
): GlowHandle | null {
  ensureFilters(target);
  const filters = external ? getExternalFilters(target) : getInternalFilters(target);
  const glow = (filters?.addGlow?.(
    color,
    outerStrength,
    innerStrength,
    1,
    knockout,
    normalizeGlowQuality(quality),
    distance,
  ) ?? null) as GlowHandle | null;

  if (!external) applyInternalPadding(target, glow);
  trackFilter(target, glow, external, importance);
  if (glow) {
    attachDestroyCleanup(target, () => {
      if (external) removeExternalFx(target, glow);
      else removeInternalFx(target, glow);
    });
  }
  return glow;
}

function legacyFilterAvailable(target: object, external: boolean): boolean {
  return Boolean(external ? getLegacyExternalFx(target) : getLegacyInternalFx(target));
}

function removeSharedGlow(target: object, handle: SharedGlowHandleLike): void {
  const controller = getTargetQualityController(target);
  controller?.untrackFilter(handle);
  if (handle.fallbackHandle) controller?.untrackFilter(handle.fallbackHandle);
  handle.destroy();
}

function addSharedGlow(
  target: object,
  external: boolean,
  color: number,
  outerStrength: number,
  innerStrength: number,
  knockout: boolean,
  quality: number,
  distance: number,
  importance: VisualImportance,
): GlowHandle | null {
  const scene = (target as { scene?: Phaser.Scene }).scene;
  if (!scene) return null;
  const system = getSharedGlowSystem(scene);
  if (!system || legacyFilterAvailable(target, external)) return null;

  const promoteToFallback = (handle: SharedGlowHandleLike): void => {
    if (handle.fallbackHandle) return;
    getTargetQualityController(target)?.untrackFilter(handle);
    const fallback = addFilterGlow(
      target,
      external,
      handle.color,
      handle.outerStrength,
      handle.innerStrength,
      knockout,
      quality,
      distance,
      importance,
    );
    handle.setFallbackHandle?.(fallback);
    if (!fallback) handle.setActive(false);
  };

  const shared = system.add({
    target: target as Phaser.GameObjects.GameObject,
    color,
    outerStrength,
    innerStrength,
    knockout,
    distance,
    importance,
    onRequiresFallback: promoteToFallback,
  });
  if (!shared) return null;

  getTargetQualityController(target)?.trackSharedGlow(target, shared, importance);
  attachDestroyCleanup(target, () => removeSharedGlow(target, shared));
  return shared as GlowHandle;
}

export function setInternalFxPadding(target: object, padding: number): void {
  const legacyFx = getLegacyInternalFx(target);
  if (legacyFx?.setPadding) {
    legacyFx.setPadding(padding);
    return;
  }

  internalPaddingOverrides.set(target, padding);
}

export function addInternalGlow(
  target: object,
  color: number,
  outerStrength: number,
  innerStrength: number,
  knockout: boolean,
  quality: number,
  distance: number,
  importance: VisualImportance = 'standard',
): GlowHandle | null {
  const legacyFx = getLegacyInternalFx(target);
  if (legacyFx?.addGlow) {
    const legacyGlow = (legacyFx.addGlow(color, outerStrength, innerStrength, knockout, quality, distance) ?? null) as GlowHandle | null;
    trackFilter(target, legacyGlow, false, importance);
    return legacyGlow;
  }

  if (innerStrength <= 0 && !knockout) {
    const shared = addSharedGlow(target, false, color, outerStrength, innerStrength, knockout, quality, distance, importance);
    if (shared) return shared;
  }

  return addFilterGlow(target, false, color, outerStrength, innerStrength, knockout, quality, distance, importance);
}

/**
 * Player silhouettes deliberately keep the original object-local glow. The shared compositor
 * is ideal for many UI/world sources, but the old internal filter preserves the tight, padded
 * contour that makes a player readable against the arena background.
 */
export function addInternalGlowLegacy(
  target: object,
  color: number,
  outerStrength: number,
  innerStrength: number,
  knockout: boolean,
  quality: number,
  distance: number,
  importance: VisualImportance = 'standard',
): GlowHandle | null {
  const legacyFx = getLegacyInternalFx(target);
  if (legacyFx?.addGlow) {
    const legacyGlow = (legacyFx.addGlow(color, outerStrength, innerStrength, knockout, quality, distance) ?? null) as GlowHandle | null;
    trackFilter(target, legacyGlow, false, importance);
    return legacyGlow;
  }

  return addFilterGlow(target, false, color, outerStrength, innerStrength, knockout, quality, distance, importance);
}

export function addExternalGlow(
  target: object,
  color: number,
  outerStrength: number,
  innerStrength: number,
  knockout: boolean,
  quality: number,
  distance: number,
  importance: VisualImportance = 'standard',
): GlowHandle | null {
  const legacyFx = getLegacyExternalFx(target);
  if (legacyFx?.addGlow) {
    const legacyGlow = (legacyFx.addGlow(color, outerStrength, innerStrength, knockout, quality, distance) ?? null) as GlowHandle | null;
    trackFilter(target, legacyGlow, true, importance);
    return legacyGlow;
  }

  if (innerStrength <= 0 && !knockout) {
    const shared = addSharedGlow(target, true, color, outerStrength, innerStrength, knockout, quality, distance, importance);
    if (shared) return shared;
  }

  return addFilterGlow(target, true, color, outerStrength, innerStrength, knockout, quality, distance, importance);
}

export function addInternalShine(
  target: object,
  speed: number,
  lineWidth: number,
  gradient: number,
): FxHandle | null {
  const legacyFx = getLegacyInternalFx(target);
  if (legacyFx?.addShine) {
    return (legacyFx.addShine(speed, lineWidth, gradient) ?? null) as FxHandle | null;
  }

  // Phaser 4 AddEffectShine wires its own destroy listener and DynamicTexture lifecycle.
  // Manual early cleanup currently collides with round-end teardown in this project.
  // Prefer local one-shot visuals at the call site instead of the engine Action here.
  void target;
  void speed;
  void lineWidth;
  void gradient;
  return null;
}

export function removeInternalFx(target: object, fx: FxHandle | null | undefined): void {
  if (!fx) return;
  if (markFxRemoved(fx)) return;
  getTargetQualityController(target)?.untrackFilter(fx);
  const shared = fx as FxHandle & { fallbackHandle?: FxHandle | null; setFallbackHandle?: unknown };
  if (shared.fallbackHandle) getTargetQualityController(target)?.untrackFilter(shared.fallbackHandle);
  if (typeof shared.setFallbackHandle === 'function') {
    fx.destroy?.();
    return;
  }

  const legacyFx = getLegacyInternalFx(target);
  if (legacyFx?.remove) {
    legacyFx.remove(fx);
    return;
  }

  const filters = getInternalFilters(target);
  if (filters?.remove && isFilterController(fx)) {
    filters.remove(fx);
    return;
  }

  fx.destroy?.();
}

export interface BlurHandle extends FxHandle {
  strength: number;
  x: number;
  y: number;
  steps: number;
}

export function addInternalBlur(
  target: object,
  quality: number,
  x: number,
  y: number,
  strength: number,
  color: number,
  steps: number,
  importance: VisualImportance = 'standard',
): BlurHandle | null {
  ensureFilters(target);
  const blur = (getInternalFilters(target)?.addBlur?.(quality, x, y, strength, color, steps) ?? null) as BlurHandle | null;
  trackFilter(target, blur, false, importance);
  return blur;
}

export function addInternalMask(target: object, maskKey: string): FxHandle | null {
  ensureFilters(target);
  return (getInternalFilters(target)?.addMask?.(maskKey) ?? null) as FxHandle | null;
}

export function removeExternalFx(target: object, fx: FxHandle | null | undefined): void {
  if (!fx) return;
  if (markFxRemoved(fx)) return;
  getTargetQualityController(target)?.untrackFilter(fx);
  const shared = fx as FxHandle & { fallbackHandle?: FxHandle | null; setFallbackHandle?: unknown };
  if (shared.fallbackHandle) getTargetQualityController(target)?.untrackFilter(shared.fallbackHandle);
  if (typeof shared.setFallbackHandle === 'function') {
    fx.destroy?.();
    return;
  }

  const legacyFx = getLegacyExternalFx(target);
  if (legacyFx?.remove) {
    legacyFx.remove(fx);
    return;
  }

  const filters = getExternalFilters(target);
  if (filters?.remove && isFilterController(fx)) {
    filters.remove(fx);
    return;
  }

  fx.destroy?.();
}

function getTargetQualityController(target: object) {
  const scene = (target as { scene?: Phaser.Scene }).scene;
  return scene ? getGraphicsQualityController(scene) : null;
}

function trackFilter(
  target: object,
  handle: FxHandle | null,
  external: boolean,
  importance: VisualImportance,
): void {
  if (!handle) return;
  getTargetQualityController(target)?.trackFilter(target, handle, external, importance);
}
