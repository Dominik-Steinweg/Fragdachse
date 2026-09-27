import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import exportsJson from '../../src/ui/radialWheelExports.json';
import {
  preloadRadialWheelAssets,
  RADIAL_HUB_FRAME,
  RADIAL_RING_FRAME,
  RADIAL_WHEEL_TEXTURE,
  radialManagementIconFrame,
} from '../../src/ui/RadialWheelAssets';
import type { RadialManagementAction } from '../../src/systems/RadialActionModel';

const runtime = resolve(__dirname, '../../public/assets/ui/radial-wheel', exportsJson.file);
const frames = exportsJson.atlas.frames as Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
const MANAGEMENT_ACTIONS: readonly RadialManagementAction[] = ['reposition', 'dismantle', 'dismantle-own-all'];

describe('radial wheel artwork', () => {
  it('preloads the exported atlas with ring, hub and one icon per management action inside it', async () => {
    const atlas = vi.fn();
    preloadRadialWheelAssets({ atlas } as never);
    expect(atlas).toHaveBeenCalledExactlyOnceWith(
      RADIAL_WHEEL_TEXTURE, './assets/ui/radial-wheel/' + exportsJson.file, exportsJson.atlas);

    const metadata = await sharp(runtime).metadata();
    expect(metadata.format).toBe('webp');
    expect([metadata.width, metadata.height]).toEqual([exportsJson.width, exportsJson.height]);
    const names = [RADIAL_RING_FRAME, RADIAL_HUB_FRAME, ...MANAGEMENT_ACTIONS.map(radialManagementIconFrame)];
    for (const name of names) {
      const { frame } = frames[name];
      expect(frame.x + frame.w).toBeLessThanOrEqual(exportsJson.width);
      expect(frame.y + frame.h).toBeLessThanOrEqual(exportsJson.height);
    }
  });

  it.each([
    [RADIAL_RING_FRAME, exportsJson.ring],
    [RADIAL_HUB_FRAME, exportsJson.hub],
  ])('%s keeps the opening inside its measured inner edge transparent', async (name, geometry) => {
    const { frame } = frames[name];
    expect(geometry.innerRadius).toBeLessThan(geometry.outerRadius);
    // Segmente und Nabenglas liegen unter der Öffnung; gemalte Fläche dort würde sie verdecken.
    const side = Math.floor(geometry.innerRadius * Math.SQRT1_2 * 2 * 0.9);
    const alpha = await sharp(runtime)
      .extract({
        left: Math.round(frame.x + geometry.centerX - side / 2),
        top: Math.round(frame.y + geometry.centerY - side / 2),
        width: side,
        height: side,
      })
      .extractChannel('alpha').raw().toBuffer();
    expect(alpha.every((value) => value <= 4)).toBe(true);
  });
});
