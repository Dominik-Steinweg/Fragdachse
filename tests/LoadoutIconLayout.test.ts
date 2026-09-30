import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Textures: { FilterMode: { LINEAR: 'LINEAR' } },
}));

import {
  fitLoadoutIcon,
  getLoadoutIconDisplaySize,
  getLoadoutIconTextureKey,
} from '../src/ui/LoadoutIconLayout';

describe('loadout icon layout', () => {
  it('fits the high-resolution primary ASMD icon to the 32px display box', () => {
    expect(getLoadoutIconDisplaySize('ASMD_PRIM', 256, 256, 32, 32)).toEqual({
      width: 32,
      height: 32,
    });
  });

  it('fits the secondary ASMD icon without an additional scale', () => {
    expect(getLoadoutIconDisplaySize('ASMD_SEC', 256, 256, 44, 44)).toEqual({
      width: 44,
      height: 44,
    });
  });

  it.each(['ASMD_PRIM', 'ASMD_SEC'])('uses the normal runtime fit for the high-resolution %s texture', (textureKey) => {
    const image = {
      texture: { key: textureKey },
      frame: { width: 256, height: 256 },
      setDisplaySize: vi.fn(),
    };

    fitLoadoutIcon(image as Parameters<typeof fitLoadoutIcon>[0], 32, 32);

    expect(image.setDisplaySize).toHaveBeenCalledWith(32, 32);
  });

  it.each(['ASMD_PRIM', 'ASMD_SEC'])('keeps the original %s key and uses LINEAR filtering', (textureKey) => {
    const setFilter = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => true),
        get: vi.fn(() => ({ setFilter })),
      },
    };

    expect(getLoadoutIconTextureKey(scene as Parameters<typeof getLoadoutIconTextureKey>[0], textureKey))
      .toBe(textureKey);
    expect(setFilter).toHaveBeenCalledWith('LINEAR');
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
