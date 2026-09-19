import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, writeFile, stat, statfs, open, unlink } from 'node:fs/promises';
import { resolve, join, relative, extname, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, platform, release, totalmem, freemem } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { summarizeWindows } from './metrics.mjs';
import { analyzeTrace, traceEvents, createSourceResolver, archiveDependencySources } from './trace.mjs';
import { writeReports } from './reports.mjs';
import { acquireOwned, preserveFailedChromeTrace } from './lifecycle.mjs';

function options(args) {
  const value = { caseId: 'standard', timeoutMs: 25 * 60_000, captureProfile: 'standard' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], arg = args[i + 1];
    if (flag === '--help') { console.log('perf:chrome [--case CASE-ID] [--duration-seconds N] [--timeout-seconds N] [--capture-profile standard|reduced]\nCases: environment.route, destruction.single/nuke/bfg, enemies.low/medium/high, weapon.glock/p90/plasma/mini-rockets/shotgun/asmd/bite/rocket/tesla/flame, utility.he/molotov/smoke, construction.defense, ultimate.armageddon, combat.day/night/day-night, recovery.idle'); process.exit(0); }
    if (!arg) throw new Error(`Missing argument for ${flag}`);
    if (flag === '--case') value.caseId = arg;
    else if (flag === '--duration-seconds' || flag === '--timeout-seconds') {
      const ms = Number(arg) * 1000;
      if (!Number.isFinite(ms) || ms <= 0 || ms > 24 * 3600_000) throw new Error(`Invalid duration: ${arg}`);
      value[flag === '--duration-seconds' ? 'durationMs' : 'timeoutMs'] = ms;
    } else if (flag === '--capture-profile' && ['standard', 'reduced'].includes(arg)) value.captureProfile = arg;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!/^(standard|environment\.route|destruction\.(single|nuke|bfg)|enemies\.(low|medium|high)|weapon\.(glock|p90|plasma|mini-rockets|shotgun|asmd|bite|rocket|tesla|flame)|utility\.(he|molotov|smoke)|construction\.defense|ultimate\.armageddon|combat\.(day|night|day-night)|recovery\.idle)$/.test(value.caseId)) throw new Error(`Unknown case: ${value.caseId}`);
  if (value.durationMs && (['standard', 'combat.day-night'].includes(value.caseId) || value.durationMs + 60_000 > value.timeoutMs)) throw new Error('Duration requires an individual case and at least 60 seconds of timeout headroom');
  return value;
}

const request = { schemaVersion: 1, runId: `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`, ...options(process.argv.slice(2)) };
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
let browser, server, context, traceSession, tracing = false, timeout, statusTimer, buildProcess;
let aborted = false;
const abortController = new AbortController();
let abortRun;
const interruption = new Promise((_, reject) => { abortRun = reason => {
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
  for (const path of ['src', 'scripts/performance', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'game-version.json']) await visit(resolve(path));
  return hash.digest('hex');
}

async function run() {
  const disk = await statfs(root);
  if (disk.bavail * disk.bsize < 1024 ** 3) throw new Error('Weniger als 1 GiB frei: Platz für Build, unkomprimierten Trace und Komprimierung schaffen.');
  manifest.sourceHash = await hashSources();
  manifest.commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  manifest.dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  const buildDirectory = resolve('build/performance-builds', manifest.sourceHash);
  const site = join(buildDirectory, 'site');
  let built = false;
  try { built = JSON.parse(await readFile(join(buildDirectory, 'build.json'), 'utf8')).sourceHash === manifest.sourceHash; } catch {}
  if (!built) {
    console.log('Building immutable performance artifact…');
    await command(process.execPath, ['node_modules/typescript/bin/tsc']);
    await command(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'performance-lab'], { FD_PERFORMANCE_BUILD_DIR: site });
    await cp(resolve('public'), site, { recursive: true });
    for (const path of ['src', 'scripts/performance', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'game-version.json']) {
      abortController.signal.throwIfAborted();
      await cp(resolve(path), join(buildDirectory, 'source', path), { recursive: true });
    }
    await archiveDependencySources(buildDirectory);
    if (await hashSources() !== manifest.sourceHash) throw new Error('Source files changed during build');
    await writeFile(join(buildDirectory, 'build.json'), JSON.stringify({ sourceHash: manifest.sourceHash, commit: manifest.commit, createdAt: new Date().toISOString() }));
  }
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
        res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'content-length': size });
        createReadStream(file).on('error', () => res.destroy()).pipe(res);
      } catch { res.writeHead(404).end(); }
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const launchOptions = { channel: 'chrome', headless: false, args: ['--window-size=1940,1160', '--enable-automation'],
    ignoreDefaultArgs: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] };
  manifest.launchOptions = launchOptions;
  browser = await acquireOwned(() => chromium.launch(launchOptions),
    resource => bounded(resource.close(), 10_000, 'Late browser close timeout'), abortController.signal);
  manifest.browserVersion = browser.version();
  context = await acquireOwned(() => browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }),
    resource => bounded(resource.close(), 5000, 'Late context close timeout'), abortController.signal);
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
  const rawTrace = join(directory, 'chrome-trace.json');
  console.log('Chrome-Trace übertragen…');
  const handle = await open(rawTrace, 'wx');
  try {
    for (;;) {
      const chunk = await traceSession.send('IO.read', { handle: completed.stream, size: 1024 * 1024 });
      await handle.writeFile(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
      if (chunk.eof) break;
    }
  } finally { await handle.close(); await traceSession.send('IO.close', { handle: completed.stream }); }
  const result = await page.evaluate(() => window.__FD_PERF__.result);
  await context.close(); context = null;
  await browser.close(); browser = null;
  abortController.signal.throwIfAborted();
  if (consoleMessages.some(m => m.type === 'pageerror' || m.type === 'error')) throw new Error('Browserfehler während des Laufs; siehe console.json');
  manifest.status = 'analyzing'; manifest.scenarioVersion = result.scenarioVersion; manifest.environment = result.environment;
  await saveManifest();
  await writeFile(join(directory, 'fragdachse-trace.json'), JSON.stringify(result));
  const summary = { schemaVersion: 2, windows: summarizeWindows(result) };
  console.log('Aufzeichnung beendet; Berichte und Source-Maps werden ausgewertet…');
  const trace = await analyzeTrace(traceEvents(rawTrace, abortController.signal), result, summary.windows, await createSourceResolver(buildDirectory), abortController.signal);
  await writeReports(directory, manifest, summary, trace, buildDirectory);
  await pipeline(createReadStream(rawTrace), createGzip(), createWriteStream(join(directory, 'chrome-trace.json.gz')), { signal: abortController.signal });
  await unlink(rawTrace);
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
  if (buildProcess && buildProcess.exitCode === null) buildProcess.kill();
  if (manifest.status === 'failed' && tracing && traceSession) {
    tracing = false;
    console.log('Abgebrochenen Chrome-Trace zur Fehlerdiagnose sichern…');
    const partialTrace = join(directory, 'chrome-trace.partial.json');
    try {
      const details = await preserveFailedChromeTrace(traceSession, partialTrace);
      manifest.partialChromeTrace = { file: 'chrome-trace.partial.json', ...details,
        note: 'Unvollständiger fehlgeschlagener Lauf; kein Eingang für perf:compare.' };
      await pipeline(createReadStream(partialTrace), createGzip(), createWriteStream(`${partialTrace}.gz`));
      manifest.partialChromeTrace.file += '.gz';
      await unlink(partialTrace);
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
