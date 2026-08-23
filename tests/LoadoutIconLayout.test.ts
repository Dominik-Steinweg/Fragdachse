import { describe, expect, it, vi } from 'vitest';
import {
  ASMD_LOADOUT_ICON_SCALE,
  fitLoadoutIcon,
  getLoadoutIconDisplaySize,
} from '../src/ui/LoadoutIconLayout';

describe('loadout icon layout', () => {
  it('adds the ASMD safety inset while keeping the icon centered and square', () => {
    const size = getLoadoutIconDisplaySize('ASMD_PRIM', 32, 32, 32, 32);

    expect(size.width).toBeCloseTo(32 * ASMD_LOADOUT_ICON_SCALE);
    expect(size.height).toBeCloseTo(32 * ASMD_LOADOUT_ICON_SCALE);
  });

  it('applies the same ASMD inset to the secondary icon', () => {
    expect(getLoadoutIconDisplaySize('ASMD_SEC', 32, 32, 44, 44)).toEqual({
      width: 44 * ASMD_LOADOUT_ICON_SCALE,
      height: 44 * ASMD_LOADOUT_ICON_SCALE,
    });
  });

  it.each([
    '__ui_loadout_icon_ASMD_PRIM_padded',
    '__ui_loadout_icon_ASMD_SEC_padded',
  ])('applies the ASMD inset to the padded runtime texture key %s', (textureKey) => {
    const image = {
      texture: { key: textureKey },
      frame: { width: 32, height: 32 },
      setDisplaySize: vi.fn(),
    };

    fitLoadoutIcon(image as Parameters<typeof fitLoadoutIcon>[0], 32, 32);

    expect(image.setDisplaySize).toHaveBeenCalledWith(
      32 * ASMD_LOADOUT_ICON_SCALE,
      32 * ASMD_LOADOUT_ICON_SCALE,
    );
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
