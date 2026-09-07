import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { exportVariant, inspectMaster, resizeMaster, nativeMetrics, variantLabel, validateManifest, inside } from '../../scripts/asset-pipeline/export.mjs';

const dirs: string[] = [];
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
afterEach(async () => {
  // Only directories created by this test are eligible for recursive cleanup.
  for (const folder of dirs.splice(0)) {
    if (!path.resolve(folder).startsWith(path.resolve(tmpdir()) + path.sep + 'fd-asset-export-')) throw new Error('Unsafe test cleanup');
    await rm(folder, { recursive: true, force: true });
  }
});

function manifest() {
  return {
    pipelineVersion: 1, id: 'fixture', variant: 'calm', forward: 'north', category: 'character',
    targetSize: 16, sourceSizes: [32], pivot: [.5, .5], masterSize: 64,
    camera: { type: 'ORTHO', rotation: [0, 0, 0], location: [0, 0, 8], orthoScale: 2, transparent: true },
    textures: { organic: { path: 'texture.png', sha256: '' } },
  };
}
async function sprite(left = 16) {
  const patch = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ec451d' } }).png().toBuffer();
  return sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 80, b: 255, alpha: 0 } } })
    .composite([{ input: patch, left, top: 16 }]).png().toBuffer();
}

describe('asset pipeline export invariants', () => {
  it('supports legacy variants and optional independent form and texture strengths', () => {
    expect(variantLabel(manifest())).toBe('Ruhig / illustrativ');
    const custom = { ...manifest(), variantLabel: 'Weich schattiert', collisionDiameter: 32,
      materialParameters: { textureStrength: .22, formShadowStrength: .55 } };
    expect(() => validateManifest(custom)).not.toThrow();
    expect(variantLabel(custom)).toBe('Weich schattiert');
    expect(() => validateManifest({ ...custom, materialParameters: { textureStrength: .22, formShadowStrength: 2 } })).toThrow(/material parameter/);
    expect(() => validateManifest({ ...custom, collisionDiameter: -1 })).toThrow(/collision/);
    expect(() => validateManifest({ ...custom, variantLabel: ' ' })).toThrow(/variant label/);
  });

  it('measures native occupancy at the inclusive half-alpha threshold without counting transparent color', async () => {
    const pixels = Buffer.alloc(4 * 4 * 4, 0);
    const put = (x: number, y: number, alpha: number) => pixels.set([200, 180, 140, alpha], (y * 4 + x) * 4);
    put(0, 0, 127); put(1, 1, 128); put(3, 2, 255); put(0, 3, 0);
    const png = await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
    expect(await nativeMetrics(png, 4)).toEqual({ canvasSize: 4, alphaThreshold: 128, width: 3, height: 2, area: 2, bounds: [1, 1, 3, 2] });
    const empty = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ffffff00' } }).png().toBuffer();
    expect(await nativeMetrics(empty, 4)).toMatchObject({ width: 0, height: 0, area: 0, bounds: null });
  });

  it('rejects perspective, tilted cameras, shifted pivots and escaping paths', () => {
    expect(() => validateManifest(manifest())).not.toThrow();
    const perspective = manifest(); perspective.camera.type = 'PERSP';
    expect(() => validateManifest(perspective)).toThrow(/orthographic/);
    const tilted = manifest(); tilted.camera.rotation[0] = .001;
    expect(() => validateManifest(tilted)).toThrow(/orthographic/);
    const shifted = manifest(); shifted.camera.location[0] = .03;
    expect(() => validateManifest(shifted)).toThrow(/pivot/);
    expect(() => inside('C:/workspace', '../outside')).toThrow(/escapes/);
  });

  it('keeps partial-alpha edge colors free of a transparent blue matte', async () => {
    const output = await resizeMaster(await sprite(15), 19);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([19, 19, 4]);
    let edges = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 24 && data[i + 3] < 230) {
        edges++;
        expect(data[i]).toBeGreaterThan(225);
        expect(data[i + 2]).toBeLessThan(40);
      }
    }
    expect(edges).toBeGreaterThan(0);
  });

  it('checks dimensions, transparent exterior and unclipped visible bounds', async () => {
    const input = await sprite();
    expect((await inspectMaster(input, 64)).bounds).toEqual([16, 16, 47, 47]);
    await expect(inspectMaster(input, 32)).rejects.toThrow(/square RGBA/);
    await expect(inspectMaster(await sprite(0), 64)).rejects.toThrow(/border/);
    const opaque = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer();
    await expect(inspectMaster(opaque, 64)).rejects.toThrow(/transparent and opaque/);
  });

  it('reproduces exports and refuses changed revisions or missing texture sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'fd-asset-export-')); dirs.push(root);
    const folder = path.join(root, 'calm'); await mkdir(folder);
    const texture = await sprite(), m = manifest();
    m.textures.organic.sha256 = hash(texture);
    await writeFile(path.join(root, 'texture.png'), texture);
    await writeFile(path.join(folder, 'render.json'), JSON.stringify(m));
    await writeFile(path.join(folder, 'master.png'), texture);
    await exportVariant(folder, root);
    const first = await readFile(path.join(folder, 'export.json'));
    await exportVariant(folder, root);
    expect(await readFile(path.join(folder, 'export.json'))).toEqual(first);
    await writeFile(path.join(folder, 'master.png'), await sprite(15));
    await expect(exportVariant(folder, root)).rejects.toThrow(/new revision/);
    await writeFile(path.join(root, 'texture.png'), await sprite(14));
    await expect(exportVariant(folder, root)).rejects.toThrow(/Texture changed/);
    await rm(path.join(root, 'texture.png'));
    await expect(exportVariant(folder, root)).rejects.toThrow(/ENOENT/);
  });
});
