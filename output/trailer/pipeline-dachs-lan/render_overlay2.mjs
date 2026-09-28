import { chromium } from 'file:///C:/Fragdachse/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
const mode = process.argv[2] ?? 'preview';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(new URL('overlay2.html', import.meta.url).href);
await page.evaluate(() => document.fonts.ready);
if (mode === 'preview') {
  for (const t of process.argv.slice(3).map(Number)) {
    await page.evaluate(t => window.renderAt(t), t);
    await page.screenshot({ path: `ov_${t}.png`, omitBackground: true });
  }
} else {
  const total = Number(process.argv[3] ?? 39.5), fps = 60, n = Math.round(total * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'png', '-i', '-', '-c:v', 'qtrle', '-pix_fmt', 'argb', 'overlay2.mov'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise(r => ff.on('exit', r));
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.renderAt(t), i / fps);
    const buf = await page.screenshot({ omitBackground: true });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log('overlay frame', i, '/', n, ((Date.now() - t0) / (i + 1)).toFixed(0), 'ms/frame');
  }
  ff.stdin.end(); await done;
}
await browser.close();
