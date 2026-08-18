export interface ArenaClipBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Returns whether the rectangle's alpha coverage contains the complete design space. */
export function coversDesignSpace(
  bounds: ArenaClipBounds,
  designWidth: number,
  designHeight: number,
): boolean {
  return bounds.x <= 0
    && bounds.y <= 0
    && bounds.x + bounds.width >= designWidth
    && bounds.y + bounds.height >= designHeight;
}
