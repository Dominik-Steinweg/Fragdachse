import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { compareImages } from './compare.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
for (const arg of args) if (!/^--(origin|run|asset|size|frames|options|effects|r4|r5|r7|p9c)=/.test(arg)) throw Error(`Unknown option: ${arg}`);
const p9c = value('p9c');
if (p9c && !['smoke', 'mask', 'all', 'runtime'].includes(p9c)) throw Error('p9c: smoke/mask/all/runtime');
const r7 = ['only', 'ashore'].includes(value('r7'));
if (value('r7') && !r7) throw Error('r7: only/ashore');
const r5 = value('r5') === 'only';
if (value('r5') && !r5) throw Error('r5: only');
const r4 = value('r4') === 'only';
if (value('r4') && !r4) throw Error('r4: only');
const effectsOnly = value('effects') === 'only' || r4 || r5 || r7;
if (value('effects') && !['only', 'all'].includes(value('effects'))) throw Error('effects: only/all');
const origin = value('origin') ?? 'http://127.0.0.1:8090';
const count = Number(value('frames') ?? 6);
if (!Number.isInteger(count) || count < 2 || count > 32) throw Error('frames: 2..32');
const available = run => existsSync(join(root, 'art/poc/pipeline-v2/runs', run, 'abyssal-kraken/standard/export.json'));
const options = { run: value('run') ?? ['kraken-v10', 'kraken-v9', 'pipeline-v8-smoke-2', 'kraken-v7'].find(available), asset: value('asset') ?? 'abyssal-kraken',
  size: Number(value('size') ?? 320), ...JSON.parse(value('options') ?? '{}') };
for (const [key, asset] of [['land', 'abyssal-kraken-land'], ['tentacle', 'abyssal-kraken-tentacle'], ['egg', 'abyssal-kraken-egg']]) {
  const file = join(root, 'art/poc/pipeline-v2/runs', options.run, asset, 'standard/export.json');
  if (options[key] === undefined && existsSync(file)) options[key] = { run: options.run, asset, size: JSON.parse(readFileSync(file, 'utf8')).manifest.targetSize };
}
if (options.tentacle === undefined && existsSync(join(root, 'art/poc/pipeline-v2/previews/kraken-v9-tent-a/abyssal-kraken-tentacle/preview.json'))) {
  options.tentacle = { run: 'kraken-v9-tent-a', asset: 'abyssal-kraken-tentacle', size: 366, previewFrame: 44 };
  options.tentaclePivot ??= [.5, .948];
}
if ((await fetch(origin + '/')).status !== 200) throw Error('Start npm run dev:browser first (HTTP 200 required).');
const output = join(root, 'build/kraken-review', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const temporary = join(root, 'build/kraken-browser-temp');
await mkdir(temporary, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = temporary;
const viewport = p9c ? { width: 1536, height: 1024 } : { width: 1280, height: 720 };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'UTC' });
// Freeze the loaded review during captures: parallel lanes must not navigate this tab via Vite HMR.
// Runtime/API traffic is unchanged; only the dev server's token-authenticated hot-reload socket is held.
await page.routeWebSocket(url => url.host === new URL(origin).host && url.searchParams.has('token'), () => {});
page.setDefaultTimeout(180000);
const errors = [], diagnostics = [], captures = [], seekMismatches = [], seekComparisons = [];
page.on('pageerror', e => { errors.push(e.stack ?? e.message); console.error(e.stack ?? e.message); });
page.on('console', message => {
  if (message.type() === 'error' && !(message.location().url.endsWith('/atlas.json') && message.text().includes('404'))) errors.push(message.text());
  if (message.text().includes('[Kraken presentation]')) {
    diagnostics.push(message.text());
    if (/budget exceeded|HTTP|hash mismatch|decode failed|registration failed|invalid/i.test(message.text())) errors.push(message.text());
  }
});
page.on('response', r => {
  // Optional atlas discovery is the only expected 404; explicit atlas errors fail the command.
  if (r.status() >= 400 && !(r.status() === 404 && r.url().endsWith('/atlas.json'))) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});
const command = async c => {
  const result = await page.evaluate(c => window.devScenario.run(c), c);
  if (!result.ok) throw Error(`${JSON.stringify(c)}: ${result.error}`);
  if (c.action === 'step' || c.action === 'settle') await page.waitForFunction(() => window.devScenario.status().pendingSteps === 0);
  return result.status;
};
const settle = async () => {
  const started = performance.now();
  do {
    await command({ action: 'settle', frames: 12 });
    const status = await page.evaluate(() => window.devScenario.status());
    if (status.loading.work?.renderReady && status.loading.work.pending === 0) return;
  } while (performance.now() - started < 60000);
  throw Error('Render work did not settle');
};
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const capture = async (label, patch) => {
  await command({ action: 'krakenReview', ...patch, playing: false });
  if (r5 && patch.effect === 'egg-throw' && patch.camera === 'effect') await command({ action: 'camera', zoom: 6 });
  await settle();
  const status = await page.evaluate(() => window.devScenario.status());
  if (!status.krakenReview?.loaded || !status.paused || errors.length) throw Error(errors.join('\n') || 'Fixture not loaded/paused');
  const png = await page.screenshot({ animations: 'disabled' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frozen = await page.screenshot({ animations: 'disabled' });
  if (!png.equals(frozen)) throw Error(`Paused capture moved: ${label}`);
  captures.push({ label, review: status.krakenReview, camera: status.camera });
  return png;
};
const sheet = async (name, frames, labels, columns) => {
  const width = 640, height = 360, caption = 28;
  const tiles = await Promise.all(frames.map(async (input, i) => ({ input: await sharp(input).resize(width, height).extend({ top: caption, bottom: 0, left: 0, right: 0, background: '#14222b' })
    .composite([{ input: Buffer.from(`<svg width="${width}" height="${caption}"><text x="12" y="20" fill="#d6eeeb" font-size="15" font-family="sans-serif">${escape(labels[i])}</text></svg>`), top: 0, left: 0 }]).png().toBuffer(),
    left: i % columns * width, top: Math.floor(i / columns) * (height + caption) })));
  await sharp({ create: { width: columns * width, height: Math.ceil(frames.length / columns) * (height + caption), channels: 4, background: '#14222b' } }).composite(tiles).png().toFile(join(output, name + '.png'));
  console.log(`${name}.png`);
};
const measureLighting = async (png, body, canvas) => {
  const src = body.source;
  const sourceUrl = await page.evaluate(async src => {
    const image = new Image(); image.src = src.url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = src.logicalWidth; canvas.height = src.logicalHeight;
    canvas.getContext('2d').drawImage(image, src.x, src.y, src.width, src.height, src.trimX, src.trimY, src.width, src.height);
    return canvas.toDataURL('image/png');
  }, src);
  const source = Buffer.from(sourceUrl.split(',')[1], 'base64');
  await writeFile(join(output, 'lighting-source.png'), source);
  const { data: pixels, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const color = await sharp(source).ensureAlpha().raw().toBuffer();
  const a = body.screen.topLeft, b = body.screen.bottomRight, rect = canvas.rect;
  const left = rect.x + a.x / canvas.width * rect.width, top = rect.y + a.y / canvas.height * rect.height;
  const width = (b.x - a.x) / canvas.width * rect.width, height = (b.y - a.y) / canvas.height * rect.height;
  const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  const sums = { source: 0, game: 0, sourceLinear: 0, gameLinear: 0 }; let samples = 0;
  for (let y = Math.max(0, Math.ceil(top)); y < Math.min(info.height, top + height); y++) {
    for (let x = Math.max(0, Math.ceil(left)); x < Math.min(info.width, left + width); x++) {
      const sx = (x + .5 - left) / width * src.logicalWidth - .5, sy = (y + .5 - top) / height * src.logicalHeight - .5;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      if (ix < 2 || iy < 2 || ix >= src.logicalWidth - 3 || iy >= src.logicalHeight - 3) continue;
      let opaque = true;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (color[((iy + dy) * src.logicalWidth + ix + dx) * 4 + 3] < 254) opaque = false;
      if (!opaque) continue;
      const sample = (dx, dy, channel) => color[((iy + dy) * src.logicalWidth + ix + dx) * 4 + channel] / 255;
      const fx = sx - ix, fy = sy - iy, weights = [.2126, .7152, .0722];
      for (let c = 0; c < 3; c++) {
        const v = (sample(0, 0, c) * (1 - fx) + sample(1, 0, c) * fx) * (1 - fy)
          + (sample(0, 1, c) * (1 - fx) + sample(1, 1, c) * fx) * fy;
        const game = pixels[(y * info.width + x) * 4 + c] / 255;
        sums.source += v * weights[c]; sums.game += game * weights[c];
        sums.sourceLinear += linear(v) * weights[c]; sums.gameLinear += linear(game) * weights[c];
      }
      samples++;
    }
  }
  if (!samples) throw Error('No opaque lighting samples');
  return { method: 'Matched opaque sprite interior, bilinear source, submersion disabled; world light unchanged', samples,
    meanLumaSource: sums.source / samples, meanLumaGame: sums.game / samples,
    lumaRatio: sums.game / sums.source, meanLinearLuminanceSource: sums.sourceLinear / samples,
    meanLinearLuminanceGame: sums.gameLinear / samples, linearRatio: sums.gameLinear / sums.sourceLinear,
    roi: { left, top, width, height } };
};
const watchdog = setTimeout(() => { console.error('Kraken review exceeded 10 minutes'); void browser.close(); }, p9c ? 1800000 : 600000);
const heartbeat = setInterval(() => {
  void page.evaluate(() => {
    const s = window.devScenario?.status();
    return s ? { state: s.state, ready: s.ready, message: s.message, loading: s.loading, review: s.krakenReview?.loaded } : 'booting';
  }).then(s => console.log('Status:', JSON.stringify(s))).catch(() => {});
}, 15000);
try {
  await page.addInitScript(() => {
    const original = console.error;
    console.error = (...args) => original(...args, new Error('Console error origin').stack);
  });
  const scenario = { version: 1, classId: 'dachs_nukem', mapId: 'kraken-abyss-lab', seed: 12345, timeOfDay: 720,
    player: { gridX: 39, gridY: 36 }, suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true };
  await page.goto(`${origin}/dev-scenario.html?visual-test=1#scenario=${encodeURIComponent(JSON.stringify(scenario))}`, { waitUntil: 'domcontentloaded' });
  console.log('Loading kraken-abyss-lab...');
  await page.waitForFunction(() => {
    const status = window.devScenario?.status();
    if (status?.lastAction?.ok === false || status?.state === 'error') throw Error(String(status.message));
    return status?.ready && status.paused;
  });
  console.log('Scenario ready; loading review assets...');
  if (p9c === 'mask') await page.evaluate(async () => {
    // Vite adds dependency timestamps: patch the constructor actually used by
    // this loaded scene, not a second module instance without its query string.
    const moduleUrl = performance.getEntriesByType('resource').map(e => e.name)
      .findLast(url => url.includes('/src/effects/kraken/KrakenShadowRenderer.ts'));
    if (!moduleUrl) throw Error('Kraken shadow module was not loaded');
    const { KrakenShadowRenderer } = await import(moduleUrl);
    const inspect = KrakenShadowRenderer.prototype.inspect;
    KrakenShadowRenderer.prototype.inspect = function() {
      const result = { ...inspect.call(this), strength: [...this.strength], sun: [...this.sun], maskDraws: this.maskDraws };
      const gl = this.scene.sys.renderer.gl, previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      result.glError = gl.getError();
      result.matrix = Array.from(this.matrix);
      result.receiver = this.environment?.receiver.world;
      result.sample = this.environment?.receiver.sample(this.body[0], this.body[1]);
      if (this.gpu) {
        result.geometry = Array.from(this.gpu.geometry.buffer.viewF32.slice(0, 12));
        result.indices = Array.from(this.gpu.indices.viewU16.slice(0, 12));
        result.indexCount = this.gpu.indexCount;
        const program = this.gpu.program.getCurrentProgramSuite()?.program.webGLProgram;
        result.uniforms = {};
        if (program) for (const name of ['uModel', 'uBounds', 'uSun', 'uReceiverWorld', 'uPlane', 'uWetPass']) {
          const location = gl.getUniformLocation(program, name);
          const value = location ? gl.getUniform(program, location) : null;
          result.uniforms[name] = ArrayBuffer.isView(value) ? Array.from(value) : value;
        }
      }
      result.targets = {};
      for (const name of ['raw', 'horizontal', 'blurred']) {
        const context = this[name]?.shader.drawingContext;
        if (!context?.framebuffer) continue;
        gl.bindFramebuffer(gl.FRAMEBUFFER, context.framebuffer.webGLFramebuffer);
        const bytes = new Uint8Array(context.width * context.height * 4);
        gl.readPixels(0, 0, context.width, context.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        let occupied = 0, sum = 0;
        for (let i = 0; i < bytes.length; i += 4) { occupied += Number(bytes[i] > 0); sum += bytes[i]; }
        result.targets[name] = { width: context.width, height: context.height, occupied, sum };
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
      return result;
    };
  });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '#dev-scenario-panel{display:none!important} *,*::before,*::after{caret-color:transparent!important}' });
  if (p9c === 'runtime') {
    const measurements = [], phasePeaks = {}, phaseAtlasPeaks = {};
    for (const quality of options.quality ? [options.quality] : ['high', 'medium', 'low']) {
      for (const trial of value('asset') === 'land' ? ['land'] : ['water', 'land']) {
        await command({ action: 'krakenMission', skipIntro: trial === 'land', ...(trial === 'land' ? { hp: 1 } : {}) });
        await page.waitForFunction(() => window.devScenario.status().ready);
        await command({ action: 'quality', level: quality });
        await command({ action: 'options', values: { refillHp: true, hideAim: true, hideTutorial: true, timeOfDay: 720 } });
        await command({ action: 'teleport', gridX: 53, gridY: 39 });
        await command({ action: 'target', gridX: 35, gridY: 29 });
        await command({ action: 'camera', zoom: 1, focusTarget: true });
        const captured = new Set();
        for (let second = 0; second < 100; second++) {
          await command({ action: 'step', frames: 60 }); await settle();
          const status = await page.evaluate(() => window.devScenario.status());
          const residency = status.krakenResidency;
          if (residency) phaseAtlasPeaks[residency.phase] = Math.max(phaseAtlasPeaks[residency.phase] ?? 0, residency.atlasBytes);
          measurements.push({ quality, trial, second, residency, mission: status.mission });
          if (second % 10 === 0) await writeFile(join(output, 'runtime-progress.json'), JSON.stringify({ quality, trial, second, residency, simulationMs: status.simulationMs, errors, diagnostics }, null, 2));
          for (const [phase, bytes] of Object.entries(residency?.phasePeaks ?? {})) phasePeaks[phase] = Math.max(phasePeaks[phase] ?? 0, bytes);
          if (residency?.atlasBytes > 0 && !captured.has(residency.phase)) {
            captured.add(residency.phase);
            await command({ action: 'target', gridX: 35, gridY: ['ashore', 'land'].includes(residency.phase) ? 35 : 29 });
            await command({ action: 'camera', zoom: 1, focusTarget: true });
            await settle();
            await page.screenshot({ path: join(output, `runtime-${quality}-${trial}-${residency.phase}.png`) });
          }
          if (errors.length) throw Error(errors.join('\n'));
        }
        await writeFile(join(output, 'runtime-report.json'), JSON.stringify({ viewport, phasePeaks, phaseAtlasPeaks, errors, diagnostics, measurements }, null, 2));
      }
    }
    for (const phase of ['intro', 'water', 'ashore', 'land']) {
      if (!(phasePeaks[phase] > 0)) throw Error(`Missing actual phase: ${phase}`);
      if (phasePeaks[phase] > (['intro', 'water'].includes(phase) ? 165 : 150) * 1024 ** 2) throw Error(`Residency limit exceeded: ${phase}`);
    }
    const plan = JSON.parse(readFileSync(join(root, 'art/poc/kraken-v12/build/budget.json'), 'utf8'));
    for (const row of plan.rows) if ((phaseAtlasPeaks[row.phase] ?? 0) < row.atlasBytes) throw Error(`Incomplete resident clip set: ${row.phase}`);
    console.log(`RUNTIME MEASUREMENTS: ${output}`);
  } else if (p9c) {
    await command({ action: 'step', frames: 240 }); await settle();
    const revision = value('run') ?? 'kraken-v12';
    const manifest = await (await fetch(`${origin}/art/poc/pipeline-v2/runs/${revision}/ls-pilot.json`)).json();
    const selected = ['smoke', 'mask'].includes(p9c) ? manifest.assets.filter(a => a.id === (value('asset') ?? 'abyssal-kraken-land')).flatMap(a => [{ asset: a, pose: a.poses.find(p => p.name === 'hover-0') ?? a.poses[0] }])
      : manifest.assets.flatMap(asset => asset.poses.map(pose => ({ asset, pose })));
    const measurements = [];
    for (const { asset, pose } of selected) {
      const frames = [], labels = [];
      for (const quality of ['smoke', 'mask'].includes(p9c) || pose.name.endsWith('-0') ? ['high', 'medium', 'low'] : ['high']) {
        for (const [azimuth, elevation] of [[0,45], [135,28]]) {
          const patch = { action: 'krakenReview', pilot: revision, pose: `${asset.id}/${pose.name}`, quality, azimuth, elevation,
            shore: asset.role === 'water' || asset.role === 'tentacle', night: false };
          await command(patch); await settle();
          await command({ action: 'step', frames: 30 }); await settle();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const state = await page.evaluate(() => window.devScenario.status());
          if (!state.krakenReview.ready || errors.length) throw Error(`Material review not ready: ${JSON.stringify(errors)}`);
          const label = `${asset.role} ${pose.name} F${pose.sourceFrame} ${quality} sun ${azimuth}/${elevation}`;
          const png = await page.screenshot();
          await writeFile(join(output, `${asset.role}-${pose.name}-${quality}-${azimuth}.png`), png);
          frames.push(png); labels.push(label); measurements.push({ label, status: state.krakenReview });
          if (p9c === 'mask' && asset.role !== 'egg' && quality !== 'low'
            && state.krakenReview.shadows.some(s => !(s.targets.raw.occupied > 0 && s.targets.blurred.occupied > 0) || s.glError))
            throw Error('Empty or invalid projected Kraken shadow mask');
        }
      }
      await sheet(`${asset.role}-${pose.name}`, frames, labels, 2);
    }
    await writeFile(join(output, 'report.json'), JSON.stringify({ revision, viewport, errors, measurements }, null, 2));
    console.log(`CONTACT SHEETS: ${output}`);
  } else {
  const status = await command({ action: 'krakenReview', ...options, playing: false });
  await settle(); await command({ action: 'step', frames: 120 }); await settle();
  await command({ action: 'step', frames: 60 }); await settle();
  if (r7) {
    for (const effect of value('r7') === 'ashore' ? ['ashore'] : ['ashore', 'land-move', 'land-claw']) {
      const start = await command({ action: 'krakenReview', effect, effectTime: 0, phase: 'water', direction: 0,
        camera: 'overview', playback: 'manual', submersion: true, waterLevel: null, grid: false, clip: 'idle' });
      const timeline = start.krakenReview.landTimeline, p = timeline.phase, a = timeline.attack;
      const times = effect === 'ashore' ? [0, timeline.roarAt, p.moveAt, p.gripAt - 30, p.gripAt + 80,
        p.gripAt + 300, p.heaveAt, p.endsAt, p.endsAt + 2200]
        : effect === 'land-claw' ? [0, a.strikeAt * .65, a.strikeAt, (a.strikeAt + a.hitAt) / 2,
          a.hitAt, a.hitAt + 100, a.endsAt, a.endsAt + 500, a.endsAt + 2200]
          : [0, 250, 500, 750, 1000, 1500, 2000, 2200, 2700];
      for (const camera of ['overview', 'effect']) {
        const frames = [], labels = [];
        for (const time of times) {
          const effectTime = Math.round(time / 1000 * 60) / 60, label = `${effect} | ${camera} | t=${effectTime.toFixed(3)}`;
          frames.push(await capture(label, { effect, effectTime, camera })); labels.push(label);
        }
        await sheet(`r7-${effect}-${camera}`, frames, labels, 3);
        const rewind = await capture(`${effect} rewind`, { effect, effectTime: 0, camera });
        const { diff: _diff, ...comparison } = await compareImages(frames[0], rewind, { delta: 3, maxRatio: 0 });
        seekComparisons.push({ effect, camera, ...comparison });
        if (!comparison.passed) seekMismatches.push(`${effect}-${camera}`);
      }
    }
  }
  if (r5) {
    for (const effect of ['intro', 'dive', 'surface', 'egg-throw']) {
      const start = await command({ action: 'krakenReview', effect, effectTime: 0, phase: 'water', direction: 90,
        camera: 'overview', playback: 'manual', submersion: true, waterLevel: null, grid: false });
      const timing = start.krakenReview.choreography.timing, look = start.krakenReview.options;
      const release = timing.release.seconds, land = release + look.eggFlight.flight, hatch = land + look.eggFlight.incubation;
      const rise = effect === 'surface' ? look.surface : look.intro;
      const times = effect === 'egg-throw' ? [0, release, release + look.eggFlight.flight * .25,
        release + look.eggFlight.flight * .6, land, land + .2, land + look.eggFlight.incubation * .5,
        hatch - .1, hatch, hatch + .18, hatch + .5, hatch + 2.5]
        : effect === 'dive' ? [0, timing.submerged.seconds * .3, timing.submerged.seconds * .65,
          timing.submerged.seconds, timing.submerged.seconds + .15, timing.submerged.seconds + .4,
          timing.submerged.seconds + .8, timing.submerged.seconds + look.dive.lifetime, timing.submerged.seconds + 3]
        : [0, timing.lead * .5, timing.lead, timing.armsBreak.seconds, timing.armsBreak.seconds + .15,
          timing.keelBreak.seconds + .1, timing.eyesOpen.seconds,
          ...(effect === 'intro' ? [timing.roar.seconds, timing.roar.seconds + .15, timing.roar.seconds + .5] : []),
          (effect === 'intro' ? timing.roar.seconds : timing.eyesOpen.seconds) + rise.lifetime + .1];
      for (const camera of ['overview', 'effect']) {
        const frames = [], labels = [];
        for (const time of times) {
          const effectTime = Math.round(time * 60) / 60, label = effect + ' | ' + camera + ' | t=' + effectTime.toFixed(3);
          frames.push(await capture(label, { effect, effectTime, camera })); labels.push(label);
        }
        await sheet('r5-' + effect + '-' + camera, frames, labels, 3);
        const rewind = await capture(effect + ' rewind', { effect, effectTime: 0, camera });
        // Shader rounding after camera travel can move a few channels by 1–3/255.
        // No pixel may exceed that bound; stationary captures above remain byte-identical.
        const { diff: _diff, ...comparison } = await compareImages(frames[0], rewind, { delta: 3, maxRatio: 0 });
        seekComparisons.push({ effect, camera, ...comparison });
        if (!comparison.passed) {
          await writeFile(join(output, effect + '-' + camera + '-first.png'), frames[0]);
          await writeFile(join(output, effect + '-' + camera + '-rewind.png'), rewind);
          seekMismatches.push(effect + '-' + camera);
        }
      }
    }
  }
  if (r4) {
    // Bite uses its existing shader unchanged; the two repeated rows also check frozen rendering.
    await command({ action: 'krakenReview', tentacle: null });
    const telegraphs = [], telegraphLabels = [];
    for (const [telegraphShape, title] of [['bite', 'Bite reference'], ['bite', 'Bite unchanged'], ['lane', 'Lane soft'], ['cone', 'Ink cone soft']]) {
      for (const telegraphProgress of [.2, .55, .9]) {
        const label = title + ' | charge ' + telegraphProgress;
        telegraphs.push(await capture(label, { effect: 'none', phase: 'water', camera: 'effect', direction: 90,
          telegraphShape, telegraphProgress, tentacleClip: 'rise', tentacleFrame: 0, grid: false })); telegraphLabels.push(label);
      }
    }
    for (let i = 0; i < 3; i++) if (!telegraphs[i].equals(telegraphs[i + 3])) throw Error('Bite repeat differs');
    await sheet('r4-telegraphs', telegraphs, telegraphLabels, 3);
    const start = await command({ action: 'krakenReview', effect: 'approach', effectTime: 0, phase: 'water',
      direction: 0, camera: 'overview', submersion: true, waterLevel: null, playback: 'manual' });
    const duration = start.krakenReview.effects.approach.duration, spit = start.krakenReview.effects.timing.spit.seconds;
    for (const camera of ['overview', 'effect']) {
      const frames = [], labels = [];
      for (const time of [0, duration * .33, duration * .66, duration, duration + spit * .55,
        duration + spit - 1 / 60, duration + spit + .2, duration + spit + .7, duration + spit + 1.5]) {
        const effectTime = Math.ceil(time * 60) / 60, label = 'approach | ' + camera + ' | t=' + effectTime.toFixed(3);
        frames.push(await capture(label, { effect: 'approach', effectTime, camera })); labels.push(label);
      }
      await sheet('r4-approach-' + camera, frames, labels, 3);
      const rewind = await capture('approach rewind', { effect: 'approach', effectTime: 0, camera });
      if (!frames[0].equals(rewind)) throw Error('Approach rewind differs');
    }
    const slamStart = await command({ action: 'krakenReview', tentacle: options.tentacle, effect: 'slam', effectTime: 0,
      tentacleSequence: true, tentacleClip: 'rise', direction: 90, erupt: { count: 1 }, camera: 'effect' });
    const timing = slamStart.krakenReview.effects.timing;
    const clips = slamStart.krakenReview.tentacle.clips;
    const rise = clips.find(c => c.name === 'rise'), hover = clips.find(c => c.name === 'hover');
    const raised = rise.frames.length / rise.frameRate + hover.frames.length / hover.frameRate * .5;
    const frames = [], labels = [];
    for (const tentacleShadow of [false, true]) for (const time of [raised, timing.impact.seconds - .12, timing.impact.seconds]) {
      const effectTime = Math.round(time * 60) / 60, label = 'shadow ' + tentacleShadow + ' | t=' + effectTime.toFixed(3);
      frames.push(await capture(label, { effect: 'slam', effectTime, tentacleShadow })); labels.push(label);
    }
    await sheet('r4-tentacle-shadow-comparison', frames, labels, 3);
    const sequence = [], sequenceLabels = [];
    for (const time of [0, rise.frames.length / rise.frameRate * .5, raised, timing.impact.seconds - .12,
      timing.impact.seconds, timing.impact.seconds + .2, timing.retract.seconds, timing.retract.seconds + .3,
      timing.retract.seconds + .8]) {
      const effectTime = Math.round(time * 60) / 60, label = 'rise / hover / slam / retract | t=' + effectTime.toFixed(3);
      sequence.push(await capture(label, { effect: 'slam', effectTime, tentacleShadow: true })); sequenceLabels.push(label);
    }
    await sheet('r4-tentacle-sequence', sequence, sequenceLabels, 3);
  }
  if (value('effects')) {
    for (const [effect, phase] of [['ink', 'water'], ['ink', 'land'], ['erupt', 'water'], ['slam', 'water']]) {
      const clip = status.krakenReview.clips.find(c => c.name === 'ink-spit')?.name ?? options.clip ?? 'idle';
      const tentacleClip = effect === 'slam' ? 'slam' : 'rise';
      const start = await command({ action: 'krakenReview', effect, phase, effectTime: 0, playback: 'manual', clip,
        tentacleClip, direction: options.direction ?? (phase === 'land' ? 0 : 90), grid: false });
      const timing = start.krakenReview.effects.timing;
      const look = start.krakenReview.options;
      const times = effect === 'ink'
        ? [0, timing.spit.seconds * .3, timing.charge.seconds, timing.spit.seconds - 1 / 60,
          timing.spit.seconds + look.ink.travel * .25, timing.spit.seconds + look.ink.travel * .7,
          timing.spit.seconds + look.ink.travel + .03, timing.spit.seconds + look.ink.travel + look.ink.hold * .6,
          timing.spit.seconds + look.ink.travel + look.ink.hold + look.ink.dissolve * .25,
          timing.spit.seconds + look.ink.travel + look.ink.hold + look.ink.dissolve * .7,
          timing.spit.seconds + look.ink.travel + look.ink.hold + look.ink.dissolve + .1]
        : effect === 'slam' ? [0, timing.impact.seconds * .6, timing.impact.seconds - 1 / 60, timing.impact.seconds,
          timing.impact.seconds + .08, timing.impact.seconds + .2, timing.impact.seconds + .45,
          timing.impact.seconds + look.slam.dustLifetime + .05, timing.impact.seconds + look.slam.decalLifetime * .75,
          timing.impact.seconds + look.slam.decalLifetime + .1]
          : [0, look.erupt.rise * .65, look.erupt.rise + .03, look.erupt.rise + .12, look.erupt.rise + .3,
            look.erupt.rise + .83, look.erupt.rise + look.erupt.lifetime + .05, timing.retract.seconds + .08,
            timing.retract.seconds + .25, timing.retract.seconds + .65, timing.retract.seconds + look.erupt.lifetime + .1];
      for (const camera of ['overview', 'effect']) {
        const frames = [], labels = [];
        // Warm both endpoints after camera/phase changes before judging reverse seeks.
        // Chunk/lightmap work can settle after renderReady when returning from the land view.
        for (const effectTime of [times.at(-1), times[0]]) {
          await command({ action: 'krakenReview', effect, effectTime, camera, playing: false });
          await settle(); await settle();
        }
        for (const time of times) {
          const effectTime = Math.max(0, Math.round(time * 60) / 60), label = `${effect} ${phase} | ${camera} | t=${effectTime.toFixed(3)}s`;
          frames.push(await capture(label, { effect, effectTime, playback: 'manual', camera })); labels.push(label);
        }
        // Rewind is required to reproduce the first frame, not just stay paused.
        const rewind = await capture('rewind', { effect, effectTime: Math.max(0, Math.round(times[0] * 60) / 60), camera });
        if (!frames[0].equals(rewind)) {
          await writeFile(join(output, `rewind-${effect}-${phase}-${camera}-before.png`), frames[0]);
          await writeFile(join(output, `rewind-${effect}-${phase}-${camera}-after.png`), rewind);
          throw Error(`Effect reverse seek differs: ${effect}/${camera}`);
        }
        await sheet(`effect-${effect}${phase === 'land' ? '-land' : ''}-${camera}`, frames, labels, 3);
      }
    }
    await command({ action: 'krakenReview', effect: 'none' });
  }
  if (!effectsOnly) {
  for (const clip of status.krakenReview.clips) for (const camera of ['overview', 'body']) {
    const frames = [], labels = [];
    for (let i = 0; i < count; i++) {
      const frame = Math.round(i * (clip.frames.length - 1) / (count - 1));
      const label = `${clip.name} | ${camera} | frame ${frame} / ${clip.frames.length - 1}`;
      frames.push(await capture(label, { clip: clip.name, frame, camera })); labels.push(label);
    }
    await sheet(`${clip.name.replace(/[^\w-]/g, '_')}-${camera}`, frames, labels, 3);
  }
  const waterFrames = [], waterLabels = [];
  for (const waterLevel of [0, .38, .8]) {
    const label = `water level ${waterLevel}`;
    waterFrames.push(await capture(label, { clip: 'idle', frame: 0, camera: 'body', waterLevel, grid: false })); waterLabels.push(label);
  }
  await sheet('water-levels', waterFrames, waterLabels, 3);
  for (const [part, view, clipKey, frameKey] of [['tentacle', 'tentacle', 'tentacleClip', 'tentacleFrame'], ['eggs', 'egg', 'eggClip', 'eggFrame']]) {
    const visual = part === 'eggs' ? status.krakenReview.eggs[0] : status.krakenReview[part];
    if (!visual) continue;
    const partFrames = [], partLabels = [];
    for (const clip of visual.clips) for (let i = 0; i < count; i++) {
      const frame = Math.round(i * (clip.frames.length - 1) / (count - 1)), label = `${view} | ${clip.name} | ${frame}`;
      partFrames.push(await capture(label, { camera: view, [clipKey]: clip.name, [frameKey]: frame, waterLevel: .38 })); partLabels.push(label);
    }
    await sheet(view, partFrames, partLabels, 3);
  }
  if (status.krakenReview.tentacle) {
    await command({ action: 'krakenReview', camera: 'tentacle', tentacleClip: 'rise', tentacleFrame: 0, tentacleSequence: true, playing: true });
    const sequenceFrames = [], sequenceLabels = [];
    const sequence = ['rise', 'hover', 'slam', 'retract'].map(name => status.krakenReview.tentacle.clips.find(c => c.name === name));
    if (sequence.some(c => !c)) throw Error('Incomplete tentacle sequence');
    const totalSteps = Math.ceil(sequence.reduce((sum, c) => sum + c.frames.length / c.frameRate, 0) * 60 / (options.speed || 1));
    let advanced = 0;
    for (let i = 0; i <= 12; i++) {
      const target = Math.round(i * totalSteps / 12);
      while (advanced < target) { const frames = Math.min(600, target - advanced); await command({ action: 'step', frames }); advanced += frames; }
      await settle();
      const state = (await page.evaluate(() => window.devScenario.status())).krakenReview;
      sequenceFrames.push(await page.screenshot()); sequenceLabels.push(`${state.tentacle.playback.clip} | ${state.options.tentacleFrame}`);
      captures.push({ label: 'tentacle-sequence', review: state });
    }
    await sheet('tentacle-sequence', sequenceFrames, sequenceLabels, 3);
  }
  const frames = [], labels = [];
  for (const direction of [45, 90, 135]) for (const telegraphProgress of [0, .5, 1]) {
    const label = `lane | ${direction} deg | progress ${telegraphProgress}`;
    frames.push(await capture(label, { camera: 'overview', direction, telegraphProgress, grid: true })); labels.push(label);
  }
  await sheet('telegraph', frames, labels, 3);
  // The pixel comparison assumes an unrotated sprite (authored north = direction -90).
  const lightingPng = await capture('lighting: source comparison', { clip: 'idle', frame: 0, direction: -90, camera: 'body', grid: false, submersion: false });
  await writeFile(join(output, 'lighting-game.png'), lightingPng);
  const lightState = (await page.evaluate(() => window.devScenario.status())).krakenReview;
  const canvas = await page.locator('canvas').first().evaluate(c => ({ width: c.width, height: c.height, rect: { x: c.getBoundingClientRect().x, y: c.getBoundingClientRect().y, width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height } }));
  const lighting = await measureLighting(lightingPng, lightState.body, canvas);
  await command({ action: 'krakenReview', submersion: true });
  const unavailable = ['tentacle', 'egg', 'land'].filter(k => !options[k]);
  if (lightState.tentacle && lightState.socketSource !== 'waterEntry') unavailable.push('authored waterEntry socket');
  if (lightState.submersion === 'missing-elevation') unavailable.push('elevation');
  await writeFile(join(output, 'report.json'), JSON.stringify({ options, count, viewport, errors, unavailable, lighting, captures }, null, 2));
  console.log('LIGHTING:', JSON.stringify(lighting));
  } else {
    await writeFile(join(output, 'report.json'), JSON.stringify({ options, viewport, errors, captures, seekMismatches, seekComparisons,
      unavailable: options.tentacle?.previewFrame !== undefined ? ['animated tentacle: static preview shown only at slam contact']
        : status.krakenReview.tentacle ? [] : ['tentacle asset: effects shown without tentacle sprites'] }, null, 2));
  }
  console.log(`CONTACT SHEETS: ${output}`);
  if (seekMismatches.length) throw Error('Rewind differs: ' + seekMismatches.join(', '));
  }
} catch (error) {
  await page.screenshot({ path: join(output, 'error.png') }).catch(() => {});
  await writeFile(join(output, 'error.json'), JSON.stringify({ error: String(error), errors, captures,
    status: await page.evaluate(() => window.devScenario?.status()).catch(() => null) }, null, 2));
  throw error;
} finally { clearInterval(heartbeat); clearTimeout(watchdog); await browser.close(); }
