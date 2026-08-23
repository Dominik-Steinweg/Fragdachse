import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Textures: { FilterMode: { NEAREST: 'NEAREST' } },
}));

import {
  fitLoadoutIcon,
  getLoadoutIconDisplaySize,
  getLoadoutIconTextureKey,
} from '../src/ui/LoadoutIconLayout';

describe('loadout icon layout', () => {
  it('fits the primary ASMD icon to the original 32px box', () => {
    expect(getLoadoutIconDisplaySize('ASMD_PRIM', 32, 32, 32, 32)).toEqual({
      width: 32,
      height: 32,
    });
  });

  it('fits the secondary ASMD icon without an additional scale', () => {
    expect(getLoadoutIconDisplaySize('ASMD_SEC', 32, 32, 44, 44)).toEqual({
      width: 44,
      height: 44,
    });
  });

  it.each(['ASMD_PRIM', 'ASMD_SEC'])('uses the normal runtime fit for the original %s texture', (textureKey) => {
    const image = {
      texture: { key: textureKey },
      frame: { width: 32, height: 32 },
      setDisplaySize: vi.fn(),
    };

    fitLoadoutIcon(image as Parameters<typeof fitLoadoutIcon>[0], 32, 32);

    expect(image.setDisplaySize).toHaveBeenCalledWith(32, 32);
  });

  it.each(['ASMD_PRIM', 'ASMD_SEC'])('keeps the original %s key and uses NEAREST filtering', (textureKey) => {
    const setFilter = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => true),
        get: vi.fn(() => ({ setFilter })),
      },
    };

    expect(getLoadoutIconTextureKey(scene as Parameters<typeof getLoadoutIconTextureKey>[0], textureKey))
      .toBe(textureKey);
    expect(setFilter).toHaveBeenCalledWith('NEAREST');
  });

  it('does not change filtering for standard icons', () => {
    const setFilter = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => true),
        get: vi.fn(() => ({ setFilter })),
      },
    };

    expect(getLoadoutIconTextureKey(scene as Parameters<typeof getLoadoutIconTextureKey>[0], 'P90'))
      .toBe('P90');
    expect(setFilter).not.toHaveBeenCalled();
  });

  it('keeps standard icons at their existing maximum size', () => {
    expect(getLoadoutIconDisplaySize('P90', 32, 32, 32, 32)).toEqual({
      width: 32,
      height: 32,
    });
  });

  it('fits non-square textures proportionally inside the target box', () => {
    expect(getLoadoutIconDisplaySize('custom', 16, 8, 24, 24)).toEqual({
      width: 24,
      height: 12,
    });
  });
});
