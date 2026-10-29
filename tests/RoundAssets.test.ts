import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// Bridge texture baking draws through Phaser; this contract only reads the preload paths.
vi.mock('../src/effects/EffectUtils', () => ({ ensureCanvasTexture: () => undefined }));
import { DEFERRED_ASSETS } from '../src/assets/DeferredAssets';
import { LOBBY_ENEMY_TEXTURE_KEYS, roundDeferredAssets } from '../src/assets/RoundAssets';
import { getWalkingSheetForStaticTexture } from '../src/animations/BadgerAnimations';

describe('round content in the second loading phase', () => {
  it('moves only round content behind the lobby, as required shipped files', () => {
    const round = roundDeferredAssets();
    expect(round.length).toBeGreaterThan(100);
    expect(new Set(round.map(asset => asset.key)).size).toBe(round.length);
    for (const asset of round) {
      expect(asset.optional).toBe(false);
      expect(statSync(resolve(__dirname, '../public', asset.url.split('?')[0])).size).toBeGreaterThan(0);
      if (asset.type === 'spritesheet') expect(asset.frameConfig?.frameWidth).toBeGreaterThan(0);
    }
    const keys = new Set(round.map(asset => asset.key));
    // The player figure and the shooting range's target stay in the boot preload.
    for (const lobby of ['badger', ...LOBBY_ENEMY_TEXTURE_KEYS]) {
      expect(keys.has(lobby)).toBe(false);
      expect(keys.has(getWalkingSheetForStaticTexture(lobby)!.textureKey)).toBe(false);
    }
    expect(DEFERRED_ASSETS.some(asset => keys.has(asset.key))).toBe(false);
  });
});
