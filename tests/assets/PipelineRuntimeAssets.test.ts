import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import manifest from '../../src/config/pipelineAssets.json';
import catalog from '../../scripts/asset-pipeline/catalog-v2.json';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../../src/config/coopDefenseEnemies';
import { getCoopDefenseUpgradeTextureKey } from '../../src/utils/coopDefenseUpgrades';

describe('selected runtime asset package', () => {
  it('resolves every smoke upgrade alias to a shipped PNG', async () => {
    const ids = ['smoke_grenade_radius', 'smoke_grenade_duration', 'smoke_grenade_storm',
      'smoke_grenade_disorientation', 'smoke_grenade_vulnerability', 'smoke_grenade_discharge', 'smoke_grenade_growth'];
    for (const id of ids) {
      const key = getCoopDefenseUpgradeTextureKey(id);
      expect(key).toBeTruthy();
      const metadata = await sharp(`public/assets/sprites/Loadout/${key}.png`).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);
    }
  });
  it('covers the authored production catalog with unique runtime textures', () => {
    expect(manifest.assets.map(a => a.id).sort()).toEqual(catalog.assets.map(a => a.id).sort());
    expect(new Set(manifest.assets.flatMap(a => [a.textureKey, a.sheetTextureKey])).size).toBe(manifest.assets.length * 2);
    for (const asset of manifest.assets) {
      expect(asset.gameIds).toEqual(catalog.assets.find(a => a.id === asset.id)!.gameIds);
      if (asset.category === 'enemy') {
        for (const id of asset.gameIds) {
          expect(COOP_DEFENSE_ENEMY_CONFIGS[id as keyof typeof COOP_DEFENSE_ENEMY_CONFIGS].imageKey).toBe(asset.textureKey);
        }
      }
    }
  });

  it('ships unchanged selected PNGs, valid gutters, idle cells and explicit clip frames', async () => {
    for (const asset of manifest.assets) {
      const { layout } = asset;
      expect(layout.frameWidth).toBe(asset.sourceSize);
      expect(layout.frameHeight).toBe(asset.sourceSize);
      expect(asset.pivot).toEqual([0.5, 0.5]);
      for (const field of ['idle', 'sheet'] as const) {
        const file = `public/${asset[`${field}Path`].replace(/^\.\//, '')}`;
        await access(file);
        const bytes = await readFile(file);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.hashes[field]);
        expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', hasAlpha: true,
          width: field === 'idle' ? asset.sourceSize : layout.width,
          height: field === 'idle' ? asset.sourceSize : layout.height });
      }
      for (const clip of asset.clips) {
        expect(clip.frameRate).toBeGreaterThan(0);
        expect(clip.frames.length).toBeGreaterThan(1);
        expect(clip.frames).not.toContain(asset.idleFrame);
        for (const frame of [asset.idleFrame, ...clip.frames]) {
          expect(Number.isInteger(frame) && frame >= 0 && frame < layout.frameCount).toBe(true);
          const x = layout.margin + frame % layout.columns * (layout.frameWidth + layout.spacing);
          const y = layout.margin + Math.floor(frame / layout.columns) * (layout.frameHeight + layout.spacing);
          expect(x + layout.frameWidth).toBeLessThanOrEqual(layout.width);
          expect(y + layout.frameHeight).toBeLessThanOrEqual(layout.height);
        }
      }
      const idle = await sharp(`public/${asset.idlePath.slice(2)}`).raw().toBuffer();
      const sheetIdle = await sharp(`public/${asset.sheetPath.slice(2)}`)
        .extract({ left: layout.margin, top: layout.margin, width: layout.frameWidth, height: layout.frameHeight }).raw().toBuffer();
      // Sheet compositing may round RGB by one level on partially transparent edges.
      // Compare visible premultiplied color; transparent RGB is not visual information.
      let maxVisibleDifference = 0;
      let maxAlphaDifference = 0;
      for (let i = 0; i < idle.length; i += 4) {
        maxAlphaDifference = Math.max(maxAlphaDifference, Math.abs(idle[i + 3] - sheetIdle[i + 3]));
        for (let channel = 0; channel < 3; channel++) {
          maxVisibleDifference = Math.max(maxVisibleDifference,
            Math.abs(idle[i + channel] * idle[i + 3] - sheetIdle[i + channel] * sheetIdle[i + 3]) / 255);
        }
      }
      expect(maxAlphaDifference).toBe(0);
      expect(maxVisibleDifference).toBeLessThanOrEqual(1);
    }
  });
});
