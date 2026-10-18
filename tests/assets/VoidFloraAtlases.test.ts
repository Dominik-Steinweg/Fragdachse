import { expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const root = 'public/assets/environment/woodland/ecology/';

it.each(['void-lilies', 'void-rock-colonies'])('publishes every approved %s frame with a congruent emissive mask', async name => {
  const m = JSON.parse(await readFile(`src/assets/manifests/${name}.json`, 'utf8'));
  const selection = JSON.parse(await readFile(`${m.source}/selection.json`, 'utf8'));
  const approved = Object.entries(selection).filter(([, e]) => (e as { accepted: boolean }).accepted).map(([n]) => n).sort();
  expect(m.assets.map((a: { name: string }) => a.name).sort()).toEqual(approved);
  const colour = await readFile(root + m.atlas.file), emissive = await readFile(root + m.emissiveAtlas.file);
  expect(hash(colour)).toBe(m.atlas.sha256);
  expect(hash(emissive)).toBe(m.emissiveAtlas.sha256);
  expect(m.emissiveAtlas.frames).toEqual(m.atlas.frames);
  for (const a of m.assets) {
    // The void prefix keeps every natural family filter (`startsWith('lily-pad')` …) untouched.
    expect(a.name.startsWith('void-')).toBe(true);
    expect(hash(await readFile(`${m.source}/${a.source}`))).toBe(a.sourceSha256);
    expect(hash(await readFile(`${m.source}/${a.emissiveSource}`))).toBe(a.emissiveSourceSha256);
    const f = m.atlas.frames[a.name].frame;
    const tile = await sharp(colour).extract({ left: f.x, top: f.y, width: f.w, height: f.h }).raw().toBuffer();
    const glow = await sharp(emissive).extract({ left: f.x, top: f.y, width: f.w, height: f.h }).raw().toBuffer();
    expect(hash(tile)).toBe(a.pixelSha256);
    let emitting = 0;
    for (let i = 0; i < f.w * f.h; i++) {
      const x = i % f.w, y = Math.floor(i / f.w);
      if (x < 4 || y < 4 || x >= f.w - 4 || y >= f.h - 4) { expect(tile[i * 4 + 3]).toBe(0); expect(glow[i * 4 + 3]).toBe(0); }
      // Emission lives inside the plant: never where the colour is transparent.
      if (glow[i * 4 + 3] > 24) { emitting++; expect(tile[i * 4 + 3], `${a.name} @${x},${y}`).toBeGreaterThan(0); }
    }
    expect(emitting, a.name).toBeGreaterThan(0);
  }
}, 30000); // Decodes two atlases per family.
