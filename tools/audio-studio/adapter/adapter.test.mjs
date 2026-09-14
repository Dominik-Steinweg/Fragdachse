import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { publishAudio, recoverAudio, scanRepository } from './index.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fragdachse-audio-adapter-'));
  await mkdir(path.join(root, 'src', 'audio'), { recursive: true });
  await mkdir(path.join(root, 'public', 'assets', 'sounds'), { recursive: true });
  const catalog = `const SHIPPED_AUDIO_FILES = new Set(['existing.ogg']);
const SFX_ASSETS = {
  sfx_one: './assets/sounds/one.ogg',
  sfx_pending: './assets/sounds/pending.ogg',
};
const MUSIC_ASSETS = { music_arena: './assets/sounds/music.ogg' };
const AUDIO_ASSETS = { ...SFX_ASSETS, ...MUSIC_ASSETS } as const;
const SOUND_VOLUMES = { sfx_one: 0.5, sfx_pending: 0.2, music_arena: 0.8 };
export { AUDIO_ASSETS, SOUND_VOLUMES };
`;
  await writeFile(path.join(root, 'src', 'audio', 'AudioCatalog.ts'), catalog);
  await writeFile(path.join(root, 'src', 'usage.ts'), "audio.playSound('sfx_one'); audio.startLoop('sfx_pending');\n");
  await writeFile(path.join(root, 'public', 'assets', 'sounds', 'one.ogg'), Buffer.from('OggS-original'));
  return root;
}

async function withFixture(callback) {
  const root = await fixture();
  try { return await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('scan is AST-only, excludes music, and reports planned missing SFX', async () => {
  await withFixture(async (root) => {
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'unrelated.ts'), "audio.startLoop('sfx_one');");
    const result = await scanRepository({ root });
    assert.deepEqual(Object.keys(result.entries), ['sfx_one', 'sfx_pending']);
    assert.equal(result.entries.sfx_pending.exists, false);
    assert.equal(result.entries.sfx_pending.shipped, false);
    assert.equal(result.entries.sfx_pending.playback, 'loop');
    assert.deepEqual(result.entries.sfx_one.shared_keys, ['sfx_one']);
    assert.equal(result.entries.sfx_one.playback, 'oneshot');
  });
});

test('whitelist insertion supports empty sets and preserves trailing comments', async () => {
  for (const whitelist of ['[]', "['existing.ogg' /* preserve comment */]"]) {
    await withFixture(async root => {
      const catalogPath = path.join(root, 'src', 'audio', 'AudioCatalog.ts');
      const initial = (await readFile(catalogPath, 'utf8')).replace("['existing.ogg']", whitelist);
      await writeFile(catalogPath, initial);
      const workspace = path.join(root, '.audio-workspace');
      await mkdir(workspace);
      const source = path.join(workspace, 'candidate.ogg');
      const bytes = Buffer.from('OggS-candidate');
      await writeFile(source, bytes);
      const crypto = await import('node:crypto');
      const before = await scanRepository({ root });
      await publishAudio({ root, workspace, key:'sfx_pending', source_path:source,
        expected_catalog_hash:before.catalog_hash, expected_file_hash:null,
        expected_source_hash:crypto.createHash('sha256').update(bytes).digest('hex'), approval_id:'reviewed' });
      const after = await readFile(catalogPath, 'utf8');
      assert.equal((await scanRepository({root})).entries.sfx_pending.shipped, true);
      assert.equal(after.slice(after.indexOf('const SFX_ASSETS')), initial.slice(initial.indexOf('const SFX_ASSETS')));
      if (whitelist.includes('comment')) assert.match(after, /preserve comment/);
    });
  }
});

test('publish rejects a stale source fingerprint before mutation', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, '.audio-workspace');
    await mkdir(workspace, { recursive: true });
    const source = path.join(workspace, 'candidate.ogg');
    await writeFile(source, Buffer.from('OggS-candidate'));
    const before = await scanRepository({ root });
    const result = await publishAudio({
      root,
      workspace,
      key: 'sfx_pending',
      source_path: source,
      expected_catalog_hash: before.catalog_hash,
      expected_file_hash: null,
      expected_source_hash: '0'.repeat(64),
      approval_id: 'human-review-1',
    }).catch((error) => error);
    assert.equal(result.code, 'stale_source');
  });
});

test('publish accepts an OGG inside workspace and rejects an outside source', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, '.audio-workspace');
    await mkdir(workspace, { recursive: true });
    const source = path.join(workspace, 'candidate.ogg');
    await writeFile(source, Buffer.from('OggS-candidate'));
    const before = await scanRepository({ root });
    const catalogPath = path.join(root, 'src', 'audio', 'AudioCatalog.ts');
    const catalogBefore = await readFile(catalogPath, 'utf8');
    const sourceHash = '2a7e1b4483e2f92eae5ed3e67f573d000777ecf58c2ba1d58ea1bd4e4f29d74a';
    // Derive the fixture hash through the same public contract rather than hard-coding it.
    const crypto = await import('node:crypto');
    const actualSourceHash = crypto.createHash('sha256').update(await readFile(source)).digest('hex');
    assert.notEqual(actualSourceHash, sourceHash);
    const published = await publishAudio({
      root,
      workspace,
      key: 'sfx_pending',
      source_path: source,
      expected_catalog_hash: before.catalog_hash,
      expected_file_hash: null,
      expected_source_hash: actualSourceHash,
      approval_id: 'human-review-2',
    });
    assert.equal(published.result.published, true);
    assert.deepEqual(published.result.whitelist_added, ['pending.ogg']);
    const catalogAfter = await readFile(catalogPath, 'utf8');
    assert.equal(catalogAfter.slice(catalogAfter.indexOf('const SFX_ASSETS')), catalogBefore.slice(catalogBefore.indexOf('const SFX_ASSETS')));
    assert.equal((await scanRepository({root})).entries.sfx_pending.shipped, true);
    assert.equal((await scanRepository({ root })).catalog_hash, published.result.catalog_hash);
    const outside = path.join(root, 'outside.ogg');
    await writeFile(outside, Buffer.from('OggS-outside'));
    const fresh = await scanRepository({ root });
    await assert.rejects(() => publishAudio({
      root,
      workspace,
      key: 'sfx_pending',
      source_path: outside,
      expected_catalog_hash: fresh.catalog_hash,
      expected_file_hash: fresh.entries.sfx_pending.file_hash,
      expected_source_hash: actualSourceHash,
      approval_id: 'human-review-3',
    }), (error) => error.code === 'unsafe_path');
  });
});

test('publish rejects a source with a non-OGG container header', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, '.audio-workspace');
    await mkdir(workspace, { recursive: true });
    const source = path.join(workspace, 'candidate.ogg');
    await writeFile(source, Buffer.from('RIFF-not-ogg'));
    const before = await scanRepository({ root });
    const crypto = await import('node:crypto');
    const sourceHash = crypto.createHash('sha256').update(await readFile(source)).digest('hex');
    await assert.rejects(() => publishAudio({
      root, workspace, key: 'sfx_pending', source_path: source,
      expected_catalog_hash: before.catalog_hash, expected_file_hash: null,
      expected_source_hash: sourceHash, approval_id: 'human-review-invalid-header',
    }), (error) => error.code === 'invalid_source');
  });
});

test('publish supports an explicitly configured workspace outside the game repository', async () => {
  await withFixture(async (root) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'fragdachse-audio-workspace-'));
    try {
      const source = path.join(workspace, 'candidate.ogg');
      await writeFile(source, Buffer.from('OggS-external-workspace'));
      const before = await scanRepository({ root });
      const crypto = await import('node:crypto');
      const sourceHash = crypto.createHash('sha256').update(await readFile(source)).digest('hex');
      const published = await publishAudio({
        root, workspace, key: 'sfx_pending', source_path: source,
        expected_catalog_hash: before.catalog_hash, expected_file_hash: null,
        expected_source_hash: sourceHash, approval_id: 'human-review-external-workspace',
      });
      assert.equal(published.result.published, true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

test('workspace validation rejects reserved game and tool directories before creating children', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, 'public', 'audio-workspace');
    const before = await scanRepository({ root });
    await assert.rejects(() => publishAudio({
      root, workspace, key: 'sfx_pending', source_path: path.join(workspace, 'candidate.ogg'),
      expected_catalog_hash: before.catalog_hash, expected_file_hash: null,
      expected_source_hash: '0'.repeat(64), approval_id: 'human-review-reserved-workspace',
    }), (error) => error.code === 'unsafe_workspace');
    assert.equal(await readFile(workspace).then(() => true, () => false), false);
  });
});

test('stale target and crash recovery refuse foreign bytes and restore known bytes', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, '.audio-workspace');
    await mkdir(workspace, { recursive: true });
    const source = path.join(workspace, 'candidate.ogg');
    await writeFile(source, Buffer.from('OggS-candidate'));
    const crypto = await import('node:crypto');
    const sourceHash = crypto.createHash('sha256').update(await readFile(source)).digest('hex');
    const before = await scanRepository({ root });
    await writeFile(path.join(root, 'public', 'assets', 'sounds', 'one.ogg'), Buffer.from('OggS-foreign'));
    await assert.rejects(() => publishAudio({
      root,
      workspace,
      key: 'sfx_one',
      source_path: source,
      expected_catalog_hash: before.catalog_hash,
      expected_file_hash: before.entries.sfx_one.file_hash,
      expected_source_hash: sourceHash,
      approval_id: 'human-review-4',
    }), (error) => error.code === 'stale_state');
    const fresh = await scanRepository({ root });
    const published = await publishAudio({
      root,
      workspace,
      key: 'sfx_one',
      source_path: source,
      expected_catalog_hash: fresh.catalog_hash,
      expected_file_hash: fresh.entries.sfx_one.file_hash,
      expected_source_hash: sourceHash,
      approval_id: 'human-review-5',
    });
    const manifestPath = path.join(workspace, 'exports', `${published.transaction.id}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.status = 'target_written';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const recovered = await recoverAudio({ root, workspace, transaction_id: published.transaction.id });
    assert.equal(recovered.result.recovered, true);
    assert.equal((await readFile(path.join(root, 'public', 'assets', 'sounds', 'one.ogg'))).toString(), 'OggS-foreign');
  });
});

test('AST parsing rejects duplicate catalog keys instead of silently overwriting them', async () => {
  await withFixture(async (root) => {
    const catalogPath = path.join(root, 'src', 'audio', 'AudioCatalog.ts');
    const source = await readFile(catalogPath, 'utf8');
    await writeFile(catalogPath, source.replace("  sfx_pending: './assets/sounds/pending.ogg',", "  sfx_pending: './assets/sounds/pending.ogg',\n  sfx_one: './assets/sounds/other.ogg',"));
    await assert.rejects(() => scanRepository({ root }), (error) => error.code === 'unsupported_catalog_syntax');
  });
});

test('AST parsing rejects executable or computed catalog values', async () => {
  await withFixture(async (root) => {
    const catalogPath = path.join(root, 'src', 'audio', 'AudioCatalog.ts');
    const source = await readFile(catalogPath, 'utf8');
    await writeFile(catalogPath, source.replace("'./assets/sounds/one.ogg'", 'resolveTarget()'));
    await assert.rejects(() => scanRepository({ root }), (error) => error.code === 'unsupported_catalog_syntax');
  });
});

test('a pending transaction blocks a second publish until it is recovered', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, '.audio-workspace');
    await mkdir(path.join(workspace, 'exports'), { recursive: true });
    await mkdir(path.join(workspace, 'backups'), { recursive: true });
    await writeFile(path.join(workspace, 'exports', 'pending.json'), JSON.stringify({ id: 'pending', status: 'target_written' }));
    const scan = await scanRepository({ root });
    await assert.rejects(() => publishAudio({
      root, workspace, key: 'sfx_one', source_path: path.join(workspace, 'missing.ogg'),
      expected_catalog_hash: scan.catalog_hash, expected_file_hash: scan.entries.sfx_one.file_hash,
      expected_source_hash: '0'.repeat(64), approval_id: 'human-review-pending',
    }), (error) => error.code === 'pending_transaction');
  });
});

test('recovery handles a crash before catalog mutation and preserves foreign catalog changes', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, '.audio-workspace');
    await mkdir(workspace, { recursive: true });
    const source = path.join(workspace, 'candidate.ogg');
    await writeFile(source, Buffer.from('OggS-candidate'));
    const crypto = await import('node:crypto');
    const sourceHash = crypto.createHash('sha256').update(await readFile(source)).digest('hex');
    const before = await scanRepository({ root });
    const published = await publishAudio({
      root, workspace, key: 'sfx_pending', source_path: source,
      expected_catalog_hash: before.catalog_hash, expected_file_hash: null,
      expected_source_hash: sourceHash, approval_id: 'human-review-recovery',
    });
    const manifestPath = path.join(workspace, 'exports', `${published.transaction.id}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const catalogPath = path.join(root, 'src', 'audio', 'AudioCatalog.ts');
    const catalogBackup = await readFile(path.join(workspace, 'backups', `${manifest.id}.catalog.ts`));
    manifest.status = 'target_written';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(catalogPath, catalogBackup);
    const recovered = await recoverAudio({ root, workspace, transaction_id: manifest.id });
    assert.equal(recovered.result.recovered, true);
    await assert.rejects(() => readFile(path.join(root, 'public', 'assets', 'sounds', 'pending.ogg')));

    const secondSource = path.join(workspace, 'candidate-2.ogg');
    await writeFile(secondSource, Buffer.from('OggS-candidate-2'));
    const secondBefore = await scanRepository({ root });
    const secondHash = crypto.createHash('sha256').update(await readFile(secondSource)).digest('hex');
    const second = await publishAudio({
      root, workspace, key: 'sfx_pending', source_path: secondSource,
      expected_catalog_hash: secondBefore.catalog_hash, expected_file_hash: null,
      expected_source_hash: secondHash, approval_id: 'human-review-foreign-catalog',
    });
    const secondManifestPath = path.join(workspace, 'exports', `${second.transaction.id}.json`);
    const secondManifest = JSON.parse(await readFile(secondManifestPath, 'utf8'));
    secondManifest.status = 'target_written';
    await writeFile(secondManifestPath, `${JSON.stringify(secondManifest, null, 2)}\n`);
    const foreignCatalog = Buffer.from(`${(await readFile(catalogPath)).toString('utf8')}\n// editor change\n`);
    await writeFile(catalogPath, foreignCatalog);
    await assert.rejects(() => recoverAudio({ root, workspace, transaction_id: secondManifest.id }), (error) => error.code === 'rollback_conflict');
    assert.deepEqual(await readFile(catalogPath), foreignCatalog);
    assert.equal((await readFile(path.join(root, 'public', 'assets', 'sounds', 'pending.ogg'))).toString(), 'OggS-candidate-2');
  });
});

test('recovery rejects a forged transaction target outside the approved SFX directory', async () => {
  await withFixture(async (root) => {
    const workspace = path.join(root, '.audio-workspace');
    await mkdir(path.join(workspace, 'exports'), { recursive: true });
    await mkdir(path.join(workspace, 'backups'), { recursive: true });
    const id = 'forged';
    await writeFile(path.join(workspace, 'exports', `${id}.json`), JSON.stringify({
      schema_version: 1, id, status: 'target_written', key: 'sfx_one',
      target_path: 'src/evil.ogg', catalog_path: 'src/audio/AudioCatalog.ts',
      before_target_hash: null, after_target_hash: '0'.repeat(64),
      before_catalog_hash: '0'.repeat(64), after_catalog_hash: '1'.repeat(64),
    }));
    await writeFile(path.join(workspace, 'backups', `${id}.target`), Buffer.alloc(0));
    await writeFile(path.join(workspace, 'backups', `${id}.catalog.ts`), Buffer.from('forged'));
    await assert.rejects(() => recoverAudio({ root, workspace, transaction_id: id }), (error) => error.code === 'rollback_conflict');
    assert.equal(await readFile(path.join(root, 'src', 'evil.ogg')).then(() => true, () => false), false);
  });
});
