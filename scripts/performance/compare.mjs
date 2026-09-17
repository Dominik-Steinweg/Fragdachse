import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compareResults } from './metrics.mjs';

const args = process.argv.slice(2);
if (args.length !== 2) throw new Error('Usage: npm run perf:compare -- <run-A> <run-B>');
const load = async directory => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.status !== 'complete') throw new Error(`Run is not complete: ${directory}`);
  return { manifest, summary: JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8')) };
};
const [a, b] = await Promise.all(args.map(p => load(resolve(p))));
const result = compareResults(a, b);
const directory = resolve('build/performance-results', `comparison-${Date.now()}`);
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'comparison.json'), JSON.stringify(result, null, 2));
const lines = ['# Performance-Vergleich\n', `${a.manifest.runId} → ${b.manifest.runId}\n`, result.interpretation,
  '\n## Bedingungen\n', ...result.warnings.map(w => `- ${w}`), '\n## Fälle\n'];
for (const c of result.cases) {
  lines.push(`### ${c.id}\n`, `Status: ${c.status}. Last verändert: ${c.loadChanged ?? 'nicht vergleichbar'}.\n`);
  if (c.durationA !== undefined && c.durationB !== undefined) {
    lines.push(`Aktives Fenster: ${(c.durationA / 1000).toFixed(3)} s → ${(c.durationB / 1000).toFixed(3)} s.\n`);
  }
  lines.push('| Messgröße | A ms | B ms | Differenz ms | Differenz % |', '|---|---:|---:|---:|---:|');
  for (const [group, metrics] of Object.entries(c.differences ?? {})) for (const [key, d] of Object.entries(metrics)) {
    if (d) lines.push(`| ${group}.${key} | ${d.before.toFixed(3)} | ${d.after.toFixed(3)} | ${d.absolute.toFixed(3)} | ${d.percent?.toFixed(2) ?? 'n/a'} |`);
  }
  if (c.loadChanged) lines.push('\nLast A/B:\n', '```json', JSON.stringify({ a: c.loadA, b: c.loadB }, null, 2), '```');
}
await writeFile(join(directory, 'comparison.md'), lines.join('\n'));
console.log(join(directory, 'comparison.md'));
