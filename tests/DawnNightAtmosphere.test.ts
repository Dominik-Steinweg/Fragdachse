import { describe, expect, it } from 'vitest';
import { DAWN_NIGHT_MODIFIER_IDS } from '../src/dawn/contracts/DawnContentIds';
import { DAWN_NIGHT_ASSET_FILES } from '../src/assets/DawnAssets';
import { DAWN_NIGHT_TEXTURES, NIGHT_MODIFIER_ATMOSPHERE } from '../src/effects/dawn/DawnNightAtmosphereConfig';

describe('Dawn night modifier atmosphere', () => {
  it('styles every modifier with its own preloaded LUT and only preloaded masks', () => {
    const preloaded = new Set<string>(DAWN_NIGHT_ASSET_FILES);
    for (const id of DAWN_NIGHT_MODIFIER_IDS) {
      const style = NIGHT_MODIFIER_ATMOSPHERE.styles[id];
      expect(style.lut, id).toBe(id);
      expect(preloaded.has(DAWN_NIGHT_TEXTURES.lut(style.lut)), id).toBe(true);
      // Subtle mood only (D-43): the LUT never fully replaces the lit image.
      expect(style.lutAmount, id).toBeLessThanOrEqual(0.7);
    }
    for (const key of [DAWN_NIGHT_TEXTURES.ember, DAWN_NIGHT_TEXTURES.edge]) {
      expect(preloaded.has(key), key).toBe(true);
    }
  });
});
