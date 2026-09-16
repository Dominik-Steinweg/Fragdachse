import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const audioHash = path => path.endsWith('.ts')
  ? createHash('sha256').update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n')).digest('hex') : sha256(path);
const sourceHash = root => {
  const hash = createHash('sha256');
  const visit = folder => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else { hash.update(path.replaceAll('\\', '/')); hash.update(readFileSync(join(root, path))); }
    }
  };
  visit('src'); return hash.digest('hex');
};
const frozen = 'build/navigation-baseline-source';
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const audio = tracked.filter(path => /\.(wav|mp3|ogg|flac)$/i.test(path) || /^src\/.*(?:audio|sound)/i.test(path))
  .map(path => ({ path, candidate: audioHash(path), baseline: audioHash(join(frozen, path)) }));
const variants = Object.fromEntries(['baseline', 'candidate'].map(variant => {
  const directory = `build/navigation-${variant}`;
  return [variant, { sourceHash: sourceHash(variant === 'baseline' ? frozen : '.'),
    files: ['navigation-lab.html', ...readdirSync(join(directory, 'assets')).filter(name => name.endsWith('.js')).map(name => `assets/${name}`)]
      .map(path => ({ path, sha256: sha256(join(directory, path)) })) }];
}));
const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(),
  baselineRevision: '2ebed407226a290858a071bc54c1a431957aba5a', workingTreeAtStart: 'clean',
  archives: ['build/navigation-original-source.zip', 'build/navigation-baseline-source.zip',
    'build/navigation-candidate-source.zip'].filter(existsSync)
    .map(path => ({ path, sha256: sha256(path) })), variants,
  audioHashNormalization: 'Audio assets: exact bytes. TypeScript audio sources: CRLF normalized to LF.',
  audioIdentical: audio.every(file => file.candidate === file.baseline), audio };
writeFileSync('build/navigation-results/manifest.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ audioIdentical: manifest.audioIdentical, audioFiles: audio.length, variants: Object.keys(variants) }));
if (!manifest.audioIdentical) process.exitCode = 1;
