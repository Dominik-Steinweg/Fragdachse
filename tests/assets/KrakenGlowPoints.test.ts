import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import glowIndex from '../../src/config/krakenGlowPoints.json';
import { getPipelineBossAsset } from '../../src/config/pipelineAssets';
import { decodeKrakenGlowPoints, krakenGlowPointEntry, KRAKEN_GLOW_POINT_BYTES } from '../../src/effects/kraken/KrakenGlowPoints';

// Published by scripts/asset-pipeline/kraken-glow-publish.mjs from the selected revision's Blender scenes.
describe('kraken sucker glow points', () => {
  for (const id of Object.keys(glowIndex.assets)) {
    it(`${id}: published points decode against the selected registry asset`, async () => {
      const asset = getPipelineBossAsset(id);
      // A stale entry (registry moved to another revision) would silently drop the glow at runtime.
      const entry = krakenGlowPointEntry(asset);
      expect(entry).not.toBeNull();
      const bytes = await readFile(`public/${entry!.file.replace(/^\.\//, '')}`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry!.sha256);
      // One table row per master pose: the index of clip.frames, socketFrames and shadowMesh.frames.
      const masterPoses = Math.max(...asset.clips.flatMap(c => c.frames)) + 1;
      expect(entry!.frames).toHaveLength(masterPoses);
      expect(entry!.frames).toHaveLength(asset.socketFrames!.length);
      const set = decodeKrakenGlowPoints(entry!, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), asset);
      let total = 0;
      for (let pose = 0; pose < masterPoses; pose++) {
        for (const p of set.points(pose)) {
          expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
          expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
          expect(p.z).toBeGreaterThanOrEqual(asset.elevation.min); expect(p.z).toBeLessThanOrEqual(asset.elevation.max);
          expect(p.vis).toBeGreaterThan(0); expect(p.radiusPx).toBeGreaterThan(0);
          expect(p.arm).toBeLessThan(asset.category === 'boss-part' ? 1 : 8);
          total++;
        }
      }
      expect(total * KRAKEN_GLOW_POINT_BYTES).toBe(entry!.bytes);
    });
  }
});
