import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import catalog from '../../scripts/asset-pipeline/catalog-v2.json';
import { PLAYER_SIZE } from '../../src/config';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../../src/config/coopDefenseEnemies';
import { TURRET_VISUALS } from '../../src/config/turretVisuals';
import { WATCHTOWER_DISPLAY_SIZE } from '../../src/config/watchtower';
import { LOADOUT_CATALOG_ENTRIES, findWeaponConfig } from '../../src/loadout/LoadoutConfig';
import { EQUIPABLE_LOADOUT_CATALOG_ENTRIES } from '../equipableLoadoutEntries';
import { validateClipContracts, validateExtensions } from '../../scripts/asset-pipeline/contracts-v2.mjs';

const root = process.cwd();
const assets = catalog.assets;
const sorted = (values: string[]) => [...values].sort();

describe('asset pipeline catalog contracts', () => {
  it('keeps the watchtower runtime canvas at its authored display size', () => {
    const asset = assets.find(entry => entry.id === 'watchtower')!;
    expect(asset.targetSize).toBe(WATCHTOWER_DISPLAY_SIZE);
  });
  it('covers every equipable utility with a portable model and authored held-item anchors', () => {
    const required = EQUIPABLE_LOADOUT_CATALOG_ENTRIES.filter(entry => entry.kind === 'utility').map(entry => entry.id);
    const utilities = assets.filter(asset => asset.category === 'utility');
    expect(sorted(utilities.flatMap(asset => asset.gameIds))).toEqual(sorted(required));
    for (const asset of utilities) {
      expect(asset.forward).toBe('north');
      expect(asset.clips).toEqual([]);
      expect(asset.heldItem?.referenceSize).toBe(asset.targetSize);
      expect(existsSync(path.join(root, asset.designReference!))).toBe(true);
      for (const point of [asset.heldItem!.grip, asset.heldItem!.muzzle]) for (const coordinate of point) {
        expect(coordinate).toBeGreaterThanOrEqual(0);
        expect(coordinate).toBeLessThanOrEqual(asset.targetSize);
      }
    }
  });
  it('covers every equipable held weapon with explicit grip and muzzle coordinates', () => {
    const slotless = new Set(['melee', 'energy_shield', 'tesla_dome', 'healing_aura']);
    const required = LOADOUT_CATALOG_ENTRIES.filter(entry => entry.kind === 'weapon')
      .filter(entry => { const weapon = findWeaponConfig(entry.id); return weapon && !slotless.has(weapon.fire.type); }).map(entry => entry.id);
    const weapons = assets.filter(asset => asset.category === 'weapon');
    expect(sorted(weapons.flatMap(asset => asset.gameIds))).toEqual(sorted(required));
    for (const asset of weapons) {
      expect(asset.forward).toBe('north');
      expect(asset.requiredClips).toEqual([]);
      expect(asset.heldItem?.referenceSize).toBe(asset.targetSize);
      expect(existsSync(path.join(root, asset.designReference!))).toBe(true);
      for (const point of [asset.heldItem!.grip, asset.heldItem!.muzzle]) for (const coordinate of point) {
        expect(coordinate).toBeGreaterThanOrEqual(0);
        expect(coordinate).toBeLessThanOrEqual(asset.targetSize);
      }
    }
  });
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

  it('covers current enemies through their standard or boss asset contracts and the north-facing player', () => {
    const enemies = assets.filter((asset) => asset.category === 'enemy');
    const standard = Object.entries(COOP_DEFENSE_ENEMY_CONFIGS).filter(([, config]) => !config.krakenBoss && !config.krakenEgg);
    expect(sorted(enemies.flatMap((asset) => asset.gameIds))).toEqual(sorted(standard.map(([id]) => id)));
    for (const [enemyId, config] of Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)) {
      // Boss silhouettes and brood have explicit asset IDs and separate visual
      // sizes; their collision radius is not a regular enemy sprite size.
      const bossAssets = config.krakenBoss ? Object.values(config.krakenBoss.assets)
        : config.krakenEgg ? [config.krakenEgg.assetId] : null;
      if (bossAssets) {
        for (const id of bossAssets) expect(assets.find(asset => asset.id === id), `${enemyId}/${id}`)
          .toMatchObject({ runtimeContract: 'boss', forward: 'north' });
        continue;
      }
      const asset = enemies.find((entry) => entry.gameIds.includes(enemyId))!;
      expect(asset.targetSize, enemyId).toBe(config.size);
      expect(asset.forward).toBe('north');
      expect(asset.requiredClips).toEqual(expect.arrayContaining((asset as { runtimeContract?: string }).runtimeContract === 'boss' ? ['move'] : ['move', 'claw']));
      expect(asset.reference).toBe(`public/assets/sprites/enemies/${config.imageKey}.png`);
      expect(config.spriteRotationOffsetDegrees ?? 0).toBe(0);
    }
    const characters = assets.filter((asset) => asset.category === 'character');
    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({ gameIds: ['player'], targetSize: PLAYER_SIZE, forward: 'north' });
    expect(characters[0].requiredClips).toEqual(expect.arrayContaining(['move', 'idle']));
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
    const motions = new Set(['relay_deploy', 'firestarter_cast', 'mechanical_fire', 'energy_fire', 'organic_pulse', 'sustained', 'quadruped', 'biped', 'player_walk', 'player_idle', 'quad_rotors', 'twin_rotors', 'claw_quadruped', 'claw_biped', 'kraken_idle', 'kraken_swim', 'kraken_slam', 'kraken_emerge']);
    for (const motion of ['kraken_intro_rise', 'kraken_call_tentacle', 'kraken_throw_egg', 'kraken_ink_spit', 'kraken_dive', 'kraken_surface', 'kraken_land_ink_spit', 'kraken_volley_spines', 'kraken_spine_idle',
      'kraken_land_idle', 'kraken_land_move', 'kraken_land_ashore', 'kraken_land_slam', 'kraken_land_egg_throw', 'kraken_land_death', 'kraken_land_volley_spines',
      'kraken_tentacle_rise', 'kraken_tentacle_hover', 'kraken_tentacle_slam', 'kraken_tentacle_retract', 'kraken_egg_idle', 'kraken_egg_hatch']) motions.add(motion);
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
      expect(() => validateClipContracts(asset.clips!, false), asset.id).not.toThrow();
      expect(() => validateExtensions(asset), asset.id).not.toThrow();
      expect(asset.orthoScale).toBeGreaterThan(0);
      expect(asset.textures).toBeDefined();
      // Original texture pixels and completed renders are local artifacts, not required in a clean checkout.
      expect(Object.keys(asset.textures!)).toContain(['weapon', 'utility', 'construction', 'companion'].includes(asset.category) || asset.category === 'turret' && asset.id !== 'spore' ? 'technical' : 'organic');
      expect(Object.keys(asset.materialVariants!)).toHaveLength(1);
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
  it('accepts organic boss parts without locomotion and requires a complete boss export contract', () => {
    const part = { category: 'boss-part', targetSize: 64, sourceSizes: [128], textures: { organic: 'fixture.png' },
      runtimeContract: 'boss', runtimeAtlas: true, runtimeBudgetMB: 16, elevation: { min: -2, max: 3 },
      clips: [{ name: 'hatch', frameCount: 4, frameRate: 12, loop: false, end: 'terminal', markers: { release: 2 } }] };
    expect(() => validateClipContracts(part.clips, false)).not.toThrow();
    expect(() => validateExtensions(part)).not.toThrow();
    for (const patch of [{ runtimeAtlas: false }, { elevation: undefined }, { runtimeBudgetMB: undefined },
      { runtimeBudgetMB: 0 }, { runtimeContract: 'other' }, { category: 'turret' }, { elevation: { min: 2, max: 2 } },
      { elevation: { min: -2, max: 3, scale: 0 } }]) expect(() => validateExtensions({ ...part, ...patch })).toThrow();
  });
});
