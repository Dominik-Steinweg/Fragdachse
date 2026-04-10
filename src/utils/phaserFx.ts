import * as Phaser from 'phaser';

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
  outerStrength: number;
  innerStrength: number;
  color: number;
  renderNode?: string;
  destroy?: () => void;
  setPaddingOverride?: (left?: number | null, top?: number, right?: number, bottom?: number) => void;
}

export interface FxHandle {
  renderNode?: string;
  destroy?: () => void;
}

const internalPaddingOverrides = new WeakMap<object, number>();

function getLegacyInternalFx(target: object): LegacyFxListLike | null {
  return ((target as { preFX?: LegacyFxListLike | null }).preFX) ?? null;
}

function getLegacyExternalFx(target: object): LegacyFxListLike | null {
  return ((target as { postFX?: LegacyFxListLike | null }).postFX) ?? null;
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
): GlowHandle | null {
  const legacyFx = getLegacyInternalFx(target);
  if (legacyFx?.addGlow) {
    return (legacyFx.addGlow(color, outerStrength, innerStrength, knockout, quality, distance) ?? null) as GlowHandle | null;
  }

  const glow = (getInternalFilters(target)?.addGlow?.(
    color,
    outerStrength,
    innerStrength,
    1,
    knockout,
    normalizeGlowQuality(quality),
    distance,
  ) ?? null) as GlowHandle | null;

  applyInternalPadding(target, glow);
  return glow;
}

export function addExternalGlow(
  target: object,
  color: number,
  outerStrength: number,
  innerStrength: number,
  knockout: boolean,
  quality: number,
  distance: number,
): GlowHandle | null {
  const legacyFx = getLegacyExternalFx(target);
  if (legacyFx?.addGlow) {
    return (legacyFx.addGlow(color, outerStrength, innerStrength, knockout, quality, distance) ?? null) as GlowHandle | null;
  }

  return (getExternalFilters(target)?.addGlow?.(
    color,
    outerStrength,
    innerStrength,
    1,
    knockout,
    normalizeGlowQuality(quality),
    distance,
  ) ?? null) as GlowHandle | null;
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

  // Phaser 4 Shine is implemented via AddEffectShine and internal DynamicTextures.
  // Its teardown currently collides with target destruction in our lifecycle,
  // so we prefer a stable no-op over a round-end crash.
  return null;
}

export function removeInternalFx(target: object, fx: FxHandle | null | undefined): void {
  if (!fx) return;

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

export function removeExternalFx(target: object, fx: FxHandle | null | undefined): void {
  if (!fx) return;

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