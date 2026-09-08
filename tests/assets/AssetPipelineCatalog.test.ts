import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import catalog from '../../scripts/asset-pipeline/catalog-v2.json';
import { PLAYER_SIZE } from '../../src/config';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../../src/config/coopDefenseEnemies';
import { TURRET_VISUALS } from '../../src/config/turretVisuals';

const root = process.cwd();
const assets = catalog.assets;
const sorted = (values: string[]) => [...values].sort();

describe('asset pipeline catalog contracts', () => {
  it('covers each current turret weapon once and preserves shared visual assignments', () => {
    const turrets = assets.filter((asset) => asset.category === 'turret');
    expect(sorted(turrets.flatMap((asset) => asset.gameIds))).toEqual(sorted(Object.keys(TURRET_VISUALS)));
    expect(turrets).toHaveLength(new Set(Object.values(TURRET_VISUALS).map((visual) => visual.textureKey)).size);
    for (const [weaponId, visual] of Object.entries(TURRET_VISUALS)) {
      const asset = turrets.find((entry) => entry.gameIds.includes(weaponId))!;
      expect(asset.targetSize).toBe(visual.displaySize);
      expect(asset.forward).toBe('east');
      expect(asset.requiredClips).toEqual(['fire']);
      expect(asset.mount?.rockSize).toBe(32);
      expect(asset.mount?.maxBaseDiameter).toBeGreaterThan(0);
      expect(asset.mount?.maxBaseDiameter).toBeLessThan(32);
      const sharedIds = Object.entries(TURRET_VISUALS)
        .filter(([, candidate]) => candidate.textureKey === visual.textureKey)
        .map(([id]) => id);
      expect(sorted(asset.gameIds)).toEqual(sorted(sharedIds));
      // Reference corrections apply only to the archived comparison artwork.
      expect(visual.asset.id).toBe(asset.id);
      expect(visual.centerCorrectionX).toBe(0);
      expect(visual.centerCorrectionY).toBe(0);
      expect(visual.rotationOffset).toBe(0);
    }
  });

  it('covers current enemies and player at configured display sizes with north-facing movement', () => {
    const enemies = assets.filter((asset) => asset.category === 'enemy');
    expect(sorted(enemies.flatMap((asset) => asset.gameIds))).toEqual(sorted(Object.keys(COOP_DEFENSE_ENEMY_CONFIGS)));
    for (const [enemyId, config] of Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)) {
      const asset = enemies.find((entry) => entry.gameIds.includes(enemyId))!;
      expect(asset.targetSize).toBe(config.size);
      expect(asset.forward).toBe('north');
      expect(asset.requiredClips).toEqual(['move']);
      expect(asset.reference).toBe(`public/assets/sprites/enemies/${config.imageKey}.png`);
      expect(config.spriteRotationOffsetDegrees ?? 0).toBe(0);
    }
    const characters = assets.filter((asset) => asset.category === 'character');
    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({ gameIds: ['player'], targetSize: PLAYER_SIZE, forward: 'north', requiredClips: ['move'] });
  });

  it('provides complete briefs and existing references without confusing source and display sizes', () => {
    expect(catalog.version).toBe(2);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(asset.label.trim()).not.toBe('');
      expect(asset.pivot).toEqual([0.5, 0.5]);
      expect(existsSync(path.join(root, asset.reference)), asset.reference).toBe(true);
      for (const brief of Object.values(asset.description)) expect(brief.trim().length).toBeGreaterThan(8);
      expect(asset.sourceSizes.length).toBeGreaterThan(0);
      expect([...new Set(asset.sourceSizes)].sort((a, b) => a - b)).toEqual(asset.sourceSizes);
      for (const size of asset.sourceSizes) {
        expect(Number.isInteger(size)).toBe(true);
        expect(size).toBeGreaterThanOrEqual(asset.targetSize);
      }
    }
  });

  it('distinguishes executable reference recipes from planned briefs and defines complete motion contracts', () => {
    const motions = new Set(['mechanical_fire', 'energy_fire', 'organic_pulse', 'sustained', 'quadruped', 'biped', 'player_walk']);
    for (const asset of assets) {
      if (asset.production === 'planned') {
        expect(asset.recipe).toBeUndefined();
        expect(asset.clips).toBeUndefined();
        continue;
      }
      expect(asset.production).toBe('reference');
      expect(asset.recipe).toBeTruthy();
      expect(existsSync(path.join(root, 'scripts/asset-pipeline/recipes_v2', `${asset.recipe}.py`))).toBe(true);
      expect(asset.model).toBeDefined();
      expect(asset.orthoScale).toBeGreaterThan(0);
      expect(asset.textures).toBeDefined();
      // Original texture pixels and completed renders are local artifacts, not required in a clean checkout.
      expect(Object.keys(asset.textures!)).toContain(asset.category === 'turret' && asset.id !== 'spore' ? 'technical' : 'organic');
      expect(Object.keys(asset.materialVariants!).sort()).toEqual(['calm', 'rich']);
      for (const variant of Object.values(asset.materialVariants!)) {
        expect(variant.textureStrength).toBeGreaterThanOrEqual(0);
        expect(variant.textureStrength).toBeLessThanOrEqual(1);
        expect(variant.formShadowStrength).toBeGreaterThanOrEqual(0);
        expect(variant.formShadowStrength).toBeLessThanOrEqual(1);
      }
      expect(asset.clips!.map((clip) => clip.name)).toEqual(asset.requiredClips);
      for (const clip of asset.clips!) {
        expect(motions.has(clip.motion)).toBe(true);
        expect(Number.isInteger(clip.frameCount) && clip.frameCount > 1).toBe(true);
        expect(Number.isFinite(clip.frameRate) && clip.frameRate > 0).toBe(true);
        expect(typeof clip.loop).toBe('boolean');
        if (clip.name === 'move') expect(clip.loop).toBe(true);
      }
    }
  });
});
