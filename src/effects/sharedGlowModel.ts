export const SHARED_GLOW_SOURCE_ALPHA_FACTOR = 0.18;

export interface SharedGlowVisibilityNode {
  readonly active?: boolean;
  readonly visible?: boolean;
  readonly alpha?: number;
  readonly parentContainer?: SharedGlowVisibilityNode | null;
}

const NEAR_DISTANCE_START = 6;
const NEAR_DISTANCE_END = 18;
const FAR_DISTANCE_START = 6;
const FAR_DISTANCE_END = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function canUseSharedGlow(innerStrength: number, knockout: boolean): boolean {
  return innerStrength <= 0 && !knockout;
}

export function resolveSharedGlowBandWeights(distance: number): { near: number; far: number } {
  const safeDistance = Number.isFinite(distance) ? distance : NEAR_DISTANCE_START;
  return {
    near: clamp((NEAR_DISTANCE_END - safeDistance) / (NEAR_DISTANCE_END - NEAR_DISTANCE_START), 0, 1),
    far: clamp((safeDistance - FAR_DISTANCE_START) / (FAR_DISTANCE_END - FAR_DISTANCE_START), 0, 1),
  };
}

export function resolveSharedGlowAlpha(outerStrength: number): number {
  if (!Number.isFinite(outerStrength) || outerStrength <= 0) return 0;
  return clamp(outerStrength * SHARED_GLOW_SOURCE_ALPHA_FACTOR, 0, 1);
}

/**
 * Direct DynamicTexture captures bypass Phaser's ContainerWebGLRenderer. Walk the parent
 * chain so hidden overlay containers cannot leak their children into the shared buffer.
 */
export function isSharedGlowTargetVisible(target: SharedGlowVisibilityNode): boolean {
  let current: SharedGlowVisibilityNode | null | undefined = target;
  while (current) {
    if (current.active === false || current.visible === false) return false;
    if (current.alpha !== undefined && (!Number.isFinite(current.alpha) || current.alpha <= 0)) return false;
    current = current.parentContainer;
  }
  return true;
}

/** Resolve the effective alpha that a direct capture must apply after replacing target.alpha. */
export function resolveSharedGlowTargetAlpha(target: SharedGlowVisibilityNode): number {
  let current: SharedGlowVisibilityNode | null | undefined = target;
  let alpha = 1;
  while (current) {
    if (current.alpha !== undefined) {
      if (!Number.isFinite(current.alpha)) return 0;
      alpha *= clamp(current.alpha, 0, 1);
    }
    current = current.parentContainer;
  }
  return clamp(alpha, 0, 1);
}
