import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_VIEWPORT_WIDTH,
} from '../../config';

export type RadialFocusQualityLevel = 'high' | 'medium' | 'low';

export interface RadialFocusFrame {
  /** Screen coordinates in the 1920x1080 design space, after camera feedback. */
  readonly focusX: number;
  readonly focusY: number;
  /** Radius of the fully sharp core in design pixels. */
  readonly radiusPx: number;
  /** Overall overlay strength, 0..1. */
  readonly alpha: number;
  /** Current visible arena rectangle in the same screen/design space. */
  readonly arenaRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface RadialFocusSampling {
  readonly filterActive: boolean;
  /** Total taps, including the original center sample. */
  readonly sampleCount: number;
  readonly blurRadiusPx: number;
}

export const RADIAL_FOCUS_SOFTNESS_PX = 96;
export const RADIAL_FOCUS_DARKEN = 0.18;
export const RADIAL_FOCUS_DESATURATE = 0.58;
export const RADIAL_FOCUS_KERNEL_TAP_COUNT = 9;

export function resolveRadialFocusFrame(
  focusWorldX: number,
  focusWorldY: number,
  cameraScrollX: number,
  cameraScrollY: number,
  radiusPx: number,
  alpha: number,
): RadialFocusFrame {
  return {
    focusX: focusWorldX - cameraScrollX,
    focusY: focusWorldY - cameraScrollY,
    radiusPx,
    alpha: Math.max(0, Math.min(1, alpha)),
    arenaRect: {
      // The viewport is screen-fixed. Only the world focus moves with camera feedback;
      // subtracting scroll from this rectangle would make the mask leave the visible arena
      // as soon as a wide arena starts following the player.
      x: ARENA_OFFSET_X,
      y: ARENA_OFFSET_Y,
      width: ARENA_VIEWPORT_WIDTH,
      height: ARENA_HEIGHT,
    },
  };
}

export function resolveRadialFocusSampling(level: RadialFocusQualityLevel): RadialFocusSampling {
  if (level === 'low') {
    return { filterActive: false, sampleCount: 0, blurRadiusPx: 0 };
  }
  return level === 'high'
    ? { filterActive: true, sampleCount: RADIAL_FOCUS_KERNEL_TAP_COUNT, blurRadiusPx: 30 }
    : { filterActive: true, sampleCount: RADIAL_FOCUS_KERNEL_TAP_COUNT, blurRadiusPx: 20 };
}
