import { describe, expect, it, vi } from 'vitest';
import { writeMarkerGpuView } from '../src/effects/markers/MarkerGpuCamera';

describe('marker camera roles', () => {
  it.each([.5, 1, 2])('keeps filtered world viewport offsets only for Clarity projection, at scale %s', scale => {
    const internal = { a: scale, b: 0, c: 0, d: scale, tx: -23 * scale, ty: -41 * scale };
    const combined = { ...internal, tx: internal.tx + 320 * scale, ty: internal.ty + 230 * scale };
    // A filtered Phaser camera returns its internal matrix even for getViewMatrix(false).
    const camera = { matrixCombined: combined, getViewMatrix: vi.fn(() => internal) };
    const matrix = new Float32Array(9);
    writeMarkerGpuView(matrix, camera, true, true);
    expect(matrix[6]).toBe(combined.tx); expect(matrix[7]).toBe(combined.ty);
    expect(camera.getViewMatrix).not.toHaveBeenCalled();
    writeMarkerGpuView(matrix, camera, false, false);
    expect(matrix[6]).toBe(internal.tx); expect(matrix[7]).toBe(internal.ty);
    expect(camera.getViewMatrix).toHaveBeenCalledWith(true);
    expect([...matrix.slice(0, 6)]).toEqual([scale, 0, 0, 0, scale, 0]);
  });
});
