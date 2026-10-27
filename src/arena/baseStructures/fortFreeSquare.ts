import { CELL_SIZE } from '../../config';

/** Caster heights around a cell: RGBA rows (R = height between min and max), their world origin and texel size. */
export interface FortHeightWindow {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly texelPx: number;
}

/**
 * The largest axis-aligned square of free deck inside one cell (world centre `cell`): texels at deck height
 * (within 3 px), with every texel of the square at least `clearancePx` away from anything taller or lower such
 * as stakes, posts and beams. Ties go to the square nearest the cell centre. Null when no texel is free.
 */
export function fortFreeSquare(cell: { readonly x: number; readonly y: number }, window: FortHeightWindow,
  heightPx: { readonly min: number; readonly max: number }, deckPx: number, clearancePx: number): { x: number; y: number; side: number } | null {
  const { data, width, height, texelPx } = window, { min, max } = heightPx;
  const n = Math.round(CELL_SIZE / texelPx), clear = Math.ceil(clearancePx / texelPx);
  const left = Math.round((cell.x - CELL_SIZE / 2 - window.left) / texelPx), top = Math.round((cell.y - CELL_SIZE / 2 - window.top) / texelPx);
  const free = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < width && ty < height
    && Math.abs(min + data[(ty * width + tx) * 4] / 255 * (max - min) - deckPx) <= 3;
  const ok = (x: number, y: number) => {
    for (let dy = -clear; dy <= clear; dy++) for (let dx = -clear; dx <= clear; dx++) if (!free(left + x + dx, top + y + dy)) return false;
    return true;
  };
  const run = new Array<number>(n * n).fill(0);
  let best = { size: 0, x: 0, y: 0, distance: Infinity };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!ok(x, y)) continue;
    const size = x && y ? 1 + Math.min(run[(y - 1) * n + x], run[y * n + x - 1], run[(y - 1) * n + x - 1]) : 1;
    run[y * n + x] = size;
    const distance = Math.hypot(x + 1 - size / 2 - n / 2, y + 1 - size / 2 - n / 2);
    if (size > best.size || (size === best.size && distance < best.distance)) best = { size, x, y, distance };
  }
  if (!best.size) return null;
  return { x: window.left + (left + best.x + 1 - best.size / 2) * texelPx, y: window.top + (top + best.y + 1 - best.size / 2) * texelPx,
    side: best.size * texelPx };
}
