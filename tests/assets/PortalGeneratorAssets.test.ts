import { expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getPipelineAsset } from '../../src/config/pipelineAssets';

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const file = (p: string) => readFile(`public/${p.replace(/^\.\//, '')}`);

it('publishes every portal generator state and outlet with congruent emissive layers', async () => {
  const m = JSON.parse(await readFile('src/assets/manifests/portal-generator.json', 'utf8'));
  const asset = getPipelineAsset('portal-generator');
  expect(asset.textureKey).toBe(m.textureKey);
  expect(asset.layout).toEqual(m.layout);
  expect(m.frames.map((f: { state: string; outlet: string }) => `${f.state}/${f.outlet}`))
    .toEqual(m.states.flatMap((s: string) => m.outlets.map((o: string) => `${s}/${o}`)));
  expect(asset.layout.frameCount).toBe(m.frames.length);
  const colour = await sharp(await file(asset.sheetPath)).raw().toBuffer({ resolveWithObject: true });
  const layers = Object.fromEntries(await Promise.all((['core', 'flow'] as const).map(async key => {
    const bytes = await file(m.emissive[key].path);
    expect(hash(bytes)).toBe(m.emissive[key].sha256);
    const raw = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    expect([raw.info.width, raw.info.height]).toEqual([colour.info.width, colour.info.height]);
    return [key, raw.data] as const;
  })));
  const { frameWidth: size, margin, spacing, columns } = asset.layout;
  const width = colour.info.width;
  for (const f of m.frames) {
    const left = margin + (f.index % columns) * (size + spacing), top = margin + Math.floor(f.index / columns) * (size + spacing);
    const lit = { core: 0, flow: 0 };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = ((top + y) * width + left + x) * 4;
      for (const key of ['core', 'flow'] as const) {
        // White carrier: the runtime tints; emission never lies outside the opaque structure.
        if (layers[key][i + 3] > 24) { lit[key]++; expect(colour.data[i + 3], `${f.state}/${f.outlet} ${key}`).toBeGreaterThan(0); }
      }
    }
    expect(lit.core, `${f.state}/${f.outlet}`).toBeGreaterThan(0);
    // A collapsed generator has no live outlet feed.
    if (f.state === 'rubble') expect(lit.flow, f.outlet).toBe(0);
    else expect(lit.flow, `${f.state}/${f.outlet}`).toBeGreaterThan(0);
    for (const p of Object.values(f.sockets) as { x: number; y: number }[]) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
    }
  }
}, 30000);
