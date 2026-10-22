import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PLAYER_SIZE } from '../../src/config';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../../src/config/coopDefenseEnemies';
import { TURRET_VISUALS } from '../../src/config/turretVisuals';
import { WATCHTOWER_DISPLAY_SIZE } from '../../src/config/watchtower';
import { getPipelineAssetForTexture } from '../../src/config/pipelineAssets';
import { DAWN_M3_ASSET_KEYS } from '../../src/dawn/contracts/DawnContentIds';
import { DAWN_SCAVENGER_KIND } from '../../src/dawn/runtime/DawnScavengerPort';
import { LOADOUT_CATALOG_ENTRIES, findWeaponConfig, findUtilityConfig } from '../../src/loadout/LoadoutConfig';
import { EQUIPABLE_LOADOUT_CATALOG_ENTRIES } from '../equipableLoadoutEntries';
import { validateClipContracts, validateExtensions } from '../../scripts/asset-pipeline/contracts-v2.mjs';
import { readDemandCatalog } from '../../scripts/asset-pipeline/pipeline-registry.mjs';

const root = process.cwd();
const catalog = await readDemandCatalog();
const assets = catalog.assets;
const sorted = (values: string[]) => [...values].sort();

describe('asset pipeline catalog contracts', () => {
  it('keeps the decorative dealer unbound and reuses the player anatomy with an idle-only contract', () => {
    const dealer = assets.find(asset => asset.id === 'dawn_dealer')!;
    const player = assets.find(asset => asset.id === 'badger')!;
    const stall = assets.find(asset => asset.id === 'construction_dawn_dealer_stall')!;
    expect(dealer).toMatchObject({ category: 'character', gameIds: [], targetSize: 32, forward: 'north', pivot: [0.5, 0.5] });
    expect(dealer.model).toEqual(player.model);
    expect(dealer.textures).toEqual(player.textures);
    expect(dealer.requiredClips).toEqual(['idle']);
    expect(dealer.clips).toHaveLength(1);
    expect(dealer.clips![0]).toMatchObject({ name: 'idle', motion: 'player_idle', loop: true });
    expect(stall).toMatchObject({ category: 'construction', gameIds: [], targetSize: 96, pivot: [0.5, 0.5], clips: [] });
  });
  it('keeps Dawn constructions unbound, tier-parametric and explicit about their clips', () => {
    const dawn = assets.filter(asset => ['dawn-wreck', 'dawn-extractor', 'dawn-scrap'].includes(asset.recipe ?? ''));
    expect(dawn).toHaveLength(7);
    for (const asset of dawn) {
      expect(asset.gameIds).toEqual([]);
      expect(asset.pivot).toEqual([0.5, 0.5]);
      expect(existsSync(path.join(root, asset.reference))).toBe(true);
      expect(() => validateClipContracts(asset.clips!, false)).not.toThrow();
      if (asset.recipe !== 'dawn-extractor') {
        expect(asset.clips).toEqual([]);
        expect([1, 2, 3]).toContain((asset.model as { tier: number }).tier);
      } else {
        expect(asset.clips!.map(clip => clip.name)).toEqual(['idle', 'active']);
        expect(asset.clips!.every(clip => clip.loop)).toBe(true);
      }
    }
  });
  it('keeps fire-control HQ exports compatible with the approved draft canvases and grips', () => {
    const expected = [
      ['fire-control-relay', 24, [48, 96], 3, undefined],
      ['held-fire-control-relay', 32, [128, 256], 3.2, [16, 18.4]],
      ['held-fire-control-portal', 32, [128, 256], 3.2, [16, 18]],
      ['fire-control-portal-flight', 34, [34, 68], 1.5, undefined],
    ] as const;
    for (const [id, size, sources, orthoScale, muzzle] of expected) {
      const asset = assets.find(entry => entry.id === id)!;
      expect(asset.targetSize).toBe(size);
      expect(asset.sourceSizes).toEqual(sources);
      expect(asset.orthoScale).toBe(orthoScale);
      expect(asset.pivot).toEqual([0.5, 0.5]);
      expect(asset.forward).toBe('north');
      if (muzzle) expect(asset.heldItem).toEqual({ referenceSize: 32, grip: [16, 24], muzzle });
      if (id !== 'fire-control-relay') expect(asset.clips).toEqual([]);
    }
    expect(assets.find(entry => entry.id === 'fire-control-relay')!.clips).toEqual([
      { name: 'deploy', motion: 'relay_deploy', frameCount: 8, frameRate: 24, loop: false, start: 'free', end: 'rest' },
    ]);
  });
  it('keeps the watchtower runtime canvas at its authored display size', () => {
    const asset = assets.find(entry => entry.id === 'watchtower')!;
    expect(asset.targetSize).toBe(WATCHTOWER_DISPLAY_SIZE);
  });
  it('covers every equipable utility with a portable model and authored held-item anchors', () => {
    const required = EQUIPABLE_LOADOUT_CATALOG_ENTRIES.filter(entry => entry.kind === 'utility').map(entry => entry.id);
    const utilities = assets.filter(asset => asset.category === 'utility');
    const authoredIds = utilities.flatMap(asset => asset.gameIds);
    expect(authoredIds).toEqual(expect.arrayContaining(required));
    expect(new Set(authoredIds).size).toBe(authoredIds.length);
    // Locked content may be authored before release, but never invent a utility ID.
    for (const id of authoredIds) expect(findUtilityConfig(id), id).toBeDefined();
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
    const slotless = new Set(['melee', 'energy_shield', 'tesla_dome']);
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
    // Dawn binds its scavenger art explicitly (EnemyEntity); a gameIds binding would let a runtime
    // import retexture it with the fallback imageKey, so the asset stays unbound but must exist.
    const explicitAssets: Record<string, string> = { [DAWN_SCAVENGER_KIND]: DAWN_M3_ASSET_KEYS.scavenger };
    const standard = Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)
      .filter(([id, config]) => !config.krakenBoss && !config.krakenEgg && !explicitAssets[id]);
    expect(sorted(enemies.flatMap((asset) => asset.gameIds))).toEqual(sorted(standard.map(([id]) => id)));
    for (const [enemyId, config] of Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)) {
      const explicitId = explicitAssets[enemyId];
      if (explicitId) {
        const asset = enemies.find(entry => entry.id === explicitId);
        expect(asset, `${enemyId}/${explicitId}`).toMatchObject({ gameIds: [], targetSize: config.size, forward: 'north' });
        expect(asset!.requiredClips).toEqual(expect.arrayContaining(config.weapons.length ? ['move', 'claw'] : ['move']));
        continue;
      }
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
      // ArenaScene loads the pipeline idle frame first; only kinds without one fall back to the static
      // sprite, which then is also the archived comparison artwork.
      if (getPipelineAssetForTexture(config.imageKey)) expect(existsSync(path.join(root, asset.reference)), enemyId).toBe(true);
      else expect(asset.reference).toBe(`public/assets/sprites/enemies/${config.imageKey}.png`);
      expect(config.spriteRotationOffsetDegrees ?? 0).toBe(0);
    }
    const characters = assets.filter((asset) => asset.category === 'character' && asset.gameIds.includes('player'));
    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({ gameIds: ['player'], targetSize: PLAYER_SIZE, forward: 'north' });
    expect(characters[0].requiredClips).toEqual(expect.arrayContaining(['move', 'idle']));
  });

  it('provides complete briefs and existing references without confusing source and display sizes', () => {
    expect(catalog.version).toBe(2);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.id).toMatch(/^[a-z][a-z0-9_-]*$/);
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
    const motions = new Set(['relay_deploy', 'dawn_broodnest_idle', 'dawn_extractor_idle', 'dawn_extractor_active', 'firestarter_cast', 'shield_bash', 'shield_windup', 'shield_charge', 'shield_recover', 'mechanical_fire', 'energy_fire', 'organic_pulse', 'sustained', 'quadruped', 'biped', 'player_walk', 'player_idle', 'quad_rotors', 'twin_rotors', 'claw_quadruped', 'claw_biped', 'kraken_idle', 'kraken_swim', 'kraken_slam', 'kraken_emerge']);
    for (const motion of ['kraken_intro_rise', 'kraken_call_tentacle', 'kraken_throw_egg', 'kraken_ink_spit', 'kraken_dive', 'kraken_surface', 'kraken_land_ink_spit', 'kraken_volley_spines', 'kraken_spine_idle',
      'kraken_land_idle', 'kraken_land_move', 'kraken_land_ashore', 'kraken_land_slam', 'kraken_land_egg_throw', 'kraken_land_death', 'kraken_land_volley_spines',
      'kraken_tentacle_rise', 'kraken_tentacle_hover', 'kraken_tentacle_slam', 'kraken_tentacle_retract', 'kraken_egg_idle', 'kraken_egg_hatch',
      'kraken_brood_idle', 'kraken_brood_crawl', 'kraken_brood_spit', 'kraken_brood_leap',
      'toad_idle', 'toad_shuffle', 'toad_hop', 'toad_channel', 'toad_tongue',
      'kaboomtula_idle', 'kaboomtula_skitter', 'kaboomtula_spit', 'kaboomtula_alert', 'kaboomtula_leap',
      'puffball_swell', 'puffball_burst', 'puffball_refill', 'hive_shake', 'hive_release',
      'staff_work_hammer', 'staff_work_plan', 'staff_work_ledger', 'staff_work_weigh', 'staff_greet']) motions.add(motion);
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
      if (asset.materialSource === 'procedural') {
        // Procedural pigments consume no external image, independent of recipe identity.
        expect(asset.textures).toEqual({});
      } else {
        const library = (asset.model as { librarySurfaces?: Record<string, { family: string; moss?: number }> }).librarySurfaces;
        if (library) {
          // Every authored shader input must participate in the texture provenance map.
          for (const surface of Object.values(library)) {
            for (const family of [surface.family, 'grime', 'edgewear', ...(surface.moss ? ['moss'] : [])]) {
              expect(Object.keys(asset.textures!), `${asset.id}: ${family}`).toContain(family);
            }
          }
        } else {
          expect(Object.keys(asset.textures!)).toContain(['weapon', 'utility', 'construction', 'companion'].includes(asset.category) || asset.category === 'turret' && asset.id !== 'spore' ? 'technical' : 'organic');
        }
      }
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
