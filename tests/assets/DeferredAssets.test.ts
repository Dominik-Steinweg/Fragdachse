import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFERRED_ASSETS } from '../../src/assets/DeferredAssets';

describe('deferred asset manifest', () => {
  it('references unique shipped files, with explicit failure policy and valid audio containers', () => {
    expect(new Set(DEFERRED_ASSETS.map(asset => asset.key)).size).toBe(DEFERRED_ASSETS.length);
    for (const asset of DEFERRED_ASSETS) {
      const path = resolve(__dirname, '../../public', asset.url);
      expect(statSync(path).size).toBeGreaterThan(0);
      expect(typeof asset.optional).toBe('boolean');
      if (asset.type === 'audio' && asset.url.endsWith('.ogg')) {
        expect(readFileSync(path).subarray(0, 4).toString()).toBe('OggS');
      }
    }
  });
});
