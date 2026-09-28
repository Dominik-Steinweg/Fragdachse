// Usage: node run2.mjs <shot> [...]  — one fresh browser per shot (bot peers stay in a page's room).
import { openGame, startScenario, cmd, cam, hud, stepFrames, recordShot } from './harness.mjs';
import { SHOTS } from './shots2.mjs';
import './actions2.mjs';
import './bfg2.mjs';
import './night2.mjs';
import './shots3.mjs';
import { sheet } from './sheet.mjs';

const dpr = Number(process.env.DPR ?? 2);
function makeCtx(page, st) {
  const m = st.metrics;
  const W = (gx, gy) => ({ x: m.offsetX + gx * 32 + 16, y: m.offsetY + gy * 32 + 16 });
  const run = async (c, quiet = false) => {
    const r = await page.evaluate(c => { const r = window.devScenario.run(c); return { ok: r.ok, error: r.error }; }, c);
    if (!r.ok && !quiet) console.log('  cmd failed', JSON.stringify(c), r.error);
    return r;
  };
  const ctx = {
    page, st, metrics: m, W, run,
    P: { x: (st.player.x - m.offsetX - 16) / 32, y: (st.player.y - m.offsetY - 16) / 32 },
    cam: v => cam(page, v),
    camAt: (gx, gy, zoom, extra = {}) => cam(page, { follow: false, ...W(gx, gy), zoom, ...extra }),
    tod: minutes => run({ action: 'options', values: { timeOfDay: Math.round(minutes) % 1440 } }),
    bot: (index, c) => run({ action: 'bot', index, ...c }),
    step: (n, dt) => stepFrames(page, n, dt),
    status: () => page.evaluate(() => window.devScenario.status()),
    async teleport(gx, gy) {
      await run({ action: 'target', gridX: gx, gridY: gy });
      const a = await page.evaluate(() => window.devScenario.run({ action: 'findFree' }).status.aim);
      await run({ action: 'teleport', gridX: a.gridX, gridY: a.gridY });
      return { x: a.gridX, y: a.gridY };
    },
    async spawnPack(kind, cx, cy, count, rx = 4, ry = rx) {
      return page.evaluate(([kind, cx, cy, count, rx, ry]) => {
        let ok = 0, tries = 0; const golden = 2.399963;
        while (ok < count && tries < count * 8) {
          const i = tries++; const r = Math.sqrt((i + 0.5) / (count * 2.2)); const a = i * golden;
          const gx = Math.round((cx + Math.cos(a) * r * rx) * 2) / 2, gy = Math.round((cy + Math.sin(a) * r * ry) * 2) / 2;
          if (window.devScenario.run({ action: 'spawn', kind, gridX: gx, gridY: gy }).ok) ok++;
        }
        return ok;
      }, [kind, cx, cy, count, rx, ry]);
    },
  };
  return ctx;
}

for (const name of process.argv.slice(2)) {
  const shot = SHOTS[name];
  if (!shot) { console.log('unknown shot', name); continue; }
  console.log(`== ${name}`);
  const t0 = Date.now();
  const { browser, page } = await openGame({ dpr });
  try {
    const st = await startScenario(page, { version: 1, seed: 4242, ...shot.scenario });
    await cmd(page, { action: 'pause' });
    await hud(page, false);
    const ctx = makeCtx(page, st);
    await page.evaluate(() => { window.__T.cur = null; window.__T.cam = { follow: true, x: 0, y: 0, zoom: 1, ox: 0, oy: 0, smooth: 0 }; });
    if (shot.setup) await shot.setup(ctx);
    const warm = shot.warmup ?? 60;
    for (let f = -warm; f < 0; f++) { if (shot.timeline) await shot.timeline(f, ctx); await stepFrames(page, 1); }
    console.log(`  setup ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const out = `shots/${name}.mp4`;
    await recordShot(page, { out, frames: shot.frames, speed: shot.speed, timeline: shot.timeline ? (f) => shot.timeline(f, ctx) : null });
    sheet(out);
  } catch (error) { console.log('  FAILED', error.message); }
  await browser.close();
}
