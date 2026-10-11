import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
for (const arg of args) if (!/^--(origin|run|asset|size|frames|options)=/.test(arg)) throw Error(`Unknown option: ${arg}`);
const origin = value('origin') ?? 'http://127.0.0.1:8090';
const count = Number(value('frames') ?? 6);
if (!Number.isInteger(count) || count < 2 || count > 32) throw Error('frames: 2..32');
const options = { run: value('run') ?? 'kraken-v7', asset: value('asset') ?? 'abyssal-kraken',
  size: Number(value('size') ?? 320), ...JSON.parse(value('options') ?? '{}') };
if ((await fetch(origin + '/')).status !== 200) throw Error('Start npm run dev:browser first (HTTP 200 required).');
const output = join(root, 'build/kraken-review', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const temporary = join(root, 'build/kraken-browser-temp');
await mkdir(temporary, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = temporary;
const viewport = { width: 1280, height: 720 };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'UTC' });
page.setDefaultTimeout(180000);
const errors = [], captures = [];
page.on('pageerror', e => { errors.push(e.stack ?? e.message); console.error(e.stack ?? e.message); });
page.on('console', message => {
  if (message.type() === 'error' && !(message.location().url.endsWith('/atlas.json') && message.text().includes('404'))) errors.push(message.text());
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
const watchdog = setTimeout(() => { console.error('Kraken review exceeded 10 minutes'); void browser.close(); }, 600000);
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
    player: { gridX: 39, gridY: 33 }, suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true };
  await page.goto(`${origin}/dev-scenario.html?visual-test=1#scenario=${encodeURIComponent(JSON.stringify(scenario))}`, { waitUntil: 'domcontentloaded' });
  console.log('Loading kraken-abyss-lab...');
  await page.waitForFunction(() => {
    const status = window.devScenario?.status();
    if (status?.lastAction?.ok === false || status?.state === 'error') throw Error(String(status.message));
    return status?.ready && status.paused;
  });
  console.log('Scenario ready; loading review assets...');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '#dev-scenario-panel{display:none!important} *,*::before,*::after{caret-color:transparent!important}' });
  const status = await command({ action: 'krakenReview', ...options, playing: false });
  await settle(); await command({ action: 'step', frames: 120 }); await settle();
  await command({ action: 'step', frames: 60 }); await settle();
  for (const clip of status.krakenReview.clips) for (const camera of ['overview', 'body']) {
    const frames = [], labels = [];
    for (let i = 0; i < count; i++) {
      const frame = Math.round(i * (clip.frames.length - 1) / (count - 1));
      const label = `${clip.name} | ${camera} | frame ${frame} / ${clip.frames.length - 1}`;
      frames.push(await capture(label, { clip: clip.name, frame, camera })); labels.push(label);
    }
    await sheet(`${clip.name.replace(/[^\w-]/g, '_')}-${camera}`, frames, labels, 3);
  }
  const frames = [], labels = [];
  for (const direction of [45, 90, 135]) for (const telegraphProgress of [0, .5, 1]) {
    const label = `lane | ${direction} deg | progress ${telegraphProgress}`;
    frames.push(await capture(label, { camera: 'overview', direction, telegraphProgress, grid: true })); labels.push(label);
  }
  await sheet('telegraph', frames, labels, 3);
  await writeFile(join(output, 'report.json'), JSON.stringify({ options, count, viewport, errors, captures }, null, 2));
  console.log(`CONTACT SHEETS: ${output}`);
} catch (error) {
  await page.screenshot({ path: join(output, 'error.png') }).catch(() => {});
  await writeFile(join(output, 'error.json'), JSON.stringify({ error: String(error), errors,
    status: await page.evaluate(() => window.devScenario?.status()).catch(() => null) }, null, 2));
  throw error;
} finally { clearInterval(heartbeat); clearTimeout(watchdog); await browser.close(); }
