import type * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { getPipelineAsset } from '../../src/config/pipelineAssets';
import {
  BOMBER_DRONE_BODY_ASSET_ID,
  BOMBER_DRONE_BOMB_ASSET_ID,
  preloadBomberSquadronAssets,
} from '../../src/effects/bomberSquadron/BomberSquadronAssets';
import { readDemandCatalog } from '../../scripts/asset-pipeline/pipeline-registry.mjs';

const catalog = await readDemandCatalog();

describe('bomber squadron asset loading', () => {
  it('loads its own selected body and ordnance, including only authored animation sheets', () => {
    const loader = { image: vi.fn(), spritesheet: vi.fn() };
    const assets = [BOMBER_DRONE_BODY_ASSET_ID, BOMBER_DRONE_BOMB_ASSET_ID].map(getPipelineAsset);
    preloadBomberSquadronAssets(loader as unknown as Phaser.Loader.LoaderPlugin);
    expect(loader.image.mock.calls).toEqual(assets.map(asset => [asset.textureKey, asset.idlePath]));
    expect(loader.spritesheet.mock.calls).toEqual(assets.filter(asset => asset.clips.length)
      .map(asset => [asset.sheetTextureKey, asset.sheetPath, asset.layout]));
    for (const asset of assets) {
      const authored = catalog.assets.find(entry => entry.id === asset.id)!;
      expect(asset.forward).toBe(authored.forward);
      expect(asset.pivot).toEqual(authored.pivot);
      for (const clip of authored.clips!) {
        const selected = asset.clips.find(entry => entry.name === clip.name)!;
        expect(selected.frames).toHaveLength(clip.frameCount);
        expect(selected.frameRate).toBe(clip.frameRate);
        expect(selected.loop).toBe(clip.loop);
      }
      expect(asset.textureKey).not.toBe(getPipelineAsset('attack-drone-body').textureKey);
    }
  });
});
