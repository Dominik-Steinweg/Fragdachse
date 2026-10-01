import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join, relative, extname, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, platform, release, totalmem, freemem } from 'node:os';
import { summarizeWindows } from './metrics.mjs';
import { analyzeTrace, traceEvents, createSourceResolver, archiveDependencySources } from './trace.mjs';
import { writeReports } from './reports.mjs';
import { acquireOwned, preserveFailedChromeTrace, transferChromeTrace, readBrowserJson } from './lifecycle.mjs';
import { createBuildStorage, checkDiskSpace, MINIMUM_FREE_BYTES, DISK_HEADROOM_BYTES } from './storage.mjs';

import { parsePerformanceOptions } from './options.mjs';
import { LOAD_VIEWPORT, runLoadMeasurements } from './load.mjs';

const request = { schemaVersion: 1, runId: `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`, ...parsePerformanceOptions(process.argv.slice(2)) };
const root = resolve('.');
const directory = resolve('build/performance-results', request.runId);
await mkdir(directory, { recursive: true });
const manifest = { schemaVersion: 1, runId: request.runId, status: 'preparing', ...request,
  hardware: { cpu: cpus()[0]?.model, logicalCores: cpus().length, memoryBytes: totalmem(), os: `${platform()} ${release()}` } };
let manifestWrite = Promise.resolve();
const saveManifest = () => {
  const contents = JSON.stringify(manifest, null, 2);
  manifestWrite = manifestWrite.then(() => writeFile(join(directory, 'manifest.json'), contents));
  return manifestWrite;
};
await saveManifest();
let browser, server, context, traceSession, tracing = false, timeout, statusTimer, diskTimer, buildProcess;
let diskSpaceFailed = false;
const checkSpace = async (additionalBytes = 0) => {
  try {
    const freeBytes = await checkDiskSpace(root, additionalBytes);
    manifest.diskObservation = { minimumFreeBytes: Math.min(manifest.diskObservation?.minimumFreeBytes ?? freeBytes, freeBytes),
      lastFreeBytes: freeBytes, reserveBytes: MINIMUM_FREE_BYTES, headroomBytes: DISK_HEADROOM_BYTES };
    return freeBytes;
  } catch (error) { if (error.code === 'PERF_DISK_SPACE') diskSpaceFailed = true; throw error; }
};
let aborted = false;
const abortController = new AbortController();
let abortRun;
const interruption = new Promise((_, reject) => { abortRun = reason => {
  if (aborted) return;
  aborted = true; abortController.abort(new Error(reason)); reject(new Error(reason));
}; });
const onInterrupt = () => abortRun('Vom Anwender abgebrochen');
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onInterrupt);
const bounded = async (operation, ms, label) => {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
};
async function waitForState(page, states) {
  for (;;) {
    const state = await page.evaluate(() => window.__FD_PERF__?.state);
    if (states.includes(state)) return;
    if (aborted) throw new Error('Lauf wurde abgebrochen');
    await new Promise(done => setTimeout(done, 500));
  }
}
const consoleMessages = [];
const command = (file, args, env = {}) => new Promise((resolvePromise, reject) => {
  abortController.signal.throwIfAborted();
  const child = spawn(file, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, ...env } });
  buildProcess = child;
  child.once('error', reject); child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Build failed (${code})`)));
});
async function hashSources() {
  const hash = createHash('sha256');
  async function visit(path) {
    abortController.signal.throwIfAborted();
    const info = await stat(path);
    if (info.isDirectory()) for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
    else { hash.update(relative(root, path).replaceAll('\\', '/')); hash.update(await readFile(path)); }
  }
  for (const path of ['src', 'scripts/performance', 'scripts/asset-cache.ts', 'scripts/prepare-runtime-assets.mjs', 'scripts/lib/runtime-colours.mjs', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'game-version.json']) await visit(resolve(path));
  return hash.digest('hex');
}

async function run() {
  await checkSpace();
  diskTimer = setInterval(() => { void checkSpace(64 * 1024 ** 2).catch(error => abortRun(error.message)); }, 2000);
  if (!request.buildHash) await command(process.execPath, ['scripts/prepare-runtime-assets.mjs']);
  manifest.sourceHash = request.buildHash ?? await hashSources();
  manifest.commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  manifest.dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  const buildDirectory = resolve('build/performance-builds', manifest.sourceHash);
  const site = join(buildDirectory, 'site');
  let built = false;
  try { built = JSON.parse(await readFile(join(buildDirectory, 'build.json'), 'utf8')).sourceHash === manifest.sourceHash; } catch {}
  if (request.buildHash && !built) throw new Error(`Archived build is missing or incomplete: ${request.buildHash}`);
  if (!built) {
    await checkSpace(512 * 1024 ** 2);
    console.log('Building immutable performance artifact…');
    await command(process.execPath, ['node_modules/typescript/bin/tsc']);
    await command(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'performance-lab'], { FD_PERFORMANCE_BUILD_DIR: site });
    const storage = createBuildStorage(resolve('build/performance-objects'), buildDirectory, checkSpace, abortController.signal);
    await storage.deduplicateTree(site);
    await storage.archiveTree(resolve('public'), site);
    for (const path of ['src', 'scripts/performance', 'scripts/asset-cache.ts', 'scripts/prepare-runtime-assets.mjs', 'scripts/lib/runtime-colours.mjs', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'game-version.json']) {
      abortController.signal.throwIfAborted();
      await storage.archiveTree(resolve(path), join(buildDirectory, 'source', path));
    }
    await archiveDependencySources(buildDirectory);
    await storage.deduplicateTree(join(buildDirectory, 'source/dependencies'));
    if (await hashSources() !== manifest.sourceHash) throw new Error('Source files changed during build');
    await writeFile(join(buildDirectory, 'build.json'), JSON.stringify({ sourceHash: manifest.sourceHash, commit: manifest.commit, dirty: manifest.dirty, createdAt: new Date().toISOString(), storage: storage.statistics }));
  }
  const buildInfo = JSON.parse(await readFile(join(buildDirectory, 'build.json'), 'utf8'));
  manifest.buildStorage = buildInfo.storage ?? null;
  manifest.buildReused = built;
  manifest.commit = buildInfo.commit;
  manifest.dirty = buildInfo.dirty ?? null;
  manifest.buildDirectory = relative(directory, buildDirectory).replaceAll('\\', '/');
  const scenarioHash = createHash('sha256');
  for (const file of ['scenarios.ts', 'referenceMap.ts', 'fixtures.ts', 'build-presets.json', 'loadouts.ts', 'gamePort.ts', 'PerformanceLabController.ts']) {
    scenarioHash.update(file).update(await readFile(join(buildDirectory, 'source/src/debug/performanceLab', file)));
  }
  manifest.scenarioDataHash = scenarioHash.digest('hex');
  abortController.signal.throwIfAborted();
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
  server = createServer((req, res) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = resolve(site, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(site + sep)) { res.writeHead(403).end(); return; }
      try {
        const size = (await stat(file)).size;
        // Immutable build URL; explicit HTTP cache semantics make warm reloads reproducible.
        const cache = request.load ? { 'cache-control': 'public, max-age=31536000, immutable', etag: `"${manifest.sourceHash}-${size}"` } : {};
        if (request.load && req.headers['if-none-match'] === cache.etag) { res.writeHead(304, cache).end(); return; }
        res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'content-length': size, ...cache });
        createReadStream(file).on('error', () => res.destroy()).pipe(res);
      } catch { res.writeHead(404).end(); }
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const launchOptions = { channel: 'chrome', headless: false, args: ['--window-size=1940,1160', '--enable-automation'],
    ignoreDefaultArgs: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] };
  if (request.load) {
    launchOptions.headless = request.headless;
    launchOptions.args = ['--window-size=1684,1016', '--enable-automation', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
    launchOptions.ignoreDefaultArgs = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];
  }
  manifest.launchOptions = launchOptions;
  if (request.load) {
    // A regular on-disk HTTP cache, scoped to this run; never use a personal Chrome profile.
    // Incognito contexts have a small memory-only cache, unsuitable for a >100 MB boot.
    launchOptions.args.push('--disk-cache-size=536870912');
    manifest.cacheProfile = 'chrome-profile';
    context = await acquireOwned(() => chromium.launchPersistentContext(join(directory, 'chrome-profile'), {
      ...launchOptions, viewport: LOAD_VIEWPORT, deviceScaleFactor: 1,
    }), resource => bounded(resource.close(), 10_000, 'Late profile close timeout'), abortController.signal);
    browser = context.browser();
  } else {
    browser = await acquireOwned(() => chromium.launch(launchOptions),
      resource => bounded(resource.close(), 10_000, 'Late browser close timeout'), abortController.signal);
    context = await acquireOwned(() => browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }),
      resource => bounded(resource.close(), 5000, 'Late context close timeout'), abortController.signal);
  }
  manifest.browserVersion = browser.version();
  await context.addInitScript(req => { window.__FD_PERF_REQUEST__ = req; }, request);
  const page = await context.newPage();
  abortController.signal.throwIfAborted();
  let lastState = '', lastStatusAt = 0;
  statusTimer = setInterval(() => {
    void page.evaluate(() => ({ state: window.__FD_PERF__?.state ?? 'navigating', detail: window.__FD_PERF__?.detail,
      memory: performance.memory ? { used: performance.memory.usedJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null,
    })).then(({ state, detail, memory }) => {
      manifest.lastGameStatus = { state, detail };
      const free = freemem(), prior = manifest.memoryObservation;
      manifest.memoryObservation = { minimumSystemFreeBytes: Math.min(prior?.minimumSystemFreeBytes ?? free, free),
        peakPageJsHeapBytes: memory ? Math.max(prior?.peakPageJsHeapBytes ?? 0, memory.used) : null,
        lastPageJsHeapBytes: memory?.used ?? null, pageJsHeapLimitBytes: memory?.limit ?? null,
        note: 'Grobe Chrome-Seitenheap-Werte; kein gesamter Renderer-/GPU-Speicher und kein Beweis für die Ursache eines Absturzes.' };
      if (state !== lastState || Date.now() - lastStatusAt > 20_000) {
        const counts = detail?.enemyPeak !== undefined ? ` (Gegner-Spitze ${detail.enemyPeak}, Projektile ${detail.projectilePeak ?? 0})` : '';
        console.log(`Lab: ${state}${counts}`); lastState = state; lastStatusAt = Date.now();
      }
    }).catch(() => {});
  }, 2000);
  page.on('console', msg => {
    if (!['warning', 'error'].includes(msg.type())) return;
    // Repeated identical messages are counted, so one noisy warning cannot abort a long run.
    const repeated = consoleMessages.find(entry => entry.type === msg.type() && entry.text === msg.text());
    if (repeated) { repeated.count = (repeated.count ?? 1) + 1; return; }
    if (consoleMessages.length >= 200) {
      manifest.consoleTruncated = true;
      abortRun('Browserprotokoll überschreitet 200 Einträge; Aufnahme unvollständig');
      return;
    }
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', error => { consoleMessages.push({ type: 'pageerror', text: error.stack }); abortRun(`Spielskript fehlgeschlagen: ${error.message}`); });
  page.on('crash', () => abortRun('Chrome-Renderer abgestürzt; Aufnahme unbrauchbar'));
  traceSession = await browser.newBrowserCDPSession();
  traceSession.on('Target.targetCrashed', details => {
    manifest.rendererCrash = details;
    void saveManifest().catch(error => abortRun(`Absturzstatus konnte nicht gespeichert werden: ${error.message}`));
  });
  await traceSession.send('Target.setDiscoverTargets', { discover: true });
  manifest.chromeArguments = (await traceSession.send('Browser.getBrowserCommandLine')).arguments;
  try { manifest.gpu = (await traceSession.send('SystemInfo.getInfo')).gpu; } catch { manifest.gpu = 'unavailable'; }
  manifest.hardware.gpu = typeof manifest.gpu === 'object' ? {
    devices: manifest.gpu.devices, renderer: manifest.gpu.auxAttributes?.glRenderer,
    vendor: manifest.gpu.auxAttributes?.glVendor,
  } : 'unavailable';
  if (request.load) {
    manifest.status = 'measuring-load';
    manifest.environment = { build: 'performance-lab', quality: 'high', viewport: LOAD_VIEWPORT, network: request.network };
    await saveManifest();
    const result = await runLoadMeasurements({ page, context, url, directory, request, signal: abortController.signal });
    clearInterval(statusTimer);
    await context.close(); context = null;
    await browser.close(); browser = null;
    manifest.validSamples = result.samples.filter(s => s.valid).length;
    manifest.invalidSamples = result.samples.length - manifest.validSamples;
    await writeFile(join(directory, 'console.json'), JSON.stringify(consoleMessages, null, 2));
    if (consoleMessages.some(m => m.type === 'pageerror' || m.type === 'error')) throw new Error('Browser errors; see console.json');
    if (manifest.invalidSamples) throw new Error(`${manifest.invalidSamples} invalid loading samples; see load-summary.md`);
    abortController.signal.throwIfAborted();
    manifest.status = 'complete'; manifest.completedAt = new Date().toISOString();
    await saveManifest();
    console.log(`Fertig: ${join(directory, 'load-summary.md')}`);
    return;
  }
  manifest.captureProfileVersion = 6;
  const categories = ['devtools.timeline', 'blink.user_timing', 'v8'];
  if (request.captureProfile === 'standard') categories.push('disabled-by-default-v8.cpu_profiler');
  manifest.traceCategories = categories;
  // Match DevTools' bounded trace storage; the CPU category itself enables JS sampling.
  // https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/services/tracing/TracingManager.ts
  manifest.traceConfig = { recordMode: 'recordUntilFull', traceBufferSizeInKb: 1_200_000, includedCategories: categories };
  traceSession.on('Tracing.bufferUsage', usage => {
    const used = usage.value ?? usage.percentFull ?? 0;
    manifest.traceBufferPeakFraction = Math.max(manifest.traceBufferPeakFraction ?? 0, used);
    if (used >= 0.99) abortRun('Chrome-Trace-Puffer nahezu voll; Aufnahme unbrauchbar statt still verkürzt');
  });
  await traceSession.send('Tracing.start', { transferMode: 'ReturnAsStream', streamFormat: 'json',
    bufferUsageReportingInterval: 1000, traceConfig: manifest.traceConfig });
  tracing = true;
  abortController.signal.throwIfAborted();
  manifest.status = 'recording';
  await saveManifest();
  console.log('Chrome wird aufgezeichnet. Fenster im Vordergrund lassen.');
  const measurement = (async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(120_000, request.timeoutMs) });
    await page.bringToFront();
    await waitForState(page, ['awaiting-audio', 'failed']);
    if (await page.evaluate(() => window.__FD_PERF__?.state === 'failed')) throw new Error(await page.evaluate(() => window.__FD_PERF__.error));
    await page.mouse.click(4, 4);
    await page.waitForFunction(() => window.__FD_PERF__?.audioState?.() === 'running', null, { timeout: 10_000 })
      .catch(() => { throw new Error('Audio wurde durch die normale Browserinteraktion nicht freigegeben'); });
    await page.evaluate(() => window.__FD_PERF__.start());
    console.log('Audio entsperrt; Szenario läuft…');
    await waitForState(page, ['complete', 'failed']);
    const outcome = await page.evaluate(() => ({ state: window.__FD_PERF__.state, error: window.__FD_PERF__.error }));
    if (outcome.state === 'failed') throw new Error(outcome.error);
  })();
  await measurement;
  clearInterval(statusTimer);
  // Stop tracing before serializing the game recording or running any report work.
  console.log('Chrome-Trace abschließen…');
  const finished = new Promise(resolvePromise => traceSession.once('Tracing.tracingComplete', resolvePromise));
  await bounded(traceSession.send('Tracing.end'), 120_000, 'Chrome antwortet nicht auf Tracing.end'); tracing = false;
  console.log('Chrome-Trace: warte auf Stream…');
  const completed = await bounded(finished, 120_000, 'Chrome liefert keinen Trace-Stream');
  if (completed.dataLossOccurred || !completed.stream) throw new Error('Chrome trace lost data or returned no stream');
  const rawTrace = join(directory, 'chrome-trace.json.gz');
  console.log('Chrome-Trace übertragen…');
  await transferChromeTrace(traceSession, completed.stream, rawTrace, { signal: abortController.signal, checkSpace });
  const gameTrace = await readBrowserJson(page, () => ({ json: JSON.stringify(window.__FD_PERF__.result) }), { signal: abortController.signal });
  const result = JSON.parse(gameTrace);
  await context.close(); context = null;
  await browser.close(); browser = null;
  abortController.signal.throwIfAborted();
  if (consoleMessages.some(m => m.type === 'pageerror' || m.type === 'error')) throw new Error('Browserfehler während des Laufs; siehe console.json');
  manifest.status = 'analyzing'; manifest.scenarioVersion = result.scenarioVersion; manifest.environment = result.environment;
  await saveManifest();
  await checkSpace(Buffer.byteLength(gameTrace) + 32 * 1024 ** 2);
  await writeFile(join(directory, 'fragdachse-trace.json'), gameTrace);
  const summary = { schemaVersion: 2, windows: summarizeWindows(result) };
  // Preserve the inexpensive frame evidence before the larger Chrome analysis.
  // A timeout still leaves a failed manifest, never a successful comparison run.
  const summaryText = JSON.stringify(summary);
  await checkSpace(Buffer.byteLength(summaryText));
  await writeFile(join(directory, 'summary.json'), summaryText);
  console.log('Aufzeichnung beendet; Berichte und Source-Maps werden ausgewertet…');
  const trace = await analyzeTrace(traceEvents(rawTrace, abortController.signal), result, summary.windows, await createSourceResolver(buildDirectory), abortController.signal);
  await writeReports(directory, manifest, summary, trace, buildDirectory, checkSpace);
  await writeFile(join(directory, 'console.json'), JSON.stringify(consoleMessages, null, 2));
  if (aborted) throw new Error('Lauf wurde abgebrochen');
  manifest.status = 'complete'; manifest.completedAt = new Date().toISOString();
  await saveManifest();
  console.log(`Fertig: ${join(directory, 'analysis.md')}`);
}
try {
  timeout = setTimeout(() => abortRun('Gesamt-Timeout einschließlich Build, Trace-Übertragung und Auswertung'), request.timeoutMs);
  await Promise.race([run(), interruption]);
} catch (error) {
  manifest.status = 'failed'; manifest.error = error.stack ?? String(error);
  await saveManifest(); console.error(manifest.error); process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  clearInterval(statusTimer);
  clearInterval(diskTimer);
  if (buildProcess && buildProcess.exitCode === null) buildProcess.kill();
  if (manifest.status === 'failed' && tracing && traceSession && !diskSpaceFailed) {
    tracing = false;
    console.log('Abgebrochenen Chrome-Trace zur Fehlerdiagnose sichern…');
    const partialTrace = join(directory, 'chrome-trace.partial.json.gz');
    try {
      const details = await preserveFailedChromeTrace(traceSession, partialTrace, 30_000, { checkSpace });
      manifest.partialChromeTrace = { file: 'chrome-trace.partial.json.gz', ...details,
        note: 'Unvollständiger fehlgeschlagener Lauf; kein Eingang für perf:compare.' };
    } catch (error) { manifest.partialChromeTraceError = String(error); }
    await saveManifest();
  }
  if (manifest.status === 'failed' && context) {
    await bounded(context.pages()[0]?.evaluate(() => window.__FD_PERF__?.cancel('Runner beendet den Lauf')), 2000, 'Lab cleanup timeout').catch(() => {});
  }
  if (tracing) void traceSession?.send('Tracing.end').catch(() => {});
  await bounded(context?.close(), 5000, 'Context close timeout').catch(() => {});
  await bounded(browser?.close(), 10000, 'Browser close timeout').catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (manifest.status !== 'complete') await writeFile(join(directory, 'console.json'), JSON.stringify(consoleMessages, null, 2));
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onInterrupt);
}
