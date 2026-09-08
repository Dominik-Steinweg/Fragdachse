import { access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { getTurretVisualSpec, getTurretVisualTransform, TURRET_VISUALS } from '../src/config/turretVisuals';
import type { TurretWeaponId } from '../src/types';

const ALL_TURRET_WEAPONS: readonly TurretWeaponId[] = [
  'SPORES',
  'BASE_SPORES',
  'SPORE_TURRET_PLASMA',
  'TURRET_ROCKET_BURST',
  'TURRET_MG',
  'TURRET_FLAME',
  'TURRET_TESLA',
  'TURRET_GRAVITY',
  'TURRET_SLOW_BUBBLE',
  'TURRET_VOID_FLAME',
  'TURRET_SPORES',
];

describe('turret visual catalog', () => {
  it('covers every turret weapon and shares the selected spore artwork', () => {
    expect(Object.keys(TURRET_VISUALS).sort()).toEqual([...ALL_TURRET_WEAPONS].sort());
    expect(getTurretVisualSpec('SPORES')).toMatchObject({
      textureKey: 'turret_weapon_spore',
      displaySize: 32,
      centerCorrectionX: 0,
      centerCorrectionY: 0,
    });
    expect(getTurretVisualSpec('BASE_SPORES')).toBe(getTurretVisualSpec('SPORES'));
    expect(getTurretVisualSpec('TURRET_SPORES')).toBe(getTurretVisualSpec('SPORES'));
  });

  it('keeps the authored mushroom artwork centered while rotating', () => {
    const transform = getTurretVisualTransform(getTurretVisualSpec('SPORES'), 100, 200, 0);
    expect(transform).toEqual({ x: 100, y: 200, rotation: 0 });
  });

  it('maps every weapon construction through the shared catalog', () => {
    for (const definition of Object.values(COOP_DEFENSE_CONSTRUCTIONS)) {
      if (definition.kind !== 'turret') continue;
      expect(getTurretVisualSpec(definition.weaponId)).toBeDefined();
    }
  });

  it('provides transparent selected PNGs and separates normal from void flame', async () => {
    const generated = [...new Set(Object.values(TURRET_VISUALS).filter((spec) => spec.assetPath !== null))];
    for (const spec of generated) {
      const file = `public/${spec.assetPath!.replace('./assets/', 'assets/')}`;
      await access(file);
      const metadata = await sharp(file).metadata();
      expect(metadata).toMatchObject({ format: 'png', width: spec.asset.sourceSize, height: spec.asset.sourceSize, hasAlpha: true });
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let transparentPixels = 0;
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          const alpha = data[(y * info.width + x) * 4 + 3];
          if (alpha === 0) transparentPixels += 1;
          if (x < 4 || y < 4 || x >= info.width - 4 || y >= info.height - 4) {
            expect(alpha).toBe(0);
          }
        }
      }
      expect(transparentPixels).toBeGreaterThan(0);
      expect(transparentPixels).toBeLessThan(info.width * info.height);
    }

    expect(getTurretVisualSpec('TURRET_FLAME').textureKey)
      .not.toBe(getTurretVisualSpec('TURRET_VOID_FLAME').textureKey);

    const countPalettePixels = async (weaponId: TurretWeaponId) => {
      const { data } = await sharp(`public/${getTurretVisualSpec(weaponId).asset.idlePath.slice(2)}`)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let warm = 0;
      let purple = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [red, green, blue, alpha] = data.subarray(i, i + 4);
        if (alpha < 100) continue;
        if (red > green * 1.2 && red > blue * 1.2) warm += 1;
        if (red + blue > green * 2.2 && blue > green * 1.2) purple += 1;
      }
      return { warm, purple };
    };
    const flame = await countPalettePixels('TURRET_FLAME');
    const voidFlame = await countPalettePixels('TURRET_VOID_FLAME');
    expect(flame.warm).toBeGreaterThan(flame.purple);
    expect(voidFlame.purple).toBeGreaterThan(voidFlame.warm);
  });
});
