import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeAssetUrls } from '../scripts/lib/runtime-asset-urls.mjs';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });

/** public/assets/sounds/{flame,copy}.ogg with `copy` published as an alias of identical `flame`. */
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'runtime-urls-'));
  const publicRoot = join(root, 'public').replaceAll('\\', '/'), sounds = `${publicRoot}/assets/sounds`;
  mkdirSync(sounds, { recursive: true });
  const placeholder = Buffer.from('flame placeholder bytes');
  writeFileSync(`${sounds}/flame.ogg`, placeholder);
  writeFileSync(`${sounds}/copy.ogg`, placeholder);
  const manifest = join(root, 'runtime-colours.json');
  writeFileSync(manifest, JSON.stringify({ assets: { 'assets/sounds/copy.ogg': {
    file: 'assets/sounds/flame.ogg', source: 'assets/sounds/copy.ogg', category: 'alias', sourceBytes: placeholder.length,
    downloadBytes: placeholder.length, sourceSha256: sha(placeholder), sha256: sha(placeholder) } } }));
  return { publicRoot, sounds, manifest, placeholder };
}

describe('runtime asset urls', () => {
  it('serves an alias from its published target while the bytes still match', () => {
    const { publicRoot, manifest, placeholder } = fixture();
    const stale: string[] = [];
    const urls = runtimeAssetUrls({ manifest, publicRoot, onStale: keys => stale.push(...keys) });
    expect(urls['assets/sounds/copy.ogg']).toBe(`assets/sounds/flame.ogg?v=${sha(placeholder)}`);
    expect(stale).toEqual([]);
  });

  it('bypasses an entry whose file was re-published until the manifest is refreshed', () => {
    const { publicRoot, sounds, manifest } = fixture();
    // An audio-studio publication replaces the placeholder copy with its own sound of the same size.
    const published = Buffer.from('demon badger heat step!');
    writeFileSync(`${sounds}/copy.ogg`, published);
    const stale: string[] = [];
    const urls = runtimeAssetUrls({ manifest, publicRoot, onStale: keys => stale.push(...keys) });
    expect(urls['assets/sounds/copy.ogg']).toBe(`assets/sounds/copy.ogg?v=${sha(published)}`);
    expect(stale).toEqual(['assets/sounds/copy.ogg']);
  });

  it('bypasses an alias whose target file changed under it', () => {
    const { publicRoot, sounds, manifest, placeholder } = fixture();
    writeFileSync(`${sounds}/flame.ogg`, Buffer.from('a new flame recording!!'));
    const urls = runtimeAssetUrls({ manifest, publicRoot });
    expect(urls['assets/sounds/copy.ogg']).toBe(`assets/sounds/copy.ogg?v=${sha(placeholder)}`);
  });
});
