import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdir, readFile, writeFile, readdir, stat, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { groups, viewport, tolerance } from './scenes.mjs';
import { compareImages } from './compare.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2), update = args.includes('--update');
const value = name => args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
for (const arg of args) if (!['--update', '--help', '--list'].includes(arg) && !/^--(runs|group)=/.test(arg)) throw Error(`Unknown flag: ${arg}`);
if (args.includes('--help')) {
  console.log('npm run test:visual -- [--update] [--runs=3] [--group=day]\nCHROME_PATH overrides the installed Chrome executable. References: tests/visual/reference; results: build/visual-tests.');
  process.exit(0);
}
if (args.includes('--list')) { for (const group of groups) console.log(`${group.id}: ${group.shots.map(s => s.id).join(', ')}`); process.exit(0); }
const runs = Number(value('--runs') ?? 1);
if (!Number.isInteger(runs) || runs < 1 || runs > 10 || (update && runs !== 1)) throw Error('runs: 1..10; --update requires one run');
const selected = value('--group') ? groups.filter(g => g.id === value('--group')) : groups;
if (!selected.length) throw Error('Unknown group (see --list)');
const reference = join(root, 'tests/visual/reference');
const output = join(root, 'build/visual-tests', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
await mkdir(reference, { recursive: true });
// Keep Chrome's disposable profile and downloads on the worktree drive, too.
const browserTemp = join(root, 'build/visual-browser-temp');
await mkdir(browserTemp, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = browserTemp;
const recipeHash = createHash('sha256').update(JSON.stringify({ groups, viewport, tolerance })).digest('hex');
const report = { update, recipeHash, viewport, tolerance, browser: null, results: [], errors: [] };
let server, browser, stopped = false;
const close = async () => { if (stopped) return; stopped = true; await browser?.close(); await server?.close(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().finally(() => process.exit(130)); });
const writeJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const staged = [];
const manifest = update ? null : await readFile(join(reference, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
try {
  server = await createServer({ root, configLoader: 'runner', cacheDir: join(root, 'build/visual-vite'),
    define: { __BUILD_TIMESTAMP__: JSON.stringify('2023-11-14T22:13:20Z') },
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, hmr: false, watch: null } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  if ((await fetch(origin + '/dev-scenario.html')).status !== 200) throw Error('Dev server did not return HTTP 200');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'] });
  report.browser = browser.version();
  for (let run = 1; run <= runs; run++) for (const group of selected) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(180000);
    const errors = [];
    // evaluate() has no Playwright timeout; closing this owned context also cancels a stuck page.
    const watchdog = setTimeout(() => { errors.push('Group exceeded 240 seconds'); void context.close(); }, 240000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('crash', () => errors.push('Browser page crashed'));
    page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
    const command = async c => {
      const result = await page.evaluate(command => window.devScenario.run(command), c);
      if (!result.ok) throw Error(`${JSON.stringify(c)}: ${result.error}`);
      if (c.action === 'step' || c.action === 'settle') await page.waitForFunction(() => window.devScenario.status().pendingSteps === 0);
    };
    const settle = async () => {
      // Workers finish on wall time; publish their results at zero simulation delta.
      const started = performance.now();
      for (;;) {
        await command({ action: 'settle', frames: 12 });
        const state = await page.evaluate(() => window.devScenario.status());
        if (state.loading.work?.renderReady && state.loading.work.pending === 0) return;
        if (performance.now() - started > 60000) throw Error('Render work did not settle');
      }
    };
    try {
      console.log(`[${run}/${runs}] ${group.id}: loading`);
      const hash = group.scenario ? '#scenario=' + encodeURIComponent(JSON.stringify(group.scenario)) : '';
      await page.goto(`${origin}/dev-scenario.html?visual-test=1${hash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(lobby => {
        const s = window.devScenario?.status();
        if (s?.state === 'error') throw Error(String(s.message));
        return s?.paused && (lobby ? s.lobbyReady : s.ready);
      }, !group.scenario);
      console.log(`  ${group.id}: ready`);
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ content: '#dev-scenario-panel{display:none!important} *,*::before,*::after{caret-color:transparent!important}' });
      for (const c of group.setup) await command(c);
      await command({ action: 'step', frames: 120 });
      await settle();
      for (const shot of group.shots) {
        console.log(`  capture ${shot.id}`);
        for (const c of shot.commands) await command(c);
        await settle();
        const status = await page.evaluate(() => window.devScenario.status());
        if (errors.length) throw Error(errors.join('\n'));
        if (!status.visualTest || !status.paused || status.pendingSteps !== 0) throw Error('Capture requires a paused deterministic frame');
        const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
        const name = `${run}-${shot.id}`, path = join(output, name);
        await writeJson(path + '.json', status);
        await sharp(actual).webp({ lossless: true, effort: 4 }).toFile(path + '.webp');
        const result = { run, id: shot.id, group: group.id, simulationMs: status.simulationMs, passed: true };
        if (update) staged.push({ id: shot.id, path: path + '.webp' });
        else {
          try {
            const expected = await readFile(join(reference, shot.id + '.webp'));
            const comparison = await compareImages(expected, actual, { ...tolerance, masks: shot.masks });
            const { diff, width, height, ...metrics } = comparison;
            Object.assign(result, metrics);
            if (manifest?.scenes?.[shot.id]?.recipeHash !== recipeHash) {
              Object.assign(result, { passed: false, error: 'Missing or stale reference manifest; review and run --update' });
            }
            if (!comparison.passed) {
              await sharp(diff, { raw: { width, height, channels: 4 } }).png().toFile(path + '-diff.png');
              await writeFile(path + '-expected.webp', expected);
            }
          } catch (error) { Object.assign(result, { passed: false, error: String(error) }); }
        }
        report.results.push(result);
        console.log(`  ${result.passed ? update ? 'STAGED' : 'PASS' : 'FAIL'} ${shot.id}${result.ratio === undefined ? '' : `: ${(result.ratio * 100).toFixed(4)}%`}`);
      }
    } catch (error) {
      report.errors.push({ run, group: group.id, error: String(error), pageErrors: errors });
      console.error(`  ERROR ${group.id}: ${error}`);
      await page.screenshot({ path: join(output, `${run}-${group.id}-error.png`) }).catch(() => {});
      await writeJson(join(output, `${run}-${group.id}-error.json`), await page.evaluate(() => window.devScenario?.status()).catch(() => null));
    } finally { clearTimeout(watchdog); await context.close(); }
  }
  if (update && !report.errors.length) {
    // Validate the entire candidate set before replacing any reviewed reference.
    const replacements = new Map(staged.map(s => [s.id + '.webp', s.path]));
    let bytes = 0;
    for (const name of new Set([...(await readdir(reference)).filter(n => n.endsWith('.webp')), ...replacements.keys()])) {
      bytes += (await stat(replacements.get(name) ?? join(reference, name))).size;
    }
    if (bytes > 30 * 1024 * 1024) throw Error('Reference budget exceeds 30 MiB');
    for (const s of staged) {
      await writeFile(join(reference, s.id + '.webp.tmp'), await readFile(s.path));
      await rename(join(reference, s.id + '.webp.tmp'), join(reference, s.id + '.webp'));
    }
    const previous = await readFile(join(reference, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => ({ scenes: {} }));
    for (const s of staged) previous.scenes[s.id] = { recipeHash, browser: report.browser, viewport, sha256: createHash('sha256').update(await readFile(s.path)).digest('hex') };
    await writeJson(join(reference, 'manifest.json'), previous);
    report.referenceBytes = bytes;
  }
} catch (error) { report.errors.push({ error: String(error) }); console.error(error); }
finally {
  await close();
  await writeJson(join(output, 'report.json'), report);
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  await writeFile(join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Visual regression</title>
<style>body{background:#15191d;color:#eee;font:16px system-ui;margin:24px}img{max-width:32%;vertical-align:top}section{margin:24px 0}a{color:#acf}</style>
<h1>Visual regression · ${update ? 'Reference update' : 'Comparison'}</h1><p>Chrome ${escape(report.browser)} · <a href="report.json">JSON report</a></p>
${report.errors.map(e => `<pre>${escape(JSON.stringify(e, null, 2))}</pre>`).join('')}
${report.results.map(r => `<section><h2>${r.passed ? 'PASS' : 'FAIL'} · ${escape(r.id)} · run ${r.run}</h2>
<p>${r.ratio === undefined ? '' : (r.ratio * 100).toFixed(4) + '% changed'} ${escape(r.error ?? '')}</p>
${!r.passed && r.ratio > tolerance.maxRatio ? `<img src="${r.run}-${r.id}-expected.webp" alt="Reference">` : ''}
<img src="${r.run}-${r.id}.webp" alt="Actual">
${!r.passed && r.ratio > tolerance.maxRatio ? `<img src="${r.run}-${r.id}-diff.png" alt="Difference">` : ''}</section>`).join('')}`);
}
const failed = report.errors.length + report.results.filter(r => !r.passed).length;
console.log(`${report.results.length} captures, ${failed} failures. ${output}`);
process.exitCode = failed ? 1 : 0;
