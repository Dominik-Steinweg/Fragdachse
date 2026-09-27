// Usage: node run.mjs <shotName> [...]   (shots defined in shots.mjs)
import { openGame, startScenario, cmd, cam, hud, stepFrames, recordShot } from './harness.mjs';
import { SHOTS } from './shots.mjs';
import './final_shots.mjs';
import './final_shots2.mjs';
import { sheet } from './sheet.mjs';

const names = process.argv.slice(2);
const dpr = Number(process.env.DPR ?? 2);
const { browser, page } = await openGame({ dpr });

function makeCtx(page, st) {
  const m = st.metrics;
  const ctx = {
    page, st, metrics: m,
    P: { x: (st.player.x - m.offsetX - 16) / 32, y: (st.player.y - m.offsetY - 16) / 32 },
    toWorld: (gx, gy) => ({ x: m.offsetX + gx * 32 + 16, y: m.offsetY + gy * 32 + 16 }),
    cmd: c => cmd(page, c),
    cam: v => cam(page, v),
    aim: (gx, gy) => page.evaluate(([x, y]) => { window.__T.dev.aim = { gridX: x, gridY: y }; }, [gx, gy]),
    player: () => page.evaluate(() => window.__T.dev.runtime.navigationLabPort.getPlayerPosition()),
    enemies: () => page.evaluate(() => window.__T.dev.runtime.navigationLabPort.readEnemies().map(e => ({ id: e.id, x: e.x, y: e.y, kind: e.kind }))),
    async teleport(gx, gy) {
      await page.evaluate(([x, y]) => { window.__T.dev.aim = { gridX: x, gridY: y }; }, [gx, gy]);
      const r = await page.evaluate(() => window.devScenario.run({ action: 'findFree' }));
      const a = r.status.aim;
      await cmd(page, { action: 'teleport', gridX: a.gridX, gridY: a.gridY });
      ctx.P = { x: a.gridX, y: a.gridY };
      return ctx.P;
    },
    /** Spawn `count` enemies in an ellipse around (cx, cy); tries many cells, skips blocked ones. */
    async spawnPack(kind, cx, cy, count, rx = 4, ry = rx, opts = {}) {
      const res = await page.evaluate(([kind, cx, cy, count, rx, ry, opts]) => {
        let ok = 0, tries = 0; const golden = 2.399963;
        while (ok < count && tries < count * 8) {
          const i = tries++; const r = Math.sqrt((i + 0.5) / (count * 2.2)); const a = i * golden;
          const gx = Math.round((cx + Math.cos(a) * r * rx) * 2) / 2, gy = Math.round((cy + Math.sin(a) * r * ry) * 2) / 2;
          const res = window.devScenario.run({ action: 'spawn', kind, gridX: gx, gridY: gy, ...(opts.pinned ? { pinned: true } : {}), ...(opts.hp ? { hp: opts.hp } : {}) });
          if (res.ok) ok++;
        }
        return ok;
      }, [kind, cx, cy, count, rx, ry, opts]);
      return res;
    },
    async build(id, gx, gy) { return cmd(page, { action: 'build', id, gridX: gx, gridY: gy }); },
    step: (n, dt) => stepFrames(page, n, dt),
  };
  return ctx;
}

for (const name of names) {
  const shot = SHOTS[name];
  if (!shot) { console.log('unknown shot', name); continue; }
  console.log(`== ${name}`);
  const t0 = Date.now();
  const st = await startScenario(page, { version: 1, seed: 4242, ...shot.scenario });
  await cmd(page, { action: 'pause' });
  await hud(page, false);
  const ctx = makeCtx(page, st);
  await page.evaluate(() => { window.__T.cur = null; window.__T.cam = { follow: true, x: 0, y: 0, zoom: 1, ox: 0, oy: 0, smooth: 0 }; });
  if (shot.setup) await shot.setup(ctx);
  // Warmup (e.g. building completes, enemies approach); runs the shot's timeline with negative frame numbers.
  const warm = shot.warmup ?? 45;
  for (let f = -warm; f < 0; f++) { if (shot.timeline) await shot.timeline(f, ctx); await stepFrames(page, 1); }
  console.log(`  setup ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const out = `shots/${name}.mp4`;
  await recordShot(page, { out, frames: shot.frames, speed: shot.speed, timeline: shot.timeline ? (f) => shot.timeline(f, ctx) : null });
  await cmd(page, { action: 'stop' });
  sheet(out);
}
await browser.close();
